import {
  TUNNEL_DURATION,
  getTunnelDiameter,
  getTunnelLook,
  getTunnelPhase,
  getTunnelTwitchInterval,
} from "./tunnelConfig.js";

const EYE_HEIGHT = 1.65;
const PATH_SAMPLES = 188;
// Eight extra radial samples are reserved for the higher-curvature fin tips;
// the path sampling remains unchanged so this is a small, silhouette-focused
// cost for WebXR rather than a blanket subdivision increase.
const PROFILE_SIDES = 40;
const WALL_DEFORMATION_TARGETS = 6;
const MINIMUM_CLEAR_RADIUS = 0.58;
const GRAZING_LIGHT_BOOST = 1.18;
const FILL_LIGHT_BOOST = 1.06;
const LATE_TUNNEL_VISIBILITY_START = 40;
const LATE_TUNNEL_RANGE_BOOST = 1.22;
const WHITE_ROOM_SPILL_START = 36;
const WHITE_ROOM_SPILL_MAX_INTENSITY = 4.5;
const WHITE_ROOM_SPILL_RANGE = 52;
// Existing morph fields remain deliberately uneven so they do not read as one
// synchronized tube pulse. Values are moderate and still safety-clamped.
const WALL_MOTION_AMPLITUDES = [1.1, 1.2, 1.02, 1.16, 1.07, 1.13];
const GRAZING_LIGHT_RIGS = [
  { ahead: -1.4, side: 0.62, height: 0.24, range: 6.8, intensity: 0.72, color: "#ffd1a3" },
  { ahead: 2.6, side: -0.66, height: -0.16, range: 8.6, intensity: 1.02, color: "#ffd1a3", returnRake: 0.72 },
  { ahead: 6.5, side: 0.58, height: 0.12, range: 10.2, intensity: 1.12, color: "#9fadc0", returnRake: 0.9 },
  { ahead: 11.4, side: -0.56, height: 0.28, range: 11.6, intensity: 0.96, color: "#8f9bad", returnRake: 1.08 },
  { ahead: 15.5, side: 0.48, height: -0.2, range: 10.4, intensity: 0.7, color: "#8f9bad" },
  // Lower-intensity counter-rakes overlap the existing moving pools of light.
  // They keep folds readable farther down the route without turning the tunnel
  // into a uniformly lit corridor.
  { ahead: 4.4, side: -0.64, height: 0.42, range: 9.4, intensity: 0.62, color: "#9fadc0" },
  { ahead: 9.1, side: 0.68, height: -0.34, range: 10.8, intensity: 0.7, color: "#8f9bad" },
  { ahead: 14.1, side: -0.6, height: 0.18, range: 12.2, intensity: 0.6, color: "#ffd1a3" },
];

// Six broad, asymmetric cross-section families establish chambers, compressed
// shoulders and deep opposing valleys. They are deliberately uneven in length
// and angle; no sequence repeats around the tunnel circumference.
const MACRO_FORM_FAMILIES = [
  { at: 0.08, span: 0.16, angle: 4.65, width: 0.82, twist: 0.72, compression: 0.2, cavity: 0.16, lower: 0.1 },
  { at: 0.25, span: 0.18, angle: 1.02, width: 0.94, twist: -0.58, compression: 0.24, cavity: 0.2, lower: 0.13 },
  { at: 0.43, span: 0.16, angle: 3.38, width: 0.72, twist: 1.08, compression: 0.22, cavity: 0.22, lower: 0.14 },
  { at: 0.58, span: 0.19, angle: 5.25, width: 0.88, twist: -0.84, compression: 0.27, cavity: 0.18, lower: 0.16 },
  { at: 0.71, span: 0.14, angle: 2.08, width: 0.68, twist: 0.98, compression: 0.29, cavity: 0.2, lower: 0.15 },
  { at: 0.79, span: 0.09, angle: 4.08, width: 0.74, twist: -0.55, compression: 0.18, cavity: 0.12, lower: 0.1 },
];

