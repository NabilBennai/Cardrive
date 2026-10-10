/**
 * Modèle de pneu : forces de contact (formule magique de Pacejka, glissement combiné) et
 * thermique à deux nœuds (bande de roulement + carcasse). Fonctions pures, sans Rapier ni
 * three.js : testables isolément, utilisées par VehicleSimulation.
 */

const GRAVITY = 9.81;

export interface TireForceParams {
  /** Coefficient d'adhérence de base (1 = pneu de route sur sol sec). */
  baseGrip: number;
  /** Taux de glissement longitudinal au pic de force (≈ 0,10-0,15). */
  peakSlipRatio: number;
  /** Angle de dérive au pic de force (rad, ≈ 0,10-0,15). */
  peakSlipAngleRad: number;
  /** Force de glissement franc / force de pic (≈ 0,8 : un pneu qui glisse accroche moins qu'un pneu au pic). */
  slidingRatio: number;
  /** Perte relative de coefficient d'adhérence par unité de surcharge de la roue (le grip ne croît pas linéairement avec la charge). */
  loadSensitivity: number;
  /** Charge statique d'une roue (N) : référence de la sensibilité à la charge. */
  referenceLoadN: number;
}

export interface TireForce {
  /** Force longitudinale dans le plan de contact (N), positive si elle pousse vers l'avant. */
  fxN: number;
  /** Force latérale (N), de signe opposé au glissement latéral. */
  fyN: number;
  /** Glissement combiné normalisé : 1 = pic d'adhérence, > 1 = au-delà du pic (le pneu glisse). */
  normalizedSlip: number;
  /** Force maximale disponible (N) à cette charge et cette température. */
  peakN: number;
}

/** C de la formule magique tel que l'asymptote (grand glissement) vaille `slidingRatio` × le pic. */
export function shapeFactor(slidingRatio: number): number {
  return 2 - (2 * Math.asin(Math.min(0.99, Math.max(0.3, slidingRatio)))) / Math.PI;
}

/** Magnitude normalisée F/Fpic en fonction du glissement normalisé s (pic en s = 1). */
export function magicCurve(s: number, slidingRatio: number): number {
  const c = shapeFactor(slidingRatio);
  const b = Math.tan(Math.PI / (2 * c));
  return Math.sin(c * Math.atan(b * s));
}

/** Produit C·B' : pente à l'origine de la courbe F/Fpic en fonction du glissement normalisé (≈ 2,9 pour un pneu de route). */
export function curveInitialSlope(slidingRatio: number): number {
  const c = shapeFactor(slidingRatio);
  return c * Math.tan(Math.PI / (2 * c));
}

/**
 * Vitesse (m/s) sous laquelle la raideur du pneu rend instable l'intégration explicite de la caisse. La raideur d'un pneu
 * est k = μ·Fz·pente/(pic de glissement·vitesse) ; la caisse (masse m, charge Fz = m·g par roue) est stable si dt·k/m < `margin`.
 * Comme Fz/m = g, la vitesse de référence ne dépend que du pneu (μ, pente, pic de glissement), pas de la masse du véhicule :
 * un kart et un camion ont la même. Équivalent d'une longueur de relaxation : en dessous, la force du pneu est adoucie.
 */
export function stableReferenceSpeedMps(dt: number, grip: number, slidingRatio: number, peakSlip: number, margin = 0.8): number {
  return (dt * GRAVITY * grip * curveInitialSlope(slidingRatio)) / (peakSlip * margin);
}

/** Coefficient d'adhérence effectif : sensibilité à la charge (un pneu très chargé adhère relativement moins). */
export function loadAdjustedGrip(p: TireForceParams, loadN: number): number {
  const factor = 1 - p.loadSensitivity * (loadN / p.referenceLoadN - 1);
  return p.baseGrip * Math.min(1.4, Math.max(0.55, factor));
}

/**
 * Forces d'un pneu en glissement combiné. κ = taux de glissement longitudinal (vitesse de
 * surface de la roue − vitesse au sol, divisée par la vitesse au sol), α = angle de dérive
 * signé (rad, positif si le point de contact dérive vers la droite du pneu). Les deux glissements
 * sont normalisés par leur pic respectif puis combinés : la courbe de pic donne la magnitude, et
 * la direction suit le rapport des glissements — une roue qui patine perd donc de l'adhérence
 * latérale, comme un vrai pneu (ellipse d'adhérence), sans règle ad hoc.
 */
export function tireForce(p: TireForceParams, kappa: number, alphaRad: number, loadN: number, gripFactor: number): TireForce {
  const peakN = loadAdjustedGrip(p, loadN) * Math.max(0, loadN) * gripFactor;
  const sx = kappa / p.peakSlipRatio;
  const sy = Math.tan(alphaRad) / Math.tan(p.peakSlipAngleRad);
  const s = Math.hypot(sx, sy);
  if (s < 1e-9 || peakN <= 0) return { fxN: 0, fyN: 0, normalizedSlip: s, peakN };
  const magnitude = peakN * magicCurve(s, p.slidingRatio);
  return { fxN: (magnitude * sx) / s, fyN: (-magnitude * sy) / s, normalizedSlip: s, peakN };
}

// ---------------------------------------------------------------------------------------
// Thermique
// ---------------------------------------------------------------------------------------

export interface TireThermalState {
  /** Température de la bande de roulement (°C) : celle qui conditionne l'adhérence. */
  surfaceC: number;
  /** Température de la carcasse / du volume d'air interne (°C) : inertielle, source de chaleur lente. */
  carcassC: number;
}

