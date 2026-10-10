import RAPIER from '@dimforge/rapier3d-compat';
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCircuitTrack, type CircuitTrack } from '../src/circuits/circuitGeometry';
import { buildCircuitLayout } from '../src/circuits/circuitMesh';
import { F1_CIRCUITS_2026 } from '../src/circuits/f1Circuits2026';
import { createCircuitSurface } from '../src/race/circuitSurface';
import { AiDriver, aiProfileFor } from '../src/race/driverAi';
import { RaceTracker } from '../src/race/raceModel';
import { buildRaceField } from '../src/race/raceSetup';
import { StuckDetector } from '../src/race/stuckDetector';
import { centerlinePoseAt } from '../src/race/trackPose';
import { TrackProjector } from '../src/race/trackProjector';
import { vehicleConfigFor } from '../src/vehicle/configs/vehicleProfiles';
import { VehicleSimulation } from '../src/vehicle/physics/VehicleSimulation';
import {
  headingToQuaternion, vehicleColliderMassProperties, vehicleColliderOffsetY, vehicleSpawnHeightM,
  VEHICLE_COLLIDER_FRICTION, VEHICLE_COLLIDER_RESTITUTION, VEHICLE_FIXED_STEP_S,
} from '../src/vehicle/physics/vehicleBody';

const dt = VEHICLE_FIXED_STEP_S;
const HOLD = { throttle: 0, brake: 0, steering: 0, handbrake: 1 };

beforeAll(async () => { await RAPIER.init(); });

function withSurface(simulation: VehicleSimulation, track: CircuitTrack): VehicleSimulation {
  simulation.setSurfaceProvider(createCircuitSurface(track));
  return simulation;
}

function circuit(id: string): CircuitTrack {
  const source = F1_CIRCUITS_2026.find((c) => c.id === id);
  if (!source) throw new Error(`circuit ${id} introuvable`);
  return buildCircuitTrack(source);
}

