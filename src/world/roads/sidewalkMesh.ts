import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { RoadGraph } from './roadGraph.ts';
import { buildStripPrisms, toTrimesh } from './stripMesh.ts';

export const SIDEWALK_WIDTH_M = 2;
/** Hauteur visible du trottoir. */
export const CURB_HEIGHT_M = 0.15;
/** Hauteur du collider : volontairement bien plus haute que la bordure visible, sinon les raycasts de suspension « montent » dessus et la voiture le franchit. */
export const SIDEWALK_COLLIDER_HEIGHT_M = 1;
/** Jeu laissé aux jonctions, en plus de la demi-largeur de la route qui croise, pour ne pas bloquer les rues transversales. */
const JUNCTION_CLEARANCE_M = 1;
const MIN_PIECE_LENGTH_M = 2;
/** Pas de ré-échantillonnage pour tester le recouvrement avec les autres chaussées. */
const SAMPLE_STEP_M = 1.5;
/** Marge autour d'une chaussée voisine dans laquelle un trottoir est supprimé. */
const CARRIAGEWAY_MARGIN_M = 0.4;
const GRID_CELL_M = 16;

interface PlanarPoint { xM: number; zM: number }

export interface SidewalkLayout {
  visual: BufferGeometry | null;
  collider: { vertices: Float32Array; indices: Uint32Array } | null;
}

/** Raccourcit une polyligne de `startM` au début et `endM` à la fin (interpolation dans le segment concerné) ; null si trop courte. */
export function trimPolyline(points: PlanarPoint[], startM: number, endM: number): PlanarPoint[] | null {
  const lengths: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].xM - points[i - 1].xM, points[i].zM - points[i - 1].zM));
  }
  const total = lengths[lengths.length - 1];
  const from = startM; const to = total - endM;
  if (to - from < MIN_PIECE_LENGTH_M) return null;

  const at = (distance: number): PlanarPoint => {
    let i = 1;
    while (i < points.length - 1 && lengths[i] < distance) i += 1;
    const span = lengths[i] - lengths[i - 1];
    const t = span === 0 ? 0 : (distance - lengths[i - 1]) / span;
    return { xM: points[i - 1].xM + (points[i].xM - points[i - 1].xM) * t, zM: points[i - 1].zM + (points[i].zM - points[i - 1].zM) * t };
  };

  const result: PlanarPoint[] = [at(from)];
  for (let i = 1; i < points.length - 1; i += 1) {
    if (lengths[i] > from && lengths[i] < to) result.push(points[i]);
  }
  result.push(at(to));
  return result;
}


interface RoadSegment { ax: number; az: number; bx: number; bz: number; halfM: number; wayId: number }

/** Tronçon de chaussée d'un AUTRE chunk, déjà exprimé dans le repère du chunk qui construit ses trottoirs. */
export type ForeignCarriageway = Omit<RoadSegment, 'wayId'>;

/**
 * Tronçons de `graph` décalés de (dxM, dzM) — différence d'origine entre le chunk d'où ils
 * viennent et le chunk cible — et limités à ceux qui approchent la tuile cible (demi-côté
 * `reachM`). Une voie appartient au chunk de son premier nœud : sans ça, un trottoir ne
 * « voit » pas les chaussées des chunks voisins qu'il croise.
 */
export function extractCarriageways(graph: RoadGraph, dxM: number, dzM: number, reachM: number): ForeignCarriageway[] {
  const out: ForeignCarriageway[] = [];
  for (const way of graph.ways) {
    const halfM = way.widthM / 2;
    const limit = reachM + halfM;
    for (let i = 0; i < way.nodeIds.length - 1; i += 1) {
      const a = graph.nodesById.get(way.nodeIds[i]); const b = graph.nodesById.get(way.nodeIds[i + 1]);
      if (!a || !b) continue;
      const ax = a.local.xM + dxM; const az = a.local.zM + dzM; const bx = b.local.xM + dxM; const bz = b.local.zM + dzM;
      if (Math.max(ax, bx) < -limit || Math.min(ax, bx) > limit || Math.max(az, bz) < -limit || Math.min(az, bz) > limit) continue;
      out.push({ ax, az, bx, bz, halfM });
    }
  }
  return out;
}

