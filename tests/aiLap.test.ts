import RAPIER from '@dimforge/rapier3d-compat';
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCircuitTrack, type CircuitTrack } from '../src/circuits/circuitGeometry';
import { buildCircuitLayout } from '../src/circuits/circuitMesh';
import { F1_CIRCUITS_2026 } from '../src/circuits/f1Circuits2026';
import { createCircuitSurface } from '../src/race/circuitSurface';
import { AiDriver, aiProfileFor, brakeDecelAt, buildSpeedPlan } from '../src/race/driverAi';
import { LapTimer, type LapTimerEvent } from '../src/race/lapTimer';
import { TrackProjector } from '../src/race/trackProjector';
import type { VehicleConfig } from '../src/shared/types';
import { vehicleConfigFor } from '../src/vehicle/configs/vehicleProfiles';
import { VehicleSimulation } from '../src/vehicle/physics/VehicleSimulation';
import {
  headingToQuaternion, vehicleColliderMassProperties, vehicleColliderOffsetY, vehicleSpawnHeightM,
  VEHICLE_COLLIDER_FRICTION, VEHICLE_COLLIDER_RESTITUTION, VEHICLE_FIXED_STEP_S,
} from '../src/vehicle/physics/vehicleBody';

const dt = VEHICLE_FIXED_STEP_S;

beforeAll(async () => { await RAPIER.init(); });

function circuit(id: string): CircuitTrack {
  const source = F1_CIRCUITS_2026.find((c) => c.id === id);
  if (!source) throw new Error(`circuit ${id} introuvable`);
  return buildCircuitTrack(source);
}

/** Circuit complet (sol, murs) et voiture réelle (même solveur que le jeu) ; le pilote automatique la conduit, le chronomètre mesure. */
function runLaps(track: CircuitTrack, config: VehicleConfig, laps: number, maxSimulatedS: number, skill = 1) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = dt;
  const layout = buildCircuitLayout(track);
  const [halfX, halfZ] = layout.ground.halfExtentM;
  world.createCollider(RAPIER.ColliderDesc.cuboid(halfX, 0.05, halfZ).setTranslation(layout.ground.centerM[0], -0.05, layout.ground.centerM[1]));
  if (layout.walls) world.createCollider(RAPIER.ColliderDesc.trimesh(layout.walls.collider.vertices, layout.walls.collider.indices));
  const { spawn } = track;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(spawn.xM, vehicleSpawnHeightM(config), spawn.zM).setRotation(headingToQuaternion(spawn.headingRad))
    .setLinearDamping(config.linearDamping).setAngularDamping(config.angularDamping).setCanSleep(false).setCcdEnabled(true));
  const mass = vehicleColliderMassProperties(config);
  world.createCollider(RAPIER.ColliderDesc.cuboid(config.dimensionsM.widthM / 2, config.dimensionsM.heightM / 2, config.dimensionsM.lengthM / 2)
    .setTranslation(0, vehicleColliderOffsetY(config), 0)
    .setMassProperties(mass.mass, mass.centerOfMass, mass.principalAngularInertia, mass.angularInertiaLocalFrame)
    .setFriction(VEHICLE_COLLIDER_FRICTION).setRestitution(VEHICLE_COLLIDER_RESTITUTION), body);
  const simulation = new VehicleSimulation(config);
  simulation.setSurfaceProvider(createCircuitSurface(track));
  const idle = { throttle: 0, brake: 0, steering: 0, handbrake: 0 };
  for (let i = 0; i < 120; i += 1) { simulation.step(world, RAPIER, body, idle); world.step(); }

  const driver = new AiDriver(track.centerline, track.lengthM, aiProfileFor(config, skill));
  const projector = new TrackProjector(track.centerline, track.lengthM);
  const timer = new LapTimer(track.lengthM, track.widthM);
  const events: LapTimerEvent[] = [];
  let hint: number | null = null;
  let maxLateral = 0;
  let maxSpeed = 0;
  let elapsed = 0;
  let lastSlip = 0;
  const trace: string[] = [];
  const done = () => events.filter((e) => e.type === 'lap').length >= laps;
  while (elapsed < maxSimulatedS && !done()) {
    const t = body.translation();
    const r = body.rotation();
    const v = body.linvel();
    const headingRad = Math.atan2(2 * (r.x * r.z + r.w * r.y), 1 - 2 * (r.x * r.x + r.y * r.y));
    const speedMps = Math.hypot(v.x, v.z);
    const input = driver.drive({ xM: t.x, zM: t.z, headingRad, speedMps, slip: lastSlip, dtS: dt });
    const telemetry = simulation.step(world, RAPIER, body, input);
    world.step();
    lastSlip = telemetry.slip;
    const after = body.translation();
    const projection = projector.project(after.x, after.z, hint);
    hint = projection.index;
    maxLateral = Math.max(maxLateral, Math.abs(projection.lateralM));
    maxSpeed = Math.max(maxSpeed, speedMps);
    events.push(...timer.step(dt, projection.sM, projection.lateralM));
    if (Math.floor(elapsed * 60) % (Number(process.env.AI_TRACE_STEP) || 240) === 0) trace.push(`${elapsed.toFixed(0)}s s=${projection.sM.toFixed(0)} v=${(speedMps * 3.6).toFixed(0)} lat=${projection.lateralM.toFixed(1)} steer=${input.steering.toFixed(2)} thr=${input.throttle.toFixed(2)} brk=${input.brake.toFixed(2)} tgt=${(driver.targetSpeedAt(projection.sM) * 3.6).toFixed(0)} slip=${telemetry.slip.toFixed(2)} wheel=${simulation.steeringRad.toFixed(2)} hd=${headingRad.toFixed(2)}`);
    elapsed += dt;
  }
  world.free();
  return { events, maxLateral, maxSpeed, elapsed, trace };
}