// Eleven independent longitudinal fin families form the reference-inspired
// interior. A fin is an actual inward displacement in the shell, flanked by
// outward grooves. The differing spans translate to roughly 2–10 m features.
const FIN_FAMILIES = [
  { at: 0.055, span: 0.05, angle: 5.05, width: 0.25, twist: 0.86, depth: 0.29, groove: 0.14, split: 0.36 },
  { at: 0.125, span: 0.075, angle: 2.42, width: 0.36, twist: -0.64, depth: 0.34, groove: 0.17, split: 0.54 },
  { at: 0.205, span: 0.048, angle: 0.52, width: 0.22, twist: 1.12, depth: 0.24, groove: 0.15, split: 0.3 },
  { at: 0.292, span: 0.082, angle: 4.18, width: 0.4, twist: -0.92, depth: 0.38, groove: 0.2, split: 0.62 },
  { at: 0.365, span: 0.052, angle: 1.72, width: 0.28, twist: 0.74, depth: 0.27, groove: 0.16, split: 0.42 },
  { at: 0.452, span: 0.066, angle: 5.72, width: 0.31, twist: 1.2, depth: 0.35, groove: 0.19, split: 0.5 },
  { at: 0.531, span: 0.046, angle: 2.88, width: 0.2, twist: -1.04, depth: 0.26, groove: 0.14, split: 0.28 },
  { at: 0.615, span: 0.078, angle: 0.86, width: 0.38, twist: 0.82, depth: 0.4, groove: 0.21, split: 0.68 },
  { at: 0.684, span: 0.05, angle: 3.96, width: 0.24, twist: -0.7, depth: 0.3, groove: 0.17, split: 0.34 },
  { at: 0.747, span: 0.055, angle: 5.38, width: 0.3, twist: 1.04, depth: 0.33, groove: 0.18, split: 0.46 },
  { at: 0.795, span: 0.04, angle: 1.9, width: 0.22, twist: -0.5, depth: 0.22, groove: 0.12, split: 0.25 },
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
    updateTunnelLights(lights, route, activeTime, impulse);
    impulse = Math.max(0, impulse - delta * 2.9);
  });

  return {
    mesh,
    route,
    setEnabled(enabled) {
      mesh.setEnabled(enabled);
      lights.points.forEach((light) => light.setEnabled(enabled));
      lights.fill.setEnabled(enabled);
      lights.whiteRoomSpill.setEnabled(enabled);
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
      updateTunnelLights(lights, route, activeTime, impulse * (0.25 + look.detail * 0.75));
    },
    setSequenceActive(active) {
      sequenceActive = active;
      if (!active) {
        activeTime = 0;
        impulse = 0;
        updateTunnelLights(lights, route, 0, 0);
      }
    },
    dispose() {
      scene.onBeforeRenderObservable.remove(observer);
      lights.points.forEach((light) => light.dispose());
      lights.fill.dispose();
      lights.whiteRoomSpill.dispose();
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
    * (0.035 + principalWall * 0.078 + supportingWall * 0.045)
    * diagonalShift * WALL_MOTION_AMPLITUDES[targetIndex];
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
  const referenceFlow = getReferenceFormFlow(angle, progress, detail);
  // Macro chambers, pronounced fins and meso folds are already present at
  // entry. The dramatic form language is therefore visible immediately, not
  // something introduced only by the later panic-lighting phases.
  const referenceProfile = 1 + referenceFlow.displacement;
  const preservedFunnelProfile = getPreviousOrganicProfile(angle, progress, detail);
  // The existing tiny White Room funnel is authoritative.  Ease the new
  // language back into its prior profile before the terminal aperture.
  const finalFunnelBlend = smoothstep((progress - 0.77) / 0.17);
  return BABYLON.Scalar.Clamp(
    BABYLON.Scalar.Lerp(referenceProfile, preservedFunnelProfile, finalFunnelBlend),
    0.64,
    1.48,
  );
}

function getReferenceFormFlow(angle, progress, detail) {
  let displacement = 0;
  let fin = 0;
  let groove = 0;
  let fold = 0;

  MACRO_FORM_FAMILIES.forEach((family, index) => {
    const longitudinal = bell(progress, family.at, family.span);
    const localProgress = (progress - family.at) / family.span;
    const flowingAngle = family.angle + localProgress * family.twist
      + Math.sin(localProgress * 2.35 + index * 0.71) * 0.2;
    const compressedShoulder = softAngularLobe(angle, flowingAngle, family.width) * longitudinal;
    const oppositeChamber = softAngularLobe(
      angle,
      flowingAngle + 2.05 + Math.sin(localProgress * 1.8) * 0.22,
      family.width * 1.1,
    ) * bell(progress, family.at + family.span * 0.1, family.span * 0.94);
    const lowerFold = softAngularLobe(
      angle,
      flowingAngle - 1.18 + localProgress * 0.42,
      family.width * 0.52,
    ) * bell(progress, family.at - family.span * 0.08, family.span * 1.12);
    displacement += -compressedShoulder * family.compression
      + oppositeChamber * family.cavity
      - lowerFold * family.lower;
    fin += compressedShoulder + lowerFold * 0.55;
    groove += oppositeChamber;
    fold += lowerFold;
  });

  FIN_FAMILIES.forEach((family, index) => {
    const longitudinal = bell(progress, family.at, family.span);
    const localProgress = (progress - family.at) / family.span;
    const finAngle = family.angle + localProgress * family.twist
      + Math.sin(localProgress * 2.6 + index * 1.17) * 0.13;
    const primaryFin = softAngularLobe(angle, finAngle, family.width) * longitudinal;
    const primaryGroove = softAngularLobe(
      angle,
      finAngle + 0.58 + Math.sin(localProgress * 1.9) * 0.14,
      family.width * 0.72,
    ) * bell(progress, family.at + family.span * 0.12, family.span * 1.08);
    const counterGroove = softAngularLobe(
      angle,
      finAngle - 0.66,
      family.width * 0.56,
    ) * bell(progress, family.at - family.span * 0.08, family.span * 0.9);
    // Some fins fork into a smaller ridge while others remain single. The
    // split varies by family and fades in/out with its parent rather than
    // creating a radial star pattern.
    const branch = softAngularLobe(
      angle,
      finAngle + 0.34 + localProgress * 0.38,
      family.width * 0.48,
    ) * bell(progress, family.at + family.span * family.split, family.span * 0.56);
    displacement += -primaryFin * family.depth
      + primaryGroove * family.groove
      + counterGroove * family.groove * 0.54
      - branch * family.depth * 0.58;
    fin += primaryFin + branch * 0.72;
    groove += primaryGroove + counterGroove;
    fold += branch;
  });

  // Meso-scale irregularity roughens the broad formations while staying far
  // below the depth of a fin or groove. Its unequal frequencies never align
  // to the route's mesh sections.
  const mesoScale = 0.042 + detail * 0.026;
  const meso = Math.sin(angle * 3.17 + progress * 17.3 + Math.sin(progress * 4.7)) * mesoScale
    + Math.sin(angle * 5.43 - progress * 11.1 + 0.9) * mesoScale * 0.52
    + Math.sin(angle * 2.21 + progress * 8.4) * mesoScale * 0.42;
  return { displacement: displacement + meso, fin, groove, fold };
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
  const flow = getReferenceFormFlow(angle, progress, look.detail);
  const finShade = Math.min(1, flow.fin);
  const grooveLight = Math.min(1, flow.groove);
  const foldShade = Math.min(1, flow.fold);
  const surfaceLight = 0.58 + grooveLight * 0.17 - finShade * 0.1 - foldShade * 0.13;
  target.push(
    base.r * surfaceLight,
    base.g * surfaceLight,
    base.b * surfaceLight,
    1,
  );
}

function createTunnelMaterial(scene) {
  const material = new BABYLON.PBRMaterial("organic-tunnel-pbr", scene);
  const textureRoot = "./assets/textures/tunnel/skin-alien-1k";
  // The mesh UVs already travel 9.2 times along the route and 2.8 times
  // around the shell. A non-integer multiplier keeps the 1K detail dense
  // without making its source tile readable through the long tunnel.
  const textureRepeat = 1.9;
  material.albedoTexture = createTexture(scene, `${textureRoot}/SkinAlien_19_1k_albedo.png`, textureRepeat, true);
  material.bumpTexture = createTexture(scene, `${textureRoot}/SkinAlien_19_1k_normal.png`, textureRepeat, false);
  material.bumpTexture.level = 0.36;
  // Babylon reads a grayscale roughness map through the green channel of its
  // metallic texture slot. Metallic contribution stays explicitly disabled.
  material.metallicTexture = createTexture(scene, `${textureRoot}/SkinAlien_19_1k_roughness.png`, textureRepeat, false);
  material.ambientTexture = createTexture(scene, `${textureRoot}/SkinAlien_19_1k_ambientOcclusion.png`, textureRepeat, false);
  material.ambientTexture.level = 0.1;
  material.useAmbientInGrayScale = true;
  material.useRoughnessFromMetallicTextureGreen = true;
  material.useMetallnessFromMetallicTextureBlue = false;
  material.useVertexColors = true;
  // The supplied albedo is intentionally subdued so the tunnel keeps its
  // established dark, abstract character rather than reading as saturated skin.
  material.albedoColor = BABYLON.Color3.FromHexString("#6d7780");
  material.metallic = 0;
  material.roughness = 0.82;
  material.environmentIntensity = 0.08;
  material.specularIntensity = 0.1;
  material.backFaceCulling = false;
  return material;
}

function createTunnelLights(scene, meshes, route) {
  const points = GRAZING_LIGHT_RIGS.map((rig, index) => {
    const frame = route.frameAt(0);
    const position = frame.position.clone();
    position.y += EYE_HEIGHT;
    // Each rig is later kept alongside the moving route position.  Starting
    // it off-axis ensures it rakes across the wall instead of becoming a
    // forward-facing headlight.
    position.addInPlace(frame.lateral.scale(rig.side));
    position.addInPlace(frame.vertical.scale(rig.height));
    const light = rig.returnRake
      ? new BABYLON.SpotLight(
        `organic-tunnel-light-${index}`,
        position,
        frame.tangent.scale(-1),
        1.72,
        1.15,
        scene,
      )
      : new BABYLON.PointLight(`organic-tunnel-light-${index}`, position, scene);
    light.range = rig.range;
    light.intensity = rig.intensity;
    light.diffuse = BABYLON.Color3.FromHexString(rig.color);
    light.includedOnlyMeshes.push(...meshes);
    return light;
  });
  const fill = new BABYLON.HemisphericLight("organic-tunnel-low-fill", BABYLON.Axis.Y, scene);
  fill.diffuse = BABYLON.Color3.FromHexString("#aeb7c4");
  fill.groundColor = BABYLON.Color3.FromHexString("#321d26");
  fill.intensity = 0.18;
  fill.includedOnlyMeshes.push(...meshes);
  const exitFrame = route.frameAt(1);
  const spillPosition = exitFrame.position.add(exitFrame.tangent.scale(3.1));
  spillPosition.y += EYE_HEIGHT;
  // Positioned just beyond the existing tunnel exit, this broad cone points
  // back into the tunnel and reads as light spilling out of the White Room.
  const whiteRoomSpill = new BABYLON.SpotLight(
    "white-room-tunnel-spill",
    spillPosition,
    exitFrame.tangent.scale(-1),
    2.58,
    1,
    scene,
  );
  whiteRoomSpill.diffuse = BABYLON.Color3.FromHexString("#e7edf5");
  whiteRoomSpill.range = WHITE_ROOM_SPILL_RANGE;
  whiteRoomSpill.intensity = 0;
  whiteRoomSpill.includedOnlyMeshes.push(...meshes);
  return { points, fill, whiteRoomSpill, rigs: GRAZING_LIGHT_RIGS };
}

function updateTunnelLights(lights, route, time, impulse) {
  const look = getTunnelLook(time);
  const phase = getTunnelPhase(time);
  // Keep the end dark, but never allow the converging tunnel to lose all
  // readable relief shortly before the White Room aperture.
  const lateVisibility = smoothstep((time - LATE_TUNNEL_VISIBILITY_START) / (TUNNEL_DURATION - LATE_TUNNEL_VISIBILITY_START));
  const whiteRoomSpillProgress = smoothstep((time - WHITE_ROOM_SPILL_START) / (TUNNEL_DURATION - WHITE_ROOM_SPILL_START));
  // Keep the fill deliberately low: it only preserves a trace of wall detail
  // in the deepest shadows, while the moving side lights define the relief.
  lights.fill.intensity = (0.14 + look.light * 0.13 + lateVisibility * 0.14) * FILL_LIGHT_BOOST;
  lights.whiteRoomSpill.intensity = WHITE_ROOM_SPILL_MAX_INTENSITY * whiteRoomSpillProgress;
  lights.points.forEach((light, index) => {
    const rig = lights.rigs[index];
    const lightTime = BABYLON.Scalar.Clamp(time + rig.ahead, 0, TUNNEL_DURATION);
    const frame = route.frameAt(lightTime / TUNNEL_DURATION);
    const sideOffset = Math.max(0.34, getTunnelDiameter(lightTime) * 0.29) * Math.sign(rig.side);
    light.position.copyFrom(frame.position);
    light.position.y += EYE_HEIGHT;
    light.position.addInPlace(frame.lateral.scale(sideOffset));
    light.position.addInPlace(frame.vertical.scale(rig.height));
    light.range = rig.range * BABYLON.Scalar.Lerp(1, LATE_TUNNEL_RANGE_BOOST, lateVisibility);
    if (rig.returnRake) {
      // These broad spots sit beside a later tunnel section and aim back down
      // the route, so their grazing highlight returns toward the traveller.
      const viewerTime = BABYLON.Scalar.Clamp(time - rig.returnRake, 0, TUNNEL_DURATION);
      const viewerFrame = route.frameAt(viewerTime / TUNNEL_DURATION);
      const viewerPosition = viewerFrame.position.clone();
      viewerPosition.y += EYE_HEIGHT;
      light.direction.copyFrom(viewerPosition.subtract(light.position).normalize());
    }
    // A modest lower bound keeps the fins readable through the late, dark
    // phases without flattening the tunnel into an evenly lit tube.
    const visibility = 0.66 + look.light * 0.42 + lateVisibility * 0.2;
    const pulse = index === 2 ? impulse * 0.16 : 0;
    light.intensity = rig.intensity * visibility * GRAZING_LIGHT_BOOST + pulse;
    if (phase.id === "PEAK" && index >= 3) {
      light.diffuse = BABYLON.Color3.FromHexString("#67252b");
    } else {
      light.diffuse = BABYLON.Color3.FromHexString(rig.color);
    }
  });
}

function createTexture(scene, url, tiling, gammaSpace) {
  const texture = new BABYLON.Texture(
    url,
    scene,
    false,
    false,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.uScale = tiling;
  texture.vScale = tiling;
  texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
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
