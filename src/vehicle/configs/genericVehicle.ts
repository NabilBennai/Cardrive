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
    config.tireLateralStiffnessNsPerM,
    config.serviceBrakeForceN,
    config.handbrakeForceN,
    config.frontalAreaM2,
    config.reverseGearRatio,
    config.finalDriveRatio,
    ...config.gearRatios,
    ...config.torqueCurve.map((point) => point.rpm),
    ...config.torqueCurve.map((point) => point.torqueNm),
  ];
  if (!config.id || !config.displayName || !config.assetProvenance || positive.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error(`Configuration de véhicule invalide : ${config.id || 'sans identifiant'}`);
  }
  if (config.wheelMounts.length !== 4
    || config.wheelMounts.filter((wheel) => wheel.front).length !== 2
    || config.wheelMounts.filter((wheel) => wheel.driven && !wheel.front).length === 0
    || config.wheelMounts.some((wheel) => !Number.isFinite(wheel.xM) || !Number.isFinite(wheel.zM))) {
    throw new Error(`La configuration ${config.id} doit décrire quatre roues et au moins une roue motrice.`);
  }
  if (config.torqueCurve.length < 2
    || config.torqueCurve.some((point, index, curve) => index > 0 && point.rpm <= curve[index - 1].rpm)) {
    throw new Error(`La courbe de couple de ${config.id} doit être triée par régime croissant.`);
  }
  if (config.idleRpm <= 0 || config.maximumRpm <= config.idleRpm
    || config.gearRatios.length === 0 || config.steeringReductionPerMps < 0
    || config.aerodynamicDragCoefficient < 0
    || !Number.isFinite(config.centerOfGravityM.xM + config.centerOfGravityM.yM + config.centerOfGravityM.zM)) {
    throw new Error(`Régimes ou rapports invalides pour ${config.id}.`);
  }
  return config;
}

const genericVehicleDefinition: VehicleConfig = {
  id: 'cardrive-generic-rwd',
  displayName: 'Prototype R-01',
  visualAssetRef: null,
  assetProvenance: 'Carrosserie et roues procédurales originales, aucun modèle tiers.',
  massKg: 1180,
  dimensionsM: { lengthM: 3.56, widthM: 1.82, heightM: 1.04 },
  centerOfGravityM: { xM: 0, yM: -0.08, zM: 0 },
  principalInertiaKgM2: { xM: 540, yM: 1850, zM: 1650 },
  wheelbaseM: 2.2,
  trackWidthM: 1.38,
  wheelRadiusM: 0.34,
  wheelInertiaKgM2: 1.25,
  wheelMounts: [
    { xM: -0.69, zM: 1.1, front: true, driven: false },
    { xM: 0.69, zM: 1.1, front: true, driven: false },
    { xM: -0.69, zM: -1.1, front: false, driven: true },
    { xM: 0.69, zM: -1.1, front: false, driven: true },
  ],
  suspensionRestLengthM: 0.57,
  suspensionTravelM: 0.3,
  springRateNPerM: 29_000,
  damperNsPerM: 3_200,
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
  tireLateralStiffnessNsPerM: 4_600,
  serviceBrakeForceN: 7_200,
  handbrakeForceN: 5_800,
  aerodynamicDragCoefficient: 0.32,
  frontalAreaM2: 2.0,
  gearRatios: [3.15, 2.12, 1.48, 1.12, 0.86],
  reverseGearRatio: 3.05,
  finalDriveRatio: 3.55,
};

export const genericVehicle = validateVehicleConfig(genericVehicleDefinition);
