// Diagnostic du modèle de pneu : séries temporelles dans le même solveur et le même Rapier que le jeu.
// Usage : node --experimental-strip-types scripts/tire-diagnostics.mjs [identifiantDuCatalogue]
import RAPIER from '@dimforge/rapier3d-compat';
import { vehicleConfigFor } from '../src/vehicle/configs/vehicleProfiles.ts';
import { VehicleSimulation } from '../src/vehicle/physics/VehicleSimulation.ts';
import {
  vehicleColliderMassProperties, vehicleColliderOffsetY, vehicleSpawnHeightM,
  VEHICLE_COLLIDER_FRICTION, VEHICLE_COLLIDER_RESTITUTION, VEHICLE_FIXED_STEP_S,
} from '../src/vehicle/physics/vehicleBody.ts';

await RAPIER.init();
const dt = VEHICLE_FIXED_STEP_S;
const id = process.argv[2] && process.argv[2] !== 'prototype' ? process.argv[2] : null;
const config = vehicleConfigFor(id);
const neutral = { throttle: 0, brake: 0, steering: 0, handbrake: 0 };

function makeRig() {
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
  return { world, body, simulation };
}

function series(title, seconds, every, input, speedMps = 0) {
  const { world, body, simulation } = makeRig();
  body.setLinvel({ x: 0, y: 0, z: speedMps }, true);
  console.log(`\n=== ${title} (${config.displayName}) ===`);
  console.log('t(s)  km/h  gear  rpm   slipMax  Tsurf(°C) per wheel          Tcarcasse(°C)   ωR−v (m/s) driven');
  const total = Math.round(seconds / dt);
  const every_ = Math.round(every / dt);
  for (let step = 0; step < total; step += 1) {
    const t = step * dt;
    const telemetry = simulation.step(world, RAPIER, body, input(t, body));
    world.step();
    if (step % every_ === 0) {
      const v = body.linvel(); const speed = Math.hypot(v.x, v.z);
      const driven = simulation.wheelPoses.filter((_, i) => config.wheelMounts[i].driven).map((p) => (p.omegaRadPerS * config.wheelRadiusM - speed).toFixed(2));
      console.log(`${t.toFixed(1).padStart(4)}  ${(speed * 3.6).toFixed(0).padStart(4)}  ${String(telemetry.gear).padStart(3)}  ${telemetry.engineRpm.toFixed(0).padStart(5)}  ${telemetry.slip.toFixed(2).padStart(6)}   ${simulation.wheelPoses.map((p) => p.temperatureC.toFixed(0).padStart(3)).join(' ')}   ${simulation.wheelPoses.map((p) => p.carcassTemperatureC.toFixed(0).padStart(3)).join(' ')}      ${driven.join(' ')}`);
    }
  }
  world.free();
}

if (process.env.ACCEL) {
  const { world, body, simulation } = makeRig();
  let t100 = null; let t60 = null;
  for (let step = 0; step < 60 * 40; step += 1) {
    simulation.step(world, RAPIER, body, { ...neutral, throttle: 1 });
    world.step();
    const v = Math.hypot(body.linvel().x, body.linvel().z) * 3.6;
    if (t60 === null && v >= 60) t60 = step * dt;
    if (t100 === null && v >= 100) t100 = step * dt;
  }
  console.log(`0-60: ${t60?.toFixed(1)} s, 0-100: ${t100?.toFixed(1)} s`);
  process.exit(0);
}
if (process.env.WHEELS) {
  const { world, body, simulation } = makeRig();
  for (let step = 0; step < 60 * 4; step += 1) {
    globalThis.__DBG = step >= 90 && step < 96;
    simulation.step(world, RAPIER, body, { ...neutral, throttle: Number(process.env.WHEELS) });
    world.step();
    if (step % 30 === 0) {
      const v = body.linvel();
      console.log(`t=${(step * dt).toFixed(1)} v=(${v.x.toFixed(2)},${v.z.toFixed(2)}) rpm=${simulation.rpm.toFixed(0)} omega*R=` + simulation.wheelPoses.map((p) => (p.omegaRadPerS * config.wheelRadiusM).toFixed(2)).join(' '));
    }
  }
  process.exit(0);
}
series('Départ arrêté, plein gaz', 12, 1, () => ({ ...neutral, throttle: 1 }));
series('Départ arrêté, 50 % gaz', 8, 1, () => ({ ...neutral, throttle: 0.5 }));
series('Virage soutenu à 50 km/h (braquage 0,5)', 40, 4, (_t, body) => ({ ...neutral, throttle: Math.hypot(body.linvel().x, body.linvel().z) < 13.9 ? 0.5 : 0.15, steering: 0.5 }), 13.9);
series('Freinage 100 -> 0', 6, 1, (_t, body) => ({ ...neutral, brake: body.linvel().z > 0.15 ? 1 : 0 }), 27.8);
