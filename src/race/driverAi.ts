/**
 * Pilote automatique : suit la ligne centrale d'un circuit avec une vitesse cible par virage et produit les MÊMES commandes que
 * le joueur (VehicleInput) : il utilise donc exactement le même solveur de véhicule, sans triche physique. Logique pure.
 *
 * Plan de vitesse : v² = a_lat / κ en chaque point (courbure κ), plafonné par la vitesse maximale, puis propagé vers l'arrière
 * avec le freinage disponible (v_i² ≤ v_{i+1}² + 2·a_frein·ds) pour que la voiture freine avant le virage et non dedans.
 * Pilotage : poursuite de point (pure pursuit) vers un point de la ligne situé devant, à une distance qui croît avec la vitesse.
 */

import type { PlanarPoint } from '../circuits/circuitGeometry.ts';
import type { VehicleConfig, VehicleInput } from '../shared/types.ts';
import { TrackProjector } from './trackProjector.ts';

const GRAVITY = 9.81;
const AIR_DENSITY_KG_M3 = 1.225;
const AERO_GRIP_EFFECTIVENESS = 0.7;
/** Fraction de l'adhérence latérale estimée réellement utilisée : < 1 laisse de la marge face aux erreurs de modèle. */
const BASE_GRIP_USE = 0.7;
const BRAKE_USE = 0.65;
const CURVATURE_HALF_WINDOW_SAMPLES = 4;
const MAX_PLAN_SPEED_MPS = 100;
/**
 * Vitesse maximale (m/s) que le pilote s'autorise pour un véhicule dont le comportement à haute vitesse est instable dans le
 * solveur actuel : mesuré sur Suzuka, la monoplace thermique (« race ») décroche au-delà de ≈ 200 km/h (l'arrière part sans
 * que le braquage suffise) alors que la monoplace électrique reste stable à 315 km/h. À lever quand l'aérodynamique (R-3.4) sera modélisée.
 */
const STABLE_SPEED_CAP_MPS: Readonly<Record<string, number>> = {};
const MIN_PLAN_SPEED_MPS = 6;

export interface AiProfile {
  /** Accélération latérale tenable en virage à basse vitesse (m/s²), sans déportance. */
  lateralAccelMps2: number;
  /** Décélération de freinage utilisable à basse vitesse (m/s²), sans déportance. */
  brakeDecelMps2: number;
  /** Coefficient d'adhérence exploité en virage et au freinage (sans dimension). */
  gripCoefficient: number;
  brakeGripCoefficient: number;
  /** Limite du freinage par la puissance des freins (m/s²), indépendante de l'adhérence. */
  brakeForceDecelMps2: number;
  /** Accélération verticale due à la déportance par (m/s)² : ½·ρ·Cz·A / masse. */
  downforcePerV2: number;
  maxSpeedMps: number;
  wheelbaseM: number;
  maxSteeringRad: number;
  steeringReductionPerMps: number;
}

/**
 * Capacités estimées d'un véhicule d'après sa configuration. `skill` (0..1, 1 = limite du modèle) règle la marge d'un pilote :
 * un faible niveau prend les virages plus lentement et freine plus tôt.
 */
export function aiProfileFor(config: VehicleConfig, skill = 1, gripUse = BASE_GRIP_USE): AiProfile {
  const level = 0.6 + 0.4 * Math.max(0, Math.min(1, skill));
  const brakeForceDecel = config.serviceBrakeForceN / config.massKg * BRAKE_USE * level;
  const brakeGrip = config.tireGrip * BRAKE_USE * level;
  // Le grip ne croît pas proportionnellement à la charge (sensibilité du pneu) : on ne compte que 70 % de la déportance.
  const downforcePerV2 = AERO_GRIP_EFFECTIVENESS * 0.5 * AIR_DENSITY_KG_M3 * config.downforceClAM2 / config.massKg;
  return {
    lateralAccelMps2: config.tireGrip * GRAVITY * gripUse * level,
    brakeDecelMps2: Math.min(brakeForceDecel, brakeGrip * GRAVITY),
    gripCoefficient: config.tireGrip * gripUse * level,
    brakeGripCoefficient: brakeGrip,
    brakeForceDecelMps2: brakeForceDecel,
    downforcePerV2,
    // Un pilote moins bon n'exploite pas toute la vitesse de pointe : 80 % à 100 % de celle que la traînée autorise.
    maxSpeedMps: Math.min(STABLE_SPEED_CAP_MPS[config.id] ?? MAX_PLAN_SPEED_MPS, dragLimitedTopSpeedMps(config) * (0.8 + 0.2 * Math.max(0, Math.min(1, skill)))),
    wheelbaseM: config.wheelbaseM,
    maxSteeringRad: config.maxSteeringRad,
    steeringReductionPerMps: config.steeringReductionPerMps,
  };
}

