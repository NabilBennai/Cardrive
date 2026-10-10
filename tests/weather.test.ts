import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VehicleInput } from '../src/shared/types';
import { vehicleConfigFor } from '../src/vehicle/configs/vehicleProfiles';
import { VehicleSimulation } from '../src/vehicle/physics/VehicleSimulation';
import {
  vehicleColliderMassProperties, vehicleColliderOffsetY, vehicleSpawnHeightM,
  VEHICLE_COLLIDER_FRICTION, VEHICLE_COLLIDER_RESTITUTION, VEHICLE_FIXED_STEP_S,
} from '../src/vehicle/physics/vehicleBody';
import {
  aquaplaningGripFactor, aquaplaningSpeedMps, effectiveAmbientC, loadWeather, sanitizeWeather, saveWeather, stepWetness,
  waterDepthMm, wetGripFactor, DEFAULT_WEATHER,
} from '../src/world/weather/weatherModel';

const dt = VEHICLE_FIXED_STEP_S;
const neutral: VehicleInput = { throttle: 0, brake: 0, steering: 0, handbrake: 0 };

beforeAll(async () => { await RAPIER.init(); });

describe('modèle de météo', () => {
  it('la piste se mouille sous la pluie jusqu\'à un plafond, et sèche en environ trois minutes', () => {
    let w = 0;
    for (let t = 0; t < 600; t += 1) w = stepWetness(w, 'light', 1);
    expect(w).toBeCloseTo(0.55, 6);
    for (let t = 0; t < 600; t += 1) w = stepWetness(w, 'heavy', 1);
    expect(w).toBe(1);
    let seconds = 0;
    while (w > 0.01 && seconds < 1000) { w = stepWetness(w, 'dry', 1); seconds += 1; }
    expect(seconds).toBeGreaterThan(150);
    expect(seconds).toBeLessThan(200);
    // Sous pluie légère, une piste détrempée sèche vers le plafond de la pluie légère.
    expect(stepWetness(1, 'light', 10)).toBeLessThan(1);
    expect(stepWetness(0, 'dry', 10)).toBe(0);
  });

  it('une piste mouillée adhère moins, l\'herbe mouillée encore moins', () => {
    expect(wetGripFactor('asphalt', 0)).toBe(1);
    expect(wetGripFactor('asphalt', 1)).toBeCloseTo(0.62, 6);
    expect(wetGripFactor('grass', 1)).toBeLessThan(wetGripFactor('gravel', 1));
    expect(wetGripFactor('asphalt', 2)).toBe(wetGripFactor('asphalt', 1));
  });

  it('l\'aquaplanage apparaît plus tôt avec plus d\'eau et avec des pneus usés', () => {
    expect(aquaplaningSpeedMps(0.1, 0)).toBe(Number.POSITIVE_INFINITY);
    const light = aquaplaningSpeedMps(0.55, 0);
    const heavy = aquaplaningSpeedMps(1, 0);
    expect(heavy).toBeLessThan(light);
    expect(aquaplaningSpeedMps(1, 1)).toBeLessThan(heavy);
    expect(waterDepthMm(1)).toBeCloseTo(2, 6);
    expect(aquaplaningGripFactor(heavy - 1, 1, 0)).toBe(1);
    expect(aquaplaningGripFactor(heavy + 20, 1, 0)).toBeCloseTo(0.45, 6);
    expect(aquaplaningGripFactor(heavy + 4, 1, 0)).toBeGreaterThan(0.35);
    expect(aquaplaningGripFactor(heavy + 4, 1, 0)).toBeLessThan(1);
  });

  it('l\'eau refroidit la piste et les pneus', () => {
    expect(effectiveAmbientC(20, 0)).toBe(20);
    expect(effectiveAmbientC(20, 1)).toBe(14);
  });

  it('assainit et mémorise les réglages', () => {
    expect(sanitizeWeather(null)).toEqual(DEFAULT_WEATHER);
    expect(sanitizeWeather({ rain: 'snow', temperature: 'hot' })).toEqual({ rain: 'dry', temperature: 'hot' });
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
    saveWeather({ rain: 'heavy', temperature: 'cool' }, storage);
    expect(loadWeather(storage)).toEqual({ rain: 'heavy', temperature: 'cool' });
    data.set('cardrive.weather', 'pas du json');
    expect(loadWeather(storage)).toEqual(DEFAULT_WEATHER);
  });
});

function makeRig(speedMps: number) {
  const config = vehicleConfigFor(null);
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
  for (let i = 0; i < 120; i += 1) { simulation.step(world, RAPIER, body, neutral); world.step(); }
  body.setLinvel({ x: 0, y: 0, z: speedMps }, true);
  for (const pose of simulation.wheelPoses) pose.omegaRadPerS = speedMps / config.wheelRadiusM;
  return { config, world, body, simulation, speed: () => Math.hypot(body.linvel().x, body.linvel().z) };
}

function brakingDistance(wetness: number, speedMps: number): number {
  const { world, body, simulation, speed } = makeRig(speedMps);
  let distance = 0;
  let previousZ = body.translation().z;
  for (let step = 0; step < 30 * 60 && speed() > 0.3; step += 1) {
    simulation.setEnvironment(wetness, 20);
    simulation.step(world, RAPIER, body, { ...neutral, brake: 1 });
    world.step();
    distance += body.translation().z - previousZ;
    previousZ = body.translation().z;
  }
  world.free();
  return distance;
}

describe('pluie dans le solveur', () => {
  it('freine nettement plus loin sur piste mouillée, encore plus à haute vitesse (aquaplanage)', () => {
    const dry = brakingDistance(0, 27.8);
    const wet = brakingDistance(1, 27.8);
    expect(wet).toBeGreaterThan(dry * 1.3);
    // À 40 m/s l'eau profonde fait aquaplaner : le rapport s'aggrave par rapport à 28 m/s.
    const dryFast = brakingDistance(0, 40);
    const wetFast = brakingDistance(1, 40);
    expect(wetFast / dryFast).toBeGreaterThan(wet / dry);
  });

  it('une pluie légère coûte moins qu\'une forte pluie', () => {
    const light = brakingDistance(0.55, 27.8);
    const heavy = brakingDistance(1, 27.8);
    const dry = brakingDistance(0, 27.8);
    expect(light).toBeGreaterThan(dry);
    expect(light).toBeLessThan(heavy);
  });

  it('les pneus prennent la température de l\'air au départ, et l\'eau les refroidit', () => {
    const cold = makeRig(0);
    cold.simulation.setEnvironment(0, 8);
    expect(cold.simulation.wheelPoses.every((pose) => pose.temperatureC === 8)).toBe(true);
    cold.world.free();

    const soaked = makeRig(25);
    const dryRig = makeRig(25);
    soaked.simulation.setEnvironment(1, 20);
    dryRig.simulation.setEnvironment(0, 20);
    for (let i = 0; i < 90 * 60; i += 1) {
      soaked.simulation.step(soaked.world, RAPIER, soaked.body, { ...neutral, throttle: 0.12 });
      soaked.world.step();
      dryRig.simulation.step(dryRig.world, RAPIER, dryRig.body, { ...neutral, throttle: 0.12 });
      dryRig.world.step();
    }
    const mean = (rig: ReturnType<typeof makeRig>) => rig.simulation.wheelPoses.reduce((sum, pose) => sum + pose.temperatureC, 0) / 4;
    expect(mean(soaked)).toBeLessThan(mean(dryRig));
    soaked.world.free();
    dryRig.world.free();
  });
});
