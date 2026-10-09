import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import type { RoadGraph } from './roadGraph.ts';

/**
 * Ruban plat pour une polyligne OUVERTE quelconque (segments droits entre nœuds OSM, pas de
 * lissage) : même technique que les rubans fermés de DemoTrack.tsx (tangente+normale par
 * échantillon), mais écrite indépendamment — DemoTrack.tsx n'est ni modifié ni importé ici.
 */
export function buildWayRibbon(points: Vector3[], halfWidthM: number, y: number): BufferGeometry {
  const count = points.length;
  const positions = new Float32Array(count * 2 * 3);
  const tangent = new Vector3();
  const normal = new Vector3();

  for (let i = 0; i < count; i += 1) {
    const previous = points[Math.max(0, i - 1)];
    const next = points[Math.min(count - 1, i + 1)];
    tangent.copy(next).sub(previous);
    if (tangent.lengthSq() === 0) tangent.set(0, 0, 1); else tangent.normalize();
    normal.set(-tangent.z, 0, tangent.x);

    const left = points[i].clone().addScaledVector(normal, halfWidthM);
    const right = points[i].clone().addScaledVector(normal, -halfWidthM);
    positions[i * 6 + 0] = left.x; positions[i * 6 + 1] = y; positions[i * 6 + 2] = left.z;
    positions[i * 6 + 3] = right.x; positions[i * 6 + 4] = y; positions[i * 6 + 5] = right.z;
  }

  const indices: number[] = [];
  for (let i = 0; i < count - 1; i += 1) {
    const a = i * 2; const b = i * 2 + 1; const c = (i + 1) * 2; const d = (i + 1) * 2 + 1;
    indices.push(a, c, b, b, c, d);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Remplissage plat à une jonction, dimensionné sur la route entrante la plus large, pour éviter les trous visuels entre voies. */
export function buildJunctionFillerGeometry(center: Vector3, widestHalfWidthM: number, y: number): BufferGeometry {
  const half = widestHalfWidthM;
  const positions = new Float32Array([
    center.x - half, y, center.z - half,
    center.x + half, y, center.z - half,
    center.x - half, y, center.z + half,
    center.x + half, y, center.z + half,
  ]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  geometry.computeVertexNormals();
  return geometry;
}

export interface JunctionPlacement {
  positionM: [number, number, number];
  halfWidthM: number;
}

export interface RoadNetworkLayout {
  wayPoints: Vector3[][];
  wayHalfWidths: number[];
  junctions: JunctionPlacement[];
  groundBounds: { centerM: [number, number]; halfExtentM: [number, number] };
}

/**
 * Résout le graphe (déjà projeté en mètres) en données prêtes pour le rendu : une polyligne par
 * voie, un remplissage par jonction (la plus large route entrante détermine sa taille), et
 * l'étendue d'un collider de sol plat couvrant toute la zone — même principe que le collider de
 * sol non accordé-au-tracé de DemoTrack.tsx, pour qu'une sortie de route ne fasse jamais tomber
 * le véhicule.
 */
export function buildRoadNetworkLayout(graph: RoadGraph, roadY: number): RoadNetworkLayout {
  const wayPoints: Vector3[][] = [];
  const wayHalfWidths: number[] = [];
  const junctionWidestHalfWidth = new Map<number, number>();

  for (const way of graph.ways) {
    const points = way.nodeIds
      .map((id) => graph.nodesById.get(id))
      .filter((node): node is NonNullable<typeof node> => node !== undefined)
      .map((node) => new Vector3(node.local.xM, roadY, node.local.zM));
    if (points.length < 2) continue;
    wayPoints.push(points);
    wayHalfWidths.push(way.widthM / 2);

    for (const nodeId of way.nodeIds) {
      if (!graph.junctionNodeIds.has(nodeId)) continue;
      const current = junctionWidestHalfWidth.get(nodeId) ?? 0;
      junctionWidestHalfWidth.set(nodeId, Math.max(current, way.widthM / 2));
    }
  }

  const junctions: JunctionPlacement[] = [];
  for (const nodeId of graph.junctionNodeIds) {
    const node = graph.nodesById.get(nodeId);
    const halfWidthM = junctionWidestHalfWidth.get(nodeId);
    if (!node || !halfWidthM) continue;
    junctions.push({ positionM: [node.local.xM, roadY, node.local.zM], halfWidthM });
  }

  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const node of graph.nodesById.values()) {
    minX = Math.min(minX, node.local.xM); maxX = Math.max(maxX, node.local.xM);
    minZ = Math.min(minZ, node.local.zM); maxZ = Math.max(maxZ, node.local.zM);
  }
  const marginM = 40;
  const groundBounds = {
    centerM: [(minX + maxX) / 2, (minZ + maxZ) / 2] as [number, number],
    halfExtentM: [(maxX - minX) / 2 + marginM, (maxZ - minZ) / 2 + marginM] as [number, number],
  };

  return { wayPoints, wayHalfWidths, junctions, groundBounds };
}
