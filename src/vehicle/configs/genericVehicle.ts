import type { VehicleConfig } from '../../shared/types';

export function validateVehicleConfig(config: VehicleConfig): VehicleConfig {
  const positive = [
    config.massKg,
    config.dimensionsM.lengthM,
    config.dimensionsM.widthM,
    config.dimensionsM.heightM,
    config.wheelbaseM,
    config.trackWidthM,
    config.wheelRadiusM,
    config.wheelInertiaKgM2,
    config.principalInertiaKgM2.xM,
    config.principalInertiaKgM2.yM,
    config.principalInertiaKgM2.zM,
    config.suspensionRestLengthM,
    config.suspensionTravelM,
    config.springRateNPerM,
    config.damperNsPerM,
    config.maxSteeringRad,
    config.tireGrip,
    config.serviceBrakeForceN,
    config.handbrakeForceN,
    config.frontalAreaM2,
    config.reverseGearRatio,
    config.finalDriveRatio,
    config.drivetrainEfficiency,
    config.launchRpm,
    config.engineResponsePerS,
    config.upshiftRpm,
    config.downshiftRpm,
    config.shiftDurationS,
    config.directionChangeSpeedMps,
    config.directionChangeDelayS,
    config.maximumReverseSpeedMps,
    config.steeringRateRadPerS,
    config.maximumCorneringAccelerationMps2,
    config.tireCorneringStiffnessPerRad,
    config.lowSpeedTireDampingNsPerM,
    config.maximumSuspensionForceN,
    config.minimumSuspensionLengthM,
    ...config.gearRatios,
    ...config.torqueCurve.map((point) => point.rpm),
    ...config.torqueCurve.map((point) => point.torqueNm),
  ];
  if (!config.id || !config.displayName || !config.assetProvenance || positive.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error(`Configuration de véhicule invalide : ${config.id || 'sans identifiant'}`);
  }
  if (config.wheelMounts.length !== 4
    || config.wheelMounts.filter((wheel) => wheel.front).length !== 2
    || !config.wheelMounts.some((wheel) => wheel.driven)
    || config.wheelMounts.some((wheel) => !Number.isFinite(wheel.xM) || !Number.isFinite(wheel.zM))) {
    throw new Error(`La configuration ${config.id} doit décrire quatre roues et au moins une roue motrice.`);
  }
  if (config.torqueCurve.length < 2
    || config.torqueCurve.some((point, index, curve) => index > 0 && point.rpm <= curve[index - 1].rpm)) {
    throw new Error(`La courbe de couple de ${config.id} doit être triée par régime croissant.`);
  }
  const nonnegative = [config.engineBrakeTorqueNm, config.steeringReductionPerMps,
    config.aerodynamicDragCoefficient, config.rollingResistanceCoefficient, config.linearDamping, config.angularDamping];
  if (!Number.isFinite(config.idleRpm) || !Number.isFinite(config.maximumRpm)
    || config.idleRpm <= 0 || config.maximumRpm <= config.idleRpm
    || config.gearRatios.length === 0 || config.steeringReductionPerMps < 0
    || config.aerodynamicDragCoefficient < 0
    || !Number.isFinite(config.centerOfGravityM.xM + config.centerOfGravityM.yM + config.centerOfGravityM.zM)) {
    throw new Error(`Régimes ou rapports invalides pour ${config.id}.`);
  }
  if (nonnegative.some((value) => !Number.isFinite(value) || value < 0)
    || !Number.isFinite(config.frontBrakeBias) || config.frontBrakeBias <= 0 || config.frontBrakeBias >= 1
    || !Number.isFinite(config.handbrakeRearGripFactor) || config.handbrakeRearGripFactor <= 0 || config.handbrakeRearGripFactor > 1
    || config.drivetrainEfficiency > 1
    || config.downshiftRpm <= config.idleRpm || config.downshiftRpm >= config.upshiftRpm
    || config.upshiftRpm >= config.maximumRpm || config.launchRpm < config.idleRpm || config.launchRpm >= config.upshiftRpm
    || config.minimumSuspensionLengthM >= config.suspensionRestLengthM) {
    throw new Error(`Paramètres de calibration invalides pour ${config.id}.`);
  }
  return config;
}

const genericVehicleDefinition: VehicleConfig = {
  id: 'cardrive-generic-rwd',
  displayName: 'Prototype R-01',
  visualAssetRef: null,
  assetProvenance: 'Carrosserie et roues procédurales originales, aucun modèle tiers.',
  // Mesures réelles d'une Citroën C3 phase 2 (citadine haute, 2005-2009) : la voiture
  // précédente était plus courte, plus large et nettement plus basse que ce gabarit,
  // ce qui réduisait l'empattement/la voie effectifs et rendait la direction nerveuse.
  massKg: 1105,
  dimensionsM: { lengthM: 3.852, widthM: 1.667, heightM: 1.523 },
  centerOfGravityM: { xM: 0, yM: -0.22, zM: 0.08 },
  principalInertiaKgM2: { xM: 630, yM: 1910, zM: 1790 },
  wheelbaseM: 2.46,
  trackWidthM: 1.44,
  wheelRadiusM: 0.3,
  wheelInertiaKgM2: 1.1,
  wheelMounts: [
    { xM: -0.72, zM: 1.23, front: true, driven: false },
    { xM: 0.72, zM: 1.23, front: true, driven: false },
    { xM: -0.72, zM: -1.23, front: false, driven: true },
    { xM: 0.72, zM: -1.23, front: false, driven: true },
  ],
  suspensionRestLengthM: 0.5,
  suspensionTravelM: 0.28,
  springRateNPerM: 27_200,
  damperNsPerM: 3_000,
  torqueCurve: [
    { rpm: 850, torqueNm: 185 },
    { rpm: 1_800, torqueNm: 230 },
    { rpm: 3_400, torqueNm: 260 },
    { rpm: 5_200, torqueNm: 220 },
    { rpm: 6_400, torqueNm: 150 },
  ],
  idleRpm: 850,
  maximumRpm: 6_400,
  maxSteeringRad: 0.48,
  steeringReductionPerMps: 0.032,
  tireGrip: 1.08,
  serviceBrakeForceN: 10_300,
  handbrakeForceN: 4_680,
  aerodynamicDragCoefficient: 0.33,
  frontalAreaM2: 2.69,
  gearRatios: [3.15, 2.12, 1.48, 1.12, 0.86],
  reverseGearRatio: 3.05,
  finalDriveRatio: 3.55,
  drivetrainEfficiency: 0.84,
  engineBrakeTorqueNm: 32,
  launchRpm: 1_800,
  engineResponsePerS: 8,
  upshiftRpm: 5_700,
  downshiftRpm: 2_000,
  shiftDurationS: 0.28,
  directionChangeSpeedMps: 0.35,
  directionChangeDelayS: 0.3,
  maximumReverseSpeedMps: 8,
  steeringRateRadPerS: 1.4,
  maximumCorneringAccelerationMps2: 7.5,
  tireCorneringStiffnessPerRad: 8,
  lowSpeedTireDampingNsPerM: 4_600,
  frontBrakeBias: 0.64,
  handbrakeRearGripFactor: 0.6,
  rollingResistanceCoefficient: 0.012,
  maximumSuspensionForceN: 17_800,
  minimumSuspensionLengthM: 0.11,
  linearDamping: 0.01,
  angularDamping: 0.5,
};

export const genericVehicle = validateVehicleConfig(genericVehicleDefinition);
