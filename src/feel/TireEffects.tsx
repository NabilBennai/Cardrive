import { useFrame } from '@react-three/fiber';
import type { RapierRigidBody } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, MeshBasicMaterial } from 'three';
import { SURFACES } from '../vehicle/physics/surfaces';
import type { WheelPose } from '../vehicle/physics/VehicleSimulation';
import { impactChannel, originShiftChannel } from './feelBus';
import { skidMarkAlpha, smokeRatePerSecond, sparkCount } from './feelMath';
import { ParticleLayer } from './ParticleLayer';
import { ParticlePool } from './ParticlePool';
import { SkidBuffer } from './SkidBuffer';

const SMOKE_CAPACITY = 240;
const SPARK_CAPACITY = 160;
const DUST_CAPACITY = 320;
const SPRAY_CAPACITY = 320;
/** Vitesse (m/s) au-dessous de laquelle une roue sur sol meuble ne soulève rien, et plafond d'émission (particules par seconde et par roue). */
const DUST_MIN_SPEED_MPS = 3;
const DUST_MAX_RATE = 38;
/** Humidité en dessous de laquelle la piste ne projette pas d'eau, vitesse minimale (m/s) et débit maximal (particules par seconde et par roue). */
const SPRAY_MIN_WETNESS = 0.2;
const SPRAY_MIN_SPEED_MPS = 7;
const SPRAY_MAX_RATE = 34;
const SKID_QUADS = 6_000;
/** Hauteur (m) des traces au-dessus du point de contact : au-dessus de l'asphalte et des vibreurs (≈ 1,6 cm), sans flotter visiblement. */
const SKID_LIFT_M = 0.03;
/** Pas maximal (s) pris en compte par les effets : au-delà (onglet en arrière-plan), on ne simule pas le temps perdu. */
const MAX_STEP_S = 0.1;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

interface TireEffectsProps {
  wheelPosesRef: React.RefObject<WheelPose[] | null>;
  /** Humidité de la piste : au-delà d'un film d'eau, les roues projettent de l'eau. */
  environmentRef?: React.RefObject<{ wetness: number }>;
  bodyRef: React.RefObject<RapierRigidBody | null>;
  /** Vrai quand la physique est à l'arrêt : les effets se figent (aucune émission, aucun vieillissement). */
  paused: boolean;
}

/** Fumée des pneus qui patinent ou se bloquent, émise là où la puissance de frottement est élevée (voir smokeRatePerSecond). */
export function TireSmoke({ wheelPosesRef, bodyRef, paused }: TireEffectsProps) {
  const pool = useMemo(() => new ParticlePool(SMOKE_CAPACITY, { gravityY: 0.35, drag: 1.3, fadeIn: 0.12 }), []);
  const carry = useRef<number[]>([]);
  useEffect(() => originShiftChannel.subscribe((shift) => pool.shift(shift.dx, shift.dy, shift.dz)), [pool]);

  useFrame((_, delta) => {
    if (paused) return;
    const dt = Math.min(delta, MAX_STEP_S);
    const poses = wheelPosesRef.current;
    const body = bodyRef.current;
    if (poses && body) {
      const velocity = body.linvel();
      poses.forEach((pose, index) => {
        const rate = pose.grounded ? smokeRatePerSecond(pose.slidingPowerW) : 0;
        carry.current[index] = (carry.current[index] ?? 0) + rate * dt;
        while (carry.current[index] >= 1) {
          carry.current[index] -= 1;
          pool.spawn({
            x: pose.contactX + rand(-0.12, 0.12), y: pose.contactY + 0.15, z: pose.contactZ + rand(-0.12, 0.12),
            // La fumée garde une partie de la vitesse de la voiture, puis s'élève et se disperse.
            vx: velocity.x * 0.35 + rand(-0.6, 0.6), vy: rand(0.5, 1.3), vz: velocity.z * 0.35 + rand(-0.6, 0.6),
            life: rand(1.1, 2.1), sizeStart: rand(0.5, 0.9), sizeEnd: rand(2.6, 3.8), alpha: 0.34,
          });
        }
      });
    }
    pool.update(dt);
  });

  return <ParticleLayer pool={pool} color="#d6d8d4" />;
}

