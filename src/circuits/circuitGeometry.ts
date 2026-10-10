import type { GeoAnchor } from '../geo/projection.ts';
import { projectToLocal } from '../geo/projection.ts';
import type { CircuitSource } from './f1Circuits2026.ts';

export interface PlanarPoint { xM: number; zM: number }

export interface CircuitTrack {
  id: string;
  name: string;
  grandPrix: string;
  /** Point de référence géographique : la ligne de départ. Sert d'ancre à la mini-carte. */
  anchor: GeoAnchor;
  widthM: number;
  /** Ligne centrale fermée (le dernier point n'est PAS répété), échantillonnée tous les SAMPLE_SPACING_M, dans le repère local de l'ancre. */
  centerline: PlanarPoint[];
  lengthM: number;
  /** Emprise de la ligne centrale (mètres, repère local). */
  boundsM: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Position de départ (quelques mètres avant la ligne) et cap, convention atan2(forward.x, forward.z). */
  spawn: { xM: number; zM: number; headingRad: number };
  /** Ligne de départ : centre et cap. */
  startLine: { xM: number; zM: number; headingRad: number };
}

export const SAMPLE_SPACING_M = 3;
/** Rayon maximal (en distance d'arrondi) d'un virage : au-delà, les lignes droites restent droites. */
const MAX_CORNER_CUT_M = 70;
const MIN_POINT_GAP_M = 1;
const CORNER_STEP_RAD = Math.PI / 18;
/** Distance minimale le long du circuit (m) pour que deux portions soient considérées comme distinctes (croisement, épingle). */
const FAR_ARC_M = 90;
const START_OFFSET_SAMPLES = 2;

const dist = (a: PlanarPoint, b: PlanarPoint) => Math.hypot(a.xM - b.xM, a.zM - b.zM);

function dedupeClosed(points: PlanarPoint[]): PlanarPoint[] {
  const out: PlanarPoint[] = [];
  for (const point of points) {
    if (out.length === 0 || dist(out[out.length - 1], point) >= MIN_POINT_GAP_M) out.push(point);
  }
  while (out.length > 1 && dist(out[0], out[out.length - 1]) < MIN_POINT_GAP_M) out.pop();
  return out;
}

/**
 * Arrondit chaque sommet d'une polyligne fermée par une courbe de Bézier quadratique (le
 * sommet est le point de contrôle). La coupe est plafonnée à la moitié des segments voisins
 * (jamais de chevauchement) et à MAX_CORNER_CUT_M : un long tronçon droit reste droit, seuls
 * les virages tracés à la main sont adoucis — contrairement à un spline global, qui bomberait
 * les lignes droites vers le virage suivant.
 */
export function roundClosedCorners(points: PlanarPoint[], maxCutM: number = MAX_CORNER_CUT_M): PlanarPoint[] {
  const n = points.length;
  const out: PlanarPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const prev = points[(i + n - 1) % n]; const p = points[i]; const next = points[(i + 1) % n];
    const lenIn = dist(prev, p); const lenOut = dist(p, next);
    const inX = (p.xM - prev.xM) / lenIn; const inZ = (p.zM - prev.zM) / lenIn;
    const outX = (next.xM - p.xM) / lenOut; const outZ = (next.zM - p.zM) / lenOut;
    const angle = Math.acos(Math.max(-1, Math.min(1, inX * outX + inZ * outZ)));
    if (angle < 0.02) { out.push(p); continue; }
    const cut = Math.min(maxCutM, lenIn / 2, lenOut / 2);
    const a = { xM: p.xM - inX * cut, zM: p.zM - inZ * cut };
    const b = { xM: p.xM + outX * cut, zM: p.zM + outZ * cut };
    const steps = Math.max(2, Math.ceil(angle / CORNER_STEP_RAD));
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps; const u = 1 - t;
      out.push({
        xM: u * u * a.xM + 2 * u * t * p.xM + t * t * b.xM,
        zM: u * u * a.zM + 2 * u * t * p.zM + t * t * b.zM,
      });
    }
  }
  return out;
}

/** Rééchantillonne une polyligne fermée à pas régulier (abscisse curviligne) ; renvoie aussi la longueur totale. */
export function resampleClosed(points: PlanarPoint[], spacingM: number): { points: PlanarPoint[]; lengthM: number } {
  const n = points.length;
  const cumulative = [0];
  for (let i = 0; i < n; i += 1) cumulative.push(cumulative[i] + dist(points[i], points[(i + 1) % n]));
  const lengthM = cumulative[n];
  const count = Math.max(8, Math.round(lengthM / spacingM));
  const out: PlanarPoint[] = [];
  let segment = 0;
  for (let k = 0; k < count; k += 1) {
    const target = (k / count) * lengthM;
    while (segment < n - 1 && cumulative[segment + 1] < target) segment += 1;
    const span = cumulative[segment + 1] - cumulative[segment];
    const t = span === 0 ? 0 : (target - cumulative[segment]) / span;
    const a = points[segment]; const b = points[(segment + 1) % n];
    out.push({ xM: a.xM + (b.xM - a.xM) * t, zM: a.zM + (b.zM - a.zM) * t });
  }
  return { points: out, lengthM };
}

