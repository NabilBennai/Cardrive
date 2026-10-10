import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCircuitTrack } from '../src/circuits/circuitGeometry';
import { F1_CIRCUITS_2026 } from '../src/circuits/f1Circuits2026';
import { circuitSurfaceAtOffset, createCircuitSurface, GRAVEL_WIDTH_M, KERB_WIDTH_M } from '../src/race/circuitSurface';
import { centerlinePoseAt } from '../src/race/trackPose';
import type { SurfaceMaterial, VehicleConfig } from '../src/shared/types';
import { vehicleConfigFor } from '../src/vehicle/configs/vehicleProfiles';
import { SURFACES } from '../src/vehicle/physics/surfaces';
import { VehicleSimulation } from '../src/vehicle/physics/VehicleSimulation';
import {
  vehicleColliderMassProperties, vehicleColliderOffsetY, vehicleSpawnHeightM,
  VEHICLE_COLLIDER_FRICTION, VEHICLE_COLLIDER_RESTITUTION, VEHICLE_FIXED_STEP_S,
} from '../src/vehicle/physics/vehicleBody';

const dt = VEHICLE_FIXED_STEP_S;
const neutral = { throttle: 0, brake: 0, steering: 0, handbrake: 0 };

beforeAll(async () => { await RAPIER.init(); });

function makeRig(config: VehicleConfig, surface: SurfaceMaterial, speedMps: number) {
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
  simulation.setSurfaceProvider(() => surface);
  for (let i = 0; i < 180; i += 1) { simulation.step(world, RAPIER, body, neutral); world.step(); }
  body.setLinvel({ x: 0, y: 0, z: speedMps }, true);
  for (const pose of simulation.wheelPoses) pose.omegaRadPerS = speedMps / config.wheelRadiusM;
  return { world, body, simulation, speed: () => Math.hypot(body.linvel().x, body.linvel().z) };
}

function brakingDistance(surface: SurfaceMaterial): number {
  const config = vehicleConfigFor(null);
  const { world, body, simulation, speed } = makeRig(config, surface, 27.8);
  let distance = 0;
  let previousZ = body.translation().z;
  for (let step = 0; step < 20 * 60 && speed() > 0.2; step += 1) {
    simulation.step(world, RAPIER, body, { ...neutral, brake: 1 });
    world.step();
    distance += body.translation().z - previousZ;
    previousZ = body.translation().z;
  }
  world.free();
  return distance;
}

describe('surfaces', () => {
  it('l\'herbe et le gravier adhèrent moins et freinent plus la voiture que l\'asphalte', () => {
    expect(SURFACES.grass.gripFactor).toBeLessThan(SURFACES.asphalt.gripFactor);
    expect(SURFACES.gravel.rollingFactor).toBeGreaterThan(1);
    expect(SURFACES.grass.loose && SURFACES.gravel.loose && !SURFACES.asphalt.loose).toBe(true);
  });

  it('freine sur l\'herbe au moins 1,5 fois plus loin que sur l\'asphalte, et plus loin encore sur le gravier', () => {
    const asphalt = brakingDistance('asphalt');
    const grass = brakingDistance('grass');
    const gravel = brakingDistance('gravel');
    expect(grass).toBeGreaterThan(asphalt * 1.5);
    expect(gravel).toBeGreaterThan(asphalt * 1.5);
  });

  it('une voiture lancée à 100 km/h sur l\'herbe en roue libre perd de la vitesse bien plus vite que sur l\'asphalte', () => {
    const coast = (surface: SurfaceMaterial) => {
      const { world, body, simulation, speed } = makeRig(vehicleConfigFor(null), surface, 27.8);
      for (let step = 0; step < 5 * 60; step += 1) { simulation.step(world, RAPIER, body, neutral); world.step(); }
      const remaining = speed();
      world.free();
      return remaining;
    };
    expect(coast('grass')).toBeLessThan(coast('asphalt') - 1);
  });

  it('expose la surface sous chaque roue', () => {
    const { world, body, simulation } = makeRig(vehicleConfigFor(null), 'gravel', 10);
    for (let step = 0; step < 30; step += 1) { simulation.step(world, RAPIER, body, neutral); world.step(); }
    expect(simulation.wheelPoses.every((pose) => pose.surface === 'gravel')).toBe(true);
    world.free();
  });
});

describe('surfaces d\'un circuit', () => {
  it('découpe en piste et vibreurs, gravier, puis herbe', () => {
    const width = 12;
    expect(circuitSurfaceAtOffset(0, width)).toBe('asphalt');
    expect(circuitSurfaceAtOffset(width / 2 + KERB_WIDTH_M - 0.1, width)).toBe('asphalt');
    expect(circuitSurfaceAtOffset(width / 2 + KERB_WIDTH_M + 1, width)).toBe('gravel');
    expect(circuitSurfaceAtOffset(-(width / 2 + KERB_WIDTH_M + 1), width)).toBe('gravel');
    expect(circuitSurfaceAtOffset(width / 2 + KERB_WIDTH_M + GRAVEL_WIDTH_M + 1, width)).toBe('grass');
  });

  it('retrouve la surface par position sur un vrai circuit, roue par roue', () => {
    const track = buildCircuitTrack(F1_CIRCUITS_2026.find((c) => c.id === 'it-1922')!);
    const surfaceAt = createCircuitSurface(track);
    const half = track.widthM / 2;
    for (const s of [100, 900, 2500]) {
      expect(surfaceAt(...at(track, s, 0), 0)).toBe('asphalt');
      expect(surfaceAt(...at(track, s, half + KERB_WIDTH_M + 3), 1)).toBe('gravel');
      expect(surfaceAt(...at(track, s, -(half + KERB_WIDTH_M + GRAVEL_WIDTH_M + 5)), 2)).toBe('grass');
    }
  });
});

function at(track: ReturnType<typeof buildCircuitTrack>, sM: number, lateralM: number): [number, number] {
  const pose = centerlinePoseAt(track, sM, lateralM);
  return [pose.xM, pose.zM];
}
