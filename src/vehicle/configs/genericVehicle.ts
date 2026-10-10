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
    config.tirePeakSlipRatio,
    config.tirePeakSlipAngleRad,
    config.tireSlidingGripRatio,
    config.engineInertiaKgM2,
    config.lowSpeedTireDampingNsPerM,
    config.maximumSuspensionForceN,
    config.minimumSuspensionLengthM,
    config.ambientTemperatureC,
    config.tireOptimalTemperatureC,
    config.tireTemperatureFalloffC,
    config.tireMinGripMultiplier,
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
  const nonnegative = [config.downforceClAM2, config.engineBrakeTorqueNm, config.steeringReductionPerMps,
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
    || !Number.isFinite(config.tireMinGripMultiplier) || config.tireMinGripMultiplier <= 0 || config.tireMinGripMultiplier > 1
    || config.tireSlidingGripRatio < 0.5 || config.tireSlidingGripRatio >= 1
    || !Number.isFinite(config.tireLoadSensitivity) || config.tireLoadSensitivity < 0 || config.tireLoadSensitivity > 0.3
    || config.drivetrainEfficiency > 1
    || config.downforceFrontShare < 0 || config.downforceFrontShare > 1
    || !(config.differentialLock >= 0 && config.differentialLock <= 1)
    || !(config.tireWearEnergyMJ > 0) || !(config.fuelCapacityKg >= 0) || config.fuelCapacityKg >= config.massKg * 0.5
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
  // Courbe de couple d'un 1.6 VTi 120 (essence, EP6) : 88 kW/120 ch à 6 000 tr/min,
  // 160 Nm à 4 250 tr/min — le bloc précédent (260 Nm) était digne d'une compacte sportive
  // turbocompressée, pas d'une C3 de série.
  torqueCurve: [
    { rpm: 900, torqueNm: 90 },
    { rpm: 1_800, torqueNm: 125 },
    { rpm: 3_000, torqueNm: 150 },
    { rpm: 4_250, torqueNm: 160 },
    { rpm: 5_500, torqueNm: 152 },
    { rpm: 6_000, torqueNm: 140 }, // 88 kW à 6 000 tr/min, valeur annoncée
    { rpm: 6_600, torqueNm: 112 },
  ],
  idleRpm: 900,
  maximumRpm: 6_700,
  // Volant réel (≈2,9 tours de butée à butée, ≈35° de braquage) : seul l'effort
  // d'assistance s'allège avec la vitesse, pas l'angle maximal lui-même (voir VehicleSimulation).
  maxSteeringRad: 0.6,
  steeringReductionPerMps: 0.022,
  tireGrip: 1.0,
  serviceBrakeForceN: 10_300,
  handbrakeForceN: 4_680,
  aerodynamicDragCoefficient: 0.33,
  // ≈ 82 % du rectangle largeur × hauteur (1,667 × 1,523 m) : surface frontale réelle d'une citadine, et non la boîte englobante.
  frontalAreaM2: 2.2,
  // Rapports de boîte manuelle 5 vitesses (BE4/5, PSA EP6) et pont, calés sur les
  // performances publiées (0-100 km/h ≈ 10,5 s, Vmax ≈ 188 km/h).
  gearRatios: [3.727, 2.048, 1.321, 0.971, 0.756],
  reverseGearRatio: 3.394,
  finalDriveRatio: 3.938,
  drivetrainEfficiency: 0.9,
  engineBrakeTorqueNm: 28,
  launchRpm: 2_000,
  engineResponsePerS: 8,
  upshiftRpm: 6_400,
  downshiftRpm: 2_200,
  shiftDurationS: 0.28,
  directionChangeSpeedMps: 0.35,
  directionChangeDelayS: 0.3,
  maximumReverseSpeedMps: 8,
  steeringRateRadPerS: 1.4,
  // Pneu de route 205/55 R16 sur sol sec : pic de force à ~12 % de glissement longitudinal et ~7,5° de
  // dérive (≈ 20 × la charge par radian de raideur de dérive), glissement franc à ~82 % du pic.
  tirePeakSlipRatio: 0.12,
  tirePeakSlipAngleRad: 0.13,
  tireSlidingGripRatio: 0.82,
  tireLoadSensitivity: 0.08,
  // Moteur 1.6 essence + volant + embrayage.
  engineInertiaKgM2: 0.12,
  lowSpeedTireDampingNsPerM: 4_600,
  frontBrakeBias: 0.64,
  handbrakeRearGripFactor: 0.6,
  rollingResistanceCoefficient: 0.012,
  maximumSuspensionForceN: 17_800,
  minimumSuspensionLengthM: 0.11,
  // Aucun amortissement linéaire de Rapier : il ajoutait une traînée parasite proportionnelle à la vitesse (≈ 530 N à 173 km/h)
  // qui doublait la vraie résistance de l'air. Toutes les résistances sont explicites (roulement, aéro, frein moteur, freins).
  linearDamping: 0,
  angularDamping: 0.5,
  // Modèle thermique de pneu (nœud unique, carcasse) : la chaleur vient du travail de
  // glissement (dérive latérale + dépassement du grip disponible), le refroidissement
  // vient de la convection d'air, renforcée par la vitesse. Le grip suit une fenêtre de
  // température optimale, pas un coefficient fixe : pneus froids ou surchauffés glissent.
  ambientTemperatureC: 20,
  tireOptimalTemperatureC: 80,
  tireTemperatureFalloffC: 55,
  tireMinGripMultiplier: 0.5,
  downforceClAM2: 0,
  downforceFrontShare: 0.45,
  differentialLock: 0,
  tireWearEnergyMJ: 8,
  fuelCapacityKg: 45,
};

export const genericVehicle = validateVehicleConfig(genericVehicleDefinition);