/** Tangente unitaire (différence centrée, cyclique) à l'échantillon i. */
export function tangentAt(points: PlanarPoint[], i: number): PlanarPoint {
  const n = points.length;
  const prev = points[(i + n - 1) % n]; const next = points[(i + 1) % n];
  const length = Math.hypot(next.xM - prev.xM, next.zM - prev.zM) || 1;
  return { xM: (next.xM - prev.xM) / length, zM: (next.zM - prev.zM) / length };
}

/** Normale gauche (-tz, tx), même convention que buildWayRibbon et buildStripPrisms. */
export const normalOf = (tangent: PlanarPoint): PlanarPoint => ({ xM: -tangent.zM, zM: tangent.xM });

export function buildCircuitTrack(source: CircuitSource): CircuitTrack {
  const anchor: GeoAnchor = { latitudeDeg: source.coordinates[0][1], longitudeDeg: source.coordinates[0][0] };
  const projected = source.coordinates.map(([longitudeDeg, latitudeDeg]) => {
    const local = projectToLocal({ latitudeDeg, longitudeDeg }, anchor);
    return { xM: local.xM, zM: local.zM };
  });
  const ring = dedupeClosed(projected);
  const { points: centerline, lengthM } = resampleClosed(roundClosedCorners(ring), SAMPLE_SPACING_M);

  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const p of centerline) {
    minX = Math.min(minX, p.xM); maxX = Math.max(maxX, p.xM);
    minZ = Math.min(minZ, p.zM); maxZ = Math.max(maxZ, p.zM);
  }

  const headingAt = (i: number) => { const t = tangentAt(centerline, i); return Math.atan2(t.xM, t.zM); };
  const spawnIndex = (centerline.length - START_OFFSET_SAMPLES) % centerline.length;
  return {
    id: source.id,
    name: source.name,
    grandPrix: source.grandPrix,
    anchor,
    widthM: source.widthM,
    centerline,
    lengthM,
    boundsM: { minX, maxX, minZ, maxZ },
    spawn: { xM: centerline[spawnIndex].xM, zM: centerline[spawnIndex].zM, headingRad: headingAt(spawnIndex) },
    startLine: { xM: centerline[0].xM, zM: centerline[0].zM, headingRad: headingAt(0) },
  };
}

/**
 * Plages d'échantillons consécutifs (cycliques) pour lesquels le point décalé de `lateralM`
 * (côté `side`) ne tombe pas sur une AUTRE portion du circuit — celle-ci étant à plus de
 * FAR_ARC_M le long de la piste — c.-à-d. ni en croisement (Suzuka) ni dans une épingle serrée.
 * Sert à supprimer murs et vibreurs là où ils couperaient la piste. Chaque plage est renvoyée
 * comme liste de points ; une plage couvrant tout le circuit est fermée (premier point répété).
 */
export function unblockedRuns(track: CircuitTrack, side: 1 | -1, lateralM: number): PlanarPoint[][] {
  const points = track.centerline;
  const n = points.length;
  const half = track.widthM / 2;
  const reach = half + 1;
  const cell = 24;
  const grid = new Map<string, number[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  points.forEach((p, i) => {
    const k = key(p.xM, p.zM);
    const list = grid.get(k);
    if (list) list.push(i); else grid.set(k, [i]);
  });
  const farIndexDistance = Math.ceil(FAR_ARC_M / SAMPLE_SPACING_M);

  const blocked: boolean[] = points.map((p, i) => {
    const normal = normalOf(tangentAt(points, i));
    const x = p.xM + normal.xM * side * lateralM; const z = p.zM + normal.zM * side * lateralM;
    const cx = Math.floor(x / cell); const cz = Math.floor(z / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const j of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          const around = Math.abs(i - j); const cyclic = Math.min(around, n - around);
          if (cyclic < farIndexDistance) continue;
          if (Math.hypot(points[j].xM - x, points[j].zM - z) < reach) return true;
        }
      }
    }
    return false;
  });

  const firstBlocked = blocked.indexOf(true);
  if (firstBlocked === -1) return [[...points, points[0]]];

  const runs: PlanarPoint[][] = [];
  let current: PlanarPoint[] = [];
  for (let step = 1; step <= n; step += 1) {
    const i = (firstBlocked + step) % n;
    if (blocked[i]) {
      if (current.length >= 2) runs.push(current);
      current = [];
    } else {
      current.push(points[i]);
    }
  }
  if (current.length >= 2) runs.push(current);
  return runs;
}
