import type { RapierRigidBody } from '@react-three/rapier';
import type { VehicleConfig } from '../../shared/types.ts';

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
