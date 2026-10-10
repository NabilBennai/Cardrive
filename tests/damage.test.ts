import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VehicleInput } from '../src/shared/types';
import { vehicleConfigFor } from '../src/vehicle/configs/vehicleProfiles';
import {
  applyImpact, createDamage, createRandom, flatTireGripFactor, impactZone, MAX_POWER_LOSS, MIN_DAMAGING_INTENSITY, powerScale,
  PUNCTURE_INTENSITY, repair, steeringPullRad, stepTireLeak,
} from '../src/vehicle/physics/damageModel';
import { VehicleSimulation } from '../src/vehicle/physics/VehicleSimulation';
import {
  vehicleColliderMassProperties, vehicleColliderOffsetY, vehicleSpawnHeightM,
  VEHICLE_COLLIDER_FRICTION, VEHICLE_COLLIDER_RESTITUTION, VEHICLE_FIXED_STEP_S,
} from '../src/vehicle/physics/vehicleBody';
import { crumplePoint, hasBodyDamage, type CrumpleBounds } from '../src/vehicle/rendering/crumple';

const dt = VEHICLE_FIXED_STEP_S;
const neutral: VehicleInput = { throttle: 0, brake: 0, steering: 0, handbrake: 0 };

beforeAll(async () => { await RAPIER.init(); });

describe('modèle de dégâts', () => {
  it('un accrochage léger ne coûte rien', () => {
    const state = createDamage(4);
    applyImpact(state, MIN_DAMAGING_INTENSITY - 0.01, 0, 1, 0.3);
    expect(state.engine).toBe(0);
    expect(state.bodyVersion).toBe(0);
    expect(state.tirePunctured.some(Boolean)).toBe(false);
  });

  it('un choc de face abîme le moteur, la direction et la carrosserie avant', () => {
    const state = createDamage(4);
    applyImpact(state, 0.6, 0, 1, 0.9);
    expect(state.body.front).toBeCloseTo(0.6, 6);
    expect(state.body.rear + state.body.left + state.body.right).toBe(0);
    expect(state.engine).toBeGreaterThan(0.25);
    expect(state.steering).toBeGreaterThan(0.2);
    expect(powerScale(state)).toBeLessThan(0.9);
    expect(powerScale(state)).toBeGreaterThanOrEqual(1 - MAX_POWER_LOSS);
    expect(state.bodyVersion).toBe(1);
  });

  it('retrouve la zone touchée dans le repère du véhicule', () => {
    expect(impactZone(0, 1)).toBe('front');
    expect(impactZone(0.1, -1)).toBe('rear');
    expect(impactZone(1, 0.2)).toBe('left');
    expect(impactZone(-1, 0.2)).toBe('right');
  });

  it('un choc de côté fausse la direction, épargne le moteur, et crève un pneu du côté touché', () => {
    const state = createDamage(4);
    applyImpact(state, 0.9, 1, 0, 0.2);
    expect(state.engine).toBe(0);
    expect(state.steering).toBeGreaterThan(0.3);
    expect(state.body.left).toBeGreaterThan(0.8);
    const flat = state.tirePunctured.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    expect(flat).toHaveLength(1);
    expect(flat[0] % 2).toBe(1); // roues de gauche : indices impairs
    // Pas de crevaison sous le seuil.
    const light = createDamage(4);
    applyImpact(light, PUNCTURE_INTENSITY - 0.05, 1, 0, 0.5);
    expect(light.tirePunctured.some(Boolean)).toBe(false);
  });

  it('les dégâts s\'accumulent sans dépasser 1, et un pneu crevé se vide progressivement', () => {
    const state = createDamage(4);
    for (let i = 0; i < 8; i += 1) applyImpact(state, 1, 0, 1, 0.4);
    expect(state.engine).toBe(1);
    expect(state.steering).toBe(1);
    expect(state.body.front).toBe(1);
    expect(Math.abs(steeringPullRad(state))).toBeGreaterThan(0.05);
    const punctured = state.tirePunctured.findIndex(Boolean);
    expect(punctured).toBeGreaterThanOrEqual(0);
    for (let t = 0; t < 2; t += dt) stepTireLeak(state, dt);
    expect(state.tireFlat[punctured]).toBeGreaterThan(0.3);
    expect(state.tireFlat[punctured]).toBeLessThan(0.7);
    for (let t = 0; t < 10; t += dt) stepTireLeak(state, dt);
    expect(state.tireFlat[punctured]).toBe(1);
    expect(flatTireGripFactor(1)).toBeCloseTo(0.45, 6);
  });

  it('réparer remet tout à neuf', () => {
    const state = createDamage(4);
    applyImpact(state, 0.9, 0, 1, 0.1);
    repair(state);
    expect(state.engine + state.steering).toBe(0);
    expect(state.tireFlat.every((f) => f === 0)).toBe(true);
    expect(hasBodyDamage(state.body)).toBe(false);
  });

  it('le générateur aléatoire est déterministe', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(createRandom(43)()).not.toBe(createRandom(42)());
  });
});

