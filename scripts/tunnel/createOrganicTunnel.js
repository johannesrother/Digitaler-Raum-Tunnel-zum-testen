import {
  TUNNEL_DURATION,
  getTunnelDiameter,
  getTunnelLook,
  getTunnelPhase,
  getTunnelTwitchInterval,
} from "./tunnelConfig.js";

const EYE_HEIGHT = 1.65;
const PATH_SAMPLES = 188;
const PROFILE_SIDES = 32;
const WALL_DEFORMATION_TARGETS = 6;
const MINIMUM_CLEAR_RADIUS = 0.58;

// Broad, non-repeating form families reconstructed from the supplied tunnel
// reference: off-centre chambers, one-sided wall weight and folds which carry
// on for several metres before dissolving into the next formation.  They are
// deliberately defined in route progress rather than per mesh ring, so the
// shell remains one continuous space instead of a succession of segments.
const REFERENCE_FORM_FIELDS = [
  { at: 0.07, span: 0.15, angle: 4.38, width: 0.78, twist: 1.5, bulge: 0.24, cavity: 0.16, fold: 0.11 },
  { at: 0.22, span: 0.18, angle: 1.12, width: 0.92, twist: -1.15, bulge: 0.29, cavity: 0.2, fold: 0.14 },
  { at: 0.39, span: 0.2, angle: 3.03, width: 0.7, twist: 1.85, bulge: 0.26, cavity: 0.24, fold: 0.16 },
  { at: 0.57, span: 0.17, angle: 5.36, width: 1.02, twist: -1.48, bulge: 0.31, cavity: 0.18, fold: 0.13 },
  { at: 0.73, span: 0.14, angle: 2.25, width: 0.74, twist: 1.25, bulge: 0.23, cavity: 0.22, fold: 0.15 },
];

/**
 * Builds one continuous, inward-facing biomorphic shell along a non-linear
 * path. Wide, overlapping profile fields make the shell read as a continuous
 * living membrane instead of a cylinder assembled from visible rings.
 */
export function createOrganicTunnel(scene, options) {
  const route = createTunnelRoute(options.entrance);
  const { mesh, wallDeformation } = createTunnelShell(scene, route);
  const material = createTunnelMaterial(scene);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  const lights = createTunnelLights(scene, [mesh], route);
  let nextImpulseAt = 12.7;
  let impulse = 0;
  let activeTime = 0;
  let sequenceActive = false;
  let previousFrameTime = performance.now();
  const observer = scene.onBeforeRenderObservable.add(() => {
    const frameTime = performance.now();
    const delta = Math.min((frameTime - previousFrameTime) / 1000, 0.04);
    previousFrameTime = frameTime;
    if (sequenceActive) {
      activeTime = Math.min(activeTime + delta, TUNNEL_DURATION);
    }
    wallDeformation.update(activeTime);
    updateTunnelLights(lights, activeTime, impulse);
    impulse = Math.max(0, impulse - delta * 2.9);
  });

  return {
    mesh,
    route,
    setEnabled(enabled) {
      mesh.setEnabled(enabled);
      lights.points.forEach((light) => light.setEnabled(enabled));
      lights.fill.setEnabled(enabled);
    },
    update(tunnelTime) {
      sequenceActive = true;
      // The walls may already be visible and moving through the rift. Keep
      // that motion continuous when the travel clock begins instead of
      // resetting the deformation phase to zero on the crossing frame.
      activeTime = Math.max(activeTime, BABYLON.Scalar.Clamp(tunnelTime, 0, TUNNEL_DURATION));
      const look = getTunnelLook(activeTime);
      if (activeTime >= nextImpulseAt) {
        impulse = 1;
        // Irrational-looking, deterministic intervals keep impulses rare and
        // non-musical without a per-frame random system.
        const interval = getTunnelTwitchInterval(activeTime);
        nextImpulseAt += interval > 0 ? interval * (0.72 + ((nextImpulseAt * 1.73) % 0.58)) : 9;
      }
      updateTunnelLights(lights, activeTime, impulse * (0.25 + look.detail * 0.75));
    },
    setSequenceActive(active) {
      sequenceActive = active;
      if (!active) {
        activeTime = 0;
        impulse = 0;
        updateTunnelLights(lights, 0, 0);
      }
    },
    dispose() {
      scene.onBeforeRenderObservable.remove(observer);
      lights.points.forEach((light) => light.dispose());
      lights.fill.dispose();
      wallDeformation.dispose();
      mesh.dispose();
      material.dispose();
    },
  };
}

