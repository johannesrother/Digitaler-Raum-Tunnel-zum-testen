import {
  TUNNEL_DURATION,
  getTunnelDiameter,
  getTunnelPhase,
} from "./tunnelConfig.js";

const IDYLL_TRAVEL_DURATION = 20;
const RIFT_FORM_START = 16;
const RIFT_TUNNEL_REVEAL_START = 18.25;
const RIFT_PULL_DURATION = 2.25;
const TUNNEL_START = IDYLL_TRAVEL_DURATION + RIFT_PULL_DURATION;
const WHITE_ROOM_ARRIVAL_DURATION = 1;
const WHITE_ROOM_DURATION = 5;
const WHITE_PREVIEW_START = 30;
const TUNNEL_BLEND_DURATION = 2;
const FINAL_PULL_START = 52;
const FINAL_PULL_DURATION = TUNNEL_DURATION - FINAL_PULL_START;
const FINAL_PULL_STRENGTH = 1.2;
const RIFT_APPROACH_REMAINING_TIME = 3.4;
const RIFT_CLOSE_DURATION = 1.4;
const RIFT_CLOSURE_FADE_RANGE = 0.42;
const RIFT_VISIBILITY_EPSILON = 0.002;
const ENTRY_ROUTE_EASE_DURATION = 0.75;
const FLASH_DEBUG_DURATION_MS = 4000;

/**
 * The only automatic motion in the experience. A parent transform carries
 * desktop and XR cameras through the route without ever writing head yaw.
 */
export function createIdyllTunnelTransition(scene, options) {
  const root = new BABYLON.TransformNode("idyll-to-tunnel-locomotion-root", scene);
  const start = options.startPosition.clone();
  const entry = createEntryPath(start, options.entrance, options.initialForward, options.tunnel.route.start);
  const tunnelRoute = createTunnelTravelRoute(entry, options.tunnel.route, options.entrance.center);
  const tunnelWorld = createTunnelWorldGroup(scene, options);
  const rift = createSpacetimeRift(
    scene,
    options.entrance,
    options.tunnel.route.start,
    options.tunnel.mesh,
    options.idyllWorldMeshes,
  );
  const riftApproachTime = Math.max(0.5, tunnelRoute.entryTime - RIFT_APPROACH_REMAINING_TIME);
  const debug = createDebugPanel();
  const flashDebug = createTunnelFlashDebug(scene, options, root, rift);
  let elapsed = 0;
  let xrCamera = null;
  let previousWorldHidden = false;
  let idyllHidden = false;
  let whiteRoomFinished = false;
  let portalClosed = false;
  let tunnelEntryPrepared = false;
  let previousFrameTime = performance.now();
  const initialHeading = headingFrom(options.initialForward);

  // Keep the camera at the root origin. The root can now yaw along the
  // spline without orbiting a desktop camera around the world origin.
  root.position.copyFrom(start);
  options.desktopCamera.parent = root;
  options.desktopCamera.position.set(0, options.desktopCamera.position.y - start.y, 0);
  // The real tunnel stays out of the idyll until the rift itself is open.
  tunnelWorld.hide();
  options.tunnel.setSequenceActive(false);

  const observer = scene.onBeforeRenderObservable.add(() => {
    flashDebug.nextFrame();
    const frameTime = performance.now();
    const delta = Math.min((frameTime - previousFrameTime) / 1000, 0.04);
    previousFrameTime = frameTime;
    elapsed += delta;
    const riftFormation = smoothstep((elapsed - RIFT_FORM_START) / (IDYLL_TRAVEL_DURATION - RIFT_FORM_START));
    const tunnelReveal = smoothstep((elapsed - RIFT_TUNNEL_REVEAL_START) / (IDYLL_TRAVEL_DURATION - RIFT_TUNNEL_REVEAL_START));
    const tunnelElapsed = elapsed - TUNNEL_START;
    const tunnelTime = BABYLON.Scalar.Clamp(tunnelElapsed, 0, TUNNEL_DURATION);
    const hasEnteredTunnel = elapsed >= TUNNEL_START;
    const hasReachedWhiteRoom = tunnelElapsed >= TUNNEL_DURATION;

    if (hasEnteredTunnel && !tunnelEntryPrepared) {
      tunnelEntryPrepared = true;
      flashDebug.start();
      options.onTunnelEntry?.();
    }
    if (!portalClosed) {
      tunnelWorld.reveal(tunnelReveal);
    }
    // Start the already visible tunnel's wall motion before the visitor
    // crosses the rift. This avoids a second visual "start" at entry.
    options.tunnel.setSequenceActive(tunnelReveal > 0.01 && !hasReachedWhiteRoom);
    // The first frame inside the tunnel is a hard world boundary. The Rift
    // disables its stencil portal as it begins closing, so the idyll must be
    // retired in this very frame rather than during a later overlap window.
    if (hasEnteredTunnel && !idyllHidden) {
      tunnelWorld.closePortal();
      rift.closePortalMask();
      portalClosed = true;
      idyllHidden = true;
    }
    rift.update(elapsed, riftFormation, tunnelReveal, hasEnteredTunnel ? tunnelTime : -1);

    if (elapsed < IDYLL_TRAVEL_DURATION) {
      applyPathTransform(root, tunnelRoute, riftApproachTime * calmTravelProgress(elapsed / IDYLL_TRAVEL_DURATION), initialHeading, delta);
    } else if (!hasEnteredTunnel) {
      applyPathTransform(root, tunnelRoute, riftApproachTime + (tunnelRoute.entryTime - riftApproachTime)
        * riftPullProgress(elapsed - IDYLL_TRAVEL_DURATION, tunnelRoute, riftApproachTime), initialHeading, delta);
    } else if (!hasReachedWhiteRoom) {
      applyPathTransform(
        root,
        tunnelRoute,
        tunnelRoute.entryTime + tunnelTravelTime(tunnelTime, tunnelRoute, riftApproachTime),
        initialHeading,
        delta,
      );
      options.tunnel.update(tunnelTime);
      if (tunnelTime >= WHITE_PREVIEW_START) {
        options.whiteRoom.preview(smoothstep((tunnelTime - WHITE_PREVIEW_START) / (TUNNEL_DURATION - WHITE_PREVIEW_START)));
      }
    } else {
      activateWhiteRoom(options, root);
      const whiteElapsed = tunnelElapsed - TUNNEL_DURATION;
      const releaseStartSpeed = tunnelRoute.normalTunnelSpeed * finalTunnelSpeedMultiplier();
      const releaseDistance = BABYLON.Vector3.Distance(tunnelRoute.endPosition, options.whiteRoom.finalPosition);
      const releaseStartSlope = BABYLON.Scalar.Clamp(
        releaseStartSpeed * WHITE_ROOM_ARRIVAL_DURATION / Math.max(releaseDistance, 0.001),
        0.15,
        1.45,
      );
      const arrival = finalReleaseProgress(whiteElapsed / WHITE_ROOM_ARRIVAL_DURATION, releaseStartSlope);
      root.position.copyFrom(BABYLON.Vector3.Lerp(tunnelRoute.endPosition, options.whiteRoom.finalPosition, arrival));
      if (!previousWorldHidden && whiteElapsed >= WHITE_ROOM_ARRIVAL_DURATION) {
        isolatePreviousWorld(options);
        previousWorldHidden = true;
      }
      if (!whiteRoomFinished && whiteElapsed >= WHITE_ROOM_DURATION) {
        options.whiteRoomTone.deactivate();
        whiteRoomFinished = true;
      }
    }
    debug.update(elapsed, tunnelTime, tunnelRoute, hasEnteredTunnel, riftFormation, riftApproachTime);
    flashDebug.capture(tunnelTime, tunnelRoute, riftApproachTime);
  });

  return {
    attachWebXR(xr) {
      if (!xr) {
        return;
      }
      xr.onStateChangedObservable.add((state) => {
        const isInXr = state === BABYLON.WebXRState.IN_XR;
        if (isInXr) {
          xrCamera = xr.baseExperience.camera;
          xrCamera.parent = root;
          syncRootToExperienceTime(root, elapsed, tunnelRoute, options.whiteRoom, initialHeading, riftApproachTime);
          return;
        }
        if (xrCamera) {
          xrCamera.parent = null;
          xrCamera = null;
        }
        syncRootToExperienceTime(root, elapsed, tunnelRoute, options.whiteRoom, initialHeading, riftApproachTime);
      });
    },
    dispose() {
      scene.onBeforeRenderObservable.remove(observer);
      options.desktopCamera.parent = null;
      if (xrCamera) {
        xrCamera.parent = null;
      }
      debug.dispose();
      flashDebug.dispose();
      rift.dispose();
      root.dispose();
    },
  };
}

