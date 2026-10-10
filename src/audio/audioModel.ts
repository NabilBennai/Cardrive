/**
 * Modèle sonore : traduit l'état du véhicule en paramètres de synthèse. Fonctions pures, sans Web Audio : testables, et
 * c'est ici que se règle le « caractère » de chaque son. GameAudio.ts les applique aux nœuds Web Audio.
 */

export const clamp = (value: number, lower: number, upper: number) => Math.max(lower, Math.min(upper, value));

/** Marche lissée 0 → 1 entre `edge0` et `edge1` (dérivée nulle aux bornes : pas de seuil audible). */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Courbe perceptive : un curseur à mi-course doit sembler à mi-volume, pas à mi-amplitude (l'oreille est logarithmique). */
export const volumeToGain = (volume: number) => clamp(volume, 0, 1) ** 2;

export type EngineKind = 'combustion' | 'electric';

export interface EngineSoundProfile {
  kind: EngineKind;
  /** Nombre de cylindres (combustion). Un 4 temps allume cylindres/2 fois par tour, un 2 temps cylindres fois. */
  cylinders: number;
  strokes: 2 | 4;
  /** Poids relatifs de l'harmonique 2, 3 et 4 par rapport au fondamental : le timbre. */
  harmonics: [number, number, number];
  /** Poids de la sous-harmonique (demi-fréquence) : le grondement d'un gros moteur. */
  sub: number;
  /** Facteur sur la fréquence de coupure du filtre : > 1 = son plus clair et agressif, < 1 = sourd. */
  brightness: number;
  /** Irrégularité d'un cycle à l'autre (0 = turbine lisse, 1 = diesel de camion qui « ronronne »). */
  roughness: number;
  /** Niveau général du moteur. */
  loudness: number;
  /** Bruit d'admission, audible à plein gaz et haut régime. */
  intake: number;
}

export interface EngineSoundState {
  rpm: number;
  idleRpm: number;
  maxRpm: number;
  /** Charge du moteur, 0 (pied levé) à 1 (plein gaz). */
  load: number;
  speedMps: number;
  /** Temps écoulé depuis le dernier changement de rapport (s) ; très grand en dehors d'un passage. */
  secondsSinceShift: number;
  /** Temps courant (s), pour le limiteur de régime. */
  timeS: number;
}

export interface EngineVoiceParams {
  /** Fréquence fondamentale (Hz). */
  fundamentalHz: number;
  /** Gains du fondamental, des harmoniques 2 à 4 et de la sous-harmonique, avant la bus moteur. */
  oscillatorGains: [number, number, number, number, number];
  filterHz: number;
  gain: number;
  intakeGain: number;
  intakeHz: number;
  /** Fréquence (Hz) et profondeur de la modulation d'amplitude d'irrégularité. */
  roughnessHz: number;
  roughnessDepth: number;
}

/** Durée (s) de la coupure de couple audible à un changement de rapport. */
export const SHIFT_DUCK_SECONDS = 0.22;
/** Cadence de la coupure d'allumage au limiteur de régime (Hz). */
export const REV_LIMITER_HZ = 14;
const REV_LIMITER_THRESHOLD = 0.985;
const REV_LIMITER_CUT_GAIN = 0.2;

/** Fréquence de combustion (Hz) : c'est elle qu'on entend comme la « hauteur » du moteur. */
export function firingFrequencyHz(rpm: number, profile: EngineSoundProfile): number {
  const firingsPerRevolution = profile.strokes === 2 ? profile.cylinders : profile.cylinders / 2;
  return (Math.max(0, rpm) / 60) * firingsPerRevolution;
}

/** Coupure de couple d'un passage de rapport : le son plonge brièvement puis revient. 1 = pas de coupure. */
export function shiftDuck(secondsSinceShift: number): number {
  if (secondsSinceShift >= SHIFT_DUCK_SECONDS || secondsSinceShift < 0) return 1;
  const t = secondsSinceShift / SHIFT_DUCK_SECONDS;
  // Chute presque instantanée (10 % de la durée), remontée en douceur.
  return t < 0.1 ? 1 - 0.75 * (t / 0.1) : 0.25 + 0.75 * smoothstep(0.1, 1, t);
}

/** Coupure d'allumage au limiteur de régime : alterne entre 1 et un niveau bas tant que le régime reste au plafond. */
export function revLimiterGain(rpm: number, maxRpm: number, timeS: number): number {
  if (rpm < maxRpm * REV_LIMITER_THRESHOLD) return 1;
  return Math.floor(timeS * REV_LIMITER_HZ * 2) % 2 === 0 ? 1 : REV_LIMITER_CUT_GAIN;
}

export function engineVoiceParams(state: EngineSoundState, profile: EngineSoundProfile): EngineVoiceParams {
  const rpmSpan = Math.max(1, state.maxRpm - state.idleRpm);
  const rpmNorm = clamp((state.rpm - state.idleRpm) / rpmSpan, 0, 1);
  const load = clamp(state.load, 0, 1);
  const cutoff = shiftDuck(state.secondsSinceShift) * revLimiterGain(state.rpm, state.maxRpm, state.timeS);

  if (profile.kind === 'electric') {
    // Moteur électrique : sifflement quasi sinusoïdal dont la hauteur suit la vitesse de rotation, sans à-coups ni ralenti.
    const whineHz = 180 + 2_400 * rpmNorm ** 0.9;
    const effort = 0.25 + 0.75 * load;
    return {
      fundamentalHz: whineHz,
      oscillatorGains: [1, profile.harmonics[0], profile.harmonics[1], 0, 0],
      filterHz: 2_500 + 5_000 * rpmNorm,
      gain: profile.loudness * effort * (0.15 + 0.85 * smoothstep(0.02, 0.35, rpmNorm + state.speedMps / 120)) * cutoff,
      intakeGain: 0,
      intakeHz: 1_000,
      roughnessHz: 1,
      roughnessDepth: 0,
    };
  }

  const fundamentalHz = firingFrequencyHz(state.rpm, profile);
  // Un moteur sous charge est plus riche en harmoniques et plus clair ; au frein moteur il devient sourd.
  const richness = 0.45 + 0.55 * load;
  const filterHz = (260 + 3_100 * (0.3 + 0.7 * rpmNorm)) * profile.brightness * (0.55 + 0.45 * load);
  const gain = profile.loudness * (0.28 + 0.5 * load) * (0.75 + 0.25 * rpmNorm) * cutoff;
  return {
    fundamentalHz,
    oscillatorGains: [1, profile.harmonics[0] * richness, profile.harmonics[1] * richness, profile.harmonics[2] * richness, profile.sub],
    filterHz,
    gain,
    intakeGain: profile.intake * load * (0.25 + 0.75 * rpmNorm) * cutoff,
    intakeHz: 700 + 2_600 * rpmNorm,
    // Une irrégularité de cycle à cycle ≈ une fois tous les deux tours : plus lente que la combustion elle-même.
    roughnessHz: Math.max(2, state.rpm / 120),
    roughnessDepth: profile.roughness * (0.45 - 0.25 * load),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Effets
// ---------------------------------------------------------------------------------------------------------------

export interface TireSquealParams {
  gain: number;
  /** Fréquence centrale du filtre / de la tonale (Hz). */
  hz: number;
}

/** Glissement normalisé au-delà duquel un pneu crisse (1 = pic d'adhérence : le crissement commence à l'approche du pic). */
export const SQUEAL_START_SLIP = 0.95;
export const SQUEAL_FULL_SLIP = 1.6;

/**
 * Crissement des pneus piloté par le glissement normalisé de la télémétrie (même grandeur que l'alerte d'adhérence) : il
 * monte AVANT que le pneu ne lâche, et se tait à l'arrêt (le glissement n'a pas de sens à très basse vitesse).
 */
export function tireSquealParams(slip: number, speedMps: number): TireSquealParams {
  const intensity = smoothstep(SQUEAL_START_SLIP, SQUEAL_FULL_SLIP, slip) * smoothstep(3, 10, speedMps);
  return { gain: 0.42 * intensity, hz: 900 + 28 * clamp(speedMps, 0, 45) };
}

export function rollingNoiseParams(speedMps: number, grounded: number, looseShare = 0): { gain: number; hz: number } {
  const contact = clamp(grounded / 4, 0, 1);
  const loose = clamp(looseShare, 0, 1);
  // Sur gravier ou herbe, le roulement est plus bruyant (projections, brins) et plus grave que sur l'asphalte.
  return { gain: 0.14 * smoothstep(0.5, 38, speedMps) ** 1.2 * contact * (1 + 1.4 * loose), hz: (350 + 45 * clamp(speedMps, 0, 45)) * (1 - 0.3 * loose) };
}

export function windNoiseParams(speedMps: number): { gain: number; hz: number } {
  return { gain: 0.3 * clamp(speedMps / 60, 0, 1) ** 2, hz: 500 + 14 * clamp(speedMps, 0, 70) };
}

/** Variation de vitesse (m/s) en un pas physique en dessous de laquelle on n'entend rien : accélérations et freinages normaux. */
export const IMPACT_MIN_DELTA_V = 2.5;
export const IMPACT_FULL_DELTA_V = 22;

/** Intensité d'un choc, 0 à 1, à partir de la variation brutale de vitesse du châssis en un pas (un choc, pas une accélération). */
export function impactIntensity(deltaVMps: number): number {
  return smoothstep(IMPACT_MIN_DELTA_V, IMPACT_FULL_DELTA_V, deltaVMps);
}

export interface ImpactParams {
  gain: number;
  /** Fréquence de départ du « boum » grave (Hz) ; elle chute pendant l'enveloppe. */
  thumpHz: number;
  durationS: number;
  noiseGain: number;
}

export function impactParams(intensity: number): ImpactParams {
  const i = clamp(intensity, 0, 1);
  return { gain: 0.25 + 0.75 * i, thumpHz: 120 - 55 * i, durationS: 0.14 + 0.45 * i, noiseGain: 0.3 + 0.7 * i };
}
