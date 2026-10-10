import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VehicleInput } from '../src/shared/types';
import { vehicleConfigFor } from '../src/vehicle/configs/vehicleProfiles';
import { VehicleSimulation } from '../src/vehicle/physics/VehicleSimulation';
import {
  vehicleColliderMassProperties, vehicleColliderOffsetY, vehicleSpawnHeightM,
  VEHICLE_COLLIDER_FRICTION, VEHICLE_COLLIDER_RESTITUTION, VEHICLE_FIXED_STEP_S,
} from '../src/vehicle/physics/vehicleBody';

const dt = VEHICLE_FIXED_STEP_S;
const neutral: VehicleInput = { throttle: 0, brake: 0, steering: 0, handbrake: 0 };

beforeAll(async () => { await RAPIER.init(); });

function makeRig(carId: string | null, transmission: 'auto' | 'manual', speedMps = 0) {
  const config = vehicleConfigFor(carId);
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
  simulation.setTransmission(transmission);
  for (let i = 0; i < 120; i += 1) { simulation.step(world, RAPIER, body, neutral); world.step(); }
  if (speedMps > 0) {
    body.setLinvel({ x: 0, y: 0, z: speedMps }, true);
    for (const pose of simulation.wheelPoses) pose.omegaRadPerS = speedMps / config.wheelRadiusM;
  }
  const step = (input: VehicleInput) => { const telemetry = simulation.step(world, RAPIER, body, input); world.step(); return telemetry; };
  return { config, world, body, simulation, step, speed: () => Math.hypot(body.linvel().x, body.linvel().z) };
}

describe('boîte manuelle', () => {
  it('ne change jamais de rapport toute seule : plein gaz, on reste en première et on tape dans le limiteur', () => {
    const { world, step, speed, config } = makeRig(null, 'manual');
    let last = step(neutral);
    for (let i = 0; i < 12 * 60; i += 1) last = step({ ...neutral, throttle: 1 });
    expect(last.gear).toBe(1);
    expect(last.engineRpm).toBeGreaterThan(config.upshiftRpm);
    expect(speed()).toBeLessThan(35);
    world.free();
  });

  it('en automatique, la même voiture monte les rapports', () => {
    const { world, step } = makeRig(null, 'auto');
    let last = step(neutral);
    for (let i = 0; i < 12 * 60; i += 1) last = step({ ...neutral, throttle: 1 });
    expect(last.gear).toBeGreaterThan(2);
    world.free();
  });

  it('un appui = un rapport, avec coupure de couple pendant le passage', () => {
    const { world, step, config } = makeRig(null, 'manual');
    for (let i = 0; i < 90; i += 1) step({ ...neutral, throttle: 1 });
    expect(step({ ...neutral, throttle: 1 }).gear).toBe(1);
    const afterPress = step({ ...neutral, throttle: 1, shiftUp: true });
    expect(afterPress.gear).toBe(2);
    // Touche maintenue : pas de second changement.
    for (let i = 0; i < 30; i += 1) expect(step({ ...neutral, throttle: 1, shiftUp: true }).gear).toBe(2);
    // Relâchée puis enfoncée de nouveau : rapport suivant (une fois le passage précédent terminé).
    for (let i = 0; i < Math.ceil(config.shiftDurationS / dt) + 2; i += 1) step({ ...neutral, throttle: 1 });
    expect(step({ ...neutral, throttle: 1, shiftUp: true }).gear).toBe(3);
    world.free();
  });

  it('refuse une rétrogradation qui emballerait le moteur, et la permet à vitesse raisonnable', () => {
    const fast = makeRig(null, 'manual', 45);
    const shiftTo = (target: number) => {
      for (let guard = 0; guard < 12 && fast.simulation.gear !== target; guard += 1) {
        const up = fast.simulation.gear < target;
        for (let i = 0; i < 4; i += 1) fast.step({ ...neutral, throttle: 0.3, shiftUp: up, shiftDown: !up });
        for (let i = 0; i < 25; i += 1) fast.step({ ...neutral, throttle: 0.3 });
      }
    };
    shiftTo(fast.config.gearRatios.length);
    expect(fast.simulation.gear).toBe(fast.config.gearRatios.length);
    shiftTo(1); // à 45 m/s, la descente jusqu'en première est impossible
    const stoppedAt = fast.simulation.gear;
    const last = fast.step({ ...neutral, throttle: 0.2 });
    expect(stoppedAt).toBeGreaterThan(1);
    expect(last.engineRpm).toBeLessThan(fast.config.maximumRpm * 1.1);
    fast.world.free();
    // À faible vitesse (12 m/s), la même demande aboutit.
    const slow = makeRig(null, 'manual', 12);
    for (let i = 0; i < 4; i += 1) slow.step({ ...neutral, throttle: 0.2, shiftUp: true });
    for (let i = 0; i < 25; i += 1) slow.step({ ...neutral, throttle: 0.2 });
    const before = slow.simulation.gear;
    for (let i = 0; i < 4; i += 1) slow.step({ ...neutral, throttle: 0.2, shiftDown: true });
    expect(slow.simulation.gear).toBe(before - 1);
    slow.world.free();
  });

  it('cale si on démarre sous charge en troisième, puis redémarre accélérateur relâché', () => {
    const { world, step, config } = makeRig(null, 'manual');
    // Deux montées à l'arrêt : on se retrouve en 3e.
    for (let press = 0; press < 2; press += 1) {
      step({ ...neutral, shiftUp: true });
      for (let i = 0; i < Math.ceil(config.shiftDurationS / dt) + 2; i += 1) step(neutral);
    }
    expect(step(neutral).gear).toBe(3);
    let telemetry = step(neutral);
    for (let i = 0; i < 60; i += 1) telemetry = step({ ...neutral, throttle: 1 });
    expect(telemetry.stalled).toBe(true);
    expect(telemetry.engineRpm).toBeLessThan(config.idleRpm * 0.6);
    // Accélérateur maintenu : pas de redémarrage.
    for (let i = 0; i < 120; i += 1) telemetry = step({ ...neutral, throttle: 1 });
    expect(telemetry.stalled).toBe(true);
    // Relâché : redémarre en première après la temporisation.
    for (let i = 0; i < 90; i += 1) telemetry = step(neutral);
    expect(telemetry.stalled).toBe(false);
    expect(telemetry.gear).toBe(1);
    world.free();
  });

  it('conseille de monter près du régime de passage et de rétrograder à bas régime', () => {
    const { world, step } = makeRig(null, 'manual');
    let sawUp = false;
    for (let i = 0; i < 6 * 60; i += 1) if (step({ ...neutral, throttle: 1 }).advisedShift === 1) sawUp = true;
    expect(sawUp).toBe(true);
    world.free();
    const slow = makeRig(null, 'manual', 3);
    for (let i = 0; i < 10; i += 1) slow.step({ ...neutral, shiftUp: i === 0 });
    for (let i = 0; i < 30; i += 1) slow.step(neutral);
    const t = slow.step(neutral);
    expect(t.gear).toBeGreaterThan(1);
    expect(t.advisedShift).toBe(-1);
    slow.world.free();
  });

  it('la boîte automatique ne publie ni conseil ni calage', () => {
    const { world, step } = makeRig(null, 'auto');
    const t = step(neutral);
    expect(t.advisedShift).toBeUndefined();
    expect(t.stalled).toBeUndefined();
    world.free();
  });
});
