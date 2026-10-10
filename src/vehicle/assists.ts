import type { TractionControl } from './physics/VehicleSimulation.ts';

/** Aides à la conduite du joueur (jamais imposées aux adversaires, qui ont leur propre pilotage). */
export interface AssistSettings {
  tractionControl: TractionControl;
}

export const DEFAULT_ASSISTS: AssistSettings = { tractionControl: 'medium' };
export const ASSISTS_KEY = 'cardrive.assists';
export const TRACTION_LABELS: Record<TractionControl, string> = { off: 'Aucune', medium: 'Moyenne', full: 'Complète' };

interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function sanitizeAssists(value: unknown): AssistSettings {
  const candidate = (typeof value === 'object' && value !== null ? value : {}) as Partial<AssistSettings>;
  const level = candidate.tractionControl;
  return { tractionControl: level === 'off' || level === 'medium' || level === 'full' ? level : DEFAULT_ASSISTS.tractionControl };
}

const browserStorage = (): Storage | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

export function loadAssists(storage: Storage | null = browserStorage()): AssistSettings {
  try {
    const raw = storage?.getItem(ASSISTS_KEY);
    return sanitizeAssists(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_ASSISTS };
  }
}

export function saveAssists(settings: AssistSettings, storage: Storage | null = browserStorage()): void {
  try { storage?.setItem(ASSISTS_KEY, JSON.stringify(settings)); } catch { /* stockage indisponible */ }
}
