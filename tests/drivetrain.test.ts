import RAPIER from '@dimforge/rapier3d-compat';
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SurfaceMaterial, VehicleConfig } from '../src/shared/types';
import { vehicleConfigFor } from '../src/vehicle/configs/vehicleProfiles';
import { VehicleSimulation, type TractionControl } from '../src/vehicle/physics/VehicleSimulation';
import {
  vehicleColliderMassProperties, vehicleColliderOffsetY, vehicleSpawnHeightM,
  VEHICLE_COLLIDER_FRICTION, VEHICLE_COLLIDER_RESTITUTION, VEHICLE_FIXED_STEP_S,
} from '../src/vehicle/physics/vehicleBody';

const dt = VEHICLE_FIXED_STEP_S;
const neutral = { throttle: 0, brake: 0, steering: 0, handbrake: 0 };

beforeAll(async () => { await RAPIER.init(); });

interface LaunchOptions {
  traction?: TractionControl;
  /** Surface sous les roues de gauche (x < 0) et de droite : permet un départ sur adhérence partagée. */
  left?: SurfaceMaterial;
  right?: SurfaceMaterial;
  targetSpeedMps: number;
}

/** Départ arrêté plein gaz en ligne droite : temps (s) pour atteindre la vitesse visée, et glissement maximal des roues motrices. */
function launch(config: VehicleConfig, options: LaunchOptions): { timeS: number; peakKappa: number; yawDrift: number } {
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
  simulation.setTractionControl(options.traction ?? 'off');
  const { left = 'asphalt', right = 'asphalt' } = options;
  simulation.setSurfaceProvider((xM) => (xM < 0 ? left : right));
  for (let i = 0; i < 180; i += 1) { simulation.step(world, RAPIER, body, neutral); world.step(); }
  let peakKappa = 0;
  let timeS = Number.POSITIVE_INFINITY;
  for (let step = 0; step < 40 * 60; step += 1) {
    simulation.step(world, RAPIER, body, { ...neutral, throttle: 1 });
    world.step();
    const v = body.linvel();
    const speed = Math.hypot(v.x, v.z);
    const driven = config.wheelMounts.map((wheel, index) => (wheel.driven ? simulation.wheelPoses[index].omegaRadPerS * config.wheelRadiusM : 0));
    const reference = Math.max(speed, 3);
    peakKappa = Math.max(peakKappa, ...driven.map((surfaceSpeed, index) => (config.wheelMounts[index].driven ? (surfaceSpeed - speed) / reference : 0)));
    if (speed >= options.targetSpeedMps) { timeS = (step + 1) * dt; break; }
  }
  const yaw = body.rotation();
  const yawDrift = Math.abs(2 * Math.atan2(yaw.y, yaw.w));
  world.free();
  return { timeS, peakKappa, yawDrift };
}

describe('contrôle de traction et différentiel', () => {
  const sports = vehicleConfigFor('sedan-sports');

  it('les aides complètes accélèrent mieux un départ arrêté de propulsion de 330 kW', () => {
    const none = launch(sports, { traction: 'off', targetSpeedMps: 27.8 });
    const medium = launch(sports, { traction: 'medium', targetSpeedMps: 27.8 });
    const full = launch(sports, { traction: 'full', targetSpeedMps: 27.8 });
    if (process.env.DRIVE_DEBUG) fs.writeFileSync(`${process.env.TEMP}/drive-debug.txt`, JSON.stringify({ none, medium, full }));
    expect(full.timeS).toBeLessThan(none.timeS);
    expect(full.peakKappa).toBeLessThan(none.peakKappa);
    expect(medium.timeS).toBeLessThan(none.timeS * 1.02);
  });

  it('le contrôle de traction ne gêne pas une voiture qui n\'a pas de problème d\'adhérence', () => {
    const small = vehicleConfigFor('sedan');
    const none = launch(small, { traction: 'off', targetSpeedMps: 27.8 });
    const full = launch(small, { traction: 'full', targetSpeedMps: 27.8 });
    expect(full.timeS).toBeLessThan(none.timeS * 1.1);
  });

  it('un différentiel à glissement limité repart mieux avec une roue sur l\'herbe', () => {
    const open: VehicleConfig = { ...sports, differentialLock: 0 };
    const limited: VehicleConfig = { ...sports, differentialLock: 0.8 };
    const options = { left: 'grass' as const, right: 'asphalt' as const, targetSpeedMps: 16 };
    const openRun = launch(open, options);
    const limitedRun = launch(limited, options);
    if (process.env.DRIVE_DEBUG) fs.appendFileSync(`${process.env.TEMP}/drive-debug.txt`, `\n${JSON.stringify({ openRun, limitedRun })}`);
    expect(limitedRun.timeS).toBeLessThan(openRun.timeS * 0.92);
  });

  it('les voitures de route ont un différentiel ouvert, les sportives un autobloquant', () => {
    expect(vehicleConfigFor('sedan').differentialLock).toBe(0);
    expect(vehicleConfigFor('sedan-sports').differentialLock).toBeGreaterThan(0);
    expect(vehicleConfigFor('race').differentialLock).toBeGreaterThan(0);
  });
});

describe('réglage des aides', () => {
  it('assainit et mémorise le contrôle de traction', async () => {
    const { sanitizeAssists, loadAssists, saveAssists, DEFAULT_ASSISTS } = await import('../src/vehicle/assists');
    expect(sanitizeAssists(null)).toEqual(DEFAULT_ASSISTS);
    expect(sanitizeAssists({ tractionControl: 'turbo' })).toEqual(DEFAULT_ASSISTS);
    expect(sanitizeAssists({ tractionControl: 'full' }).tractionControl).toBe('full');
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
    saveAssists({ tractionControl: 'off' }, storage);
    expect(loadAssists(storage).tractionControl).toBe('off');
    data.set('cardrive.assists', 'pas du json');
    expect(loadAssists(storage)).toEqual(DEFAULT_ASSISTS);
  });
});