/** Poussière soulevée par les roues sur un sol meuble (gravier, herbe sèche) : plus on va vite, plus il y en a. */
export function OffRoadDust({ wheelPosesRef, bodyRef, paused }: TireEffectsProps) {
  const pool = useMemo(() => new ParticlePool(DUST_CAPACITY, { gravityY: 0.2, drag: 1.6, fadeIn: 0.15 }), []);
  const carry = useRef<number[]>([]);
  useEffect(() => originShiftChannel.subscribe((shift) => pool.shift(shift.dx, shift.dy, shift.dz)), [pool]);

  useFrame((_, delta) => {
    if (paused) return;
    const dt = Math.min(delta, MAX_STEP_S);
    const poses = wheelPosesRef.current;
    const body = bodyRef.current;
    if (poses && body) {
      const velocity = body.linvel();
      const speed = Math.hypot(velocity.x, velocity.z);
      poses.forEach((pose, index) => {
        const loose = pose.grounded && SURFACES[pose.surface].loose && speed > DUST_MIN_SPEED_MPS;
        carry.current[index] = (carry.current[index] ?? 0) + (loose ? Math.min(DUST_MAX_RATE, speed * 1.4) * dt : 0);
        while (carry.current[index] >= 1) {
          carry.current[index] -= 1;
          pool.spawn({
            x: pose.contactX + rand(-0.15, 0.15), y: pose.contactY + 0.1, z: pose.contactZ + rand(-0.15, 0.15),
            vx: velocity.x * 0.25 + rand(-0.7, 0.7), vy: rand(0.4, 1.1), vz: velocity.z * 0.25 + rand(-0.7, 0.7),
            life: rand(0.8, 1.5), sizeStart: rand(0.3, 0.6), sizeEnd: rand(1.8, 2.8), alpha: 0.3,
          });
        }
      });
    }
    pool.update(dt);
  });

  return <ParticleLayer pool={pool} color="#a39b7a" />;
}

/** Gerbes d'eau soulevées par les roues sur une piste mouillée : proportionnelles à la vitesse et à l'humidité. */
export function WheelSpray({ wheelPosesRef, bodyRef, environmentRef, paused }: TireEffectsProps) {
  const pool = useMemo(() => new ParticlePool(SPRAY_CAPACITY, { gravityY: -0.6, drag: 1.1, fadeIn: 0.05 }), []);
  const carry = useRef<number[]>([]);
  useEffect(() => originShiftChannel.subscribe((shift) => pool.shift(shift.dx, shift.dy, shift.dz)), [pool]);

  useFrame((_, delta) => {
    if (paused) return;
    const dt = Math.min(delta, MAX_STEP_S);
    const poses = wheelPosesRef.current;
    const body = bodyRef.current;
    const wetness = environmentRef?.current.wetness ?? 0;
    if (poses && body && wetness > SPRAY_MIN_WETNESS) {
      const velocity = body.linvel();
      const speed = Math.hypot(velocity.x, velocity.z);
      poses.forEach((pose, index) => {
        const sprays = pose.grounded && !SURFACES[pose.surface].loose && speed > SPRAY_MIN_SPEED_MPS;
        carry.current[index] = (carry.current[index] ?? 0) + (sprays ? Math.min(SPRAY_MAX_RATE, speed * wetness * 1.1) * dt : 0);
        while (carry.current[index] >= 1) {
          carry.current[index] -= 1;
          pool.spawn({
            x: pose.contactX + rand(-0.12, 0.12), y: pose.contactY + 0.08, z: pose.contactZ + rand(-0.12, 0.12),
            vx: velocity.x * 0.12 + rand(-0.8, 0.8), vy: rand(0.5, 1.5), vz: velocity.z * 0.12 + rand(-0.8, 0.8),
            life: rand(0.5, 0.95), sizeStart: rand(0.25, 0.45), sizeEnd: rand(1.1, 1.9), alpha: 0.2,
          });
        }
      });
    }
    pool.update(dt);
  });

  return <ParticleLayer pool={pool} color="#cfdae2" />;
}