/** Décélération (m/s²) que le freinage peut tenir à la vitesse v : bornée par les freins et par l'adhérence, qui croît avec la déportance. */
export function brakeDecelAt(profile: AiProfile, speedMps: number): number {
  return Math.min(profile.brakeForceDecelMps2, profile.brakeGripCoefficient * (GRAVITY + profile.downforcePerV2 * speedMps * speedMps));
}

/** Vitesse (m/s) maximale en virage de courbure κ : v²·κ = μ·(g + k·v²), soit v² = μ·g / (κ − μ·k) ; infinie si la déportance suffit. */
export function cornerSpeedMps(profile: AiProfile, curvature: number): number {
  const denominator = curvature - profile.gripCoefficient * profile.downforcePerV2;
  return denominator > 1e-5 ? Math.sqrt(profile.gripCoefficient * GRAVITY / denominator) : Infinity;
}

/** Vitesse maximale (m/s) limitée par la traînée aérodynamique à pleine puissance : v³ = 2·P·η / (ρ·Cd·A). */
export function dragLimitedTopSpeedMps(config: VehicleConfig): number {
  const peakPowerW = config.torqueCurve.reduce((best, point) => Math.max(best, point.torqueNm * point.rpm * 2 * Math.PI / 60), 0);
  const dragArea = config.aerodynamicDragCoefficient * config.frontalAreaM2;
  return Math.cbrt((2 * peakPowerW * config.drivetrainEfficiency) / (AIR_DENSITY_KG_M3 * dragArea));
}

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Vitesse limite (m/s) en chaque échantillon de la ligne centrale : virages puis anticipation du freinage. */
export function buildSpeedPlan(centerline: readonly PlanarPoint[], lengthM: number, profile: AiProfile): number[] {
  const n = centerline.length;
  const ds = lengthM / n;
  const heading = centerline.map((p, i) => {
    const next = centerline[(i + 1) % n];
    return Math.atan2(next.xM - p.xM, next.zM - p.zM);
  });
  const k = CURVATURE_HALF_WINDOW_SAMPLES;
  const limit = centerline.map((_, i) => {
    const turn = Math.abs(wrapAngle(heading[(i + k) % n] - heading[(i - k + n) % n]));
    const curvature = turn / (2 * k * ds);
    const cornerSpeed = curvature > 1e-4 ? cornerSpeedMps(profile, curvature) : Infinity;
    return Math.max(MIN_PLAN_SPEED_MPS, Math.min(profile.maxSpeedMps, cornerSpeed));
  });
  // Deux tours de propagation arrière : la limite d'un virage se répercute sur la ligne droite qui le précède, circuit fermé compris.
  for (let pass = 0; pass < 2 * n; pass += 1) {
    const i = (n - 1 - (pass % n) + n) % n;
    const ahead = limit[(i + 1) % n];
    limit[i] = Math.min(limit[i], Math.sqrt(ahead * ahead + 2 * brakeDecelAt(profile, ahead) * ds));
  }
  return limit;
}

export interface DriverState {
  xM: number;
  zM: number;
  /** Cap, convention atan2(forward.x, forward.z). */
  headingRad: number;
  speedMps: number;
  /** Glissement normalisé de la télémétrie (1 = pic d'adhérence) : sert à doser l'accélérateur et à ajuster la vitesse en virage. */
  slip?: number;
  /** Durée (s) depuis l'appel précédent ; 1/60 par défaut. */
  dtS?: number;
}

const LOOKAHEAD_MIN_M = 7;
const LOOKAHEAD_PER_MPS = 0.35;
/** Avance (s) prise sur la vitesse cible : la voiture met un instant à réagir aux freins. */
const SPEED_LEAD_S = 0.35;
/** Au-delà de ce glissement, l'accélérateur est réduit (antipatinage). */
const TRACTION_SLIP = 0.65;
/** Vitesse (par seconde) à laquelle l'accélérateur peut monter ou retomber : évite le pompage marche/arrêt autour du seuil d'adhérence. */
const THROTTLE_RISE_PER_S = 2.5;
const THROTTLE_FALL_PER_S = 10;
/** Glissement au-delà duquel, en virage, le pilote conclut qu'il va trop vite pour l'adhérence disponible (pneus froids, usés). */
const CORNER_SLIDE_SLIP = 1.25;
const MIN_GRIP_SCALE = 0.4;
const GRIP_LOSS_PER_S = 0.8;
const GRIP_RECOVERY_PER_S = 0.04;

