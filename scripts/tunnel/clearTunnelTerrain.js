import { TUNNEL_DURATION, getTunnelDiameter } from "./tunnelConfig.js";

/**
 * Removes terrain triangles from the tunnel exclusion corridor. This is a
 * real cutout: no terrain is translated, hidden, or left spanning the hole.
 */
export function clearTunnelTerrain(terrainMeshes, route) {
  const routeSamples = createRouteSamples(route);

  terrainMeshes.filter(Boolean).forEach((terrain) => {
    const positions = terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const indices = terrain.getIndices();
    if (!positions || !indices) {
      return;
    }

    const remainingIndices = [];
    for (let index = 0; index < indices.length; index += 3) {
      const triangleTouchesTunnel = triangleIntersectsTunnel(
        positions,
        indices[index],
        indices[index + 1],
        indices[index + 2],
        routeSamples,
      );
      if (!triangleTouchesTunnel) {
        remainingIndices.push(indices[index], indices[index + 1], indices[index + 2]);
      }
    }

    const normals = [];
    BABYLON.VertexData.ComputeNormals(positions, remainingIndices, normals);
    terrain.updateVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
    terrain.setIndices(remainingIndices);
  });
}

/** Removes placed idyll assets whose anchors fall inside the same corridor. */
export function removeIdyllObjectsFromTunnel(entries, route) {
  const routeSamples = createRouteSamples(route);
  const removed = [];

  entries.forEach((entry) => {
    const position = entry.anchor.getAbsolutePosition();
    if (!isInsideTunnelExclusion(position.x, position.z, routeSamples, 0.95)) {
      return;
    }
    entry.roots?.forEach((root) => root.dispose());
    entry.anchor.dispose();
    removed.push(entry.prefix);
  });

  return removed;
}

function createRouteSamples(route) {
  const samples = Array.from({ length: 189 }, (_, index) => {
    const progress = index / 188;
    return {
      point: route.positionAt(progress),
      diameter: getTunnelDiameter(progress * TUNNEL_DURATION),
    };
  });
  // Keep the actual cutout open through the short spatial hand-off to the
  // White Room. Without these continuation samples, the grass terrain could
  // remain visible across the otherwise open final tunnel aperture.
  const end = route.positionAt(1);
  const direction = route.tangentAt(1);
  for (let index = 1; index <= 10; index += 1) {
    samples.push({
      point: end.add(direction.scale(index * 0.4)),
      diameter: getTunnelDiameter(TUNNEL_DURATION),
    });
  }
  return samples;
}

function triangleIntersectsTunnel(positions, firstIndex, secondIndex, thirdIndex, routeSamples) {
  const vertices = [firstIndex, secondIndex, thirdIndex].map((vertexIndex) => ({
    x: positions[vertexIndex * 3],
    z: positions[vertexIndex * 3 + 2],
  }));
  const samples = [
    ...vertices,
    midpoint(vertices[0], vertices[1]),
    midpoint(vertices[1], vertices[2]),
    midpoint(vertices[2], vertices[0]),
    {
      x: (vertices[0].x + vertices[1].x + vertices[2].x) / 3,
      z: (vertices[0].z + vertices[1].z + vertices[2].z) / 3,
    },
  ];
  return samples.some((point) => isInsideTunnelExclusion(point.x, point.z, routeSamples, 0.8));
}

function midpoint(first, second) {
  return { x: (first.x + second.x) * 0.5, z: (first.z + second.z) * 0.5 };
}

function isInsideTunnelExclusion(x, z, routeSamples, padding) {
  const nearest = findNearestRouteSample(x, z, routeSamples);
  return nearest.distance < nearest.diameter * 0.5 + padding;
}

function findNearestRouteSample(x, z, samples) {
  let nearest = samples[0];
  let closestSquaredDistance = Number.POSITIVE_INFINITY;

  samples.forEach((sample) => {
    const distanceX = x - sample.point.x;
    const distanceZ = z - sample.point.z;
    const squaredDistance = distanceX * distanceX + distanceZ * distanceZ;
    if (squaredDistance < closestSquaredDistance) {
      nearest = sample;
      closestSquaredDistance = squaredDistance;
    }
  });

  return { ...nearest, distance: Math.sqrt(closestSquaredDistance) };
}