function createEntryPath(start, entrance, initialForward, finish) {
  const direction = initialForward.clone();
  direction.y = 0;
  direction.normalize();
  const controlA = start.add(direction.scale(4.2));
  const controlB = entrance.center.subtract(entrance.forward.scale(3.1));
  const points = [];
  for (let index = 0; index <= 88; index += 1) {
    points.push(cubicBezier(start, controlA, controlB, finish, index / 88));
  }
  return points;
}

function createTunnelTravelRoute(entryPath, tunnelRoute, entranceCenter) {
  const points = [...entryPath];
  for (let index = 0; index <= 188; index += 1) {
    // The cap stays just ahead of the final ascent endpoint; the visitor can
    // never cross it or leave the visible tunnel volume.
    if (index > 0) {
      points.push(tunnelRoute.positionAt(index / 188 * 0.986));
    }
  }
  return createPolylineRoute(points, closestDistanceAlongPolyline(points, entranceCenter));
}

function createPolylineRoute(points, entranceDistance) {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(lengths[index - 1] + BABYLON.Vector3.Distance(points[index - 1], points[index]));
  }
  const totalLength = lengths.at(-1);
  // The old 60-second clock included the approach from the idyll to the
  // opening. Keep that route and its gentle ease-in, but derive its duration
  // so the distance after the physical entrance always takes exactly 60 s.
  const distanceInsideTunnel = totalLength - entranceDistance;
  const duration = TUNNEL_DURATION * totalLength / distanceInsideTunnel
    + ENTRY_ROUTE_EASE_DURATION * 0.5;
  const normalTunnelSpeed = totalLength / (duration - ENTRY_ROUTE_EASE_DURATION * 0.5);

  const distanceAt = (time) => {
    const clamped = BABYLON.Scalar.Clamp(time, 0, duration);
    if (clamped < ENTRY_ROUTE_EASE_DURATION) {
      const easeProgress = clamped / ENTRY_ROUTE_EASE_DURATION;
      return normalTunnelSpeed * ENTRY_ROUTE_EASE_DURATION
        * (easeProgress ** 3 - 0.5 * easeProgress ** 4);
    }
    return normalTunnelSpeed * (clamped - ENTRY_ROUTE_EASE_DURATION * 0.5);
  };

  const positionAt = (time) => {
    const clamped = BABYLON.Scalar.Clamp(time, 0, duration);
    const distance = distanceAt(clamped);
    const next = lengths.findIndex((length) => length >= distance);
    if (next <= 0) {
      return points[0].clone();
    }
    const before = lengths[next - 1];
    const span = Math.max(lengths[next] - before, 0.0001);
    return BABYLON.Vector3.Lerp(points[next - 1], points[next], (distance - before) / span);
  };

  return {
    endPosition: points.at(-1).clone(),
    totalLength,
    duration,
    entryDistance: entranceDistance,
    entryTime: entranceDistance / normalTunnelSpeed + ENTRY_ROUTE_EASE_DURATION * 0.5,
    distanceAt,
    positionAt,
    speedAt(time) {
      const clamped = BABYLON.Scalar.Clamp(time, 0, duration);
      return normalTunnelSpeed * smoothstep(clamped / ENTRY_ROUTE_EASE_DURATION);
    },
    normalTunnelSpeed,
    tangentAt(time) {
      // A short future sample filters tiny spline detail without delaying the
      // turning response into a visible late rotation.
      const lookAhead = 0.62;
      const lookBehind = 0.18;
      const before = positionAt(Math.max(0, time - lookBehind));
      const after = positionAt(Math.min(duration, time + lookAhead));
      const tangent = after.subtract(before);
      tangent.y = 0;
      return tangent.lengthSquared() > 0.00001
        ? tangent.normalize()
        : BABYLON.Axis.Z.clone();
    },
  };
}

function closestDistanceAlongPolyline(points, target) {
  let nearestDistance = Number.POSITIVE_INFINITY;
  let distanceAlongPath = 0;
  let accumulated = 0;

  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const segment = points[index].subtract(from);
    const segmentLength = segment.length();
    const direction = segment.scale(1 / Math.max(segmentLength, 0.00001));
    const projection = BABYLON.Scalar.Clamp(BABYLON.Vector3.Dot(target.subtract(from), direction), 0, segmentLength);
    const closestPoint = from.add(direction.scale(projection));
    const distance = BABYLON.Vector3.DistanceSquared(target, closestPoint);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      distanceAlongPath = accumulated + projection;
    }
    accumulated += segmentLength;
  }

  return distanceAlongPath;
}

