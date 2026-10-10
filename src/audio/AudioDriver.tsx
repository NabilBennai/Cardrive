import { useFrame } from '@react-three/fiber';
import { useAfterPhysicsStep, type RapierRigidBody } from '@react-three/rapier';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { perfStats } from '../debug/perfStats';
import { impactChannel } from '../feel/feelBus';
import type { VehicleConfig, VehicleTelemetry } from '../shared/types';
import { SURFACES } from '../vehicle/physics/surfaces';
import type { WheelPose } from '../vehicle/physics/VehicleSimulation';
import { impactIntensity } from './audioModel';
import { getGameAudio } from './GameAudio';
import { soundProfileFor } from './soundProfiles';

/** Demi-longueur approximative d'un véhicule (m) : un choc de face se produit à peu près à l'avant du châssis. */
const IMPACT_FRONT_OFFSET_M = 1.9;
/** Délai minimal (s) entre deux chocs sonores : un contact prolongé contre un mur ne doit pas mitrailler. */
const IMPACT_COOLDOWN_S = 0.12;
const DEBUG_PUBLISH_EVERY_FRAMES = 6;

interface AudioDriverProps {
  bodyRef: React.RefObject<RapierRigidBody | null>;
  telemetryRef: React.RefObject<VehicleTelemetry>;
  /** Poses de roues du solveur : donnent la surface sous chaque roue. */
  wheelPosesRef: React.RefObject<WheelPose[] | null>;
  vehicle: VehicleConfig;
  /** Identifiant du catalogue (détermine le caractère du moteur) ; null pour le prototype. */
  carId: string | null;
  paused: boolean;
  respawnVersion: number;
}

/**
 * À monter dans le Canvas, pendant la conduite : alimente la synthèse sonore avec la télémétrie à chaque image et détecte
 * les chocs (variation brutale de vitesse du châssis en un pas physique) qu'il publie sur le bus de ressenti pour les sons,
 * les étincelles et le tremblement de caméra. Ne rend rien.
 */
export function AudioDriver({ bodyRef, telemetryRef, wheelPosesRef, vehicle, carId, paused, respawnVersion }: AudioDriverProps) {
  const audio = getGameAudio();
  const profile = useMemo(() => soundProfileFor(carId), [carId]);
  const previousVelocity = useRef<{ x: number; y: number; z: number } | null>(null);
  const lastImpactTime = useRef(-1);
  const frames = useRef(0);

  useEffect(() => {
    audio.setActive(true);
    return () => audio.setActive(false);
  }, [audio]);
  useEffect(() => { audio.setPaused(paused); }, [audio, paused]);
  // Un respawn remet la vitesse à zéro d'un coup : ce n'est pas un choc.
  useLayoutEffect(() => { previousVelocity.current = null; }, [respawnVersion]);
  useEffect(() => impactChannel.subscribe((event) => audio.impact(event.intensity)), [audio]);

  useAfterPhysicsStep(() => {
    const body = bodyRef.current;
    if (!body) return;
    const velocity = body.linvel();
    const previous = previousVelocity.current;
    if (previous) {
      const deltaV = Math.hypot(velocity.x - previous.x, velocity.y - previous.y, velocity.z - previous.z);
      const intensity = impactIntensity(deltaV);
      const now = performance.now() / 1000;
      if (intensity > 0 && now - lastImpactTime.current > IMPACT_COOLDOWN_S) {
        lastImpactTime.current = now;
        const horizontal = Math.hypot(previous.x, previous.z) || 1;
        const dirX = previous.x / horizontal;
        const dirZ = previous.z / horizontal;
        const position = body.translation();
        impactChannel.emit({ intensity, x: position.x + dirX * IMPACT_FRONT_OFFSET_M, y: position.y - 0.2, z: position.z + dirZ * IMPACT_FRONT_OFFSET_M, dirX, dirZ });
      }
    }
    previousVelocity.current = { x: velocity.x, y: velocity.y, z: velocity.z };
  });

  useFrame(() => {
    const telemetry = telemetryRef.current;
    if (!telemetry) return;
    const poses = wheelPosesRef.current ?? [];
    const grounded = poses.filter((pose) => pose.grounded);
    const looseShare = grounded.length > 0 ? grounded.filter((pose) => SURFACES[pose.surface].loose).length / grounded.length : 0;
    perfStats.looseShare = looseShare;
    audio.update({
      rpm: telemetry.engineRpm, idleRpm: vehicle.idleRpm, maxRpm: vehicle.maximumRpm, throttle: telemetry.throttle, gear: telemetry.gear,
      speedMps: telemetry.speedMps, slip: telemetry.slip, groundedWheels: telemetry.groundedWheels, looseShare,
    }, profile);
    frames.current += 1;
    if (frames.current % DEBUG_PUBLISH_EVERY_FRAMES === 0) perfStats.audio = audio.debug();
  });

  return null;
}
