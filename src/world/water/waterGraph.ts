import type { GeoAnchor } from '../../geo/projection.ts';
import { projectToLocal } from '../../geo/projection.ts';
import type { RawOsmData } from '../../map/geoProvider.ts';

export interface PlanarPoint { xM: number; zM: number }

export interface WaterArea { ring: PlanarPoint[] }
export interface WaterLine { points: PlanarPoint[]; widthM: number }

export interface WaterGraph {
  areas: WaterArea[];
  lines: WaterLine[];
}

export const EMPTY_WATER_GRAPH: WaterGraph = { areas: [], lines: [] };

const DEFAULT_WATERWAY_WIDTH_M: Record<string, number> = { river: 14, canal: 10, stream: 3 };
const MIN_AREA_M2 = 4;

/** Sutherland–Hodgman contre un seul demi-plan ; `inside` et `intersect` sont fournis par le côté testé. */
function clipAgainst(
  ring: PlanarPoint[],
  inside: (p: PlanarPoint) => boolean,
  intersect: (a: PlanarPoint, b: PlanarPoint) => PlanarPoint,
): PlanarPoint[] {
  const output: PlanarPoint[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const current = ring[i];
    const previous = ring[(i + ring.length - 1) % ring.length];
    if (inside(current)) {
      if (!inside(previous)) output.push(intersect(previous, current));
      output.push(current);
    } else if (inside(previous)) {
      output.push(intersect(previous, current));
    }
  }
  return output;
}

/** Découpe un anneau au carré [-half, half]² (repère local du chunk) : un grand lac/fleuve est ainsi réparti sur chaque chunk qu'il traverse. */
export function clipRingToSquare(ring: PlanarPoint[], halfM: number): PlanarPoint[] {
  const atX = (x: number) => (a: PlanarPoint, b: PlanarPoint): PlanarPoint => ({ xM: x, zM: a.zM + ((b.zM - a.zM) * (x - a.xM)) / (b.xM - a.xM) });
  const atZ = (z: number) => (a: PlanarPoint, b: PlanarPoint): PlanarPoint => ({ zM: z, xM: a.xM + ((b.xM - a.xM) * (z - a.zM)) / (b.zM - a.zM) });
  let result = clipAgainst(ring, (p) => p.xM >= -halfM, atX(-halfM));
  if (result.length) result = clipAgainst(result, (p) => p.xM <= halfM, atX(halfM));
  if (result.length) result = clipAgainst(result, (p) => p.zM >= -halfM, atZ(-halfM));
  if (result.length) result = clipAgainst(result, (p) => p.zM <= halfM, atZ(halfM));
  return result;
}

function polygonAreaM2(ring: PlanarPoint[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    sum += a.xM * b.zM - b.xM * a.zM;
  }
  return Math.abs(sum) / 2;
}

/** Projette l'eau brute dans le repère du chunk (ancre = son centre) et découpe les surfaces à sa tuile (+ léger recouvrement contre les coutures). */
export function buildWaterGraph(raw: RawOsmData, anchor: GeoAnchor, chunkHalfSizeM: number): WaterGraph {
  const nodesById = new Map(raw.nodes.map((node) => [node.id, projectToLocal(node, anchor)] as const));
  const areas: WaterArea[] = [];
  const lines: WaterLine[] = [];

  for (const way of raw.ways) {
    const points: PlanarPoint[] = [];
    for (const id of way.nodeIds) {
      const local = nodesById.get(id);
      if (local) points.push({ xM: local.xM, zM: local.zM });
    }
    if (way.tags.water === 'area') {
      const closed = points.length > 1 && points[0].xM === points[points.length - 1].xM && points[0].zM === points[points.length - 1].zM;
      const ring = closed ? points.slice(0, -1) : points;
      if (ring.length < 3) continue;
      const clipped = clipRingToSquare(ring, chunkHalfSizeM + 0.5);
      if (clipped.length >= 3 && polygonAreaM2(clipped) >= MIN_AREA_M2) areas.push({ ring: clipped });
    } else if (way.tags.water === 'line' && points.length >= 2) {
      const widthTag = way.tags.width ? Number.parseFloat(way.tags.width) : NaN;
      const widthM = Number.isFinite(widthTag) && widthTag > 0 ? widthTag : (DEFAULT_WATERWAY_WIDTH_M[way.tags.waterway ?? ''] ?? 4);
      lines.push({ points, widthM });
    }
  }
  return { areas, lines };
}