/** Une vraie course : tous les concurrents sont des voitures du même modèle, conduites par le pilote automatique, avec collisions. */
function simulateRace(circuitId: string, carId: string, rivals: number, laps: number, difficulty: 'easy' | 'normal' | 'hard', maxRaceS: number) {
  const track = circuit(circuitId);
  const config = vehicleConfigFor(carId);
  const field = buildRaceField({ mode: 'race', laps, rivals, difficulty }, track);
  // Ici le « joueur » est un pilote automatique de niveau moyen, au fond de la grille.
  const entries = [...field.opponents.map((o) => ({ id: o.id, slot: o.slot, skill: o.skill })), { id: 'player', slot: field.playerSlot, skill: 0.5 }];

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = dt;
  const layout = buildCircuitLayout(track);
  const [halfX, halfZ] = layout.ground.halfExtentM;
  world.createCollider(RAPIER.ColliderDesc.cuboid(halfX, 0.05, halfZ).setTranslation(layout.ground.centerM[0], -0.05, layout.ground.centerM[1]));
  if (layout.walls) world.createCollider(RAPIER.ColliderDesc.trimesh(layout.walls.collider.vertices, layout.walls.collider.indices));
  const mass = vehicleColliderMassProperties(config);

  const cars = entries.map((entry) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(entry.slot.xM, vehicleSpawnHeightM(config), entry.slot.zM).setRotation(headingToQuaternion(entry.slot.headingRad))
      .setLinearDamping(config.linearDamping).setAngularDamping(config.angularDamping).setCanSleep(false).setCcdEnabled(true));
    world.createCollider(RAPIER.ColliderDesc.cuboid(config.dimensionsM.widthM / 2, config.dimensionsM.heightM / 2, config.dimensionsM.lengthM / 2)
      .setTranslation(0, vehicleColliderOffsetY(config), 0)
      .setMassProperties(mass.mass, mass.centerOfMass, mass.principalAngularInertia, mass.angularInertiaLocalFrame)
      .setFriction(VEHICLE_COLLIDER_FRICTION).setRestitution(VEHICLE_COLLIDER_RESTITUTION), body);
    return {
      id: entry.id, body, simulation: withSurface(new VehicleSimulation(config), track), slip: 0, stuck: new StuckDetector(), respawns: 0,
      driver: new AiDriver(track.centerline, track.lengthM, aiProfileFor(config, entry.skill)),
    };
  });
  const idle = { throttle: 0, brake: 0, steering: 0, handbrake: 0 };
  for (let i = 0; i < 120; i += 1) { for (const car of cars) car.simulation.step(world, RAPIER, car.body, idle); world.step(); }

  const projector = new TrackProjector(track.centerline, track.lengthM);
  const hints = new Map<string, number | null>();
  const tracker = new RaceTracker(track.lengthM, laps);
  cars.forEach((car) => tracker.addCar(car.id));
  let elapsed = 0;
  const allFinished = () => cars.every((car) => tracker.progressOf(car.id)!.finishS !== null);
  while (elapsed < RaceTracker.countdownS + maxRaceS && !allFinished()) {
    const racing = tracker.currentPhase === 'racing';
    for (const car of cars) {
      const t = car.body.translation();
      const v = car.body.linvel();
      const r = car.body.rotation();
      const speedMps = Math.hypot(v.x, v.z);
      const input = racing
        ? car.driver.drive({ xM: t.x, zM: t.z, headingRad: Math.atan2(2 * (r.x * r.z + r.w * r.y), 1 - 2 * (r.x * r.x + r.y * r.y)), speedMps, slip: car.slip, dtS: dt })
        : HOLD;
      car.slip = car.simulation.step(world, RAPIER, car.body, input).slip;
      if (racing && car.stuck.update(speedMps, dt)) {
        const pose = centerlinePoseAt(track, projector.project(t.x, t.z, null).sM);
        car.body.setTranslation({ x: pose.xM, y: vehicleSpawnHeightM(config), z: pose.zM }, true);
        car.body.setRotation(headingToQuaternion(pose.headingRad), true);
        car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        car.simulation.reset();
        car.driver.reset();
        car.respawns += 1;
        if (process.env.RACE_DEBUG) console.info(`remise en piste ${car.id} à s=${pose.xM.toFixed(0)},${pose.zM.toFixed(0)} t=${elapsed.toFixed(0)}`);
      }
    }
    world.step();
    tracker.tick(dt);
    if (process.env.RACE_DEBUG && Math.abs(elapsed - 2) < dt / 2) {
      const summary = cars.map((c) => { const p = c.body.translation(); const v = c.body.linvel(); return `${c.id} (${p.x.toFixed(1)},${p.z.toFixed(1)}) v=${Math.hypot(v.x, v.z).toFixed(2)}`; });
      console.info(`t=2s: ${summary.join(' ')}`);
    }
    for (const car of cars) {
      const p = car.body.translation();
      const projection = projector.project(p.x, p.z, hints.get(car.id) ?? null);
      hints.set(car.id, projection.index);
      tracker.update(car.id, projection.sM, p.x, p.z);
    }
    elapsed += dt;
  }
  const result = { standings: tracker.standings(), respawns: Object.fromEntries(cars.map((c) => [c.id, c.respawns])), elapsed, track, skills: Object.fromEntries(entries.map((e) => [e.id, e.skill])) };
  world.free();
  return result;
}

describe('course complète simulée avec le vrai solveur', () => {
  it('Monaco, 6 voitures, 2 tours : tout le monde termine, sans faux départ, et les plus rapides gagnent', () => {
    const { standings, respawns, elapsed, skills } = simulateRace('mc-1929', 'sedan-sports', 5, 2, 'hard', 500);
    const line = standings.map((s) => `${s.position}. ${s.id}${s.finishS === null ? ' (non arrivé)' : ` ${s.finishS.toFixed(1)} s`} niveau ${skills[s.id].toFixed(2)}`).join(' | ');
    if (process.env.RACE_DEBUG) fs.writeFileSync(`${process.env.TEMP}/race-sim.txt`, `${line} ; ${elapsed.toFixed(0)} s ; remises ${JSON.stringify(respawns)}`);
    console.info(`Course Monaco : ${line} ; ${elapsed.toFixed(0)} s simulées ; remises en piste ${JSON.stringify(respawns)}`);
    expect(standings.every((s) => s.finishS !== null)).toBe(true);
    if (process.env.RACE_DEBUG) console.info(JSON.stringify(standings.map((x) => [x.id, x.falseStart])));
    expect(standings.every((s) => !s.falseStart)).toBe(true);
    // Les temps sont triés (classement cohérent) et raisonnables : deux tours de Monaco en voiture de sport.
    const times = standings.map((s) => s.finishS!);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times[0]).toBeGreaterThan(200);
    expect(times[0]).toBeLessThan(450);
    // Le vainqueur est l'un des meilleurs niveaux (les collisions et le trafic peuvent brouiller l'ordre exact).
    const ranked = Object.entries(skills).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    expect(ranked.slice(0, 3)).toContain(standings[0].id);
    // Le joueur (niveau moyen, fond de grille) ne finit pas devant tout le monde.
    expect(standings[0].id).not.toBe('player');
  }, 300_000);
});