/** Étincelles projetées à l'arrière du point d'impact lors d'un choc (voir sparkCount : rien pour un contact léger). */
export function ImpactSparks({ paused }: Pick<TireEffectsProps, 'paused'>) {
  const pool = useMemo(() => new ParticlePool(SPARK_CAPACITY, { gravityY: -9.8, drag: 0.35, fadeIn: 0 }), []);
  useEffect(() => originShiftChannel.subscribe((shift) => pool.shift(shift.dx, shift.dy, shift.dz)), [pool]);
  useEffect(() => impactChannel.subscribe((event) => {
    const count = sparkCount(event.intensity);
    for (let i = 0; i < count; i += 1) {
      const speed = rand(2, 5 + 8 * event.intensity);
      pool.spawn({
        x: event.x, y: event.y + 0.3, z: event.z,
        vx: -event.dirX * speed + rand(-3, 3), vy: rand(1, 5 + 3 * event.intensity), vz: -event.dirZ * speed + rand(-3, 3),
        life: rand(0.35, 0.85), sizeStart: 0.1, sizeEnd: 0.03, alpha: 1,
      });
    }
  }), [pool]);

  useFrame((_, delta) => {
    if (paused) return;
    pool.update(Math.min(delta, MAX_STEP_S));
  });

  return <ParticleLayer pool={pool} color="#ffb04a" additive />;
}

/** Traces noires laissées au sol par les pneus qui glissent, avant même qu'ils ne fument (voir skidMarkAlpha). */
export function SkidMarks({ wheelPosesRef, paused }: Pick<TireEffectsProps, 'wheelPosesRef' | 'paused'>) {
  const buffer = useMemo(() => new SkidBuffer(SKID_QUADS, 4), []);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(buffer.positions, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('color', new BufferAttribute(buffer.colors, 4).setUsage(DynamicDrawUsage));
    const indices = new Uint32Array(SKID_QUADS * 6);
    for (let quad = 0; quad < SKID_QUADS; quad += 1) {
      const v = quad * 4;
      indices.set([v, v + 1, v + 2, v, v + 2, v + 3], quad * 6);
    }
    g.setIndex(new BufferAttribute(indices, 1));
    g.setDrawRange(0, 0);
    return g;
  }, [buffer]);
  const material = useMemo(() => new MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), []);

  useEffect(() => originShiftChannel.subscribe((shift) => buffer.shift(shift.dx, shift.dy, shift.dz)), [buffer]);
  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  useEffect(() => () => { material.dispose(); }, [material]);

  useFrame(() => {
    if (paused) return;
    const poses = wheelPosesRef.current;
    if (poses) {
      poses.forEach((pose, index) => {
        const alpha = pose.grounded ? skidMarkAlpha(pose.slidingPowerW) : 0;
        if (alpha > 0) buffer.extend(index, pose.contactX, pose.contactY + SKID_LIFT_M, pose.contactZ, alpha);
        else buffer.breakStrip(index);
      });
    }
    if (buffer.dirty) {
      geometry.getAttribute('position').needsUpdate = true;
      geometry.getAttribute('color').needsUpdate = true;
      geometry.setDrawRange(0, buffer.visibleQuads * 6);
      buffer.markUploaded();
    }
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={1} />;
}

/** Ensemble des effets de ressenti liés aux pneus et aux chocs. À monter dans le Canvas. */
export function TireEffects(props: TireEffectsProps) {
  return (
    <>
      <SkidMarks wheelPosesRef={props.wheelPosesRef} paused={props.paused} />
      <TireSmoke {...props} />
      <OffRoadDust {...props} />
      <WheelSpray {...props} />
      <ImpactSparks paused={props.paused} />
    </>
  );
}