describe('plan de vitesse du pilote automatique', () => {
  it('ralentit avant un virage serré et reste dans des bornes raisonnables', () => {
    const track = circuit('mc-1929');
    const profile = aiProfileFor(vehicleConfigFor('sedan'));
    const plan = buildSpeedPlan(track.centerline, track.lengthM, profile);
    expect(plan).toHaveLength(track.centerline.length);
    expect(Math.min(...plan)).toBeGreaterThanOrEqual(6);
    expect(Math.max(...plan)).toBeLessThanOrEqual(100);
    // Cohérence du freinage : la vitesse ne peut pas chuter plus vite que la décélération disponible.
    const ds = track.lengthM / plan.length;
    for (let i = 0; i < plan.length; i += 1) {
      const next = plan[(i + 1) % plan.length];
      expect(plan[i] * plan[i]).toBeLessThanOrEqual(next * next + 2 * brakeDecelAt(profile, next) * ds + 1e-6);
    }
  });
});

describe('tour complet piloté, avec le vrai solveur', () => {
  it.each<[string, string | null, number]>([
    ['mc-1929', null, 2], // le prototype par défaut du jeu
    ['mc-1929', 'sedan-sports', 3],
    ['it-1922', 'sedan-sports', 2],
    ['sg-2008', 'sedan', 2],
    ['jp-1962', 'race', 2],
  ])('%s (%s) : enchaîne des tours valides, réguliers, sans sortir de la piste', (circuitId, carId, lapCount) => {
    const track = circuit(circuitId);
    const config = vehicleConfigFor(carId);
    const { events, maxLateral, maxSpeed, elapsed } = runLaps(track, config, lapCount, 900);
    const laps = events.filter((e): e is Extract<LapTimerEvent, { type: 'lap' }> => e.type === 'lap');
    const times = laps.map((l) => (l.valid ? l.lapS.toFixed(1) : `invalide(${l.reason})`));
    console.info(`${track.name} (${config.id}, ${(track.lengthM / 1000).toFixed(2)} km) : tours ${times.join(' · ')} ; vitesse max ${(maxSpeed * 3.6).toFixed(0)} km/h ; écart max ${maxLateral.toFixed(1)} m ; ${elapsed.toFixed(0)} s simulées`);
    if (process.env.AI_TRACE) fs.appendFileSync(`${process.env.TEMP}/ai-summary.txt`, `${track.name} (${config.id}) : ${times.join(' · ')} ; vmax ${(maxSpeed * 3.6).toFixed(0)} km/h ; écart max ${maxLateral.toFixed(1)} m
`);
    expect(laps.length).toBeGreaterThanOrEqual(lapCount);
    expect(laps.every((l) => l.valid)).toBe(true);
    const valid = laps.filter((l): l is Extract<LapTimerEvent, { type: 'lap'; valid: true }> => l.valid);
    // Vitesse moyenne plausible, et régularité : le dernier tour (voiture lancée) est proche du précédent.
    const average = track.lengthM / valid[valid.length - 1].lapS;
    expect(average).toBeGreaterThan(14);
    expect(average).toBeLessThan(100);
    if (valid.length >= 3) expect(Math.abs(valid[2].lapS - valid[1].lapS) / valid[1].lapS).toBeLessThan(0.04);
    // Reste sur la piste (vibreurs compris) : la voiture ne s'écarte jamais beaucoup plus que la demi-largeur.
    expect(maxLateral).toBeLessThan(track.widthM / 2 + 3);
  }, 180_000);
});

describe('niveau du pilote', () => {
  it('un pilote moins bon est plus lent, sans exagération', () => {
    const track = circuit('it-1922');
    const config = vehicleConfigFor('sedan-sports');
    const lapOf = (skill: number) => {
      const { events } = runLaps(track, config, 2, 600, skill);
      const laps = events.filter((e): e is Extract<LapTimerEvent, { type: 'lap'; valid: true }> => e.type === 'lap' && e.valid);
      expect(laps.length).toBeGreaterThanOrEqual(2);
      return laps[1].lapS;
    };
    const fast = lapOf(1);
    const slow = lapOf(0.1);
    if (process.env.AI_TRACE) fs.writeFileSync(`${process.env.TEMP}/skill.txt`, `fast ${fast.toFixed(1)} slow ${slow.toFixed(1)} ratio ${(slow / fast).toFixed(3)}`);
    expect(slow).toBeGreaterThan(fast * 1.04);
    expect(slow).toBeLessThan(fast * 1.5);
  }, 120_000);
});