export interface TireThermalParams {
  surfaceCapacityJPerC: number;
  carcassCapacityJPerC: number;
  /** Conduction bande de roulement ↔ carcasse (W/°C). */
  surfaceCarcassConductanceWPerC: number;
  /** Surface exposée à l'air (m²). */
  treadAreaM2: number;
  carcassAreaM2: number;
  /** Conduction vers la route à travers la zone de contact (W/°C). */
  roadConductanceWPerC: number;
}

/** Part de la puissance de frottement qui échauffe le pneu (le reste va dans la route). */
const SLIDING_HEAT_TO_TIRE = 0.6;
/** Part de la puissance d'hystérésis (déformation cyclique) qui reste dans la carcasse ; le reste chauffe la bande. */
const HYSTERESIS_TO_CARCASS = 0.6;
/** Charge statique de la roue de référence (≈ citadine de 1 100 kg, N) pour laquelle les valeurs ci-dessous sont données. */
const REFERENCE_WHEEL_LOAD_N = 2_700;
const MIN_TEMPERATURE_C = -40;
const MAX_TEMPERATURE_C = 260;

/**
 * Paramètres thermiques d'un pneu de route de 205/55 R16 (≈ 9 kg), mis à l'échelle de la charge
 * statique de la roue (un pneu de camion est plus massif et plus grand, un pneu de kart bien plus petit).
 * Ordres de grandeur : capacité de la bande ≈ 2 kJ/°C (≈ 1 kg de gomme active), carcasse ≈ 12 kJ/°C.
 * Constantes de temps résultantes : la bande se met en équilibre avec la carcasse en ~30 s ; la
 * carcasse perd la moitié de son excès de température en ~12 min à l'arrêt (constante de temps ≈ 17 min)
 * et en quelques minutes à 100 km/h.
 */
export function thermalParamsFor(staticWheelLoadN: number): TireThermalParams {
  const scale = (staticWheelLoadN / REFERENCE_WHEEL_LOAD_N) ** 0.75;
  return {
    surfaceCapacityJPerC: 2_000 * scale,
    carcassCapacityJPerC: 12_000 * scale,
    surfaceCarcassConductanceWPerC: 60 * scale,
    treadAreaM2: 0.25 * scale,
    carcassAreaM2: 0.45 * scale,
    roadConductanceWPerC: 8 * scale,
  };
}

/** Coefficient de convection (W/m²/°C) d'une surface de pneu dans l'air relatif : naturelle à l'arrêt, forcée en roulant. */
export function convectionCoefficient(speedMps: number): number {
  return 10 + 7 * Math.max(0, speedMps) ** 0.6;
}

export interface TireThermalInput {
  /** Puissance de frottement au contact (N·m/s) : |Fx × vitesse de glissement longitudinale| + |Fy × vitesse de glissement latérale|. */
  slidingPowerW: number;
  /** Puissance d'hystérésis (résistance au roulement × vitesse). */
  hysteresisPowerW: number;
  speedMps: number;
  ambientC: number;
}

/** Un pas d'intégration d'Euler explicite ; stable car la plus petite constante de temps (≈ 24 s) est très supérieure au pas. */
export function stepTireThermal(state: TireThermalState, input: TireThermalInput, p: TireThermalParams, dt: number): TireThermalState {
  const h = convectionCoefficient(input.speedMps);
  const conduction = p.surfaceCarcassConductanceWPerC * (state.surfaceC - state.carcassC);
  const surfaceHeat = input.slidingPowerW * SLIDING_HEAT_TO_TIRE + input.hysteresisPowerW * (1 - HYSTERESIS_TO_CARCASS);
  const surfaceLoss = conduction + h * p.treadAreaM2 * (state.surfaceC - input.ambientC) + p.roadConductanceWPerC * (state.surfaceC - input.ambientC);
  const carcassHeat = input.hysteresisPowerW * HYSTERESIS_TO_CARCASS + conduction;
  const carcassLoss = h * p.carcassAreaM2 * (state.carcassC - input.ambientC);
  const clamp = (value: number) => Math.min(MAX_TEMPERATURE_C, Math.max(MIN_TEMPERATURE_C, value));
  return {
    surfaceC: clamp(state.surfaceC + ((surfaceHeat - surfaceLoss) / p.surfaceCapacityJPerC) * dt),
    carcassC: clamp(state.carcassC + ((carcassHeat - carcassLoss) / p.carcassCapacityJPerC) * dt),
  };
}

/** Largeur de la plage d'adhérence côté froid (°C) et perte à son bord : un pneu de route froid garde ~85 % de son grip, pas 60 %. */
const COLD_WIDTH_C = 70;
const COLD_LOSS = 0.16;
/** Perte maximale côté chaud à une demi-largeur `hotWidthC` du optimum (gomme qui chauffe : cloques, graissage). */
const HOT_LOSS = 0.22;

/**
 * Facteur d'adhérence en fonction de la température de la BANDE : maximum à l'optimum, perte
 * douce côté froid (la gomme durcit), perte plus marquée côté chaud (la gomme se dégrade).
 */
export function temperatureGripFactor(surfaceC: number, optimalC: number, hotWidthC: number, minFactor: number): number {
  if (surfaceC < optimalC) return Math.max(minFactor, 1 - COLD_LOSS * ((optimalC - surfaceC) / COLD_WIDTH_C) ** 2);
  return Math.max(minFactor, 1 - HOT_LOSS * ((surfaceC - optimalC) / hotWidthC) ** 2);
}

/** Charge statique d'une roue (N) pour une masse donnée répartie sur quatre roues. */
export const staticWheelLoadN = (massKg: number) => (massKg * GRAVITY) / 4;
