import type { VehicleConfig } from '../../shared/types.ts';
import { findCar } from '../catalog/carCatalog.ts';
import { genericVehicle, validateVehicleConfig } from './genericVehicle.ts';

export type DriveLayout = 'rwd' | 'fwd' | 'awd';

/**
 * Caractéristiques « de catalogue » d'un véhicule, exprimées en grandeurs réelles lisibles
 * (masse, puissance, vitesse de pointe, adhérence…). deriveVehicleConfig() les traduit en
 * VehicleConfig complet à partir du prototype calibré (genericVehicle) : on ne réécrit pas
 * le solveur, on change ses paramètres de façon cohérente avec la masse et le gabarit.
 */
export interface VehicleProfile {
  massKg: number;
  lengthM: number;
  widthM: number;
  heightM: number;
  wheelbaseM: number;
  trackWidthM: number;
  wheelRadiusM: number;
  /** Puissance maximale (kW). */
  powerKw: number;
  /** Vitesse de pointe visée (km/h) : sert à régler la démultiplication finale. */
  topSpeedKmh: number;
  gears: number;
  /** Rapport total (boîte × pont) en première : plus il est grand, plus le démarrage est vigoureux. */
  firstGearOverall: number;
  /** Échelle de la plage de régime du moteur (diesel poids lourd < 1, moteur de course > 1). */
  rpmScale: number;
  drive: DriveLayout;
  /** Coefficient d'adhérence des pneus (1 = pneu de route standard du prototype). */
  tireGrip: number;
  /** Capacité de freinage, en multiples de g. */
  brakeG: number;
  dragCoefficient: number;
  frontalAreaM2: number;
  maxSteeringRad: number;
  steeringRateRadPerS: number;
  /** Raideur de suspension relative (1 = confort du prototype ; > 1 = sportif). */
  stiffness: number;
  /** Hauteur du centre de gravité en fraction de la hauteur du véhicule (bas = stable). */
  cogHeightFraction: number;
  shiftDurationS: number;
  /** Échelle de la débattement de suspension (petits véhicules < 1). */
  suspensionScale: number;
  maximumReverseSpeedMps: number;
  /** Pneus : angle de dérive au pic (rad), rapport de glissement franc/pic, température optimale de bande (°C), sensibilité à la charge. */
  tirePeakSlipAngleRad: number;
  tireSlidingGripRatio: number;
  tireOptimalTemperatureC: number;
  tireLoadSensitivity: number;
  /** Déportance Cz·A (m²) et part à l'avant ; 0 pour un véhicule de route. */
  downforceClAM2: number;
  downforceFrontShare: number;
  /** Verrouillage du différentiel (0 = ouvert, 1 = bloqué). */
  differentialLock: number;
  /** Énergie de frottement (MJ) qui use un pneu ; par défaut proportionnelle à la masse. */
  tireWearEnergyMJ?: number;
  /** Réservoir plein (kg) ; par défaut 4 % de la masse ; 0 = électrique. */
  fuelCapacityKg?: number;
}

/** Puissance du moteur du prototype (kW) autour de 6 000 tr/min : base de calcul de l'échelle de couple. */
const BASE_POWER_KW = 88;
const GRAVITY = 9.81;
/** Énergie de frottement (MJ) par kg de masse qui use complètement un pneu (à étalonner d'après les mesures de conduite). */
const WEAR_MJ_PER_KG = 0.007;
/** Rapport de la dernière vitesse (boîte seule) : la démultiplication finale est déduite de la vitesse de pointe visée. */
const TOP_GEAR_RATIO = 0.8;
/** Vitesse au régime MAXIMAL en dernier rapport / vitesse de pointe visée (le rapport de coupure est à 6 400 tr/min pour 6 700 tr/min maximum, donc 0,96 ≈ 1 au régime maximal) : la démultiplication fixe la vitesse de pointe, comme une voiture bridée ; un véhicule moins puissant reste limité par la traînée en dessous. */
const REDLINE_OVER_TOP_SPEED = 0.96;
/** Fraction de la course de suspension écrasée sous le poids statique (celle du prototype). */
const STATIC_SAG_FRACTION = 0.2;
const DAMPING_RATIO = 0.55;

