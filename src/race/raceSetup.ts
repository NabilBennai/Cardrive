import type { CircuitTrack } from '../circuits/circuitGeometry.ts';
import { buildGrid, type GridSlot } from './grid.ts';
import type { KeyValueStorage } from './records.ts';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type RaceMode = 'timeattack' | 'race';

export interface RaceSetup {
  mode: RaceMode;
  laps: number;
  /** Nombre d'adversaires. */
  rivals: number;
  difficulty: Difficulty;
}

export const DEFAULT_RACE_SETUP: RaceSetup = { mode: 'timeattack', laps: 3, rivals: 5, difficulty: 'normal' };
export const LAP_CHOICES = [1, 3, 5] as const;
export const RIVAL_CHOICES = [3, 5, 7] as const;
export const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: 'Facile', normal: 'Normal', hard: 'Difficile' };
/** Niveau de pilotage moyen des adversaires (voir aiProfileFor). */
const BASE_SKILL: Record<Difficulty, number> = { easy: 0.25, normal: 0.6, hard: 1 };
/** Écart de niveau entre deux rangs de grille : la pole est la plus rapide, le fond de grille la moins. */
const SKILL_STEP_PER_RANK = 0.05;

export const RACE_SETUP_KEY = 'cardrive.raceSetup';

const oneOf = <T,>(value: unknown, choices: readonly T[], fallback: T): T => (choices.includes(value as T) ? (value as T) : fallback);

export function sanitizeRaceSetup(value: unknown): RaceSetup {
  const candidate = (typeof value === 'object' && value !== null ? value : {}) as Partial<RaceSetup>;
  return {
    mode: oneOf(candidate.mode, ['timeattack', 'race'] as const, DEFAULT_RACE_SETUP.mode),
    laps: oneOf(candidate.laps, LAP_CHOICES, DEFAULT_RACE_SETUP.laps),
    rivals: oneOf(candidate.rivals, RIVAL_CHOICES, DEFAULT_RACE_SETUP.rivals),
    difficulty: oneOf(candidate.difficulty, ['easy', 'normal', 'hard'] as const, DEFAULT_RACE_SETUP.difficulty),
  };
}

const browserStorage = (): KeyValueStorage | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

export function loadRaceSetup(storage: KeyValueStorage | null = browserStorage()): RaceSetup {
  try {
    const raw = storage?.getItem(RACE_SETUP_KEY);
    return sanitizeRaceSetup(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_RACE_SETUP };
  }
}

export function saveRaceSetup(setup: RaceSetup, storage: KeyValueStorage | null = browserStorage()): void {
  try { storage?.setItem(RACE_SETUP_KEY, JSON.stringify(setup)); } catch { /* stockage indisponible */ }
}

export interface OpponentSetup {
  id: string;
  slot: GridSlot;
  skill: number;
}

export interface RaceField {
  laps: number;
  opponents: OpponentSetup[];
  /** Emplacement du joueur : le fond de la grille. */
  playerSlot: GridSlot;
}

/** Grille de départ d'une course : les adversaires devant (du plus au moins rapide), le joueur en dernier. */
export function buildRaceField(setup: RaceSetup, track: CircuitTrack): RaceField {
  const slots = buildGrid(track, setup.rivals + 1);
  const base = BASE_SKILL[setup.difficulty];
  const opponents = slots.slice(0, setup.rivals).map((slot, rank) => ({
    id: `ai-${rank + 1}`,
    slot,
    skill: Math.max(0, Math.min(1, base + 0.1 - rank * SKILL_STEP_PER_RANK)),
  }));
  return { laps: setup.laps, opponents, playerSlot: slots[setup.rivals] };
}
