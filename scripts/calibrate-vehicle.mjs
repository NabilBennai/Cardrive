import RAPIER from '@dimforge/rapier3d-compat';
import { writeFileSync } from 'node:fs';
import { genericVehicle as config } from '../src/vehicle/configs/genericVehicle.ts';
import { VehicleSimulation } from '../src/vehicle/physics/VehicleSimulation.ts';
import { resetVehicleBody, vehicleMassProperties, VEHICLE_COLLIDER_FRICTION, VEHICLE_COLLIDER_RESTITUTION,
  VEHICLE_FIXED_STEP_S } from '../src/vehicle/physics/vehicleBody.ts';

await RAPIER.init();
const neutral = { throttle: 0, brake: 0, steering: 0, handbrake: 0 };
const dt = VEHICLE_FIXED_STEP_S;
const scenarios = [
  { name: 'repos', seconds: 15, input: () => neutral },
  { name: 'acceleration', seconds: 20, input: () => ({ ...neutral, throttle: 1 }) },
  { name: 'freinage-100-kmh', seconds: 8, speed: 100 / 3.6,
    input: (_t, body) => ({ ...neutral, brake: body.linvel().z > 0.15 ? 1 : 0 }) },
  { name: 'recul', seconds: 8, input: () => ({ ...neutral, brake: 1 }) },
  { name: 'recul-vers-avant', seconds: 12, input: (t) => t < 5 ? ({ ...neutral, brake: 1 }) : ({ ...neutral, throttle: 1 }) },
  { name: 'virage', seconds: 10, speed: 10, input: () => ({ ...neutral, throttle: 0.3, steering: 0.35 }) },
  { name: 'slalom', seconds: 12, speed: 10, input: (t) => ({ ...neutral, throttle: 0.3, steering: Math.sin(t * 1.5) * 0.5 }) },
  { name: 'frein-main', seconds: 5, speed: 15, input: (t) => ({ ...neutral, steering: 0.3, handbrake: t > 1 ? 1 : 0 }) },
  { name: 'bosse', seconds: 6, speed: 8, bump: true, input: () => neutral },
  { name: 'collision', seconds: 8, obstacle: true, input: () => ({ ...neutral, throttle: 1 }) },
  { name: 'respawn', seconds: 10, respawn: true, input: (t) => ({ ...neutral, throttle: t < 5 ? 1 : 0 }) },
  { name: 'pause-reprise', seconds: 12, pause: true, input: () => ({ ...neutral, throttle: 0.5 }) },
];