function createTunnelRoute(entrance) {
  const fromEntrance = (forward, lateral, elevation) => {
    const point = entrance.center
      .add(entrance.forward.scale(forward))
      .add(entrance.lateral.scale(lateral));
    point.y = elevation;
    return point;
  };

  const controls = [
    // Begin the continuous organic shell at the portal itself.  The remaining
    // controls are unchanged, preserving the established tunnel path.
    fromEntrance(0, 0, 0),
    fromEntrance(16, -0.35, 0.04),
    fromEntrance(30, -1.45, -0.08),
    fromEntrance(45, -1.1, -0.13),
    fromEntrance(57, 0.45, -0.06),
    fromEntrance(65, 1.05, 0.02),
    fromEntrance(70, 0.65, 0.08),
    fromEntrance(73, 0.2, 0.1),
    fromEntrance(76, 0, 0.1),
  ];
  const samples = [];
  let totalLength = 0;
  let previous = controls[0].clone();

  for (let index = 0; index <= PATH_SAMPLES; index += 1) {
    const progress = index / PATH_SAMPLES;
    const point = sampleCatmullRom(controls, progress);
    if (index > 0) {
      totalLength += BABYLON.Vector3.Distance(previous, point);
    }
    samples.push({ point, length: totalLength });
    previous = point;
  }

  return {
    length: totalLength,
    start: samples[0].point.clone(),
    end: samples.at(-1).point.clone(),
    positionAt(progress) {
      const clamped = BABYLON.Scalar.Clamp(progress, 0, 1);
      const floatIndex = clamped * PATH_SAMPLES;
      const index = Math.min(PATH_SAMPLES - 1, Math.floor(floatIndex));
      return BABYLON.Vector3.Lerp(samples[index].point, samples[index + 1].point, floatIndex - index);
    },
    distanceAtProgress(progress) {
      const clamped = BABYLON.Scalar.Clamp(progress, 0, 1);
      const floatIndex = clamped * PATH_SAMPLES;
      const index = Math.min(PATH_SAMPLES - 1, Math.floor(floatIndex));
      return BABYLON.Scalar.Lerp(samples[index].length, samples[index + 1].length, floatIndex - index);
    },
    progressAtDistance(distance) {
      const clamped = BABYLON.Scalar.Clamp(distance, 0, totalLength);
      let lower = 0;
      let upper = samples.length - 1;
      while (upper - lower > 1) {
        const middle = Math.floor((lower + upper) / 2);
        if (samples[middle].length < clamped) {
          lower = middle;
        } else {
          upper = middle;
        }
      }
      const span = Math.max(samples[upper].length - samples[lower].length, 0.0001);
      return (lower + (clamped - samples[lower].length) / span) / PATH_SAMPLES;
    },
    tangentAt(progress) {
      const step = 1 / PATH_SAMPLES;
      const before = this.positionAt(Math.max(0, progress - step));
      const after = this.positionAt(Math.min(1, progress + step));
      return after.subtract(before).normalize();
    },
    frameAt(progress) {
      const tangent = this.tangentAt(progress);
      const lateral = BABYLON.Vector3.Cross(BABYLON.Axis.Y, tangent).normalize();
      const vertical = BABYLON.Vector3.Cross(tangent, lateral).normalize();
      return { position: this.positionAt(progress), tangent, lateral, vertical };
    },
  };
}

