export interface VehicleInput {
  throttle: number;
  brake: number;
  steering: number;
  handbrake: number;
}

export interface VehicleTelemetry {
  speedMps: number;
  engineRpm: number;
  gear: number;
  slip: number;
  groundedWheels: number;
  throttle: number;
  brake: number;
  steering: number;
  /** Température de carcasse par roue, ordre wheelMounts (avant-gauche, avant-droit, arrière-gauche, arrière-droit). */
  tireTemperaturesC: number[];
  /** Position locale du châssis (mètres, repère de la zone chargée) et lacet (rad, atan2(forward.x, forward.z)) : pour la mini-carte. */
  positionM: { xM: number; zM: number };
  headingRad: number;
}

export interface VehicleSnapshot {
  position: LocalPoint;
  headingRad: number;
}

export interface GeoPoint {
  latitudeDeg: number;
  longitudeDeg: number;
}

export interface LocalPoint {
  xM: number;
  yM: number;
  zM: number;
}

export type SurfaceMaterial = 'asphalt' | 'concrete' | 'gravel' | 'grass';

export interface ChunkKey {
  x: number;
  z: number;
}

export interface WheelMountConfig {
  xM: number;
  zM: number;
  front: boolean;
  driven: boolean;
}

export interface TorqueSample {
  rpm: number;
  torqueNm: number;
}

export interface VehicleConfig {
  id: string;
  displayName: string;
  visualAssetRef: string | null;
  assetProvenance: string;
  massKg: number;
  dimensionsM: { lengthM: number; widthM: number; heightM: number };
  centerOfGravityM: LocalPoint;
  principalInertiaKgM2: LocalPoint;
  wheelbaseM: number;
  trackWidthM: number;
  wheelRadiusM: number;
  wheelInertiaKgM2: number;
  wheelMounts: WheelMountConfig[];
  suspensionRestLengthM: number;
  suspensionTravelM: number;
  springRateNPerM: number;
  damperNsPerM: number;
  torqueCurve: TorqueSample[];
  idleRpm: number;
  maximumRpm: number;
  maxSteeringRad: number;
  steeringReductionPerMps: number;
  tireGrip: number;
  serviceBrakeForceN: number;
  handbrakeForceN: number;
  aerodynamicDragCoefficient: number;
  frontalAreaM2: number;
  gearRatios: number[];
  reverseGearRatio: number;
  finalDriveRatio: number;
  drivetrainEfficiency: number;
  engineBrakeTorqueNm: number;
  launchRpm: number;
  engineResponsePerS: number;
  upshiftRpm: number;
  downshiftRpm: number;
  shiftDurationS: number;
  directionChangeSpeedMps: number;
  directionChangeDelayS: number;
  maximumReverseSpeedMps: number;
  steeringRateRadPerS: number;
  /** Taux de glissement longitudinal au pic d'adhérence du pneu (≈ 0,10-0,15). */
  tirePeakSlipRatio: number;
  /** Angle de dérive (rad) au pic d'adhérence latérale (≈ 0,10-0,15). */
  tirePeakSlipAngleRad: number;
  /** Force de glissement franc / force de pic (≈ 0,8). */
  tireSlidingGripRatio: number;
  /** Perte relative de coefficient d'adhérence par unité de surcharge de la roue. */
  tireLoadSensitivity: number;
  /** Inertie du volant moteur et du vilebrequin (kg·m²), ramenée aux roues par le rapport au carré. */
  engineInertiaKgM2: number;
  lowSpeedTireDampingNsPerM: number;
  frontBrakeBias: number;
  handbrakeRearGripFactor: number;
  rollingResistanceCoefficient: number;
  maximumSuspensionForceN: number;
  minimumSuspensionLengthM: number;
  linearDamping: number;
  angularDamping: number;
  ambientTemperatureC: number;
  /** Température de bande de roulement d'adhérence maximale (°C). */
  tireOptimalTemperatureC: number;
  /** Demi-largeur (°C) de la fenêtre chaude : perte d'adhérence au-delà de l'optimum. */
  tireTemperatureFalloffC: number;
  /** Plancher du facteur d'adhérence lié à la température. */
  tireMinGripMultiplier: number;
  /** Déportance : surface équivalente Cz·A (m²) ; la force plaquant la voiture au sol vaut ½·ρ·Cz·A·v². 0 pour un véhicule de route. */
  downforceClAM2: number;
  /** Part de la déportance appliquée à l'essieu avant (0..1). */
  downforceFrontShare: number;
  /** Verrouillage du différentiel de chaque essieu moteur : 0 = ouvert, 1 = bloqué (couple reporté sur la roue la plus lente). */
  differentialLock: number;
}