function applyPathTransform(root, route, time, initialHeading, delta) {
  const position = route.positionAt(time);
  root.position.copyFrom(position);

  // Only the locomotion body rotates. A WebXR camera remains free to receive
  // its headset-local orientation, while the desktop camera naturally faces
  // along the same body frame.
  const desiredYaw = normalizeAngle(headingFrom(route.tangentAt(time)) - initialHeading);
  const smoothing = 1 - Math.exp(-Math.max(0, delta) * 2.6);
  root.rotation.y = lerpAngle(root.rotation.y, desiredYaw, smoothing);
}

function calmTravelProgress(amount) {
  const progress = BABYLON.Scalar.Clamp(amount, 0, 1);
  // This remains almost constant-speed, with just enough easing to avoid a
  // mathematical start/stop while crossing the open landscape.
  return progress + (smoothstep(progress) - progress) * 0.12;
}

function riftPullProgress(time, route, approachTime) {
  const progress = BABYLON.Scalar.Clamp(time / RIFT_PULL_DURATION, 0, 1);
  const virtualDuration = Math.max(route.entryTime - approachTime, 0.001);
  const approachSpeed = route.distanceAt(approachTime) / IDYLL_TRAVEL_DURATION;
  const startSlope = BABYLON.Scalar.Clamp(
    approachSpeed / route.normalTunnelSpeed * RIFT_PULL_DURATION / virtualDuration,
    0.05,
    0.5,
  );
  const endSlope = BABYLON.Scalar.Clamp(RIFT_PULL_DURATION / virtualDuration, 0.2, 1.3);
  const inverse = 1 - progress;
  return (progress ** 3 - 2 * progress ** 2 + progress) * startSlope
    + (-2 * progress ** 3 + 3 * progress ** 2)
    + (progress ** 3 - progress ** 2) * endSlope;
}

function riftExitSpeedMultiplier(route, approachTime) {
  const virtualDuration = Math.max(route.entryTime - approachTime, 0.001);
  const endSlope = BABYLON.Scalar.Clamp(RIFT_PULL_DURATION / virtualDuration, 0.2, 1.3);
  return virtualDuration * endSlope / RIFT_PULL_DURATION;
}

function tunnelEntryBlendTime(tunnelTime, route, approachTime) {
  if (tunnelTime >= TUNNEL_BLEND_DURATION) {
    return tunnelTime;
  }
  const progress = BABYLON.Scalar.Clamp(tunnelTime / TUNNEL_BLEND_DURATION, 0, 1);
  const initialSlope = riftExitSpeedMultiplier(route, approachTime);
  const square = progress * progress;
  const cube = square * progress;
  // Cubic Hermite path time: start with the actual rift-exit velocity and
  // settle to normal tunnel velocity after two seconds without moving the
  // path endpoint or resetting tunnel progress.
  return TUNNEL_BLEND_DURATION * (
    (cube - 2 * square + progress) * initialSlope
    + (-2 * cube + 3 * square)
    + (cube - square)
  );
}

function tunnelTravelTime(tunnelTime, route, approachTime) {
  return finalTunnelTravelTime(tunnelEntryBlendTime(tunnelTime, route, approachTime));
}

function tunnelEntrySpeedMultiplier(tunnelTime, route, approachTime) {
  if (tunnelTime >= TUNNEL_BLEND_DURATION) {
    return 1;
  }
  const progress = BABYLON.Scalar.Clamp(tunnelTime / TUNNEL_BLEND_DURATION, 0, 1);
  const initialSlope = riftExitSpeedMultiplier(route, approachTime);
  return initialSlope * (3 * progress ** 2 - 4 * progress + 1)
    + (-6 * progress ** 2 + 6 * progress)
    + (3 * progress ** 2 - 2 * progress);
}

/**
 * Keeps the route endpoint and the sixty-second tunnel clock fixed while
 * redistributing only the last seven seconds into a strong forward pull.
 * It is continuous at both ends: normal travel becomes a local attraction
 * instead of reviving any of the old global-entry suction states.
 */
function finalTunnelTravelTime(tunnelTime) {
  if (tunnelTime <= FINAL_PULL_START) {
    return tunnelTime;
  }
  const progress = BABYLON.Scalar.Clamp((tunnelTime - FINAL_PULL_START) / FINAL_PULL_DURATION, 0, 1);
  const pulledProgress = progress + FINAL_PULL_STRENGTH * (progress ** 5 - progress ** 3);
  return FINAL_PULL_START + FINAL_PULL_DURATION * pulledProgress;
}

function finalTunnelSpeedMultiplier(tunnelTime = TUNNEL_DURATION) {
  if (tunnelTime <= FINAL_PULL_START) {
    return 1;
  }
  const progress = BABYLON.Scalar.Clamp((tunnelTime - FINAL_PULL_START) / FINAL_PULL_DURATION, 0, 1);
  // Derivative of finalTunnelTravelTime.
  return 1 + FINAL_PULL_STRENGTH * (5 * progress ** 4 - 3 * progress ** 2);
}

function finalReleaseProgress(value, initialSlope) {
  const progress = BABYLON.Scalar.Clamp(value, 0, 1);
  const square = progress * progress;
  const cube = square * progress;
  // Cubic Hermite release: carry the final pull forward, then smoothly stop
  // inside the White Room without a camera snap or an abrupt braking frame.
  return (cube - 2 * square + progress) * initialSlope + (-2 * cube + 3 * square);
}