/** Index spatial des tronçons de chaussée (grille uniforme) : évite un test O(échantillons × tronçons) sur un gros chunk. */
class CarriagewayIndex {
  private readonly cells = new Map<string, RoadSegment[]>();

  constructor(graph: RoadGraph, foreign: ForeignCarriageway[]) {
    for (const way of graph.ways) {
      const halfM = way.widthM / 2;
      for (let i = 0; i < way.nodeIds.length - 1; i += 1) {
        const a = graph.nodesById.get(way.nodeIds[i]); const b = graph.nodesById.get(way.nodeIds[i + 1]);
        if (!a || !b) continue;
        this.add({ ax: a.local.xM, az: a.local.zM, bx: b.local.xM, bz: b.local.zM, halfM, wayId: way.id });
      }
    }
    for (const segment of foreign) this.add({ ...segment, wayId: -1 });
  }

  private add(segment: RoadSegment) {
    const reach = segment.halfM + CARRIAGEWAY_MARGIN_M;
    const x0 = Math.floor((Math.min(segment.ax, segment.bx) - reach) / GRID_CELL_M); const x1 = Math.floor((Math.max(segment.ax, segment.bx) + reach) / GRID_CELL_M);
    const z0 = Math.floor((Math.min(segment.az, segment.bz) - reach) / GRID_CELL_M); const z1 = Math.floor((Math.max(segment.az, segment.bz) + reach) / GRID_CELL_M);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cz = z0; cz <= z1; cz += 1) {
        const key = `${cx},${cz}`;
        const list = this.cells.get(key);
        if (list) list.push(segment); else this.cells.set(key, [segment]);
      }
    }
  }

  /** Vrai si (x, z) est sur une chaussée : celle d'une autre voie (avec marge) ou un autre tronçon de `ownWayId`. */
  isOnCarriageway(x: number, z: number, ownWayId: number): boolean {
    const list = this.cells.get(`${Math.floor(x / GRID_CELL_M)},${Math.floor(z / GRID_CELL_M)}`);
    if (!list) return false;
    for (const segment of list) {
      const dx = segment.bx - segment.ax; const dz = segment.bz - segment.az;
      const lengthSq = dx * dx + dz * dz;
      const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - segment.ax) * dx + (z - segment.az) * dz) / lengthSq));
      const px = segment.ax + dx * t - x; const pz = segment.az + dz * t - z;
      // Sa propre voie : pas de marge (le trottoir est par construction à ≥ halfM de son axe), mais un virage serré ou un repli
      // fait revenir le décalage dans la chaussée d'un autre tronçon de la MÊME voie — c'est ce cas qu'on supprime.
      const limit = segment.halfM + (segment.wayId === ownWayId ? 0 : CARRIAGEWAY_MARGIN_M);
      if (px * px + pz * pz < limit * limit) return true;
    }
    return false;
  }
}

/** Ré-échantillonne la polyligne tous les SAMPLE_STEP_M (sommets d'origine conservés en pratique par l'interpolation fine). */
function resample(points: PlanarPoint[]): PlanarPoint[] {
  const out: PlanarPoint[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]; const b = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.xM - a.xM, b.zM - a.zM) / SAMPLE_STEP_M));
    for (let k = 1; k <= steps; k += 1) out.push({ xM: a.xM + ((b.xM - a.xM) * k) / steps, zM: a.zM + ((b.zM - a.zM) * k) / steps });
  }
  return out;
}

