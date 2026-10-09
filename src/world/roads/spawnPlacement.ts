import type { LocalPoint } from '../../shared/types.ts';
import type { RoadGraph, RoadWay } from './roadGraph.ts';

export interface RoadSpawnPose {
  position: LocalPoint;
  headingRad: number;
}

function wayLengthM(way: RoadWay, graph: RoadGraph): number {
  let length = 0;
  for (let i = 0; i < way.nodeIds.length - 1; i += 1) {
    const a = graph.nodesById.get(way.nodeIds[i]);
    const b = graph.nodesById.get(way.nodeIds[i + 1]);
    if (!a || !b) continue;
    length += Math.hypot(b.local.xM - a.local.xM, b.local.zM - a.local.zM);
  }
  return length;
}

/**
 * Doc §7 étape 6 : « Choisir un segment valide et orienter le spawn selon sa tangente. » Prend la
 * voie la plus longue du graphe, un point à mi-longueur, et une direction compatible avec la
 * convention de lacet déjà utilisée par DemoTrack.tsx (atan2(tangent.x, tangent.z), forward = +Z).
 */
export function pickSpawnPose(graph: RoadGraph): RoadSpawnPose | null {
  if (graph.ways.length === 0) return null;
  let longestWay: RoadWay | null = null;
  let longestLengthM = -1;
  for (const way of graph.ways) {
    const length = wayLengthM(way, graph);
    if (length > longestLengthM) { longestLengthM = length; longestWay = way; }
  }
  if (!longestWay || longestWay.nodeIds.length < 2) return null;

  const points = longestWay.nodeIds
    .map((id) => graph.nodesById.get(id))
    .filter((node): node is NonNullable<typeof node> => node !== undefined);
  if (points.length < 2) return null;

  const midIndex = Math.min(points.length - 2, Math.max(0, Math.floor(points.length / 2) - 1));
  const start = points[midIndex].local;
  const end = points[midIndex + 1].local;
  const directionX = end.xM - start.xM;
  const directionZ = end.zM - start.zM;
  const headingRad = Math.atan2(directionX, directionZ);
  const position: LocalPoint = {
    xM: (start.xM + end.xM) / 2,
    yM: 0,
    zM: (start.zM + end.zM) / 2,
  };
  return { position, headingRad };
}