function createTunnelShell(scene, route) {
  const positions = [];
  const indices = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const deformationVertices = [];

  for (let section = 0; section <= PATH_SAMPLES; section += 1) {
    const progress = section / PATH_SAMPLES;
    const time = progress * TUNNEL_DURATION;
    const center = route.positionAt(progress);
    center.y += EYE_HEIGHT;
    const { lateral, vertical } = route.frameAt(progress);
    const diameter = getFinalFunnelDiameter(time);
    const look = getTunnelLook(time);

    for (let side = 0; side < PROFILE_SIDES; side += 1) {
      const angle = (side / PROFILE_SIDES) * Math.PI * 2;
      const profile = organicProfile(angle, progress, look.detail);
      const radius = diameter * 0.5 * profile;
      const direction = lateral.scale(Math.cos(angle)).add(vertical.scale(Math.sin(angle))).normalize();
      const point = center.add(direction.scale(radius));
      positions.push(point.x, point.y, point.z);
      deformationVertices.push({
        angle,
        progress,
        radius,
        direction,
      });
      uvs.push(progress * 9.2, side / PROFILE_SIDES * 2.8);
      pushTunnelColor(colors, time, angle, progress, look);
    }
  }

  for (let section = 0; section < PATH_SAMPLES; section += 1) {
    for (let side = 0; side < PROFILE_SIDES; side += 1) {
      const nextSide = (side + 1) % PROFILE_SIDES;
      const current = section * PROFILE_SIDES + side;
      const next = (section + 1) * PROFILE_SIDES + side;
      const currentNext = section * PROFILE_SIDES + nextSide;
      const nextNext = (section + 1) * PROFILE_SIDES + nextSide;
      // Reversed winding makes the calculated normals face toward the visitor.
      indices.push(current, nextNext, next, current, currentNext, nextNext);
    }
  }

  BABYLON.VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new BABYLON.Mesh("general-organic-tunnel-v1", scene);
  const data = new BABYLON.VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = uvs;
  data.colors = colors;
  data.applyToMesh(mesh);
  return {
    mesh,
    wallDeformation: createWallDeformation(scene, mesh, positions, indices, deformationVertices),
  };
}

/**
 * Six broad contraction fields are blended by Babylon's morph-target system.
 * The GPU interpolates the existing wall vertices; no geometry is rebuilt
 * while the visitor travels through the tunnel.
 */
function createWallDeformation(scene, mesh, basePositions, indices, vertices) {
  const manager = new BABYLON.MorphTargetManager(scene);
  const targets = Array.from({ length: WALL_DEFORMATION_TARGETS }, (_, targetIndex) => {
    const positions = basePositions.slice();
    vertices.forEach((vertex, index) => {
      const requestedContraction = getLocalContraction(vertex.progress, vertex.angle, targetIndex);
      const safeContraction = Math.max(0, 1 - MINIMUM_CLEAR_RADIUS / vertex.radius);
      const contraction = Math.min(requestedContraction, safeContraction);
      const offset = vertex.direction.scale(-vertex.radius * contraction);
      const position = index * 3;
      positions[position] += offset.x;
      positions[position + 1] += offset.y;
      positions[position + 2] += offset.z;
    });
    const normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    const target = new BABYLON.MorphTarget(`organic-wall-pressure-${targetIndex}`, 0, scene);
    target.setPositions(positions);
    target.setNormals(normals);
    manager.addTarget(target);
    return target;
  });
  mesh.morphTargetManager = manager;

  return {
    update(time) {
      targets.forEach((target, targetIndex) => {
        target.influence = getPressureWaveInfluence(time, targetIndex);
      });
    },
    dispose() {
      manager.dispose();
    },
  };
}

