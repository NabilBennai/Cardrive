/** Réglages sonores du joueur, mémorisés dans le navigateur. Logique pure : le stockage est injecté pour les tests. */

export interface AudioSettings {
  /** Volumes de 0 à 1 (curseurs ; voir volumeToGain pour la courbe appliquée). */
  master: number;
  engine: number;
  effects: number;
  muted: boolean;
  /** Tremblement de caméra et champ de vision variable : un réglage de confort, avec les sons car c'est le « ressenti ». */
  cameraEffects: boolean;
}

export const AUDIO_SETTINGS_KEY = 'cardrive.audioSettings';

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { master: 0.8, engine: 1, effects: 1, muted: false, cameraEffects: true };

const unit = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback);

/** Tolère un contenu absent, tronqué ou d'une ancienne version : chaque champ invalide retombe sur sa valeur par défaut. */
export function sanitizeAudioSettings(raw: unknown): AudioSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    master: unit(source.master, DEFAULT_AUDIO_SETTINGS.master),
    engine: unit(source.engine, DEFAULT_AUDIO_SETTINGS.engine),
    effects: unit(source.effects, DEFAULT_AUDIO_SETTINGS.effects),
    muted: typeof source.muted === 'boolean' ? source.muted : DEFAULT_AUDIO_SETTINGS.muted,
    cameraEffects: typeof source.cameraEffects === 'boolean' ? source.cameraEffects : DEFAULT_AUDIO_SETTINGS.cameraEffects,
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** localStorage peut être absent ou bloqué (navigation privée) : on retombe alors sur les réglages par défaut. */
export function loadAudioSettings(storage: StorageLike | null = typeof localStorage === 'undefined' ? null : localStorage): AudioSettings {
  try {
    const raw = storage?.getItem(AUDIO_SETTINGS_KEY);
    return sanitizeAudioSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

export function saveAudioSettings(settings: AudioSettings, storage: StorageLike | null = typeof localStorage === 'undefined' ? null : localStorage) {
  try {
    storage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Non mémorisé : valable pour cette session uniquement.
  }
}