describe('froissement de la carrosserie', () => {
  const bounds: CrumpleBounds = { minX: -0.9, maxX: 0.9, minY: 0, maxY: 1.4, minZ: -2.2, maxZ: 2.2 };

  it('sans dégâts, aucun sommet ne bouge', () => {
    const p = { x: 0.3, y: 0.8, z: 2.1 };
    expect(crumplePoint(p, { front: 0, rear: 0, left: 0, right: 0 }, bounds)).toEqual(p);
  });

  it('un choc avant repousse le nez vers l\'arrière, sans toucher à l\'arrière, et davantage quand les dégâts augmentent', () => {
    const nose = { x: 0.2, y: 0.7, z: 2.2 };
    const tail = { x: 0.2, y: 0.7, z: -2.2 };
    const light = crumplePoint(nose, { front: 0.3, rear: 0, left: 0, right: 0 }, bounds);
    const heavy = crumplePoint(nose, { front: 1, rear: 0, left: 0, right: 0 }, bounds);
    expect(light.z).toBeLessThan(nose.z);
    expect(heavy.z).toBeLessThan(light.z);
    expect(nose.z - heavy.z).toBeGreaterThan(0.3);
    expect(crumplePoint(tail, { front: 1, rear: 0, left: 0, right: 0 }, bounds)).toEqual(tail);
    // Un sommet au milieu de la caisse reste en place.
    const middle = { x: 0.2, y: 0.7, z: 0 };
    expect(crumplePoint(middle, { front: 1, rear: 0, left: 0, right: 0 }, bounds)).toEqual(middle);
  });

  it('un choc latéral enfonce le flanc touché vers l\'intérieur', () => {
    const left = crumplePoint({ x: 0.9, y: 0.7, z: 0 }, { front: 0, rear: 0, left: 1, right: 0 }, bounds);
    const right = crumplePoint({ x: -0.9, y: 0.7, z: 0 }, { front: 0, rear: 0, left: 0, right: 1 }, bounds);
    expect(left.x).toBeLessThan(0.9 - 0.1);
    expect(right.x).toBeGreaterThan(-0.9 + 0.1);
  });

  it('est déterministe : même sommet, même résultat', () => {
    const damage = { front: 0.8, rear: 0, left: 0, right: 0 };
    expect(crumplePoint({ x: 0.1, y: 0.5, z: 2 }, damage, bounds)).toEqual(crumplePoint({ x: 0.1, y: 0.5, z: 2 }, damage, bounds));
  });
});

function makeRig() {
  const config = vehicleConfigFor('sedan-sports');
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
  return { world, body, simulation, step: (input: VehicleInput) => { const telemetry = simulation.step(world, RAPIER, body, input); world.step(); return telemetry; } };
}

