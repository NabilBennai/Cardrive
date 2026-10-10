import RAPIER from '@dimforge/rapier3d-compat';
import fs from 'node:fs';
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

function makeRig(carId: string) {
  const config = vehicleConfigFor(carId);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = dt;
  world.createCollider(RAPIER.ColliderDesc.cuboid(20000, 0.05, 20000).setTranslation(0, -0.05, 0));
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, vehicleSpawnHeightM(config), 0)
    .setLinearDamping(config.linearDamping).setAngularDamping(config.angularDamping).setCanSleep(false).setCcdEnabled(true));
  const mass = vehicleColliderMassProperties(config);
  world.createCollider(RAPIER.ColliderDesc.cuboid(config.dimensionsM.widthM / 2, config.dimensionsM.heightM / 2, config.dimensionsM.lengthM / 2)
    .setTranslation(0, vehicleColliderOffsetY(config), 0)
    .setMassProperties(mass.mass, mass.centerOfMass, mass.principalAngularInertia, mass.angularInertiaLocalFrame)
    .setFriction(VEHICLE_COLLIDER_FRICTION).setRestitution(VEHICLE_COLLIDER_RESTITUTION), body);
  const simulation = new VehicleSimulation(config);
  for (let i = 0; i < 120; i += 1) { simulation.step(world, RAPIER, body, neutral); world.step(); }
  return { config, world, body, simulation };
}

describe('stabilité à très haute vitesse', () => {
  it.each(['race', 'race-future'])('%s : accélération jusqu\'à la vitesse de pointe puis changements de cap, sans valeur aberrante', (id) => {
    const { world, body, simulation } = makeRig(id);
    let maxSpeed = 0; let maxHeight = 0; let minGrounded = 4; let maxAngular = 0; let finite = true; let maxTilt = 0;
    for (let step = 0; step < 60 * 60; step += 1) {
      const t = step / 60;
      // 40 s plein gaz en ligne droite, puis des changements de cap à pleine vitesse (± 15 % de braquage).
      const steering = t < 40 ? 0 : Math.sign(Math.sin((t - 40) * 1.2)) * 0.15;
      const telemetry = simulation.step(world, RAPIER, body, { throttle: 1, brake: 0, steering, handbrake: 0 });
      world.step();
      const v = body.linvel(); const w = body.angvel(); const p = body.translation(); const r = body.rotation();
      finite &&= [v.x, v.y, v.z, w.x, w.y, w.z, p.x, p.y, p.z].every(Number.isFinite);
      maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.z));
      maxHeight = Math.max(maxHeight, p.y);
      maxAngular = Math.max(maxAngular, Math.hypot(w.x, w.y, w.z));
      maxTilt = Math.max(maxTilt, 1 - (1 - 2 * (r.x * r.x + r.z * r.z)));
      if (step > 180) minGrounded = Math.min(minGrounded, telemetry.groundedWheels);
    }
    if (process.env.STAB_DEBUG) fs.appendFileSync(`${process.env.TEMP}/stab.txt`, `${id}: vmax ${(maxSpeed * 3.6).toFixed(0)} km/h, hauteur max ${maxHeight.toFixed(2)} m, roues au sol min ${minGrounded}, vitesse angulaire max ${maxAngular.toFixed(2)} rad/s, inclinaison max ${maxTilt.toFixed(3)}\n`);
    world.free();
    expect(finite).toBe(true);
    expect(maxSpeed * 3.6).toBeGreaterThan(280);
    expect(maxHeight).toBeLessThan(1.2);
    expect(minGrounded).toBeGreaterThanOrEqual(3);
    expect(maxAngular).toBeLessThan(6);
    expect(maxTilt).toBeLessThan(0.1);
  });
});

describe('voiture retournée', () => {
  it('détecte une voiture sur le toit ou sur le flanc après 2 s, pas une voiture à plat ni une voiture rapide', async () => {
    const { FlipDetector } = await import('../src/race/flipDetector');
    const run = (up: number, speed: number, seconds: number) => {
      const detector = new FlipDetector();
      let flipped = false;
      for (let t = 0; t < seconds; t += dt) flipped = detector.update(up, speed, dt);
      return flipped;
    };
    expect(run(-1, 0.2, 1.5)).toBe(false);
    expect(run(-1, 0.2, 2.5)).toBe(true);
    expect(run(0.1, 1, 2.5)).toBe(true);
    expect(run(1, 0, 10)).toBe(false);
    expect(run(-1, 20, 10)).toBe(false);
  });

  it('une voiture posée sur le toit dans le solveur est bien détectée comme retournée', async () => {
    const { FlipDetector } = await import('../src/race/flipDetector');
    const { uprightness } = await import('../src/race/bodyPose');
    const { world, body, simulation, config } = makeRig('sedan');
    body.setTranslation({ x: 0, y: vehicleSpawnHeightM(config) + 1.5, z: 0 }, true);
    body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); // demi-tour autour de l'axe longitudinal : sur le toit
    const detector = new FlipDetector();
    let flipped = false;
    for (let step = 0; step < 6 * 60; step += 1) {
      simulation.step(world, RAPIER, body, neutral);
      world.step();
      const v = body.linvel();
      flipped = detector.update(uprightness(body.rotation()), Math.hypot(v.x, v.y, v.z), dt);
    }
    expect(flipped).toBe(true);
    world.free();
  });
});