export function deriveVehicleConfig(id: string, displayName: string, p: VehicleProfile): VehicleConfig {
  const base = genericVehicle;
  const massRatio = p.massKg / base.massKg;
  const sizeFactor = ((p.lengthM / base.dimensionsM.lengthM) ** 2 + (p.widthM / base.dimensionsM.widthM) ** 2 + (p.heightM / base.dimensionsM.heightM) ** 2) / 3;
  const torqueScale = p.powerKw / (BASE_POWER_KW * p.rpmScale);

  const upshiftRpm = base.upshiftRpm * p.rpmScale;
  const redlineSpeedMps = (p.topSpeedKmh / 3.6) * REDLINE_OVER_TOP_SPEED;
  const finalDriveRatio = ((upshiftRpm * 2 * Math.PI) / 60 * p.wheelRadiusM) / (redlineSpeedMps * TOP_GEAR_RATIO);
  const firstGear = p.firstGearOverall / finalDriveRatio;
  const gearRatios = Array.from({ length: p.gears }, (_, index) => firstGear * (TOP_GEAR_RATIO / firstGear) ** (index / Math.max(1, p.gears - 1)));

  const restLengthM = base.suspensionRestLengthM * p.suspensionScale;
  const springRateNPerM = (p.massKg * GRAVITY) / (4 * STATIC_SAG_FRACTION * restLengthM) * p.stiffness;
  const damperNsPerM = 2 * DAMPING_RATIO * Math.sqrt(springRateNPerM * p.massKg / 4);
  const staticLoadPerWheelN = (p.massKg * GRAVITY) / 4;
  const restSagM = restLengthM * STATIC_SAG_FRACTION / p.stiffness;
  // Distance entre l'origine du châssis et le sol au repos : montage de roue (0,08) + suspension + rayon.
  const groundDistanceM = 0.08 + (restLengthM - restSagM) + p.wheelRadiusM;
  const halfWheelbase = p.wheelbaseM / 2;
  const halfTrack = p.trackWidthM / 2;
  const frontDriven = p.drive !== 'rwd';
  const rearDriven = p.drive !== 'fwd';

  return validateVehicleConfig({
    ...base,
    id,
    displayName,
    assetProvenance: 'Profil dérivé du prototype calibré (voir vehicleProfiles.ts) ; habillage visuel : Kenney Car Kit (CC0).',
    massKg: p.massKg,
    dimensionsM: { lengthM: p.lengthM, widthM: p.widthM, heightM: p.heightM },
    centerOfGravityM: { xM: 0, yM: -groundDistanceM + p.cogHeightFraction * p.heightM, zM: base.centerOfGravityM.zM * (p.lengthM / base.dimensionsM.lengthM) },
    principalInertiaKgM2: {
      xM: base.principalInertiaKgM2.xM * massRatio * sizeFactor,
      yM: base.principalInertiaKgM2.yM * massRatio * sizeFactor,
      zM: base.principalInertiaKgM2.zM * massRatio * sizeFactor,
    },
    wheelbaseM: p.wheelbaseM,
    trackWidthM: p.trackWidthM,
    wheelRadiusM: p.wheelRadiusM,
    wheelInertiaKgM2: base.wheelInertiaKgM2 * (p.wheelRadiusM / base.wheelRadiusM) ** 2 * Math.sqrt(massRatio),
    wheelMounts: [
      { xM: -halfTrack, zM: halfWheelbase, front: true, driven: frontDriven },
      { xM: halfTrack, zM: halfWheelbase, front: true, driven: frontDriven },
      { xM: -halfTrack, zM: -halfWheelbase, front: false, driven: rearDriven },
      { xM: halfTrack, zM: -halfWheelbase, front: false, driven: rearDriven },
    ],
    suspensionRestLengthM: restLengthM,
    suspensionTravelM: base.suspensionTravelM * p.suspensionScale,
    springRateNPerM,
    damperNsPerM,
    maximumSuspensionForceN: 6.5 * staticLoadPerWheelN * p.stiffness,
    minimumSuspensionLengthM: base.minimumSuspensionLengthM * p.suspensionScale,
    torqueCurve: base.torqueCurve.map((point) => ({ rpm: point.rpm * p.rpmScale, torqueNm: point.torqueNm * torqueScale })),
    idleRpm: base.idleRpm * p.rpmScale,
    maximumRpm: base.maximumRpm * p.rpmScale,
    launchRpm: base.launchRpm * p.rpmScale,
    upshiftRpm,
    downshiftRpm: base.downshiftRpm * p.rpmScale,
    engineBrakeTorqueNm: base.engineBrakeTorqueNm * torqueScale,
    gearRatios,
    finalDriveRatio,
    shiftDurationS: p.shiftDurationS,
    maxSteeringRad: p.maxSteeringRad,
    steeringRateRadPerS: p.steeringRateRadPerS,
    steeringReductionPerMps: base.steeringReductionPerMps,
    maximumReverseSpeedMps: p.maximumReverseSpeedMps,
    tireGrip: p.tireGrip,
    tirePeakSlipRatio: base.tirePeakSlipRatio,
    tirePeakSlipAngleRad: p.tirePeakSlipAngleRad,
    tireSlidingGripRatio: p.tireSlidingGripRatio,
    tireLoadSensitivity: p.tireLoadSensitivity,
    tireOptimalTemperatureC: p.tireOptimalTemperatureC,
    // L'inertie d'un moteur suit sa cylindrée, donc sa puissance ; un moteur qui tourne vite est plus léger pour la même puissance.
    engineInertiaKgM2: base.engineInertiaKgM2 * (p.powerKw / BASE_POWER_KW) / p.rpmScale,
    lowSpeedTireDampingNsPerM: base.lowSpeedTireDampingNsPerM * massRatio,
    serviceBrakeForceN: p.massKg * GRAVITY * p.brakeG,
    handbrakeForceN: p.massKg * GRAVITY * 0.43,
    aerodynamicDragCoefficient: p.dragCoefficient,
    frontalAreaM2: p.frontalAreaM2,
    downforceClAM2: p.downforceClAM2,
    downforceFrontShare: p.downforceFrontShare,
    differentialLock: p.differentialLock,
    tireWearEnergyMJ: p.tireWearEnergyMJ ?? p.massKg * WEAR_MJ_PER_KG,
    fuelCapacityKg: p.fuelCapacityKg ?? Math.round(p.massKg * 0.04),
  });
}

