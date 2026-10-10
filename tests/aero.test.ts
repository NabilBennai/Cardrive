import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VehicleConfig } from '../src/shared/types';
import { vehicleConfigFor } from '../src/vehicle/configs/vehicleProfiles';
import { VehicleSimulation } from '../src/vehicle/physics/VehicleSimulation';
import {
  vehicleColliderMassProperties, vehicleColliderOffsetY, vehicleSpawnHeightM,
  VEHICLE_COLLIDER_FRICTION, VEHICLE_COLLIDER_RESTITUTION, VEHICLE_FIXED_STEP_S,
} from '../src/vehicle/physics/vehicleBody';

const dt = VEHICLE_FIXED_STEP_S;
const neutral = { throttle: 0, brake: 0, steering: 0, handbrake: 0 };

beforeAll(async () => { await RAPIER.init(); });

function makeRig(config: VehicleConfig, speedMps: number) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = dt;
  world.createCollider(RAPIER.ColliderDesc.cuboid(6000, 0.05, 6000).setTranslation(0, -0.05, 0));
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, vehicleSpawnHeightM(config), 0)
    .setLinearDamping(config.linearDamping).setAngularDamping(config.angularDamping).setCanSleep(false).setCcdEnabled(true));
  const mass = vehicleColliderMassProperties(config);
  world.createCollider(RAPIER.ColliderDesc.cuboid(config.dimensionsM.widthM / 2, config.dimensionsM.heightM / 2, config.dimensionsM.lengthM / 2)
    .setTranslation(0, vehicleColliderOffsetY(config), 0)
    .setMassProperties(mass.mass, mass.centerOfMass, mass.principalAngularInertia, mass.angularInertiaLocalFrame)
    .setFriction(VEHICLE_COLLIDER_FRICTION).setRestitution(VEHICLE_COLLIDER_RESTITUTION), body);
  const simulation = new VehicleSimulation(config);
  for (let i = 0; i < 180; i += 1) { simulation.step(world, RAPIER, body, neutral); world.step(); }
  body.setLinvel({ x: 0, y: 0, z: speedMps }, true);
  for (const pose of simulation.wheelPoses) pose.omegaRadPerS = speedMps / config.wheelRadiusM;
  return { world, body, simulation, speed: () => Math.hypot(body.linvel().x, body.linvel().z) };
}

function brakingDistance(config: VehicleConfig, speedMps: number): number {
  const { world, body, simulation, speed } = makeRig(config, speedMps);
  let distance = 0;
  let previousZ = body.translation().z;
  for (let step = 0; step < 30 * 60 && speed() > 0.5; step += 1) {
    simulation.step(world, RAPIER, body, { ...neutral, brake: 1 });
    world.step();
    distance += body.translation().z - previousZ;
    previousZ = body.translation().z;
  }
  world.free();
  return distance;
}

describe('aérodynamique', () => {
  it('la déportance raccourcit le freinage à haute vitesse, pas à basse vitesse', () => {
    const withDownforce = vehicleConfigFor('race');
    const without: VehicleConfig = { ...withDownforce, downforceClAM2: 0 };
    const fastWith = brakingDistance(withDownforce, 80);
    const fastWithout = brakingDistance(without, 80);
    const slowWith = brakingDistance(withDownforce, 20);
    const slowWithout = brakingDistance(without, 20);
    expect(fastWith).toBeLessThan(fastWithout * 0.8);
    expect(Math.abs(slowWith - slowWithout) / slowWithout).toBeLessThan(0.06);
  });

  it('les voitures de route n\'ont pas de déportance notable', () => {
    expect(vehicleConfigFor('sedan').downforceClAM2).toBe(0);
    expect(vehicleConfigFor('race').downforceClAM2).toBeGreaterThan(2);
    expect(vehicleConfigFor('race-future').downforceClAM2).toBeGreaterThan(2);
  });
});
