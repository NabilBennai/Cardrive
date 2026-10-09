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

export interface RoadSegment {
  id: string;
  points: GeoPoint[];
  widthM: number;
  surface: SurfaceMaterial;
}

export interface ChunkKey {
  x: number;
  z: number;
}

export interface ChunkData {
  key: ChunkKey;
  roads: RoadSegment[];
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
  tireCorneringStiffnessPerRad: number;
  lowSpeedTireDampingNsPerM: number;
  frontBrakeBias: number;
  handbrakeRearGripFactor: number;
  rollingResistanceCoefficient: number;
  maximumSuspensionForceN: number;
  minimumSuspensionLengthM: number;
  linearDamping: number;
  angularDamping: number;
}