function createSpacetimeRift(scene, entrance, tunnelStart, tunnelMesh, idyllWorldMeshes) {
  const center = tunnelStart.add(new BABYLON.Vector3(0, 1.65, 0));
  const lateral = entrance.lateral.clone();
  const forward = entrance.forward.clone();
  const apertureShape = [
    [-1.78, -0.14], [-1.38, -0.6], [-0.72, -0.82], [-0.08, -0.63],
    [0.68, -0.78], [1.6, -0.4], [1.43, 0.02], [1.78, 0.3],
    [0.92, 0.62], [0.18, 0.5], [-0.52, 0.76], [-1.26, 0.5],
    [-1.84, 0.2],
  ];
  const fragmentMaterial = new BABYLON.StandardMaterial("spacetime-rift-shard-material", scene);
  fragmentMaterial.diffuseColor = BABYLON.Color3.FromHexString("#dcecf4");
  fragmentMaterial.emissiveColor = BABYLON.Color3.FromHexString("#7898b0");
  fragmentMaterial.specularColor = BABYLON.Color3.Black();
  fragmentMaterial.backFaceCulling = false;
  fragmentMaterial.disableLighting = true;
  const voidMaterial = new BABYLON.StandardMaterial("spacetime-rift-charcoal-void-material", scene);
  voidMaterial.diffuseColor = BABYLON.Color3.FromHexString("#070a10");
  voidMaterial.emissiveColor = BABYLON.Color3.FromHexString("#10151d");
  voidMaterial.specularColor = BABYLON.Color3.Black();
  voidMaterial.backFaceCulling = false;
  const maskMaterial = new BABYLON.StandardMaterial("spacetime-rift-stencil-mask-material", scene);
  maskMaterial.backFaceCulling = false;
  maskMaterial.disableColorWrite = true;
  maskMaterial.disableDepthWrite = true;
  maskMaterial.stencil.enabled = true;
  maskMaterial.stencil.func = BABYLON.Engine.ALWAYS;
  maskMaterial.stencil.funcRef = 1;
  maskMaterial.stencil.funcMask = 0xff;
  maskMaterial.stencil.opStencilFail = BABYLON.Engine.KEEP;
  maskMaterial.stencil.opDepthFail = BABYLON.Engine.KEEP;
  maskMaterial.stencil.opStencilDepthPass = BABYLON.Engine.REPLACE;
  const voidMesh = createFracturedAperture(scene, "spacetime-rift-charcoal-void", voidMaterial, apertureShape.length);
  const apertureMask = createFracturedAperture(scene, "spacetime-rift-opening-stencil-mask", maskMaterial, apertureShape.length);
  apertureMask.mesh.setEnabled(false);
  const fragments = createRealityShards(scene, center, lateral, forward, fragmentMaterial);
  const cracks = createShatterCracks(scene, center, lateral, forward);
  const edgeHighlights = createFractureEdgeHighlights(scene, center, lateral, forward);
  const tunnelMaterial = tunnelMesh.material;
  const originalRenderGroup = tunnelMesh.renderingGroupId;
  const originalStencil = {
    enabled: tunnelMaterial.stencil.enabled,
    func: tunnelMaterial.stencil.func,
    funcRef: tunnelMaterial.stencil.funcRef,
    funcMask: tunnelMaterial.stencil.funcMask,
    opStencilFail: tunnelMaterial.stencil.opStencilFail,
    opDepthFail: tunnelMaterial.stencil.opDepthFail,
    opStencilDepthPass: tunnelMaterial.stencil.opStencilDepthPass,
  };
  const idyllMeshes = idyllWorldMeshes.filter((mesh) => mesh !== tunnelMesh);
  const idyllRenderGroups = new Map(idyllMeshes.map((mesh) => [mesh, mesh.renderingGroupId]));
  const idyllMaterials = [...new Set(idyllMeshes.map((mesh) => mesh.material).filter(Boolean))];
  const idyllicStencils = new Map(idyllMaterials.map((material) => [material, {
    enabled: material.stencil.enabled,
    func: material.stencil.func,
    funcRef: material.stencil.funcRef,
    funcMask: material.stencil.funcMask,
    opStencilFail: material.stencil.opStencilFail,
    opDepthFail: material.stencil.opDepthFail,
    opStencilDepthPass: material.stencil.opStencilDepthPass,
  }]));
  let maskEnabled = false;
  let portalMaskEnabled = false;
  let portalMaskPermanentlyClosed = false;
  [voidMesh.mesh, ...fragments.map(({ mesh }) => mesh), ...cracks, ...edgeHighlights].forEach((mesh) => { mesh.renderingGroupId = 3; });
  apertureMask.mesh.renderingGroupId = 0;

  const setTunnelMask = (enabled) => {
    if (enabled === maskEnabled) {
      return;
    }
    maskEnabled = enabled;
    apertureMask.mesh.setEnabled(enabled);
    if (enabled) {
      // Group 0 writes the aperture. Group 1 renders the idyll everywhere
      // except that aperture; group 2 renders the one real tunnel only inside
      // it. This prevents the meadow from leaking into the portal centre.
      scene.setRenderingAutoClearDepthStencil(1, false, false, false);
      scene.setRenderingAutoClearDepthStencil(2, false, false, false);
      tunnelMesh.renderingGroupId = 2;
      tunnelMaterial.stencil.enabled = true;
      tunnelMaterial.stencil.func = BABYLON.Engine.EQUAL;
      tunnelMaterial.stencil.funcRef = 1;
      tunnelMaterial.stencil.funcMask = 0xff;
      tunnelMaterial.stencil.opStencilFail = BABYLON.Engine.KEEP;
      tunnelMaterial.stencil.opDepthFail = BABYLON.Engine.KEEP;
      tunnelMaterial.stencil.opStencilDepthPass = BABYLON.Engine.KEEP;
      return;
    }
    scene.setRenderingAutoClearDepthStencil(1, true, true, true);
    scene.setRenderingAutoClearDepthStencil(2, true, true, true);
    tunnelMesh.renderingGroupId = originalRenderGroup;
    Object.assign(tunnelMaterial.stencil, originalStencil);
  };

  const setIdyllMask = (enabled) => {
    idyllMeshes.forEach((mesh) => {
      mesh.renderingGroupId = enabled ? 1 : idyllRenderGroups.get(mesh);
    });
    idyllicStencils.forEach((stencil, material) => {
      if (!enabled) {
        Object.assign(material.stencil, stencil);
        return;
      }
      material.stencil.enabled = true;
      material.stencil.func = BABYLON.Engine.NOTEQUAL;
      material.stencil.funcRef = 1;
      material.stencil.funcMask = 0xff;
      material.stencil.opStencilFail = BABYLON.Engine.KEEP;
      material.stencil.opDepthFail = BABYLON.Engine.KEEP;
      material.stencil.opStencilDepthPass = BABYLON.Engine.KEEP;
    });
  };

  const setPortalMask = (enabled) => {
    if (enabled === portalMaskEnabled) {
      return;
    }
    portalMaskEnabled = enabled;
    setTunnelMask(enabled);
    setIdyllMask(enabled);
  };

  const closePortalMask = () => {
    if (portalMaskPermanentlyClosed) {
      return;
    }
    // The tunnel world owns the post-entry render state. Restore every
    // stencil/render-group setting once, then permanently prevent the
    // lingering Rift visual animation from touching those settings again.
    portalMaskPermanentlyClosed = true;
    setPortalMask(false);
    apertureMask.mesh.setEnabled(false);
  };

  const setPoint = (positions, offset, x, y, depth) => {
    positions[offset] = center.x + lateral.x * x + forward.x * depth;
    positions[offset + 1] = center.y + y;
    positions[offset + 2] = center.z + lateral.z * x + forward.z * depth;
  };
  const updateAperture = (aperture, scale, depth) => {
    apertureShape.forEach(([x, y], index) => {
      setPoint(aperture.positions, index * 3, x * scale, y * scale, depth);
    });
    aperture.mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, aperture.positions, true);
  };

  return {
    update(elapsed, formation, reveal, tunnelTime) {
      const isClosing = tunnelTime >= 0;
      const closure = isClosing ? 1 - smoothstep(tunnelTime / RIFT_CLOSE_DURATION) : 1;
      // The Rift's geometry contracts across the full close duration. Fade
      // its visible remnants only in the final part of that same curve, so
      // their eventual disable cannot produce a one-frame bright pop.
      const closureVisibility = smoothstep(closure / RIFT_CLOSURE_FADE_RANGE);
      if (formation <= 0 || closure <= 0.01) {
        if (!portalMaskPermanentlyClosed) {
          setPortalMask(false);
          apertureMask.mesh.setEnabled(false);
        }
        voidMesh.mesh.setEnabled(false);
        fragments.forEach(({ mesh }) => mesh.setEnabled(false));
        cracks.forEach((mesh) => mesh.setEnabled(false));
        edgeHighlights.forEach((mesh) => mesh.setEnabled(false));
        return;
      }
      const opening = smoothstep((elapsed - RIFT_TUNNEL_REVEAL_START) / (IDYLL_TRAVEL_DURATION - RIFT_TUNNEL_REVEAL_START));
      const apertureScale = (0.08 + formation * 0.78) * closure;
      updateAperture(voidMesh, apertureScale, -0.13);
      if (!portalMaskPermanentlyClosed) {
        updateAperture(apertureMask, apertureScale, -0.145);
        setPortalMask(reveal > 0.01 && !isClosing);
      }
      voidMesh.mesh.visibility = BABYLON.Scalar.Clamp(formation * (1 - opening * 1.1), 0, 1)
        * closureVisibility;
      voidMesh.mesh.setEnabled(voidMesh.mesh.visibility > RIFT_VISIBILITY_EPSILON);
      const breakProgress = smoothstep((formation - 0.22) / 0.78);
      fragments.forEach((fragment, index) => {
        const visibility = BABYLON.Scalar.Clamp(formation * (0.22 + opening * 0.78), 0, 0.86)
          * closureVisibility;
        fragment.mesh.visibility = visibility;
        fragment.mesh.setEnabled(visibility > RIFT_VISIBILITY_EPSILON);
        fragment.mesh.scaling.setAll(0.18 + formation * 0.82);
        fragment.mesh.position.copyFrom(fragment.base
          .add(lateral.scale(fragment.lateralDrift * breakProgress))
          .add(forward.scale(fragment.depthDrift * breakProgress))
          .add(new BABYLON.Vector3(0, fragment.verticalDrift * breakProgress, 0)));
        fragment.mesh.rotation.y = fragment.rotation + elapsed * fragment.spin * breakProgress;
        fragment.mesh.rotation.z = fragment.tilt + elapsed * fragment.spin * 0.5 * breakProgress;
      });
      cracks.forEach((mesh, index) => {
        mesh.visibility = BABYLON.Scalar.Clamp(
          formation * (1 - opening * 0.7) * (index % 2 ? 0.85 : 1),
          0,
          0.88,
        ) * closureVisibility;
        mesh.setEnabled(mesh.visibility > RIFT_VISIBILITY_EPSILON);
      });
      edgeHighlights.forEach((mesh, index) => {
        mesh.visibility = BABYLON.Scalar.Clamp(
          formation * (0.28 + opening * 0.45) * (index % 2 ? 0.8 : 1),
          0,
          0.7,
        ) * closureVisibility;
        mesh.setEnabled(mesh.visibility > RIFT_VISIBILITY_EPSILON);
      });
    },
    closePortalMask,
    getVisualMeshes() {
      return [
        voidMesh.mesh,
        apertureMask.mesh,
        ...fragments.map(({ mesh }) => mesh),
        ...cracks,
        ...edgeHighlights,
      ];
    },
    dispose() {
      edgeHighlights.forEach((mesh) => mesh.dispose());
      cracks.forEach((mesh) => mesh.dispose());
      fragments.forEach(({ mesh }) => mesh.dispose());
      voidMesh.mesh.dispose();
      closePortalMask();
      apertureMask.mesh.dispose();
      fragmentMaterial.dispose();
      voidMaterial.dispose();
      maskMaterial.dispose();
    },
  };
}

