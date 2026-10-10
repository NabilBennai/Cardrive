import { BufferGeometry, Float32BufferAttribute } from 'three';
import { buildStripPrisms, toTrimesh } from '../world/roads/stripMesh.ts';
import { normalOf, unblockedRuns, type CircuitTrack, type PlanarPoint } from './circuitGeometry.ts';

export const TRACK_Y = 0.01;
/** Les vibreurs sont posés à peine plus haut que la piste pour ne pas z-fighter avec elle. */
const KERB_Y = 0.016;
const KERB_WIDTH_M = 1.3;
/** Distance entre le bord de la piste et le mur : une zone d'échappatoire herbeuse. */
const WALL_OFFSET_M = 7;
const WALL_THICKNESS_M = 0.7;
export const WALL_HEIGHT_M = 1.1;
/** Taille (m) d'une répétition de la texture d'asphalte, dans les deux sens. */
const ASPHALT_TILE_M = 4;
/** Longueur (m) d'un couple rouge + blanc de vibreur. */
const KERB_PERIOD_M = 1.6;

interface RibbonBuffers { positions: number[]; uvs: number[]; indices: number[] }
const newBuffers = (): RibbonBuffers => ({ positions: [], uvs: [], indices: [] });

/**
 * Ajoute un ruban entre les décalages latéraux offsetA et offsetB (m, signés, normale gauche) le
 * long d'une polyligne. `closed` : le dernier point répète le premier, les tangentes bouclent.
 * UV : u = décalage / uTileM, v = abscisse curviligne / vTileM (répétition par tuile réelle).
 */
function appendRibbon(out: RibbonBuffers, points: PlanarPoint[], closed: boolean, offsetA: number, offsetB: number, y: number, uOf: (offset: number) => number, vTileM: number) {
  const count = points.length;
  const base = out.positions.length / 3;
  let along = 0;
  for (let i = 0; i < count; i += 1) {
    if (i > 0) along += Math.hypot(points[i].xM - points[i - 1].xM, points[i].zM - points[i - 1].zM);
    const prev = i > 0 ? points[i - 1] : (closed ? points[count - 2] : points[0]);
    const next = i < count - 1 ? points[i + 1] : (closed ? points[1] : points[count - 1]);
    const length = Math.hypot(next.xM - prev.xM, next.zM - prev.zM) || 1;
    const normal = normalOf({ xM: (next.xM - prev.xM) / length, zM: (next.zM - prev.zM) / length });
    out.positions.push(
      points[i].xM + normal.xM * offsetA, y, points[i].zM + normal.zM * offsetA,
      points[i].xM + normal.xM * offsetB, y, points[i].zM + normal.zM * offsetB,
    );
    out.uvs.push(uOf(offsetA), along / vTileM, uOf(offsetB), along / vTileM);
  }
  // Face visible vers le HAUT : la normale gauche (-tz, tx) fait que (a, c, b) regarde vers le bas quand
  // B est à gauche de A (offsetB > offsetA) ; on inverse alors l'enroulement.
  const flip = offsetB > offsetA;
  for (let i = 0; i < count - 1; i += 1) {
    const a = base + i * 2; const b = a + 1; const c = a + 2; const d = a + 3;
    if (flip) out.indices.push(a, b, c, b, d, c); else out.indices.push(a, c, b, b, c, d);
  }
}

function toGeometry(buffers: RibbonBuffers): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(buffers.uvs, 2));
  geometry.setIndex(buffers.indices);
  geometry.computeVertexNormals();
  return geometry;
}

export interface CircuitLayout {
  asphalt: BufferGeometry;
  kerbs: BufferGeometry | null;
  walls: { geometry: BufferGeometry; collider: { vertices: Float32Array; indices: Uint32Array } } | null;
  /** Rectangle du sol herbeux (centre et demi-côtés, mètres) couvrant tout le circuit + dégagement. */
  ground: { centerM: [number, number]; halfExtentM: [number, number] };
}

/** Piste fermée (une seule bande continue), vibreurs rouges/blancs et murs d'enceinte — ces deux derniers supprimés là où une autre portion de piste passe (croisement de Suzuka, épingles serrées). */
export function buildCircuitLayout(track: CircuitTrack): CircuitLayout {
  const half = track.widthM / 2;
  const loop = [...track.centerline, track.centerline[0]];

  const asphaltBuffers = newBuffers();
  appendRibbon(asphaltBuffers, loop, true, -half, half, TRACK_Y, (offset) => offset / ASPHALT_TILE_M, ASPHALT_TILE_M);

  const kerbBuffers = newBuffers();
  const wallPositions: number[] = [];
  for (const side of [1, -1] as const) {
    const kerbInner = side * half; const kerbOuter = side * (half + KERB_WIDTH_M);
    for (const run of unblockedRuns(track, side, half + KERB_WIDTH_M / 2)) {
      const closed = run.length > 2 && run[0] === run[run.length - 1];
      appendRibbon(kerbBuffers, run, closed, kerbInner, kerbOuter, KERB_Y, (offset) => (Math.abs(offset) > half + KERB_WIDTH_M / 2 ? 1 : 0), KERB_PERIOD_M);
    }
    const wallA = side * (half + WALL_OFFSET_M); const wallB = side * (half + WALL_OFFSET_M + WALL_THICKNESS_M);
    for (const run of unblockedRuns(track, side, half + WALL_OFFSET_M + WALL_THICKNESS_M / 2)) {
      buildStripPrisms(wallPositions, run, wallA, wallB, WALL_HEIGHT_M, 0);
    }
  }

  const { minX, maxX, minZ, maxZ } = track.boundsM;
  const margin = half + WALL_OFFSET_M + 120;
  let walls: CircuitLayout['walls'] = null;
  if (wallPositions.length > 0) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(wallPositions, 3));
    geometry.computeVertexNormals();
    walls = { geometry, collider: toTrimesh(wallPositions) };
  }
  return {
    asphalt: toGeometry(asphaltBuffers),
    kerbs: kerbBuffers.positions.length > 0 ? toGeometry(kerbBuffers) : null,
    walls,
    ground: { centerM: [(minX + maxX) / 2, (minZ + maxZ) / 2], halfExtentM: [(maxX - minX) / 2 + margin, (maxZ - minZ) / 2 + margin] },
  };
}