function getLocalContraction(progress, angle, targetIndex) {
  const center = [0.1, 0.25, 0.4, 0.56, 0.72, 0.86][targetIndex];
  const regionalMask = bell(progress, center, 0.145);
  const entryMask = smoothstep((progress - 0.035) / 0.18);
  // The final opening stays calm and clear for the White Room sightline.
  const exitMask = 1 - smoothstep((progress - 0.88) / 0.11);
  const journeyStrength = getJourneyDeformationStrength(progress * TUNNEL_DURATION);
  const principalWall = softAngularLobe(angle, targetIndex * 1.19 + 0.44, 0.78);
  const supportingWall = softAngularLobe(angle, targetIndex * 1.87 + 2.1, 1.04) * 0.52;
  const diagonalShift = 0.72 + 0.28 * Math.sin(angle * 1.45 + progress * 12.7 + targetIndex * 0.71);
  return regionalMask * entryMask * exitMask * journeyStrength
    * (0.035 + principalWall * 0.078 + supportingWall * 0.045) * diagonalShift;
}

function getJourneyDeformationStrength(time) {
  const arrival = smoothstep((time - 4) / 16);
  const compression = smoothstep((time - 18) / 34);
  const finalConstriction = smoothstep((time - 50) / 10);
  const release = 1 - smoothstep((time - 58.6) / 1.4);
  // The final wave presses forward through the funnel, then vanishes as the
  // visitor crosses into the White Room.
  return (0.42 + arrival * 0.25 + compression * 0.24 + finalConstriction * 0.18) * release;
}

function getPressureWaveInfluence(time, targetIndex) {
  const targetCenter = [0.1, 0.25, 0.4, 0.56, 0.72, 0.86][targetIndex];
  // One wave begins deeper in the passage and moves toward the visitor while
  // a slower one glides forward. Cross-fading nearby fields makes the motion
  // read as travelling pressure rather than a synchronized tube pulse.
  const returningWave = wrap01(0.96 - time * 0.027);
  const advancingWave = wrap01(0.16 + time * 0.017 + Math.sin(time * 0.11) * 0.04);
  const returningPressure = circularBell(targetCenter, returningWave, 0.14);
  const advancingPressure = circularBell(targetCenter, advancingWave, 0.2) * 0.48;
  const finalPush = smoothstep((time - 50) / 10);
  const exitBoundWave = 0.08 + BABYLON.Scalar.Clamp((time - 50) / 10, 0, 1) * 0.8;
  const expulsionPressure = circularBell(targetCenter, exitBoundWave, 0.15) * finalPush * 1.28;
  const breath = 0.06 + 0.06 * (0.5 + 0.5 * Math.sin(time * (0.31 + targetIndex * 0.037) + targetIndex * 1.83));
  const lateIntensity = 0.66 + smoothstep((time - 16) / 35) * 0.34;
  return BABYLON.Scalar.Clamp((returningPressure + advancingPressure + expulsionPressure + breath) * lateIntensity, 0, 1);
}

function getFinalFunnelDiameter(time) {
  const baseDiameter = getTunnelDiameter(time);
  const finalProgress = smoothstep((time - 48) / 12);
  // At the tightest point the varying cross-section yields an approximately
  // 0.3 m visual aperture, while the uncollided camera path remains central.
  return BABYLON.Scalar.Lerp(baseDiameter, 0.38, finalProgress);
}

function bell(value, center, width) {
  const distance = (value - center) / width;
  return Math.exp(-distance * distance * 3.2);
}

function organicProfile(angle, progress, detail) {
  const referenceFlow = getReferenceFormFlow(angle, progress);
  // The large formations stay legible even in the calm first seconds. Detail
  // only increases their pressure; it never turns the shell back into a
  // uniform, noise-deformed cylinder.
  const formStrength = 0.82 + detail * 0.38;
  const referenceProfile = 1 + referenceFlow.displacement * formStrength;
  const preservedFunnelProfile = getPreviousOrganicProfile(angle, progress, detail);
  // The existing tiny White Room funnel is authoritative.  Ease the new
  // language back into its prior profile before the terminal aperture.
  const finalFunnelBlend = smoothstep((progress - 0.79) / 0.14);
  return BABYLON.Scalar.Clamp(
    BABYLON.Scalar.Lerp(referenceProfile, preservedFunnelProfile, finalFunnelBlend),
    0.66,
    1.38,
  );
}

