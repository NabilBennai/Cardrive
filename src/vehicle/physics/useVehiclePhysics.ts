import { useBeforePhysicsStep, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { VehicleInput, VehicleTelemetry } from '../../shared/types';
import { genericVehicle } from '../configs/genericVehicle';
import { VehicleSimulation, type WheelPose } from './VehicleSimulation';

export type { WheelPose } from './VehicleSimulation';

export interface VehiclePhysicsOptions {
  bodyRef: React.RefObject<RapierRigidBody | null>;
  input: React.RefObject<VehicleInput>;
  telemetryRef: React.RefObject<VehicleTelemetry>;
  wheelPosesRef: React.RefObject<WheelPose[]>;
  respawnVersion: number;
  onTelemetry: (telemetry: VehicleTelemetry) => void;
  /** Appelé à CHAQUE pas physique (pas throttlé comme onTelemetry), juste après la mise à jour
   *  de la télémétrie — doc §6 : vérification de l'origine flottante « entre deux pas ».
   *  Absent par défaut : aucun changement de comportement pour la piste de démo. */
  onAfterStep?: (telemetry: VehicleTelemetry, body: RapierRigidBody) => void;
}

export function useVehiclePhysics({ bodyRef, input, telemetryRef, wheelPosesRef, respawnVersion, onTelemetry, onAfterStep }: VehiclePhysicsOptions) {
  const { rapier } = useRapier();
  const simulation = useMemo(() => new VehicleSimulation(genericVehicle), []);
  const telemetryDelay = useRef(0);
  const telemetryCallback = useRef(onTelemetry);
  const afterStepCallback = useRef(onAfterStep);
  useLayoutEffect(() => { telemetryCallback.current = onTelemetry; }, [onTelemetry]);
  useLayoutEffect(() => { afterStepCallback.current = onAfterStep; }, [onAfterStep]);
  useLayoutEffect(() => {
    simulation.reset();
    wheelPosesRef.current = simulation.wheelPoses;
    telemetryDelay.current = 0;
  }, [respawnVersion, simulation, wheelPosesRef]);

  useBeforePhysicsStep((world) => {
    const body = bodyRef.current;
    if (!body) return;
    const telemetry = simulation.step(world, rapier, body, input.current);
    telemetryRef.current = telemetry;
    afterStepCallback.current?.(telemetry, body);
    telemetryDelay.current += world.timestep;
    if (telemetryDelay.current >= 0.1) {
      telemetryDelay.current %= 0.1;
      telemetryCallback.current(telemetry);
    }
  });
  return { wheelMounts: genericVehicle.wheelMounts };
}