function measure(scenario, fps) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = dt;
  world.createCollider(RAPIER.ColliderDesc.cuboid(1000, 0.05, 1000).setTranslation(0, -0.05, 0));
  if (scenario.bump) world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.12, 0.5).setTranslation(0, 0.12, 10));
  if (scenario.obstacle) world.createCollider(RAPIER.ColliderDesc.cuboid(4, 1, 0.5).setTranslation(0, 1, 30));
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.9, 0)
    .setLinearDamping(config.linearDamping).setAngularDamping(config.angularDamping).setCanSleep(false).setCcdEnabled(true));
  const mass = vehicleMassProperties(config);
  world.createCollider(RAPIER.ColliderDesc.cuboid(config.dimensionsM.widthM / 2, config.dimensionsM.heightM / 2, config.dimensionsM.lengthM / 2)
    .setMassProperties(mass.mass, mass.centerOfMass, mass.principalAngularInertia, mass.angularInertiaLocalFrame)
    .setFriction(VEHICLE_COLLIDER_FRICTION).setRestitution(VEHICLE_COLLIDER_RESTITUTION), body);
  const simulation = new VehicleSimulation(config);
  // Populate scene queries and settle the same body before a rolling start.
  for (let i = 0; i < 120; i++) {
    simulation.step(world, RAPIER, body, neutral);
    world.step();
  }
  body.setLinvel({ x: 0, y: 0, z: scenario.speed ?? 0 }, true);
  let accumulator = 0;
  let steps = 0;
  let wallTime = 0;
  let pathM = 0;
  let maximumHeightM = body.translation().y;
  let minimumHeightM = maximumHeightM;
  let maximumSpeedMps = 0;
  let maximumRollRad = 0;
  let maximumPitchRad = 0;
  let stopTimeS = null;
  let stopDistanceM = null;
  let zeroTo100S = null;
  let minimumWorldZSpeedMps = 0;
  let maximumSlip = 0;
  let gearChanges = 0;
  let previousGear = simulation.gear;
  let previousPosition = body.translation();
  let telemetry;
  while (steps < Math.round(scenario.seconds / dt)) {
    wallTime += 1 / fps;
    // A hidden tab pauses without adding catch-up time to the accumulator.
    if (scenario.pause && wallTime >= 4 && wallTime < 6) continue;
    accumulator += 1 / fps;
    while (accumulator + 1e-10 >= dt && steps < Math.round(scenario.seconds / dt)) {
      const t = steps * dt;
      if (scenario.respawn && steps === 300) {
        resetVehicleBody(body, { x: 0, y: 0.9, z: 0 });
        simulation.reset();
        previousPosition = body.translation();
      }
      telemetry = simulation.step(world, RAPIER, body, scenario.input(t, body));
      world.step();
      const position = body.translation();
      const velocity = body.linvel();
      const rotation = body.rotation();
      pathM += Math.hypot(position.x - previousPosition.x, position.z - previousPosition.z);
      previousPosition = position;
      minimumHeightM = Math.min(minimumHeightM, position.y);
      maximumHeightM = Math.max(maximumHeightM, position.y);
      maximumSpeedMps = Math.max(maximumSpeedMps, Math.hypot(velocity.x, velocity.z));
      maximumRollRad = Math.max(maximumRollRad, Math.abs(Math.atan2(2 * (rotation.w * rotation.z + rotation.x * rotation.y), 1 - 2 * (rotation.x ** 2 + rotation.z ** 2))));
      maximumPitchRad = Math.max(maximumPitchRad, Math.abs(Math.asin(Math.max(-1, Math.min(1, 2 * (rotation.w * rotation.x - rotation.y * rotation.z))))));
      minimumWorldZSpeedMps = Math.min(minimumWorldZSpeedMps, velocity.z);
      maximumSlip = Math.max(maximumSlip, telemetry.slip);
      if (simulation.gear !== previousGear) gearChanges++;
      previousGear = simulation.gear;
      if (scenario.name === 'freinage-100-kmh' && stopTimeS === null && Math.hypot(velocity.x, velocity.z) < 0.15) {
        stopTimeS = t + dt;
        stopDistanceM = pathM;
      }
      if (zeroTo100S === null && Math.hypot(velocity.x, velocity.z) >= 100 / 3.6) zeroTo100S = t + dt;
      steps++;
      accumulator -= dt;
    }
  }
  const result = { scenario: scenario.name, fps, steps, pathM, minimumHeightM, maximumHeightM,
    maximumSpeedKmh: maximumSpeedMps * 3.6, maximumRollDeg: maximumRollRad * 180 / Math.PI,
    maximumPitchDeg: maximumPitchRad * 180 / Math.PI,
    minimumWorldZSpeedMps, maximumSlip, gearChanges, finalGear: simulation.gear,
    stopTimeS, stopDistanceM, zeroTo100S, position: body.translation(), velocity: body.linvel(),
    finalRpm: simulation.rpm, groundedWheels: telemetry.groundedWheels,
    persistentForce: body.userForce(), persistentTorque: body.userTorque() };
  world.free();
  return result;
}