/** Distance entre l'origine du châssis et le sol au repos (m, positive) : sert au placement du collider, du visuel et du point d'apparition. */
export function groundDistanceM(config: VehicleConfig): number {
  const sagM = (config.massKg * GRAVITY) / (4 * config.springRateNPerM);
  return 0.08 + (config.suspensionRestLengthM - sagM) + config.wheelRadiusM;
}

/** Compression de suspension (longueur) au repos : valeur initiale des poses de roues visuelles. */
export function restSuspensionM(config: VehicleConfig): number {
  return config.suspensionRestLengthM - (config.massKg * GRAVITY) / (4 * config.springRateNPerM);
}

export interface VehicleSummary {
  powerKw: number;
  massKg: number;
  drive: 'Propulsion' | 'Traction' | 'Intégrale';
}

/** Résumé lisible d'une configuration (carte du garage) : puissance de pointe, masse, transmission. */
export function summarizeVehicle(config: VehicleConfig): VehicleSummary {
  const peakWatts = config.torqueCurve.reduce((best, point) => Math.max(best, point.torqueNm * point.rpm * 2 * Math.PI / 60), 0);
  const driven = config.wheelMounts.filter((wheel) => wheel.driven);
  const drive = driven.length === config.wheelMounts.length ? 'Intégrale' : driven[0].front ? 'Traction' : 'Propulsion';
  return { powerKw: Math.round(peakWatts / 1000), massKg: config.massKg, drive };
}

const DEFAULTS = {
  drive: 'fwd' as DriveLayout, tireGrip: 1, brakeG: 0.95, maxSteeringRad: 0.58, steeringRateRadPerS: 1.4, stiffness: 1,
  cogHeightFraction: 0.37, shiftDurationS: 0.28, suspensionScale: 1, maximumReverseSpeedMps: 8, rpmScale: 1, gears: 6,
  wheelRadiusM: 0.3,
  tirePeakSlipAngleRad: 0.13,
  tireSlidingGripRatio: 0.82,
  tireOptimalTemperatureC: 80,
  tireLoadSensitivity: 0.08,
  downforceClAM2: 0,
  downforceFrontShare: 0.45,
  differentialLock: 0,
};
const profile = (p: Omit<VehicleProfile, keyof typeof DEFAULTS> & Partial<typeof DEFAULTS>): VehicleProfile => ({ ...DEFAULTS, ...p });

