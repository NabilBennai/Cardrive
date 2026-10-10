import type { RapierRigidBody } from '@react-three/rapier';
import type { VehicleConfig } from '../../shared/types.ts';
import { groundDistanceM } from '../configs/vehicleProfiles.ts';

export const VEHICLE_FIXED_STEP_S = 1 / 60;
export const VEHICLE_SPAWN = { x: 38, y: 0.8, z: 0 };
export const VEHICLE_COLLIDER_FRICTION = 0.72;
export const VEHICLE_COLLIDER_RESTITUTION = 0.08;

/** Both the rendered collider and the headless rig use these exact properties. */
export function vehicleMassProperties(config: VehicleConfig) {
  return {
    mass: config.massKg,
    centerOfMass: { x: config.centerOfGravityM.xM, y: config.centerOfGravityM.yM, z: config.centerOfGravityM.zM },
    principalAngularInertia: { x: config.principalInertiaKgM2.xM, y: config.principalInertiaKgM2.yM, z: config.principalInertiaKgM2.zM },
    angularInertiaLocalFrame: { x: 0, y: 0, z: 0, w: 1 },
  };
}

/**
 * Hauteur du centre du collider cuboïde par rapport à l'origine du châssis : son bas reste
 * 2 cm au-dessus du sol au repos, quelle que soit la hauteur du véhicule (un camion de 3,3 m
 * ou un kart de 0,85 m ne doivent pas traîner leur caisse au sol ou flotter).
 */
export function vehicleColliderOffsetY(config: VehicleConfig): number {
  return -groundDistanceM(config) + 0.02 + config.dimensionsM.heightM / 2;
}

/** Propriétés de masse exprimées dans le repère LOCAL du collider (centre de masse décalé de l'offset du collider). */
export function vehicleColliderMassProperties(config: VehicleConfig) {
  const properties = vehicleMassProperties(config);
  return { ...properties, centerOfMass: { ...properties.centerOfMass, y: properties.centerOfMass.y - vehicleColliderOffsetY(config) } };
}

/** Hauteur d'apparition de l'origine du châssis : un peu au-dessus de sa position de repos, la suspension absorbe la chute. */
export function vehicleSpawnHeightM(config: VehicleConfig): number {
  return groundDistanceM(config) + 0.12;
}

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

/** Quaternion de lacet pur autour de l'axe Y, pour orienter un spawn selon la tangente d'une route. */
export function headingToQuaternion(headingRad: number) {
  const half = headingRad / 2;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

export function resetVehicleBody(body: RapierRigidBody, position = VEHICLE_SPAWN, rotation = IDENTITY_ROTATION) {
  body.setTranslation(position, true);
  body.setRotation(rotation, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  body.resetForces(true);
  body.resetTorques(true);
}

/**
 * Décalage d'origine flottante (doc §6 : « Le décalage ne modifie pas la vitesse et ne doit
 * pas apparaître comme un déplacement physique »). Contrairement à resetVehicleBody, ne touche
 * ni aux vitesses ni aux forces/couples : seule la position change, le mouvement continue
 * physiquement à l'identique dans le nouveau repère.
 */
export function translateVehicleBody(body: RapierRigidBody, offset: { xM: number; yM: number; zM: number }) {
  const current = body.translation();
  body.setTranslation({ x: current.x - offset.xM, y: current.y - offset.yM, z: current.z - offset.zM }, true);
}