export class AiDriver {
  private readonly projector: TrackProjector;
  private readonly plan: number[];
  private hint: number | null = null;
  /** Facteur (0..1) appliqué à l'adhérence supposée : baisse quand la voiture glisse en virage, remonte lentement ensuite. */
  private gripScale = 1;
  private throttleOut = 0;
  private readonly spacingM: number;

  constructor(private readonly centerline: readonly PlanarPoint[], lengthM: number, private readonly profile: AiProfile) {
    this.projector = new TrackProjector(centerline as PlanarPoint[], lengthM);
    this.plan = buildSpeedPlan(centerline, lengthM, profile);
    this.spacingM = lengthM / centerline.length;
  }

  /** À appeler après une remise sur la grille ou une téléportation : la prochaine projection cherchera sur tout le circuit. */
  reset(): void { this.hint = null; this.gripScale = 1; this.throttleOut = 0; }

  /** Vitesse cible (m/s) à l'abscisse sM : exposé pour l'affichage et les tests. */
  targetSpeedAt(sM: number): number {
    const n = this.plan.length;
    return this.plan[Math.floor(sM / this.spacingM + n) % n];
  }

  drive(state: DriverState): VehicleInput {
    const n = this.centerline.length;
    const projection = this.projector.project(state.xM, state.zM, this.hint);
    this.hint = projection.index;

    // Pilotage : point visé sur la ligne centrale, plus loin quand on va vite.
    const lookahead = LOOKAHEAD_MIN_M + LOOKAHEAD_PER_MPS * Math.abs(state.speedMps);
    const aimIndex = (projection.index + Math.round(lookahead / this.spacingM)) % n;
    const aim = this.centerline[aimIndex];
    const bearing = Math.atan2(aim.xM - state.xM, aim.zM - state.zM);
    const alpha = wrapAngle(bearing - state.headingRad);
    const wheelAngle = Math.atan2(2 * this.profile.wheelbaseM * Math.sin(alpha), lookahead);
    const maxSteer = this.profile.maxSteeringRad / (1 + Math.abs(state.speedMps) * this.profile.steeringReductionPerMps);
    // Une entrée positive braque à droite, c'est-à-dire fait DIMINUER le cap : le signe est inversé.
    const steering = Math.max(-1, Math.min(1, -wheelAngle / maxSteer));

    // Vitesse : cible du plan un peu plus loin devant, commande proportionnelle avec une petite zone morte.
    const slip = state.slip ?? 0;
    const dtS = state.dtS ?? 1 / 60;
    if (slip > CORNER_SLIDE_SLIP && Math.abs(steering) > 0.25) this.gripScale = Math.max(MIN_GRIP_SCALE, this.gripScale - GRIP_LOSS_PER_S * dtS);
    else this.gripScale = Math.min(1, this.gripScale + GRIP_RECOVERY_PER_S * dtS);
    // v² ∝ adhérence : la vitesse cible suit la racine du facteur ; ligne droite (cible au plafond) intacte tant que le facteur reste proche de 1.
    const targetSpeed = this.targetSpeedAt(projection.sM + Math.max(0, state.speedMps) * SPEED_LEAD_S) * Math.sqrt(this.gripScale);
    const error = targetSpeed - state.speedMps;
    const throttle = Math.max(0, Math.min(1, error * 0.6));
    const brake = error < -1 ? Math.max(0, Math.min(1, (-error - 1) * 0.35)) : 0;
    // Dans un virage serré, on ne demande pas toute la puissance : le train moteur ne doit pas décrocher l'arrière.
    const traction = slip > TRACTION_SLIP ? Math.max(0.05, 1 - (slip - TRACTION_SLIP) * 2.5) : 1;
    const throttleLimited = throttle * (1 - 0.5 * Math.min(1, Math.abs(steering))) * traction;
    // Freiner et braquer sollicitent le même cercle d'adhérence : quand la voiture glisse déjà, on relâche le frein.
    const brakeLimited = slip > 1 ? brake * Math.max(0.35, 1 - (slip - 1) * 0.6) : brake;
    const throttleWanted = brake > 0 ? 0 : throttleLimited;
    const change = throttleWanted - this.throttleOut;
    this.throttleOut += Math.max(-THROTTLE_FALL_PER_S * dtS, Math.min(THROTTLE_RISE_PER_S * dtS, change));
    return { throttle: this.throttleOut, brake: brakeLimited, steering, handbrake: 0 };
  }
}
