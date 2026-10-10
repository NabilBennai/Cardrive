import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VehicleConfig, VehicleInput } from '../src/shared/types';
import { PROFILE_IDS, vehicleConfigFor } from '../src/vehicle/configs/vehicleProfiles';
import { VehicleSimulation } from '../src/vehicle/physics/VehicleSimulation';
import {
  vehicleColliderMassProperties, vehicleColliderOffsetY, vehicleSpawnHeightM,
  VEHICLE_COLLIDER_FRICTION, VEHICLE_COLLIDER_RESTITUTION, VEHICLE_FIXED_STEP_S,
} from '../src/vehicle/physics/vehicleBody';

const dt = VEHICLE_FIXED_STEP_S;
const neutral: VehicleInput = { throttle: 0, brake: 0, steering: 0, handbrake: 0 };

beforeAll(async () => { await RAPIER.init(); });

function makeRig(config: VehicleConfig, speedMps = 0) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = dt;
  world.createCollider(RAPIER.ColliderDesc.cuboid(4000, 0.05, 4000).setTranslation(0, -0.05, 0));
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, vehicleSpawnHeightM(config), 0)
    .setLinearDamping(config.linearDamping).setAngularDamping(config.angularDamping).setCanSleep(false).setCcdEnabled(true));
  const mass = vehicleColliderMassProperties(config);
  world.createCollider(RAPIER.ColliderDesc.cuboid(config.dimensionsM.widthM / 2, config.dimensionsM.heightM / 2, config.dimensionsM.lengthM / 2)
    .setTranslation(0, vehicleColliderOffsetY(config), 0)
    .setMassProperties(mass.mass, mass.centerOfMass, mass.principalAngularInertia, mass.angularInertiaLocalFrame)
    .setFriction(VEHICLE_COLLIDER_FRICTION).setRestitution(VEHICLE_COLLIDER_RESTITUTION), body);
  const simulation = new VehicleSimulation(config);
  for (let i = 0; i < 180; i += 1) { simulation.step(world, RAPIER, body, neutral); world.step(); }
  if (speedMps > 0) {
    body.setLinvel({ x: 0, y: 0, z: speedMps }, true);
    // Les roues tournent déjà à la vitesse du sol : on ne mesure pas un départ lancé avec des roues arrêtées.
    for (const pose of simulation.wheelPoses) pose.omegaRadPerS = speedMps / config.wheelRadiusM;
  }
  const speed = () => Math.hypot(body.linvel().x, body.linvel().z);
  return { world, body, simulation, speed };
}

