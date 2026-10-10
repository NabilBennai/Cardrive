// Mesure, dans le même solveur et le même Rapier que le jeu, les performances de chaque véhicule
// du catalogue : 0-100 km/h, vitesse de pointe, freinage 100 -> 0, adhérence latérale en virage
// stabilisé et roulis maximal. Usage : npm run measure-catalog
import RAPIER from '@dimforge/rapier3d-compat';
import { vehicleConfigFor, PROFILE_IDS } from '../src/vehicle/configs/vehicleProfiles.ts';
import { VehicleSimulation } from '../src/vehicle/physics/VehicleSimulation.ts';
import {
  vehicleColliderMassProperties, vehicleColliderOffsetY, vehicleSpawnHeightM,
  VEHICLE_COLLIDER_FRICTION, VEHICLE_COLLIDER_RESTITUTION, VEHICLE_FIXED_STEP_S,
} from '../src/vehicle/physics/vehicleBody.ts';

await RAPIER.init();
const dt = VEHICLE_FIXED_STEP_S;
const neutral = { throttle: 0, brake: 0, steering: 0, handbrake: 0 };

function run(config, { seconds, speedMps = 0, input, onStep }) {
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
  const restHeight = body.translation().y;
  body.setLinvel({ x: 0, y: 0, z: speedMps }, true);
  let telemetry;
  const total = Math.round(seconds / dt);
  for (let step = 0; step < total; step += 1) {
    const t = step * dt;
    telemetry = simulation.step(world, RAPIER, body, input(t, body));
    world.step();
    if (onStep(t, body, telemetry) === 'stop') break;
  }
  world.free();
  return { restHeight, telemetry };
}

const speedOf = (body) => Math.hypot(body.linvel().x, body.linvel().z);
const rollDeg = (body) => {
  const q = body.rotation();
  return Math.abs(Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.x ** 2 + q.z ** 2))) * 180 / Math.PI;
};

function measure(id) {
  const config = vehicleConfigFor(id);

  let zeroTo100 = null; let zeroTo60 = null; let top = 0; let maxRollAccel = 0;
  const accel = run(config, {
    seconds: 70, input: () => ({ ...neutral, throttle: 1 }),
    onStep: (t, body) => {
      const v = speedOf(body); top = Math.max(top, v); maxRollAccel = Math.max(maxRollAccel, rollDeg(body));
      if (zeroTo60 === null && v >= 60 / 3.6) zeroTo60 = t;
      if (zeroTo100 === null && v >= 100 / 3.6) zeroTo100 = t;
    },
  });

  let stopDistance = null; let path = 0; let prev = { x: 0, z: 0 }; let stopFrom = 100 / 3.6;
  if (top < stopFrom) stopFrom = top * 0.9;
  run(config, {
    seconds: 40, speedMps: stopFrom, input: (_t, body) => ({ ...neutral, brake: body.linvel().z > 0.15 ? 1 : 0 }),
    onStep: (t, body) => {
      const p = body.translation();
      path += Math.hypot(p.x - prev.x, p.z - prev.z); prev = { x: p.x, z: p.z };
      if (stopDistance === null && speedOf(body) < 0.15) { stopDistance = path; return 'stop'; }
    },
  });

  // Virage stabilisé : on force un braquage et on garde une vitesse constante, puis on mesure l'accélération latérale.
  let lateralG = 0; let maxRollCorner = 0;
  const cornerSpeed = Math.min(22, top * 0.7);
  run(config, {
    seconds: 14, speedMps: cornerSpeed,
    input: (_t, body) => ({ ...neutral, throttle: speedOf(body) < cornerSpeed ? 0.6 : 0.12, steering: 0.5 }),
    onStep: (t, body) => {
      maxRollCorner = Math.max(maxRollCorner, rollDeg(body));
      if (t > 8) { const v = body.linvel(); const w = body.angvel(); lateralG = Math.max(lateralG, Math.abs(Math.hypot(v.x, v.z) * w.y) / 9.81); }
    },
  });

  return {
    id, kg: config.massKg, kW: Math.round(config.torqueCurve.reduce((m, p) => Math.max(m, p.torqueNm * p.rpm * 2 * Math.PI / 60), 0) / 1000),
    drive: config.wheelMounts.filter((w) => w.driven).length === 4 ? 'awd' : config.wheelMounts.find((w) => w.driven).front ? 'fwd' : 'rwd',
    'rest y': +accel.restHeight.toFixed(2),
    '0-60 s': zeroTo60 === null ? '-' : +zeroTo60.toFixed(1),
    '0-100 s': zeroTo100 === null ? '-' : +zeroTo100.toFixed(1),
    'top km/h': Math.round(top * 3.6), 'brake m': stopDistance === null ? '-' : Math.round(stopDistance),
    'lat g': +lateralG.toFixed(2), 'roll accel°': +maxRollAccel.toFixed(1), 'roll corner°': +maxRollCorner.toFixed(1),
  };
}

const ids = ['prototype', ...PROFILE_IDS];
console.table(ids.map((id) => measure(id === 'prototype' ? null : id)).map((row, i) => ({ ...row, id: ids[i] })));
