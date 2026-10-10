/**
 * Fantôme du meilleur tour : position et cap de la voiture échantillonnés à fréquence fixe pendant un tour, rejoués ensuite par
 * interpolation. Stockage compact (différences entières, centimètres et millièmes de radian) dans localStorage, avec les mêmes
 * précautions que les records : tout est facultatif, jamais bloquant. Logique pure.
 */

import type { KeyValueStorage } from './records.ts';

export const GHOST_HZ = 20;
export const GHOSTS_KEY = 'cardrive.ghosts';
const VERSION = 1;
/** Nombre maximal de fantômes conservés (les plus anciens sont oubliés) : borne l'espace pris dans localStorage. */
export const MAX_GHOSTS = 12;
const POSITION_UNIT_M = 0.01;
const HEADING_UNIT_RAD = 0.001;

export interface GhostSample { xM: number; zM: number; headingRad: number }

/** Fantôme décodé : un échantillon tous les 1 / GHOST_HZ secondes, le premier à l'instant 0 du tour. */
export interface Ghost {
  lapS: number;
  samples: GhostSample[];
}

/** Forme stockée : première valeur absolue puis différences entières, à plat [x, z, cap, x, z, cap…]. */
export interface StoredGhost {
  lapS: number;
  d: number[];
  setAtMs: number;
}

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export class GhostRecorder {
  private samples: GhostSample[] = [];

  reset(): void { this.samples = []; }

  /** À appeler à chaque pas avec le temps écoulé depuis le début du tour ; n'enregistre que quand un nouvel échantillon est dû. */
  add(lapTimeS: number, xM: number, zM: number, headingRad: number): void {
    while (this.samples.length / GHOST_HZ <= lapTimeS) {
      this.samples.push({ xM, zM, headingRad });
    }
  }

  finish(lapS: number): Ghost {
    return { lapS, samples: this.samples.slice() };
  }
}

export function encodeGhost(ghost: Ghost, nowMs: number): StoredGhost {
  const d: number[] = [];
  let px = 0; let pz = 0; let ph = 0;
  for (const sample of ghost.samples) {
    const x = Math.round(sample.xM / POSITION_UNIT_M);
    const z = Math.round(sample.zM / POSITION_UNIT_M);
    const h = Math.round(wrapAngle(sample.headingRad) / HEADING_UNIT_RAD);
    d.push(x - px, z - pz, h - ph);
    px = x; pz = z; ph = h;
  }
  return { lapS: ghost.lapS, d, setAtMs: nowMs };
}

export function decodeGhost(stored: StoredGhost): Ghost {
  const samples: GhostSample[] = [];
  let x = 0; let z = 0; let h = 0;
  for (let i = 0; i + 2 < stored.d.length; i += 3) {
    x += stored.d[i]; z += stored.d[i + 1]; h += stored.d[i + 2];
    samples.push({ xM: x * POSITION_UNIT_M, zM: z * POSITION_UNIT_M, headingRad: h * HEADING_UNIT_RAD });
  }
  return { lapS: stored.lapS, samples };
}

/** Pose interpolée du fantôme à l'instant lapTimeS du tour ; null s'il n'y a pas d'échantillon ou si le tour du fantôme est fini depuis plus d'une seconde. */
export function sampleGhost(ghost: Ghost, lapTimeS: number): GhostSample | null {
  const { samples } = ghost;
  if (samples.length === 0 || lapTimeS < 0 || lapTimeS > ghost.lapS + 1) return null;
  const position = lapTimeS * GHOST_HZ;
  const lower = Math.min(Math.floor(position), samples.length - 1);
  const upper = Math.min(lower + 1, samples.length - 1);
  const t = Math.min(1, position - lower);
  const a = samples[lower]; const b = samples[upper];
  return {
    xM: a.xM + (b.xM - a.xM) * t,
    zM: a.zM + (b.zM - a.zM) * t,
    headingRad: a.headingRad + wrapAngle(b.headingRad - a.headingRad) * t,
  };
}

export type GhostBook = Record<string, StoredGhost>;

const isStoredGhost = (value: unknown): value is StoredGhost => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredGhost>;
  return typeof candidate.lapS === 'number' && Number.isFinite(candidate.lapS)
    && Array.isArray(candidate.d) && candidate.d.length >= 6 && candidate.d.length % 3 === 0
    && candidate.d.every((n) => typeof n === 'number' && Number.isFinite(n))
    && typeof candidate.setAtMs === 'number';
};

const browserStorage = (): KeyValueStorage | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

export function loadGhosts(storage: KeyValueStorage | null = browserStorage()): GhostBook {
  try {
    const raw = storage?.getItem(GHOSTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { version?: number; ghosts?: Record<string, unknown> };
    if (parsed.version !== VERSION || typeof parsed.ghosts !== 'object' || parsed.ghosts === null) return {};
    const book: GhostBook = {};
    for (const [key, value] of Object.entries(parsed.ghosts)) if (isStoredGhost(value)) book[key] = value;
    return book;
  } catch {
    return {};
  }
}

/** Ajoute (ou remplace) le fantôme d'une clé et n'en garde que MAX_GHOSTS, les plus récents. */
export function withGhost(book: GhostBook, key: string, ghost: StoredGhost): GhostBook {
  const next: GhostBook = { ...book, [key]: ghost };
  const keys = Object.keys(next);
  if (keys.length <= MAX_GHOSTS) return next;
  keys.sort((a, b) => next[a].setAtMs - next[b].setAtMs);
  for (const key of keys.slice(0, keys.length - MAX_GHOSTS)) delete next[key];
  return next;
}

/** Renvoie vrai si l'écriture a réussi (stockage indisponible ou plein : faux, sans erreur). */
export function saveGhosts(book: GhostBook, storage: KeyValueStorage | null = browserStorage()): boolean {
  try {
    storage?.setItem(GHOSTS_KEY, JSON.stringify({ version: VERSION, ghosts: book }));
    return storage !== null;
  } catch {
    return false;
  }
}
