import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VehicleConfig, VehicleInput } from '../src/shared/types';
import { vehicleConfigFor } from '../src/vehicle/configs/vehicleProfiles';
import { VehicleSimulation } from '../src/vehicle/physics/VehicleSimulation';
import {
  vehicleColliderMassProperties, vehicleColliderOffsetY, vehicleSpawnHeightM,
  VEHICLE_COLLIDER_FRICTION, VEHICLE_COLLIDER_RESTITUTION, VEHICLE_FIXED_STEP_S,
} from '../src/vehicle/physics/vehicleBody';
import { fuelBurnedKg, IDLE_FUEL_POWER_W, MAX_WEAR_GRIP_LOSS, wearGripFactor, wearIncrement } from '../src/vehicle/physics/wearModel';

const dt = VEHICLE_FIXED_STEP_S;
const neutral: VehicleInput = { throttle: 0, brake: 0, steering: 0, handbrake: 0 };

beforeAll(async () => { await RAPIER.init(); });

function makeRig(config: VehicleConfig, wear: boolean, speedMps = 0) {
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
  simulation.setWearEnabled(wear);
  for (let i = 0; i < 120; i += 1) { simulation.step(world, RAPIER, body, neutral); world.step(); }
  if (speedMps > 0) {
    body.setLinvel({ x: 0, y: 0, z: speedMps }, true);
    for (const pose of simulation.wheelPoses) pose.omegaRadPerS = speedMps / config.wheelRadiusM;
  }
  return {
    world, body, simulation, speed: () => Math.hypot(body.linvel().x, body.linvel().z),
    step: (input: VehicleInput) => { const telemetry = simulation.step(world, RAPIER, body, input); world.step(); return telemetry; },
  };
}

describe('modèle d\'usure et de consommation', () => {
  it('l\'adhérence baisse avec l\'usure, de façon bornée et progressive', () => {
    expect(wearGripFactor(0)).toBe(1);
    expect(wearGripFactor(1)).toBeCloseTo(1 - MAX_WEAR_GRIP_LOSS, 6);
    expect(wearGripFactor(0.25)).toBeGreaterThan(wearGripFactor(0.5));
    expect(wearGripFactor(2)).toBe(wearGripFactor(1));
    expect(wearGripFactor(-1)).toBe(1);
    // Progressif : la première moitié de la vie coûte moins que la seconde.
    expect(1 - wearGripFactor(0.5)).toBeLessThan((1 - wearGripFactor(1)) / 2);
  });

  it('l\'usure est proportionnelle à l\'énergie de frottement et majorée à chaud', () => {
    const cold = wearIncrement(10_000, 1, 80, 80, 50);
    expect(cold).toBeCloseTo(10_000 / 50e6, 12);
    expect(wearIncrement(20_000, 1, 80, 80, 50)).toBeCloseTo(2 * cold, 12);
    expect(wearIncrement(10_000, 1, 140, 80, 50)).toBeCloseTo(2 * cold, 12);
    expect(wearIncrement(0, 1, 80, 80, 50)).toBe(0);
  });

  it('le carburant brûlé suit la puissance, avec un plancher au ralenti', () => {
    expect(fuelBurnedKg(0, 3600)).toBeCloseTo(fuelBurnedKg(IDLE_FUEL_POWER_W, 3600), 9);
    expect(fuelBurnedKg(100_000, 3600)).toBeCloseTo(100 * 0.27, 6);
  });
});

describe('usure et carburant dans le solveur', () => {
  it('désactivés par défaut : ni usure, ni carburant brûlé, aucune donnée publiée', () => {
    const { world, step, simulation } = makeRig(vehicleConfigFor('sedan-sports'), false);
    let telemetry = step(neutral);
    for (let i = 0; i < 600; i += 1) telemetry = step({ ...neutral, throttle: 1, steering: 0.5 });
    expect(telemetry.tireWear).toBeUndefined();
    expect(simulation.fuelRemainingKg).toBe(simulation.config.fuelCapacityKg);
    expect(Math.max(...simulation.tireWear)).toBe(0);
    world.free();
  });

  it('activés : le carburant diminue et la masse de la voiture suit', () => {
    const config = vehicleConfigFor('sedan-sports');
    const { world, body, step, simulation } = makeRig(config, true);
    expect(body.mass()).toBeCloseTo(config.massKg, 0);
    let telemetry = step(neutral);
    for (let i = 0; i < 60 * 60; i += 1) telemetry = step({ ...neutral, throttle: 1, steering: Math.sin(i / 40) * 0.2 });
    const burned = config.fuelCapacityKg - simulation.fuelRemainingKg;
    expect(burned).toBeGreaterThan(1);
    expect(telemetry.fuelKg).toBeCloseTo(simulation.fuelRemainingKg, 6);
    expect(telemetry.tireWear).toHaveLength(4);
    expect(body.mass()).toBeCloseTo(config.massKg - burned, 0);
    expect(body.mass()).toBeLessThan(config.massKg - 1);
    world.free();
  });

  it('des pneus usés freinent moins bien, et « pneus neufs et plein » remet tout à neuf', () => {
    const config = vehicleConfigFor(null);
    const stop = (worn: number) => {
      const { world, body, step, simulation, speed } = makeRig(config, true, 27.8);
      simulation.wearTires(worn);
      let distance = 0;
      let previousZ = body.translation().z;
      for (let i = 0; i < 20 * 60 && speed() > 0.2; i += 1) {
        step({ ...neutral, brake: 1 });
        distance += body.translation().z - previousZ;
        previousZ = body.translation().z;
      }
      world.free();
      return distance;
    };
    const fresh = stop(0);
    const worn = stop(1);
    expect(worn).toBeGreaterThan(fresh * 1.15);

    const { world, body, step, simulation } = makeRig(config, true);
    simulation.wearTires(0.8);
    for (let i = 0; i < 20 * 60; i += 1) step({ ...neutral, throttle: 1 });
    expect(simulation.fuelRemainingKg).toBeLessThan(config.fuelCapacityKg);
    simulation.service();
    expect(Math.max(...simulation.tireWear)).toBe(0);
    expect(simulation.fuelRemainingKg).toBe(config.fuelCapacityKg);
    step(neutral);
    step(neutral);
    expect(body.mass()).toBeCloseTo(config.massKg, 0);
    world.free();
  });

  it('en panne sèche, le moteur ne fournit plus de couple', () => {
    const config: VehicleConfig = { ...vehicleConfigFor(null), fuelCapacityKg: 0.05 };
    const { world, step, simulation, speed } = makeRig(config, true);
    for (let i = 0; i < 30 * 60; i += 1) step({ ...neutral, throttle: 1 });
    expect(simulation.fuelRemainingKg).toBe(0);
    const before = speed();
    for (let i = 0; i < 10 * 60; i += 1) step({ ...neutral, throttle: 1 });
    expect(speed()).toBeLessThan(before - 1);
    world.free();
  });

  it('les voitures électriques n\'ont pas de carburant', () => {
    expect(vehicleConfigFor('race-future').fuelCapacityKg).toBe(0);
    expect(vehicleConfigFor('race').fuelCapacityKg).toBeGreaterThan(50);
  });
});