function createFracturedAperture(scene, name, material, pointCount) {
  const positions = Array(pointCount * 3).fill(0);
  const indices = [];
  for (let index = 1; index < pointCount - 1; index += 1) {
    indices.push(0, index, index + 1);
  }
  const mesh = new BABYLON.Mesh(name, scene);
  const vertexData = new BABYLON.VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = [];
  BABYLON.VertexData.ComputeNormals(positions, indices, vertexData.normals);
  vertexData.applyToMesh(mesh, true);
  mesh.material = material;
  mesh.isPickable = false;
  return { mesh, positions };
}

function createRealityShards(scene, center, lateral, forward, material) {
  const heading = Math.atan2(forward.x, forward.z);
  const definitions = [
    [-1.48, 0.5, -0.06, 0.22, 0.3, -0.24, 0.1, -0.08, 0.32],
    [-0.78, 0.94, 0.08, 0.18, 1.3, -0.12, 0.16, 0.06, -0.24],
    [0.22, 0.76, -0.02, 0.2, 2.1, 0.18, 0.1, -0.1, 0.29],
    [1.42, 0.38, 0.1, 0.22, 0.8, 0.25, 0.04, 0.08, -0.27],
    [1.5, -0.3, -0.04, 0.17, 2.7, 0.2, -0.14, -0.07, 0.22],
    [0.62, -0.86, 0.12, 0.2, 1.7, 0.08, -0.2, 0.08, -0.31],
    [-0.48, -0.88, -0.1, 0.23, 2.5, -0.16, -0.12, -0.12, 0.25],
    [-1.5, -0.46, 0.06, 0.18, 0.5, -0.24, -0.04, 0.1, -0.2],
  ];
  return definitions.map(([x, y, depth, size, rotation, lateralDrift, verticalDrift, depthDrift, spin], index) => {
    const mesh = BABYLON.MeshBuilder.CreateDisc(`spacetime-rift-shard-${index}`, {
      radius: size,
      tessellation: index % 3 === 0 ? 4 : 3,
      sideOrientation: BABYLON.Mesh.DOUBLESIDE,
    }, scene);
    const base = center.add(lateral.scale(x)).add(forward.scale(depth)).add(new BABYLON.Vector3(0, y, 0));
    mesh.position.copyFrom(base);
    mesh.rotation.set(0, heading, rotation);
    mesh.material = material;
    mesh.isPickable = false;
    return { mesh, base, rotation: heading, tilt: rotation, lateralDrift, verticalDrift, depthDrift, spin };
  });
}

