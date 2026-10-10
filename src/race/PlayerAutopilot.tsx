import { useBeforePhysicsStep, type RapierRigidBody } from '@react-three/rapier';
import { useMemo } from 'react';
import type { CircuitTrack } from '../circuits/circuitGeometry';
import type { VehicleConfig, VehicleInput, VehicleTelemetry } from '../shared/types';
import { headingOfRotation } from './bodyPose';
import { AiDriver, aiProfileFor } from './driverAi';

/** Écrit une commande dans la référence d'entrée du véhicule (fonction externe : la référence est un objet partagé avec le solveur). */
function writeInput(target: VehicleInput, next: VehicleInput): void {
  target.throttle = next.throttle;
  target.brake = next.brake;
  target.steering = next.steering;
  target.handbrake = next.handbrake;
}

interface PlayerAutopilotProps {
  track: CircuitTrack;
  config: VehicleConfig;
  bodyRef: React.RefObject<RapierRigidBody | null>;
  input: React.RefObject<VehicleInput>;
  telemetryRef: React.RefObject<VehicleTelemetry>;
  respawnVersion: number;
}

/**
 * Crochet de test et de démonstration (adresse `?autopilot`) : le pilote automatique conduit la voiture du joueur sur un circuit, avec
 * les mêmes commandes que le clavier. Sert aux tests de bout en bout d'un tour complet (chrono, records, fantôme).
 */
export function PlayerAutopilot({ track, config, bodyRef, input, telemetryRef, respawnVersion }: PlayerAutopilotProps) {
  const driver = useMemo(() => {
    // Un repositionnement remet la voiture ailleurs : la projection repart d'une recherche globale.
    void respawnVersion;
    return new AiDriver(track.centerline, track.lengthM, aiProfileFor(config));
  }, [track, config, respawnVersion]);

  useBeforePhysicsStep((world) => {
    const body = bodyRef.current;
    if (!body) return;
    const position = body.translation();
    const velocity = body.linvel();
    writeInput(input.current, driver.drive({
      xM: position.x, zM: position.z, headingRad: headingOfRotation(body.rotation()), speedMps: Math.hypot(velocity.x, velocity.z),
      slip: telemetryRef.current.slip, dtS: world.timestep,
    }));
  });

  return null;
}