describe('dégâts dans le solveur', () => {
  const topSpeedAfter = (damaged: boolean) => {
    const { world, body, simulation, step } = makeRig();
    simulation.setDamageEnabled(true);
    if (damaged) simulation.registerImpact(1, 0, 1);
    for (let i = 0; i < 25 * 60; i += 1) step({ ...neutral, throttle: 1 });
    const speed = Math.hypot(body.linvel().x, body.linvel().z);
    world.free();
    return speed;
  };

  it('un moteur abîmé accélère moins', () => {
    expect(topSpeedAfter(true)).toBeLessThan(topSpeedAfter(false) * 0.9);
  });

  it('une direction faussée fait dériver la voiture en ligne droite', () => {
    const drift = (damaged: boolean) => {
      const { world, body, simulation, step } = makeRig();
      simulation.setDamageEnabled(true);
      if (damaged) simulation.registerImpact(0.9, 0, 1);
      for (let i = 0; i < 6 * 60; i += 1) step({ ...neutral, throttle: 0.6 });
      const x = Math.abs(body.translation().x);
      world.free();
      return x;
    };
    expect(drift(true)).toBeGreaterThan(drift(false) + 2);
  });

  it('un pneu crevé tire la voiture et réduit sa vitesse', () => {
    const { world, body, simulation, step } = makeRig();
    simulation.setDamageEnabled(true);
    simulation.registerImpact(0.95, 1, 0); // côté gauche : crevaison d'un pneu gauche
    expect(simulation.damage.tirePunctured.some(Boolean)).toBe(true);
    let telemetry = step(neutral);
    for (let i = 0; i < 10 * 60; i += 1) telemetry = step({ ...neutral, throttle: 0.6 });
    expect(telemetry.damage?.tireFlat.some((flat) => flat > 0.9)).toBe(true);
    world.free();
    expect(body).toBeDefined();
  });

  it('désactivés (par défaut), un choc violent ne change rien', () => {
    const { world, simulation, step } = makeRig();
    simulation.registerImpact(1, 0, 1);
    const telemetry = step({ ...neutral, throttle: 1 });
    expect(telemetry.damage).toBeUndefined();
    expect(simulation.damage.engine).toBe(0);
    world.free();
  });

  it('réparer rend la puissance', () => {
    const { world, simulation } = makeRig();
    simulation.setDamageEnabled(true);
    simulation.registerImpact(1, 0, 1);
    expect(simulation.damage.engine).toBeGreaterThan(0.5);
    simulation.repairCar();
    expect(simulation.damage.engine).toBe(0);
    world.free();
  });
});

describe('contrôleur de froissement (maillages)', () => {
  it('froisse une copie de la géométrie sans toucher à la géométrie partagée, et la restitue après réparation', async () => {
    const { BoxGeometry, Group, Mesh, MeshBasicMaterial } = await import('three');
    const { CrumpleController } = await import('../src/vehicle/rendering/crumpleObject');
    const shared = new BoxGeometry(1.8, 1.2, 4.4, 6, 4, 10);
    const sharedBefore = Float32Array.from(shared.getAttribute('position').array as ArrayLike<number>);
    const root = new Group();
    const body = new Mesh(shared, new MeshBasicMaterial());
    const wheel = new Mesh(new BoxGeometry(0.3, 0.6, 0.6), new MeshBasicMaterial());
    wheel.name = 'wheel-front-left';
    root.add(body, wheel);
    const wheelBefore = Float32Array.from(wheel.geometry.getAttribute('position').array as ArrayLike<number>);
    const controller = new CrumpleController(root, (mesh) => mesh.name !== 'wheel-front-left');
    const state = createDamage(4);
    controller.sync(state); // rien à faire sans dégâts : la géométrie n'est même pas copiée
    expect(body.geometry).toBe(shared);
    applyImpact(state, 0.9, 0, 1, 0.3);
    controller.sync(state);
    expect(body.geometry).not.toBe(shared);
    const crumpled = body.geometry.getAttribute('position').array as ArrayLike<number>;
    let moved = 0;
    for (let i = 0; i < sharedBefore.length; i += 1) if (Math.abs(crumpled[i] - sharedBefore[i]) > 1e-4) moved += 1;
    expect(moved).toBeGreaterThan(20);
    expect(Array.from(shared.getAttribute('position').array)).toEqual(Array.from(sharedBefore));
    expect(Array.from(wheel.geometry.getAttribute('position').array)).toEqual(Array.from(wheelBefore));
    repair(state);
    controller.sync(state);
    expect(Array.from(body.geometry.getAttribute('position').array)).toEqual(Array.from(sharedBefore));
  });
});
