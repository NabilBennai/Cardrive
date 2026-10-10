import type { EngineSoundProfile } from './audioModel.ts';

const combustion = (overrides: Partial<EngineSoundProfile> & Pick<EngineSoundProfile, 'cylinders'>): EngineSoundProfile => ({
  kind: 'combustion',
  strokes: 4,
  harmonics: [0.55, 0.32, 0.16],
  sub: 0.15,
  brightness: 1,
  roughness: 0.15,
  loudness: 0.55,
  intake: 0.35,
  ...overrides,
});

/** Profil par défaut : un quatre cylindres essence de série (prototype, berline, compacte). */
export const DEFAULT_SOUND_PROFILE: EngineSoundProfile = combustion({ cylinders: 4 });

/**
 * Caractère sonore de chaque véhicule du catalogue (identifiants de carCatalog.ts). Comme pour les profils physiques, c'est
 * la nature du véhicule qui commande : un diesel de camion est grave et irrégulier, un moteur de course aigu et ouvert, un
 * kart deux temps rageur, une voiture électrique un sifflement sans ralenti.
 */
const PROFILES: Record<string, EngineSoundProfile> = {
  prototype: DEFAULT_SOUND_PROFILE,
  sedan: combustion({ cylinders: 4, brightness: 0.9, loudness: 0.5 }),
  'sedan-sports': combustion({ cylinders: 6, brightness: 1.25, harmonics: [0.6, 0.4, 0.22], sub: 0.2, loudness: 0.62, intake: 0.5 }),
  'hatchback-sports': combustion({ cylinders: 4, brightness: 1.35, harmonics: [0.62, 0.38, 0.24], loudness: 0.6, intake: 0.55 }),
  suv: combustion({ cylinders: 6, brightness: 0.85, sub: 0.28, loudness: 0.55 }),
  'suv-luxury': combustion({ cylinders: 8, brightness: 0.95, sub: 0.45, roughness: 0.25, loudness: 0.6 }),
  van: combustion({ cylinders: 4, brightness: 0.62, roughness: 0.55, sub: 0.3, harmonics: [0.7, 0.3, 0.1], loudness: 0.55, intake: 0.15 }),
  taxi: combustion({ cylinders: 4, brightness: 0.7, roughness: 0.45, sub: 0.25, harmonics: [0.65, 0.3, 0.1], loudness: 0.5, intake: 0.15 }),
  police: combustion({ cylinders: 8, brightness: 1.1, sub: 0.5, roughness: 0.3, loudness: 0.65, intake: 0.5 }),
  race: combustion({ cylinders: 10, brightness: 1.8, harmonics: [0.7, 0.5, 0.35], sub: 0.05, roughness: 0.04, loudness: 0.62, intake: 0.7 }),
  'race-future': { kind: 'electric', cylinders: 0, strokes: 4, harmonics: [0.18, 0.06, 0], sub: 0, brightness: 1, roughness: 0, loudness: 0.4, intake: 0 },
  delivery: combustion({ cylinders: 4, brightness: 0.55, roughness: 0.65, sub: 0.38, harmonics: [0.7, 0.28, 0.08], loudness: 0.6, intake: 0.1 }),
  ambulance: combustion({ cylinders: 4, brightness: 0.6, roughness: 0.6, sub: 0.35, harmonics: [0.7, 0.28, 0.08], loudness: 0.6, intake: 0.1 }),
  firetruck: combustion({ cylinders: 6, brightness: 0.42, roughness: 0.75, sub: 0.55, harmonics: [0.75, 0.25, 0.06], loudness: 0.7, intake: 0.1 }),
  'garbage-truck': combustion({ cylinders: 6, brightness: 0.4, roughness: 0.8, sub: 0.6, harmonics: [0.75, 0.22, 0.05], loudness: 0.7, intake: 0.08 }),
  truck: combustion({ cylinders: 6, brightness: 0.45, roughness: 0.7, sub: 0.5, harmonics: [0.72, 0.25, 0.06], loudness: 0.66, intake: 0.1 }),
  tractor: combustion({ cylinders: 4, brightness: 0.4, roughness: 0.85, sub: 0.6, harmonics: [0.8, 0.2, 0.04], loudness: 0.7, intake: 0.05 }),
  'kart-oobi': combustion({ cylinders: 1, strokes: 2, brightness: 1.6, harmonics: [0.8, 0.55, 0.4], sub: 0.02, roughness: 0.12, loudness: 0.6, intake: 0.6 }),
};

export function soundProfileFor(carId: string | null | undefined): EngineSoundProfile {
  return (carId && PROFILES[carId]) || DEFAULT_SOUND_PROFILE;
}

export const SOUND_PROFILE_IDS = Object.keys(PROFILES);