function getReferenceFormFlow(angle, progress) {
  let displacement = 0;
  let bulge = 0;
  let cavity = 0;
  let ridge = 0;

  REFERENCE_FORM_FIELDS.forEach((field, index) => {
    const longitudinal = bell(progress, field.at, field.span);
    // Each formation slowly rotates as it travels down the passage. This is
    // the longitudinal flow visible in the reference, not a radial ring.
    const localProgress = (progress - field.at) / field.span;
    const flowingAngle = field.angle + localProgress * field.twist
      + Math.sin(localProgress * 2.1 + index * 0.83) * 0.18;
    const weightedBulge = softAngularLobe(angle, flowingAngle, field.width) * longitudinal;
    const innerCavity = softAngularLobe(
      angle,
      flowingAngle + 2.12 + Math.sin(localProgress * 1.7) * 0.28,
      field.width * 0.78,
    ) * bell(progress, field.at + field.span * 0.16, field.span * 0.82);
    const diagonalFold = softAngularLobe(
      angle,
      flowingAngle - 0.93 + localProgress * 0.58,
      field.width * 0.34,
    ) * bell(progress, field.at - field.span * 0.1, field.span * 1.22);

    displacement += weightedBulge * field.bulge - innerCavity * field.cavity + diagonalFold * field.fold;
    bulge += weightedBulge;
    cavity += innerCavity;
    ridge += diagonalFold;
  });

  // A restrained irregular drift joins the major formations without adding
  // a readable construction rhythm or fine procedural noise.
  const connectiveFlow = Math.sin(angle * 1.31 + progress * 5.2 + Math.sin(progress * 3.7)) * 0.032
    + Math.sin(angle * 2.06 - progress * 3.3 + 1.7) * 0.018;
  return { displacement: displacement + connectiveFlow, bulge, cavity, ridge };
}

function getPreviousOrganicProfile(angle, progress, detail) {
  const intensity = 0.34 + detail * 0.76;
  const primaryBulge = Math.sin(angle * 1.08 + progress * 4.3 + Math.sin(progress * 2.2) * 0.7) * 0.15;
  const opposingBulge = Math.sin(angle * 2.17 - progress * 6.6 + 1.4) * 0.085;
  const softFold = Math.sin(angle * 3.12 + progress * 13.8 + Math.sin(progress * 5.1)) * 0.064;
  const driftingCavity = -softAngularLobe(angle, progress * 8.4 + 1.9, 0.66)
    * (0.055 + detail * 0.085);
  const smallShift = Math.sin(angle * 4.31 - progress * 19.7 + 0.8) * 0.02;
  return 1 + (primaryBulge + opposingBulge + softFold + driftingCavity + smallShift) * intensity;
}

function softAngularLobe(angle, center, width) {
  const offset = Math.atan2(Math.sin(angle - center), Math.cos(angle - center));
  return Math.exp(-((offset / width) ** 2) * 1.8);
}

function circularBell(value, center, width) {
  const offset = Math.min(Math.abs(value - center), 1 - Math.abs(value - center));
  return Math.exp(-((offset / width) ** 2) * 3.4);
}

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function pushTunnelColor(target, time, angle, progress, look) {
  const warm = new BABYLON.Color3(0.82, 0.75, 0.64);
  const charcoal = new BABYLON.Color3(0.12, 0.12, 0.145);
  const progression = smoothstep((time - 5) / 53);
  const base = BABYLON.Color3.Lerp(warm, charcoal, progression);
  const flow = getReferenceFormFlow(angle, progress);
  const bulgeLight = Math.min(1, flow.bulge);
  const cavityShade = Math.min(1, flow.cavity);
  const ridgeShade = Math.min(1, flow.ridge);
  const surfaceLight = 0.62 + bulgeLight * 0.2 - ridgeShade * 0.13 - cavityShade * 0.12;
  target.push(
    base.r * surfaceLight,
    base.g * surfaceLight,
    base.b * surfaceLight,
    1,
  );
}

