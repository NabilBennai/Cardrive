/**
 * Dégâts mécaniques et de carrosserie selon l'énergie d'un choc. Logique pure : VehicleSimulation en applique les effets
 * (puissance, direction, pneus), le rendu s'en sert pour froisser la carrosserie.
 */

/** Intensité de choc (0..1, voir impactIntensity) en dessous de laquelle rien n'est abîmé : un accrochage léger ne coûte rien. */
export const MIN_DAMAGING_INTENSITY = 0.12;
/** Une crevaison n'arrive qu'au-delà de cette intensité. */
export const PUNCTURE_INTENSITY = 0.45;
/** Vitesse (par seconde) à laquelle un pneu crevé se vide complètement. */
export const PUNCTURE_LEAK_PER_S = 0.25;
/** Braquage parasite maximal (rad) d'une direction complètement faussée. */
export const MAX_STEERING_PULL_RAD = 0.07;
/** Perte de puissance d'un moteur complètement abîmé. */
export const MAX_POWER_LOSS = 0.65;

export interface BodyDamage {
  front: number;
  rear: number;
  /** Côtés gauche (+x) et droit (-x) du véhicule orienté vers +z. */
  left: number;
  right: number;
}

export interface DamageState {
  engine: number;
  steering: number;
  /** Sens du braquage parasite : +1 ou -1, fixé au premier dégât de direction. */
  steeringPullSign: 1 | -1;
  /** Gonflage perdu de chaque pneu (0 intact, 1 à plat) et crevaison en cours (le pneu continue de se vider). */
  tireFlat: number[];
  tirePunctured: boolean[];
  body: BodyDamage;
  /** Incrémenté à chaque changement de carrosserie : le rendu ne recalcule les sommets que lorsqu'il change. */
  bodyVersion: number;
}

export const createDamage = (wheelCount: number): DamageState => ({
  engine: 0, steering: 0, steeringPullSign: 1,
  tireFlat: Array.from({ length: wheelCount }, () => 0),
  tirePunctured: Array.from({ length: wheelCount }, () => false),
  body: { front: 0, rear: 0, left: 0, right: 0 },
  bodyVersion: 0,
});

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Zone touchée d'après la direction du mouvement avant le choc, exprimée dans le repère du véhicule (x gauche, z avant). */
export function impactZone(localDirX: number, localDirZ: number): keyof BodyDamage {
  if (Math.abs(localDirZ) >= Math.abs(localDirX)) return localDirZ >= 0 ? 'front' : 'rear';
  return localDirX >= 0 ? 'left' : 'right';
}

/**
 * Applique un choc. `random` (0..1) est tiré une seule fois par appel et sert à choisir le pneu crevé et le sens du braquage
 * parasite : le résultat reste déterministe pour un générateur donné.
 */
export function applyImpact(state: DamageState, intensity: number, localDirX: number, localDirZ: number, random: number): void {
  if (!(intensity >= MIN_DAMAGING_INTENSITY)) return;
  const zone = impactZone(localDirX, localDirZ);
  state.body[zone] = clamp01(state.body[zone] + intensity);
  state.bodyVersion += 1;
  const wheelCount = state.tireFlat.length;
  if (zone === 'front') {
    state.engine = clamp01(state.engine + 0.75 * intensity ** 1.2);
    state.steering = clamp01(state.steering + 0.5 * intensity);
  } else if (zone === 'rear') {
    state.engine = clamp01(state.engine + 0.2 * intensity);
  } else {
    state.steering = clamp01(state.steering + 0.4 * intensity);
  }
  if (state.steering > 0 && state.steeringPullSign === 1 && random < 0.5) state.steeringPullSign = -1;
  if (intensity >= PUNCTURE_INTENSITY) {
    // Roues du côté touché, sinon celles de l'extrémité touchée. Ordre des profils : avant droite, avant gauche, arrière droite, arrière gauche.
    const candidates = Array.from({ length: wheelCount }, (_, i) => i).filter((i) => {
      const left = i % 2 === 1;
      if (zone === 'left') return left;
      if (zone === 'right') return !left;
      const front = i < wheelCount / 2;
      return zone === 'front' ? front : !front;
    }).filter((i) => !state.tirePunctured[i]);
    if (candidates.length > 0) state.tirePunctured[candidates[Math.min(candidates.length - 1, Math.floor(random * candidates.length))]] = true;
  }
}

/** Fait avancer la fuite des pneus crevés. */
export function stepTireLeak(state: DamageState, dtS: number): void {
  for (let i = 0; i < state.tireFlat.length; i += 1) {
    if (state.tirePunctured[i] && state.tireFlat[i] < 1) state.tireFlat[i] = Math.min(1, state.tireFlat[i] + PUNCTURE_LEAK_PER_S * dtS);
  }
}

/** Facteur de puissance du moteur (1 intact). */
export const powerScale = (state: DamageState): number => 1 - MAX_POWER_LOSS * state.engine;

/** Braquage parasite (rad) ajouté à la consigne : le véhicule tire d'un côté. */
export const steeringPullRad = (state: DamageState): number => state.steeringPullSign * MAX_STEERING_PULL_RAD * state.steering;

/** Facteur d'adhérence d'un pneu qui se vide (1 intact, 0,45 à plat) et résistance au roulement supplémentaire (×1 à ×4). */
export const flatTireGripFactor = (flat: number): number => 1 - 0.55 * clamp01(flat);
export const flatTireRollingFactor = (flat: number): number => 1 + 3 * clamp01(flat);

export function repair(state: DamageState): void {
  state.engine = 0;
  state.steering = 0;
  state.steeringPullSign = 1;
  state.tireFlat.fill(0);
  state.tirePunctured.fill(false);
  state.body.front = 0; state.body.rear = 0; state.body.left = 0; state.body.right = 0;
  state.bodyVersion += 1;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) : même suite pour une même graine, sans Math.random dans la simulation. */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