/**
 * Profils du catalogue. Valeurs inspirées de véhicules réels de la même catégorie (le nom du
 * modèle Kenney en donne la nature) ; elles sont arrondies pour un comportement lisible, pas
 * mesurées. L'identifiant est celui de src/vehicle/catalog/carCatalog.ts.
 */
const PROFILES: Record<string, VehicleProfile> = {
  sedan: profile({
    massKg: 1400, lengthM: 4.65, widthM: 1.82, heightM: 1.45, wheelbaseM: 2.75, trackWidthM: 1.56,
    powerKw: 145, topSpeedKmh: 215, firstGearOverall: 14.5, dragCoefficient: 0.29, frontalAreaM2: 2.2, drive: 'fwd',
  }),
  'sedan-sports': profile({
    massKg: 1550, lengthM: 4.72, widthM: 1.86, heightM: 1.39, wheelbaseM: 2.82, trackWidthM: 1.6,
    powerKw: 330, topSpeedKmh: 270, firstGearOverall: 14, dragCoefficient: 0.3, frontalAreaM2: 2.15, drive: 'rwd',
    differentialLock: 0.35, tireGrip: 1.25, brakeG: 1.05, stiffness: 1.35, cogHeightFraction: 0.33, rpmScale: 1.1, shiftDurationS: 0.2, maxSteeringRad: 0.56,
  }),
  'hatchback-sports': profile({
    massKg: 1250, lengthM: 4.1, widthM: 1.8, heightM: 1.43, wheelbaseM: 2.63, trackWidthM: 1.55,
    powerKw: 200, topSpeedKmh: 245, firstGearOverall: 14.2, dragCoefficient: 0.32, frontalAreaM2: 2.1, drive: 'fwd',
    tireGrip: 1.12, brakeG: 1.0, stiffness: 1.25, cogHeightFraction: 0.34, rpmScale: 1.05, shiftDurationS: 0.22, steeringRateRadPerS: 1.7,
  }),
  suv: profile({
    massKg: 1950, lengthM: 4.8, widthM: 1.94, heightM: 1.75, wheelbaseM: 2.85, trackWidthM: 1.65,
    powerKw: 170, topSpeedKmh: 200, firstGearOverall: 16.5, dragCoefficient: 0.36, frontalAreaM2: 2.9, drive: 'awd',
    tireGrip: 1.0, brakeG: 0.9, stiffness: 0.95, cogHeightFraction: 0.42, maxSteeringRad: 0.55,
  }),
  'suv-luxury': profile({
    massKg: 2300, lengthM: 5.0, widthM: 1.98, heightM: 1.78, wheelbaseM: 2.95, trackWidthM: 1.68,
    powerKw: 300, topSpeedKmh: 245, firstGearOverall: 16, dragCoefficient: 0.34, frontalAreaM2: 2.95, drive: 'awd',
    tireGrip: 1.05, brakeG: 0.95, stiffness: 1.1, cogHeightFraction: 0.41, rpmScale: 1.02, maxSteeringRad: 0.54,
  }),
  van: profile({
    massKg: 2000, lengthM: 4.95, widthM: 1.95, heightM: 1.95, wheelbaseM: 3.0, trackWidthM: 1.66,
    powerKw: 110, topSpeedKmh: 165, firstGearOverall: 17, dragCoefficient: 0.37, frontalAreaM2: 3.3, drive: 'fwd',
    tireGrip: 0.92, brakeG: 0.85, stiffness: 0.9, cogHeightFraction: 0.45, rpmScale: 0.9, maxSteeringRad: 0.57,
  }),
  taxi: profile({
    massKg: 1500, lengthM: 4.7, widthM: 1.82, heightM: 1.5, wheelbaseM: 2.78, trackWidthM: 1.56,
    powerKw: 105, topSpeedKmh: 190, firstGearOverall: 15, dragCoefficient: 0.3, frontalAreaM2: 2.25, drive: 'fwd', rpmScale: 0.85, brakeG: 0.9,
  }),
  police: profile({
    massKg: 1850, lengthM: 5.0, widthM: 1.9, heightM: 1.5, wheelbaseM: 2.95, trackWidthM: 1.62,
    powerKw: 310, topSpeedKmh: 250, firstGearOverall: 14.5, dragCoefficient: 0.33, frontalAreaM2: 2.4, drive: 'awd',
    tireGrip: 1.08, brakeG: 1.0, stiffness: 1.15, cogHeightFraction: 0.38, rpmScale: 1.05, shiftDurationS: 0.22, maxSteeringRad: 0.56,
  }),
  race: profile({
    massKg: 800, lengthM: 4.5, widthM: 1.95, heightM: 1.05, wheelbaseM: 3.0, trackWidthM: 1.7,
    powerKw: 650, topSpeedKmh: 340, firstGearOverall: 12, gears: 7, dragCoefficient: 0.6, frontalAreaM2: 1.4, drive: 'rwd',
    differentialLock: 0.2, fuelCapacityKg: 100, tireWearEnergyMJ: 20, tireGrip: 1.35, brakeG: 1.9, stiffness: 2.0, cogHeightFraction: 0.27, downforceClAM2: 2.8, downforceFrontShare: 0.42, rpmScale: 1.7, shiftDurationS: 0.1, maxSteeringRad: 0.42, steeringRateRadPerS: 2.2,
    wheelRadiusM: 0.33, suspensionScale: 0.6, tirePeakSlipAngleRad: 0.1, tireSlidingGripRatio: 0.88, tireOptimalTemperatureC: 95, tireLoadSensitivity: 0.1,
  }),
  'race-future': profile({
    massKg: 900, lengthM: 4.5, widthM: 1.95, heightM: 1.1, wheelbaseM: 3.0, trackWidthM: 1.7,
    powerKw: 700, topSpeedKmh: 380, firstGearOverall: 11.5, gears: 7, dragCoefficient: 0.5, frontalAreaM2: 1.4, drive: 'awd',
    differentialLock: 0.2, fuelCapacityKg: 0, tireWearEnergyMJ: 22, tireGrip: 1.4, brakeG: 2.1, stiffness: 2.2, cogHeightFraction: 0.26, downforceClAM2: 3.0, downforceFrontShare: 0.42, rpmScale: 1.5, shiftDurationS: 0.08, maxSteeringRad: 0.42, steeringRateRadPerS: 2.4,
    wheelRadiusM: 0.33, suspensionScale: 0.6, tirePeakSlipAngleRad: 0.1, tireSlidingGripRatio: 0.88, tireOptimalTemperatureC: 95, tireLoadSensitivity: 0.1,
  }),
  delivery: profile({
    massKg: 3500, lengthM: 5.8, widthM: 2.05, heightM: 2.6, wheelbaseM: 3.6, trackWidthM: 1.75,
    powerKw: 130, topSpeedKmh: 135, firstGearOverall: 22, dragCoefficient: 0.42, frontalAreaM2: 4.5, drive: 'rwd',
    tireGrip: 0.85, brakeG: 0.75, stiffness: 0.8, cogHeightFraction: 0.45, rpmScale: 0.75, shiftDurationS: 0.4, maxSteeringRad: 0.52, steeringRateRadPerS: 1.1,
    wheelRadiusM: 0.37, maximumReverseSpeedMps: 6,
  }),
  ambulance: profile({
    massKg: 3300, lengthM: 5.9, widthM: 2.05, heightM: 2.45, wheelbaseM: 3.65, trackWidthM: 1.75,
    powerKw: 150, topSpeedKmh: 160, firstGearOverall: 21, dragCoefficient: 0.4, frontalAreaM2: 4.3, drive: 'rwd',
    tireGrip: 0.88, brakeG: 0.8, stiffness: 0.85, cogHeightFraction: 0.44, rpmScale: 0.78, shiftDurationS: 0.38, maxSteeringRad: 0.52, steeringRateRadPerS: 1.15,
    wheelRadiusM: 0.37, maximumReverseSpeedMps: 6,
  }),
  firetruck: profile({
    massKg: 12000, lengthM: 8.6, widthM: 2.5, heightM: 3.3, wheelbaseM: 5.0, trackWidthM: 2.0,
    powerKw: 300, topSpeedKmh: 115, firstGearOverall: 34, dragCoefficient: 0.55, frontalAreaM2: 7.5, drive: 'rwd',
    tireGrip: 0.8, brakeG: 0.65, stiffness: 0.7, cogHeightFraction: 0.45, rpmScale: 0.6, shiftDurationS: 0.5, maxSteeringRad: 0.46, steeringRateRadPerS: 0.9,
    wheelRadiusM: 0.5, suspensionScale: 1.2, maximumReverseSpeedMps: 5,
  }),
  'garbage-truck': profile({
    massKg: 14000, lengthM: 8.0, widthM: 2.5, heightM: 3.4, wheelbaseM: 4.6, trackWidthM: 2.0,
    powerKw: 260, topSpeedKmh: 95, firstGearOverall: 36, dragCoefficient: 0.6, frontalAreaM2: 8, drive: 'rwd',
    tireGrip: 0.78, brakeG: 0.6, stiffness: 0.7, cogHeightFraction: 0.46, rpmScale: 0.6, shiftDurationS: 0.55, maxSteeringRad: 0.46, steeringRateRadPerS: 0.85,
    wheelRadiusM: 0.5, suspensionScale: 1.2, maximumReverseSpeedMps: 5,
  }),
  truck: profile({
    massKg: 9000, lengthM: 7.5, widthM: 2.45, heightM: 3.2, wheelbaseM: 4.4, trackWidthM: 1.95,
    powerKw: 240, topSpeedKmh: 120, firstGearOverall: 30, dragCoefficient: 0.55, frontalAreaM2: 6.5, drive: 'rwd',
    tireGrip: 0.82, brakeG: 0.65, stiffness: 0.75, cogHeightFraction: 0.45, rpmScale: 0.62, shiftDurationS: 0.5, maxSteeringRad: 0.47, steeringRateRadPerS: 0.95,
    wheelRadiusM: 0.48, suspensionScale: 1.15, maximumReverseSpeedMps: 5.5,
  }),
  tractor: profile({
    massKg: 6000, lengthM: 4.6, widthM: 2.4, heightM: 2.9, wheelbaseM: 2.7, trackWidthM: 1.9,
    powerKw: 110, topSpeedKmh: 55, firstGearOverall: 40, dragCoefficient: 0.9, frontalAreaM2: 5, drive: 'rwd',
    tireGrip: 1.05, brakeG: 0.6, stiffness: 0.8, cogHeightFraction: 0.5, rpmScale: 0.55, shiftDurationS: 0.45, maxSteeringRad: 0.6, steeringRateRadPerS: 1.0,
    wheelRadiusM: 0.55, suspensionScale: 1.2, maximumReverseSpeedMps: 4,
  }),
  'kart-oobi': profile({
    massKg: 180, lengthM: 2.0, widthM: 1.4, heightM: 0.85, wheelbaseM: 1.25, trackWidthM: 1.1,
    powerKw: 11, topSpeedKmh: 85, firstGearOverall: 7, gears: 3, dragCoefficient: 0.8, frontalAreaM2: 0.6, drive: 'rwd',
    tireGrip: 1.35, brakeG: 1.1, stiffness: 1.6, cogHeightFraction: 0.28, rpmScale: 1.1, shiftDurationS: 0.08, maxSteeringRad: 0.62, steeringRateRadPerS: 3,
    wheelRadiusM: 0.14, suspensionScale: 0.4, maximumReverseSpeedMps: 4, tirePeakSlipAngleRad: 0.11, tireSlidingGripRatio: 0.85, tireOptimalTemperatureC: 70, tireLoadSensitivity: 0.04,
  }),
};

const cache = new Map<string, VehicleConfig>();

/** Configuration physique du véhicule du catalogue ; le prototype (ou un identifiant inconnu) garde la configuration calibrée d'origine. */
export function vehicleConfigFor(carId: string | null | undefined): VehicleConfig {
  const entry = carId ? PROFILES[carId] : undefined;
  if (!carId || !entry) return genericVehicle;
  let config = cache.get(carId);
  if (!config) {
    config = deriveVehicleConfig(`cardrive-${carId}`, findCar(carId).label, entry);
    cache.set(carId, config);
  }
  return config;
}

export const PROFILE_IDS = Object.keys(PROFILES);
