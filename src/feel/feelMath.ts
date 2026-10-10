/** Fonctions pures du « ressenti » visuel : champ de vision, tremblement, fumée, traces, étincelles. Testables sans WebGL. */

const clamp = (value: number, lower: number, upper: number) => Math.max(lower, Math.min(upper, value));
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Champ de vision de base (degrés) de la caméra de poursuite. */
export const BASE_FOV_DEG = 52;
/** Ouverture supplémentaire à très haute vitesse : accentue la sensation de vitesse sans déformer la route à l'arrêt. */
export const MAX_FOV_BOOST_DEG = 13;

export function fovForSpeed(speedMps: number, enabled = true): number {
  return BASE_FOV_DEG + (enabled ? MAX_FOV_BOOST_DEG * smoothstep(12, 62, speedMps) : 0);
}

/** Durée de décroissance (s) d'un tremblement de caméra après un choc. */
export const SHAKE_DECAY_S = 0.55;

/** Amplitude (m) du tremblement de la caméra : une trépidation légère à très haute vitesse, plus un choc qui s'éteint. */
export function cameraShakeAmplitude(speedMps: number, impactEnergy: number): number {
  const vibration = 0.012 * smoothstep(35, 75, speedMps);
  return vibration + 0.55 * clamp(impactEnergy, 0, 1) ** 1.3;
}

/** Puissance de glissement (W) à partir de laquelle un pneu fume : un virage sportif (≈ 3-6 kW) ne fume pas, un patinage ou un blocage oui. */
export const SMOKE_START_W = 9_000;
export const SMOKE_FULL_W = 45_000;
/** Puissance de glissement (W) à partir de laquelle un pneu laisse une trace : plus tôt que la fumée, comme sur une route. */
export const SKID_START_W = 3_500;
export const SKID_FULL_W = 28_000;

/** Particules de fumée émises par seconde et par roue. */
export function smokeRatePerSecond(slidingPowerW: number): number {
  return 70 * smoothstep(SMOKE_START_W, SMOKE_FULL_W, slidingPowerW);
}

/** Opacité (0 à 0,6) de la trace laissée au sol, 0 sous le seuil. */
export function skidMarkAlpha(slidingPowerW: number): number {
  return 0.6 * smoothstep(SKID_START_W, SKID_FULL_W, slidingPowerW);
}

/** Nombre d'étincelles projetées par un choc d'intensité donnée (0 à 1) : rien pour un contact léger. */
export function sparkCount(intensity: number): number {
  return intensity < 0.18 ? 0 : Math.round(8 + 52 * clamp(intensity, 0, 1));
}

/** Pondération anti-saccade pour mélanger deux valeurs au même rythme quelle que soit la cadence d'image. */
export const smoothingFactor = (ratePerSecond: number, deltaS: number) => 1 - Math.exp(-ratePerSecond * deltaS);
