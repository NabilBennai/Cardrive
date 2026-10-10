/**
 * Meilleurs tours par couple circuit × véhicule, en localStorage (format versionné). Le stockage peut être indisponible ou
 * corrompu : toute lecture retombe sur « aucun record » et toute écriture échoue en silence, sans jamais bloquer le jeu.
 */

export const RECORDS_KEY = 'cardrive.records';
const VERSION = 1;
/** Garde-fou : un tour plus court est un artefact (ligne franchie deux fois), pas un record. */
export const MIN_PLAUSIBLE_LAP_S = 15;

export interface LapRecord {
  /** Temps du meilleur tour (s). */
  bestS: number;
  /** Durée de chacun des trois secteurs (s) de ce tour. */
  sectorS: number[];
  /** Temps cumulé (s) aux portes du tour, de 0 à bestS : sert à l'écart en direct. */
  profileS: number[];
  /** Horodatage (ms) du record. */
  setAtMs: number;
}

export type RecordBook = Record<string, LapRecord>;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const recordKey = (circuitId: string, carId: string): string => `${circuitId}|${carId}`;

const isNumberArray = (value: unknown, min: number): value is number[] =>
  Array.isArray(value) && value.length >= min && value.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0);

function sanitizeRecord(value: unknown): LapRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<LapRecord>;
  if (typeof candidate.bestS !== 'number' || !Number.isFinite(candidate.bestS) || candidate.bestS < MIN_PLAUSIBLE_LAP_S) return null;
  if (!isNumberArray(candidate.sectorS, 3) || !isNumberArray(candidate.profileS, 2)) return null;
  return {
    bestS: candidate.bestS,
    sectorS: candidate.sectorS.slice(0, 3),
    profileS: candidate.profileS,
    setAtMs: typeof candidate.setAtMs === 'number' && Number.isFinite(candidate.setAtMs) ? candidate.setAtMs : 0,
  };
}

const browserStorage = (): KeyValueStorage | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

export function loadRecords(storage: KeyValueStorage | null = browserStorage()): RecordBook {
  try {
    const raw = storage?.getItem(RECORDS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { version?: number; records?: Record<string, unknown> };
    if (parsed.version !== VERSION || typeof parsed.records !== 'object' || parsed.records === null) return {};
    const book: RecordBook = {};
    for (const [key, value] of Object.entries(parsed.records)) {
      const record = sanitizeRecord(value);
      if (record) book[key] = record;
    }
    return book;
  } catch {
    return {};
  }
}

export function saveRecords(book: RecordBook, storage: KeyValueStorage | null = browserStorage()): void {
  try { storage?.setItem(RECORDS_KEY, JSON.stringify({ version: VERSION, records: book })); } catch { /* stockage plein ou indisponible */ }
}

/** Renvoie le nouveau carnet si le tour bat le record (ou en crée un), sinon le même carnet. */
export function withLap(book: RecordBook, key: string, lap: Omit<LapRecord, 'setAtMs'>, nowMs: number): { book: RecordBook; improved: boolean } {
  if (!(lap.bestS >= MIN_PLAUSIBLE_LAP_S)) return { book, improved: false };
  const current = book[key];
  if (current && current.bestS <= lap.bestS) return { book, improved: false };
  return { book: { ...book, [key]: { ...lap, setAtMs: nowMs } }, improved: true };
}