function createFractureEdgeHighlights(scene, center, lateral, forward) {
  const toWorld = (x, y, depth = -0.18) => center.add(lateral.scale(x)).add(forward.scale(depth)).add(new BABYLON.Vector3(0, y, 0));
  const paths = [
    [[-1.78, -0.14], [-1.38, -0.6], [-0.72, -0.82]],
    [[-0.08, -0.63], [0.68, -0.78], [1.6, -0.4]],
    [[1.43, 0.02], [1.78, 0.3], [0.92, 0.62]],
    [[0.18, 0.5], [-0.52, 0.76], [-1.26, 0.5]],
  ];
  return paths.map((path, index) => {
    const mesh = BABYLON.MeshBuilder.CreateLines(`spacetime-rift-fracture-edge-${index}`, {
      points: path.map(([x, y]) => toWorld(x, y)),
      updatable: false,
    }, scene);
    mesh.color = BABYLON.Color3.FromHexString("#d6e5ec");
    mesh.isPickable = false;
    return mesh;
  });
}

function createShatterCracks(scene, center, lateral, forward) {
  const toWorld = (x, y, depth = -0.16) => center.add(lateral.scale(x)).add(forward.scale(depth)).add(new BABYLON.Vector3(0, y, 0));
  const paths = [
    [[-1.2, 0.72], [-1.66, 1.02], [-2.0, 1.24]],
    [[0.82, 0.94], [1.2, 1.32], [1.62, 1.34]],
    [[-1.5, -0.22], [-1.96, -0.5], [-2.2, -0.84]],
    [[1.28, -0.48], [1.76, -0.68], [2.04, -0.52]],
    [[0.18, -1.02], [0.48, -1.42], [0.9, -1.56]],
  ];
  return paths.map((path, index) => {
    const mesh = BABYLON.MeshBuilder.CreateLines(`spacetime-rift-shatter-crack-${index}`, {
      points: path.map(([x, y]) => toWorld(x, y)),
      updatable: false,
    }, scene);
    mesh.color = BABYLON.Color3.FromHexString("#34495a");
    mesh.isPickable = false;
    return mesh;
  });
}

function activateWhiteRoom(options, root) {
  if (options.whiteRoomActive) {
    return;
  }
  options.whiteRoomActive = true;
  options.whiteRoom.activate();
  options.whiteRoomTone.activate();
  root.rotation.x = 0;
  root.rotation.z = 0;
}

function isolatePreviousWorld(options) {
  options.tunnel.setEnabled(false);
  options.tunnel.setSequenceActive(false);
  options.previousWorldMeshes.forEach((mesh) => mesh.setEnabled(false));
  options.previousWorldLights.forEach((light) => light.setEnabled(false));
}

function syncRootToExperienceTime(root, elapsed, tunnelRoute, whiteRoom, initialHeading, riftApproachTime) {
  if (elapsed < IDYLL_TRAVEL_DURATION) {
    applyPathTransform(root, tunnelRoute, riftApproachTime * calmTravelProgress(elapsed / IDYLL_TRAVEL_DURATION), initialHeading, 0);
    return;
  }
  if (elapsed < TUNNEL_START) {
    applyPathTransform(root, tunnelRoute, riftApproachTime + (tunnelRoute.entryTime - riftApproachTime)
      * riftPullProgress(elapsed - IDYLL_TRAVEL_DURATION, tunnelRoute, riftApproachTime), initialHeading, 0);
    return;
  }
  const tunnelTime = elapsed - TUNNEL_START;
  if (tunnelTime < TUNNEL_DURATION) {
    applyPathTransform(
      root,
      tunnelRoute,
      tunnelRoute.entryTime + tunnelTravelTime(tunnelTime, tunnelRoute, riftApproachTime),
      initialHeading,
      0,
    );
    return;
  }
  root.position.copyFrom(whiteRoom.finalPosition);
}

function headingFrom(direction) {
  return Math.atan2(direction.x, direction.z);
}

function lerpAngle(from, to, amount) {
  return from + normalizeAngle(to - from) * amount;
}