function createTunnelMaterial(scene) {
  const material = new BABYLON.PBRMaterial("organic-tunnel-pbr", scene);
  material.albedoTexture = createTexture(scene, "./assets/textures/architecture/ivory-mineral/ivory_mineral_1k_color.jpg", 1, true);
  material.bumpTexture = createTexture(scene, "./assets/textures/architecture/ivory-mineral/ivory_mineral_1k_normalgl.jpg", 1, false);
  material.bumpTexture.level = 0.16;
  material.metallicTexture = createTexture(scene, "./assets/textures/architecture/ivory-mineral/ivory_mineral_1k_roughness.jpg", 1, false);
  material.useRoughnessFromMetallicTextureGreen = true;
  material.useMetallnessFromMetallicTextureBlue = false;
  material.useVertexColors = true;
  material.albedoColor = BABYLON.Color3.White();
  material.metallic = 0;
  material.roughness = 0.9;
  material.environmentIntensity = 0.08;
  material.specularIntensity = 0.1;
  material.backFaceCulling = false;
  return material;
}

function createTunnelLights(scene, meshes, route) {
  const points = [0.01, 0.25, 0.52, 0.77, 0.94].map((progress, index) => {
    const position = route.positionAt(progress);
    position.y += EYE_HEIGHT;
    const light = new BABYLON.PointLight(`organic-tunnel-light-${index}`, position, scene);
    light.range = index === 0 ? 5.8 : 4.8;
    light.intensity = 0.56;
    light.diffuse = index < 2
      ? BABYLON.Color3.FromHexString("#ffd1a3")
      : BABYLON.Color3.FromHexString("#8f9bad");
    light.includedOnlyMeshes.push(...meshes);
    return light;
  });
  const fill = new BABYLON.HemisphericLight("organic-tunnel-low-fill", BABYLON.Axis.Y, scene);
  fill.diffuse = BABYLON.Color3.FromHexString("#aeb7c4");
  fill.groundColor = BABYLON.Color3.FromHexString("#321d26");
  fill.intensity = 0.2;
  fill.includedOnlyMeshes.push(...meshes);
  return { points, fill };
}

function updateTunnelLights(lights, time, impulse) {
  const look = getTunnelLook(time);
  const phase = getTunnelPhase(time);
  lights.fill.intensity = 0.08 + look.light * 0.2;
  lights.points.forEach((light, index) => {
    const proximity = 1 - Math.min(1, Math.abs(index / (lights.points.length - 1) - time / TUNNEL_DURATION) * 2.6);
    const pulse = index === 2 ? impulse * 0.16 : 0;
    light.intensity = (0.38 + proximity * 0.78) * look.light + pulse;
    if (phase.id === "PEAK" && index >= 3) {
      light.diffuse = BABYLON.Color3.FromHexString("#67252b");
    }
  });
}

function createTexture(scene, url, tiling, gammaSpace) {
  const texture = new BABYLON.Texture(url, scene, true, false);
  texture.uScale = tiling;
  texture.vScale = tiling;
  texture.gammaSpace = gammaSpace;
  texture.anisotropicFilteringLevel = 2;
  return texture;
}

function sampleCatmullRom(points, progress) {
  const scaled = progress * (points.length - 1);
  const segment = Math.min(points.length - 2, Math.floor(scaled));
  const local = scaled - segment;
  const a = points[Math.max(0, segment - 1)];
  const b = points[segment];
  const c = points[segment + 1];
  const d = points[Math.min(points.length - 1, segment + 2)];
  return new BABYLON.Vector3(
    catmull(a.x, b.x, c.x, d.x, local),
    catmull(a.y, b.y, c.y, d.y, local),
    catmull(a.z, b.z, c.z, d.z, local),
  );
}

function catmull(a, b, c, d, value) {
  const square = value * value;
  const cube = square * value;
  return 0.5 * ((2 * b) + (-a + c) * value + (2 * a - 5 * b + 4 * c - d) * square + (-a + 3 * b - 3 * c + d) * cube);
}

function smoothstep(value) {
  const clamped = BABYLON.Scalar.Clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}
