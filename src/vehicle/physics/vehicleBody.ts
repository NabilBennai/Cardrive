import type { RapierRigidBody } from '@react-three/rapier';
import type { VehicleConfig } from '../../shared/types.ts';

export const VEHICLE_FIXED_STEP_S = 1 / 60;
export const VEHICLE_SPAWN = { x: 38, y: 0.9, z: 0 };
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

export function resetVehicleBody(body: RapierRigidBody, position = VEHICLE_SPAWN) {
  body.setTranslation(position, true);
  body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  body.resetForces(true);
  body.resetTorques(true);
}