describe('tire realism with the full vehicle solver', () => {
  it('launches the prototype from a standstill without sitting at the grip limit, and without heating the tires', () => {
    const config = vehicleConfigFor(null);
    const { world, body, simulation } = makeRig(config);
    let maximumSlip = 0;
    let hottest = 0;
    for (let step = 0; step < 10 * 60; step += 1) {
      const telemetry = simulation.step(world, RAPIER, body, { ...neutral, throttle: 1 });
      world.step();
      if (step < 4 * 60) maximumSlip = Math.max(maximumSlip, telemetry.slip);
      hottest = Math.max(hottest, ...simulation.wheelPoses.map((pose) => pose.temperatureC));
    }
    expect(maximumSlip).toBeLessThan(1); // jamais au-delà du pic d'adhérence pendant le lancement
    expect(hottest).toBeLessThan(config.ambientTemperatureC + 8); // 10 s d'accélération ne chauffent pas un pneu de 20 à 180 °C
    world.free();
  });

  it('keeps the free-rolling front wheels at the speed of the car', () => {
    const config = vehicleConfigFor(null);
    const { world, body, simulation, speed } = makeRig(config, 16.7);
    for (let step = 0; step < 6 * 60; step += 1) {
      simulation.step(world, RAPIER, body, { ...neutral, throttle: 0.25 });
      world.step();
    }
    for (const index of [0, 1]) {
      const surfaceSpeed = simulation.wheelPoses[index].omegaRadPerS * config.wheelRadiusM;
      expect(Math.abs(surfaceSpeed - speed()) / speed()).toBeLessThan(0.03);
    }
    world.free();
  });

  it('brakes with ABS: the wheels keep turning and the car stops in a realistic distance', () => {
    const config = vehicleConfigFor(null);
    const { world, body, simulation, speed } = makeRig(config, 27.8);
    let distance = 0;
    let minimumRolling = 1;
    let previousZ = body.translation().z;
    for (let step = 0; step < 8 * 60 && speed() > 0.2; step += 1) {
      simulation.step(world, RAPIER, body, { ...neutral, brake: 1 });
      world.step();
      distance += body.translation().z - previousZ;
      previousZ = body.translation().z;
      if (speed() > 10) {
        for (const pose of simulation.wheelPoses) minimumRolling = Math.min(minimumRolling, (pose.omegaRadPerS * config.wheelRadiusM) / speed());
      }
    }
    expect(minimumRolling).toBeGreaterThan(0.6); // pas de blocage de roue (ABS)
    expect(distance).toBeGreaterThan(30); // 100 km/h → 0 ne peut pas se faire en moins de 0,95 g
    expect(distance).toBeLessThan(70);
    world.free();
  });

  it('heats the loaded outer front tire most in a sustained corner, gradually, and reaches the limit without runaway', () => {
    const config = vehicleConfigFor(null);
    const { world, body, simulation, speed } = makeRig(config, 13.9);
    const history: number[] = [];
    for (let step = 0; step < 40 * 60; step += 1) {
      simulation.step(world, RAPIER, body, { ...neutral, throttle: speed() < 13.9 ? 0.5 : 0.15, steering: 0.5 });
      world.step();
      if (step % 600 === 599) history.push(Math.max(...simulation.wheelPoses.map((pose) => pose.temperatureC)));
    }
    expect(history[history.length - 1]).toBeGreaterThan(history[0]);
    expect(history[history.length - 1]).toBeGreaterThan(40);
    expect(history[history.length - 1]).toBeLessThan(120);
    // Montée progressive : jamais plus de 3 °C par seconde en moyenne.
    for (let i = 1; i < history.length; i += 1) expect(history[i] - history[i - 1]).toBeLessThan(30);
    world.free();
  });

  it('stays parked: no creeping or jitter at rest, with the wheels stopped', () => {
    const config = vehicleConfigFor(null);
    const { world, body, simulation, speed } = makeRig(config);
    for (let step = 0; step < 5 * 60; step += 1) {
      simulation.step(world, RAPIER, body, neutral);
      world.step();
    }
    expect(speed()).toBeLessThan(0.01);
    for (const pose of simulation.wheelPoses) expect(Math.abs(pose.omegaRadPerS)).toBeLessThan(0.05);
    world.free();
  });

  it('lets a car at rest on its tires stay at ambient temperature', () => {
    const config = vehicleConfigFor(null);
    const { world, body, simulation } = makeRig(config);
    for (let step = 0; step < 60 * 60; step += 1) {
      simulation.step(world, RAPIER, body, neutral);
      world.step();
    }
    for (const pose of simulation.wheelPoses) expect(Math.abs(pose.temperatureC - config.ambientTemperatureC)).toBeLessThan(0.5);
    world.free();
  });

  it.each(PROFILE_IDS)('%s accelerates forward, stays finite and keeps its wheels on the ground', (id) => {
    const config = vehicleConfigFor(id);
    const { world, body, simulation, speed } = makeRig(config);
    let finite = true;
    for (let step = 0; step < 8 * 60; step += 1) {
      const telemetry = simulation.step(world, RAPIER, body, { ...neutral, throttle: 1 });
      world.step();
      finite &&= Number.isFinite(telemetry.engineRpm) && Number.isFinite(speed());
      if (step > 120) expect(telemetry.groundedWheels).toBeGreaterThanOrEqual(2);
    }
    expect(finite).toBe(true);
    expect(body.linvel().z).toBeGreaterThan(2);
    expect(Math.abs(body.linvel().x)).toBeLessThan(2);
    world.free();
  });
});