/** Sous-polylignes de `axis` (ré-échantillonnée) dont le trottoir du côté `side` ne recouvre aucune autre chaussée. */
function unblockedRuns(axis: PlanarPoint[], side: number, halfWidthM: number, ownWayId: number, index: CarriagewayIndex): PlanarPoint[][] {
  const runs: PlanarPoint[][] = [];
  let current: PlanarPoint[] = [];
  for (let i = 0; i < axis.length; i += 1) {
    const prev = axis[Math.max(0, i - 1)]; const next = axis[Math.min(axis.length - 1, i + 1)];
    const length = Math.hypot(next.xM - prev.xM, next.zM - prev.zM) || 1;
    const nx = -(next.zM - prev.zM) / length; const nz = (next.xM - prev.xM) / length;
    const blocked = [0.2, SIDEWALK_WIDTH_M / 2, SIDEWALK_WIDTH_M - 0.2].some((lateral) => {
      const offset = side * (halfWidthM + lateral);
      return index.isOnCarriageway(axis[i].xM + nx * offset, axis[i].zM + nz * offset, ownWayId);
    });
    if (blocked) {
      if (current.length >= 2) runs.push(current);
      current = [];
    } else {
      current.push(axis[i]);
    }
  }
  if (current.length >= 2) runs.push(current);
  return runs;
}

/**
 * Trottoirs des deux côtés de chaque voie urbaine : chaque voie est coupée à ses jonctions et
 * raccourcie à chaque jonction d'une distance égale à la demi-largeur de la plus large route
 * qui s'y croise (+ jeu), puis tout morceau qui recouvrirait la chaussée d'une autre voie
 * est supprimé géométriquement (indépendant de la topologie OSM : nœuds non partagés,
 * voies qui se croisent sans jonction), pour laisser les carrefours praticables. Produit un visuel bas
 * (CURB_HEIGHT_M) et un maillage de collision haut (SIDEWALK_COLLIDER_HEIGHT_M) fusionnés
 * pour tout le chunk : un seul collider trimesh par chunk.
 */
export function buildSidewalkLayout(graph: RoadGraph, foreign: ForeignCarriageway[] = []): SidewalkLayout {
  const carriageways = new CarriagewayIndex(graph, foreign);
  const widestHalfAtJunction = new Map<number, number>();
  for (const way of graph.ways) {
    for (const nodeId of way.nodeIds) {
      if (!graph.junctionNodeIds.has(nodeId)) continue;
      widestHalfAtJunction.set(nodeId, Math.max(widestHalfAtJunction.get(nodeId) ?? 0, way.widthM / 2));
    }
  }

  const visualPositions: number[] = [];
  const colliderPositions: number[] = [];

  for (const way of graph.ways) {
    if (!way.hasSidewalks) continue;
    const nodes = way.nodeIds.map((id) => graph.nodesById.get(id));
    if (nodes.some((node) => node === undefined) || nodes.length < 2) continue;
    const points: PlanarPoint[] = nodes.map((node) => ({ xM: node!.local.xM, zM: node!.local.zM }));

    const breaks: number[] = [0];
    for (let i = 1; i < nodes.length - 1; i += 1) if (graph.junctionNodeIds.has(way.nodeIds[i])) breaks.push(i);
    breaks.push(nodes.length - 1);

    const halfWidthM = way.widthM / 2;
    for (let b = 0; b < breaks.length - 1; b += 1) {
      const a = breaks[b]; const z = breaks[b + 1];
      const gapAt = (nodeIndex: number) => {
        const nodeId = way.nodeIds[nodeIndex];
        return graph.junctionNodeIds.has(nodeId) ? (widestHalfAtJunction.get(nodeId) ?? halfWidthM) + JUNCTION_CLEARANCE_M : 0;
      };
      const piece = trimPolyline(points.slice(a, z + 1), gapAt(a), gapAt(z));
      if (!piece) continue;
      const axis = resample(piece);
      for (const side of [1, -1]) {
        const inner = side * halfWidthM;
        const outer = side * (halfWidthM + SIDEWALK_WIDTH_M);
        for (const run of unblockedRuns(axis, side, halfWidthM, way.id, carriageways)) {
          buildStripPrisms(visualPositions, run, inner, outer, CURB_HEIGHT_M, 0);
          buildStripPrisms(colliderPositions, run, inner, outer, SIDEWALK_COLLIDER_HEIGHT_M, 0);
        }
      }
    }
  }

  if (visualPositions.length === 0) return { visual: null, collider: null };
  const visual = new BufferGeometry();
  visual.setAttribute('position', new Float32BufferAttribute(visualPositions, 3));
  visual.computeVertexNormals();
  return { visual, collider: toTrimesh(colliderPositions) };
}