const results = scenarios.flatMap((scenario) => [30, 60, 120].map((fps) => measure(scenario, fps)));
const cadenceDeltas = scenarios.map(({ name }) => {
  const rows = results.filter((row) => row.scenario === name);
  const reference = rows[1];
  return { scenario: name, maximumPositionDeltaM: Math.max(...rows.map((row) => Math.hypot(row.position.x - reference.position.x,
    row.position.y - reference.position.y, row.position.z - reference.position.z))),
    maximumSpeedDeltaMps: Math.max(...rows.map((row) => Math.hypot(row.velocity.x - reference.velocity.x,
      row.velocity.y - reference.velocity.y, row.velocity.z - reference.velocity.z))) };
});
const at60 = (name) => results.find((row) => row.scenario === name && row.fps === 60);
const checks = {
  finiteResults: results.every((row) => [row.pathM, row.minimumHeightM, row.maximumHeightM, row.maximumSpeedKmh,
    row.position.x, row.position.y, row.position.z, row.velocity.x, row.velocity.y, row.velocity.z, row.finalRpm].every(Number.isFinite)),
  noPersistentForces: results.every((row) => Object.values(row.persistentForce).every((value) => value === 0)
    && Object.values(row.persistentTorque).every((value) => value === 0)),
  cadenceIndependent: cadenceDeltas.every((row) => row.maximumPositionDeltaM < 1e-5 && row.maximumSpeedDeltaMps < 1e-5),
  restingSupport: at60('repos').groundedWheels === 4 && at60('repos').pathM < 0.01
    && at60('repos').maximumHeightM - at60('repos').minimumHeightM < 0.02,
  accelerationStable: at60('acceleration').zeroTo100S !== null && at60('acceleration').maximumHeightM < 1.05
    && at60('acceleration').maximumPitchDeg < 5 && at60('acceleration').gearChanges >= 2,
  brakingStopsWithoutReversing: at60('freinage-100-kmh').stopTimeS !== null
    && at60('freinage-100-kmh').stopDistanceM < 55 && at60('freinage-100-kmh').minimumWorldZSpeedMps > -0.15,
  sustainedBoundedReverse: at60('recul').finalGear === -1 && at60('recul').velocity.z < -2
    && at60('recul').maximumSpeedKmh <= config.maximumReverseSpeedMps * 3.6 + 0.5,
  directionChange: at60('recul-vers-avant').finalGear > 0 && at60('recul-vers-avant').velocity.z > 2,
  turningStable: Math.abs(at60('virage').position.x) > 20 && at60('virage').maximumRollDeg < 10
    && at60('slalom').maximumRollDeg < 10,
  bumpBounded: at60('bosse').maximumHeightM < 1.2 && at60('bosse').minimumHeightM > 0.5,
  collisionBlocked: at60('collision').position.z < 30,
  respawnRestored: at60('respawn').finalGear === 1 && Math.abs(at60('respawn').position.z) < 0.01
    && Math.hypot(at60('respawn').velocity.x, at60('respawn').velocity.z) < 0.01,
};
const report = { generatedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch },
  physicsHz: 1 / dt, rapierVersion: RAPIER.version(), vehicleConfig: config,
  note: 'Rapier headless, synthetic render cadence; no GPU/FPS benchmark or browser input validation.',
  checks, cadenceDeltas, results };
writeFileSync(new URL('../docs/architecture/calibration-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.table(results.filter((row) => row.fps === 60).map(({ scenario, pathM, maximumHeightM, maximumSpeedKmh, maximumRollDeg, maximumPitchDeg, finalGear, stopTimeS, stopDistanceM, zeroTo100S }) =>
  ({ scenario, pathM: pathM.toFixed(2), maxY: maximumHeightM.toFixed(3), maxKmh: maximumSpeedKmh.toFixed(1), rollDeg: maximumRollDeg.toFixed(1), pitchDeg: maximumPitchDeg.toFixed(1), finalGear, stopTimeS, stopDistanceM, zeroTo100S })));
console.table(cadenceDeltas);
console.table(checks);
if (Object.values(checks).some((passed) => !passed)) process.exitCode = 1;