function normalizeAngle(value) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function smoothstep(value) {
  const clamped = BABYLON.Scalar.Clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Opt-in, temporary instrumentation for the post-rift flash investigation.
 * It observes state only when ?debugFlash=1 is present and never changes a
 * rendering value itself. The hooks are restored after the four-second window.
 */
function createTunnelFlashDebug(scene, options, root, rift) {
  const enabled = new URLSearchParams(window.location.search).has("debugFlash");
  if (!enabled) {
    return {
      nextFrame() {},
      start() {},
      capture() {},
      dispose() {},
    };
  }

  const panel = document.createElement("pre");
  panel.className = "tunnel-flash-debug-panel";
  panel.style.cssText = [
    "position:fixed",
    "top:12px",
    "left:12px",
    "z-index:10000",
    "margin:0",
    "padding:10px",
    "max-width:45vw",
    "color:#f8f8f8",
    "background:rgba(0,0,0,0.78)",
    "border:1px solid rgba(255,255,255,0.35)",
    "border-radius:6px",
    "font:12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
    "pointer-events:none",
    "white-space:pre-wrap",
  ].join(";");
  document.body.append(panel);

  const tunnelMeshes = new Set([
    options.tunnel.mesh,
    options.tunnelEntrance?.portal,
    options.tunnelEntrance?.shell,
    options.tunnelEntrance?.floor,
    options.tunnelEntrance?.fade,
  ].filter(Boolean));
  const riftMeshes = new Set(rift.getVisualMeshes());
  const idyllMeshes = new Set(options.idyllWorldMeshes);
  const setEnabledRestorers = [];
  const lightRestorers = [];
  const originalAutoClear = scene.setRenderingAutoClearDepthStencil;
  const renderingClearState = new Map();
  let active = false;
  let finished = false;
  let entryTime = 0;
  let frame = 0;
  let previousState = null;
  let lastUnexpectedIdyll = "";
  let lastEvent = "waiting for tunnel entry";

  const timestamp = () => performance.now();
  const sinceEntry = () => active || finished ? timestamp() - entryTime : 0;
  const colorValue = (color) => color
    ? [color.r, color.g, color.b, color.a].map((value) => Number(value ?? 1).toFixed(3)).join(", ")
    : "none";
  const value = (input) => typeof input === "object" ? JSON.stringify(input) : String(input);
  const meshCategory = (mesh) => {
    if (tunnelMeshes.has(mesh)) return "tunnel";
    if (riftMeshes.has(mesh) || mesh.name.startsWith("spacetime-rift-")) return "rift";
    if (mesh.name.startsWith("white-room-")) return "white-room";
    if (idyllMeshes.has(mesh)) return "idyll";
    return "technical";
  };
  const record = (operation, subject, oldValue, newValue) => {
    if (!active || sinceEntry() > FLASH_DEBUG_DURATION_MS) return;
    const entry = {
      performanceNow: Number(timestamp().toFixed(2)),
      sinceTunnelEntryMs: Number(sinceEntry().toFixed(2)),
      frame,
      operation,
      subject,
      oldValue,
      newValue,
    };
    lastEvent = `${operation}: ${subject}`;
    console.info(`[TUNNEL DEBUG] ${JSON.stringify(entry)}`);
  };
  scene.setRenderingAutoClearDepthStencil = function instrumentedAutoClear(groupId, autoClear, depth, stencil) {
    const oldValue = renderingClearState.get(groupId) ?? "unobserved";
    const newValue = { autoClear, depth, stencil };
    renderingClearState.set(groupId, newValue);
    record("scene.setRenderingAutoClearDepthStencil", `rendering group ${groupId}`, oldValue, newValue);
    return originalAutoClear.call(scene, groupId, autoClear, depth, stencil);
  };
  const wrapSetEnabled = (target, kind, restorers) => {
    if (!target?.setEnabled) return;
    const original = target.setEnabled;
    target.setEnabled = function instrumentedSetEnabled(nextEnabled) {
      const oldEnabled = this.isEnabled();
      const result = original.call(this, nextEnabled);
      const newEnabled = this.isEnabled();
      if (oldEnabled !== newEnabled) {
        record(`${kind}.setEnabled`, this.name, oldEnabled, newEnabled);
      }
      return result;
    };
    restorers.push(() => { target.setEnabled = original; });
  };
  const currentState = () => {
    const meshState = new Map(scene.meshes.map((mesh) => [mesh.uniqueId, {
      name: mesh.name,
      enabled: mesh.isEnabled(),
      visibility: mesh.visibility,
      renderingGroupId: mesh.renderingGroupId,
      material: mesh.material?.name ?? null,
    }]));
    const materials = new Set([...scene.materials, ...scene.meshes.map((mesh) => mesh.material).filter(Boolean)]);
    const materialState = new Map([...materials].map((material) => [material.uniqueId, {
      name: material.name,
      alpha: material.alpha,
      stencil: {
        enabled: material.stencil?.enabled,
        func: material.stencil?.func,
        funcRef: material.stencil?.funcRef,
        funcMask: material.stencil?.funcMask,
      },
    }]));
    const lightState = new Map(scene.lights.map((light) => [light.uniqueId, {
      name: light.name,
      enabled: light.isEnabled(),
      intensity: light.intensity,
    }]));
    return {
      scene: {
        clearColor: colorValue(scene.clearColor),
        autoClear: scene.autoClear,
      },
      meshes: meshState,
      materials: materialState,
      lights: lightState,
    };
  };
  const compare = (previous, next, operation, subject, fields) => {
    fields.forEach((field) => {
      const oldValue = previous?.[field];
      const newValue = next?.[field];
      if (value(oldValue) !== value(newValue)) {
        record(`${operation}.${field}`, subject, oldValue, newValue);
      }
    });
  };
  const drawOverlay = (tunnelTime, tunnelRoute, riftApproachTime) => {
    const counts = { idyll: 0, rift: 0, tunnel: 0, whiteRoom: 0 };
    scene.meshes.forEach((mesh) => {
      if (!mesh.isEnabled()) return;
      const category = meshCategory(mesh);
      if (category === "white-room") counts.whiteRoom += 1;
      else if (Object.hasOwn(counts, category)) counts[category] += 1;
    });
    const activeLights = scene.lights.filter((light) => light.isEnabled());
    const cameraPosition = scene.activeCamera?.globalPosition ?? root.getAbsolutePosition();
    const tunnelDistance = tunnelTravelTime(tunnelTime, tunnelRoute, riftApproachTime) * tunnelRoute.normalTunnelSpeed;
    panel.textContent = [
      "TUNNEL DEBUG",
      `time since entry: ${active || finished ? (sinceEntry() / 1000).toFixed(3) : "waiting"} s`,
      `frame: ${active || finished ? frame : "-"}`,
      `enabled idyll meshes: ${counts.idyll}`,
      `enabled rift meshes: ${counts.rift}`,
      `enabled tunnel meshes: ${counts.tunnel}`,
      `enabled white-room meshes: ${counts.whiteRoom}`,
      `active lights: ${activeLights.length} (${activeLights.map((light) => light.name).join(", ") || "none"})`,
      `scene clearColor: ${colorValue(scene.clearColor)}`,
      `camera position: ${cameraPosition.x.toFixed(2)}, ${cameraPosition.y.toFixed(2)}, ${cameraPosition.z.toFixed(2)}`,
      `tunnel progress: ${tunnelTime.toFixed(3)} s / ${TUNNEL_DURATION} s (${tunnelDistance.toFixed(2)} m)`,
      `last event: ${lastEvent}`,
      finished ? "capture complete (4.0 s)" : "capture armed",
    ].join("\n");
  };
  const detectUnexpectedIdyll = () => {
    const unexpected = scene.meshes
      .filter((mesh) => mesh.isEnabled() && meshCategory(mesh) === "idyll")
      .map((mesh) => mesh.name)
      .sort();
    const signature = unexpected.join(" | ");
    if (signature && signature !== lastUnexpectedIdyll) {
      console.error(`[FLASH DETECTOR] ${JSON.stringify({
        performanceNow: Number(timestamp().toFixed(2)),
        sinceTunnelEntryMs: Number(sinceEntry().toFixed(2)),
        frame,
        meshes: unexpected,
      })}`);
    }
    lastUnexpectedIdyll = signature;
  };
  const finish = () => {
    if (!active) return;
    active = false;
    finished = true;
    setEnabledRestorers.splice(0).forEach((restore) => restore());
    lightRestorers.splice(0).forEach((restore) => restore());
    scene.setRenderingAutoClearDepthStencil = originalAutoClear;
    console.info(`[TUNNEL DEBUG] capture complete ${JSON.stringify({
      performanceNow: Number(timestamp().toFixed(2)),
      sinceTunnelEntryMs: Number(sinceEntry().toFixed(2)),
      frame,
    })}`);
  };

  return {
    nextFrame() {
      if (active) frame += 1;
    },
    start() {
      if (active || finished) return;
      active = true;
      entryTime = timestamp();
      frame = 0;
      previousState = currentState();
      scene.meshes.forEach((mesh) => wrapSetEnabled(mesh, "mesh", setEnabledRestorers));
      scene.lights.forEach((light) => wrapSetEnabled(light, "light", lightRestorers));
      console.info(`[TUNNEL DEBUG] tunnel-entry capture started ${JSON.stringify({
        performanceNow: Number(entryTime.toFixed(2)),
        sinceTunnelEntryMs: 0,
        frame,
      })}`);
    },
    capture(tunnelTime, tunnelRoute, riftApproachTime) {
      if (!active && !finished) return;
      if (active) {
        const nextState = currentState();
        compare(previousState.scene, nextState.scene, "scene", "scene", ["clearColor", "autoClear"]);
        nextState.meshes.forEach((next, key) => compare(previousState.meshes.get(key), next, "mesh", next.name, [
          "enabled", "visibility", "renderingGroupId", "material",
        ]));
        nextState.materials.forEach((next, key) => {
          const previous = previousState.materials.get(key);
          compare(previous, next, "material", next.name, ["alpha"]);
          compare(previous?.stencil, next.stencil, "material.stencil", next.name, [
            "enabled", "func", "funcRef", "funcMask",
          ]);
        });
        nextState.lights.forEach((next, key) => compare(previousState.lights.get(key), next, "light", next.name, [
          "enabled", "intensity",
        ]));
        previousState = nextState;
        detectUnexpectedIdyll();
        if (sinceEntry() >= FLASH_DEBUG_DURATION_MS) finish();
      }
      drawOverlay(tunnelTime, tunnelRoute, riftApproachTime);
    },
    dispose() {
      finish();
      panel.remove();
    },
  };
}

function createDebugPanel() {
  const enabled = new URLSearchParams(window.location.search).has("debugTunnel");
  if (!enabled) {
    return { update() {}, dispose() {} };
  }
  const panel = document.createElement("pre");
  panel.className = "tunnel-debug-panel";
  document.body.append(panel);
  return {
    update(experienceTime, tunnelTime, tunnelRoute, hasEnteredTunnel, riftFormation, riftApproachTime) {
      const phase = getTunnelPhase(tunnelTime);
      const inWhiteRoom = experienceTime >= TUNNEL_START + TUNNEL_DURATION;
      const inTunnel = hasEnteredTunnel && tunnelTime < TUNNEL_DURATION;
      const controller = inWhiteRoom
        ? "white room"
        : inTunnel
        ? "tunnel travel"
        : experienceTime >= IDYLL_TRAVEL_DURATION
          ? "rift pull"
          : experienceTime >= RIFT_FORM_START
            ? "rift forming"
            : "idyll travel";
      const currentSpeed = inTunnel
        ? tunnelRoute.normalTunnelSpeed
          * tunnelEntrySpeedMultiplier(tunnelTime, tunnelRoute, riftApproachTime)
          * finalTunnelSpeedMultiplier(tunnelTime)
        : 0;
      panel.textContent = [
        `Experience: ${experienceTime.toFixed(1)} s`,
        `Tunnel: ${tunnelTime.toFixed(1)} / ${TUNNEL_DURATION} s`,
        `Controller: ${controller}`,
        `Speed: ${currentSpeed.toFixed(2)} / ${tunnelRoute.normalTunnelSpeed.toFixed(2)} m/s`,
        `Rift: ${(riftFormation * 100).toFixed(0)} %`,
        `Phase: ${phase.id}`,
        `Progress: ${(tunnelTime / TUNNEL_DURATION * 100).toFixed(0)} %`,
        `Tunnel path: ${(inTunnel ? tunnelTravelTime(tunnelTime, tunnelRoute, riftApproachTime) * tunnelRoute.normalTunnelSpeed : 0).toFixed(1)} m`,
        `Diameter: ${getTunnelDiameter(tunnelTime).toFixed(2)} m`,
      ].join("\n");
    },
    dispose() {
      panel.remove();
    },
  };
}

/**
 * One authoritative visibility controller owns the real tunnel, its entrance
 * shell, the previously visible ribbed interior, floor/fade helpers and their
 * lights. Disabled meshes do not render or cast shadows during the idyll.
 */
function createTunnelWorldGroup(scene, options) {
  const entrance = options.tunnelEntrance;
  const entranceMeshes = [entrance.portal, entrance.shell, entrance.floor, entrance.fade]
    .filter(Boolean);
  const allMeshes = [options.tunnel.mesh, ...entranceMeshes];
  const originalVisibility = new Map(allMeshes.map((mesh) => [mesh, mesh.visibility]));

  const setEntranceEnabled = (enabled) => {
    entranceMeshes.forEach((mesh) => mesh.setEnabled(enabled));
    entrance.daylight?.setEnabled(enabled);
  };

  return {
    hide() {
      options.tunnel.setEnabled(false);
      setEntranceEnabled(false);
    },
    reveal(amount) {
      if (amount <= 0) {
        this.hide();
        return;
      }
      options.tunnel.setEnabled(true);
      setEntranceEnabled(amount > 0.14);
      allMeshes.forEach((mesh) => {
        mesh.visibility = originalVisibility.get(mesh) * amount;
      });
      // The entrance light only joins once the rupture already has volume, so
      // it cannot spill onto the idyll before the reveal.
      entrance.daylight?.setEnabled(amount > 0.48);
    },
    closePortal() {
      // Once crossed, this is a hard invariant: Rift teardown or later
      // cleanup may never leave a frame without the real tunnel renderable.
      options.tunnel.setEnabled(true);
      options.tunnel.mesh.visibility = originalVisibility.get(options.tunnel.mesh);
      // The idyll's sky mesh is disabled below, but Babylon still clears the
      // frame with the idyll's pale blue clear color. During the Rift stencil
      // handoff that background can briefly be exposed through a gap, which
      // reads as an idyll flash even with every idyll mesh disabled.
      scene.clearColor = new BABYLON.Color4(0.006, 0.009, 0.014, 1);
      setEntranceEnabled(false);
      entranceMeshes.forEach((mesh) => {
        mesh.visibility = originalVisibility.get(mesh);
      });
      // The rupture has closed behind the visitor: the idyll is no longer a
      // renderable dimension from inside the tunnel, including through the
      // later White-Room sightline.
      options.idyllWorldMeshes.forEach((mesh) => mesh.setEnabled(false));
      options.onIdyllHidden?.();
    },
  };
}

function cubicBezier(start, controlA, controlB, finish, amount) {
  const inverse = 1 - amount;
  return start.scale(inverse ** 3)
    .add(controlA.scale(3 * inverse * inverse * amount))
    .add(controlB.scale(3 * inverse * amount * amount))
    .add(finish.scale(amount ** 3));
}
