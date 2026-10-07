import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { VehicleInput, VehicleTelemetry } from '../../shared/types';
import { genericVehicle } from '../configs/genericVehicle';
import { VehicleSimulation, type WheelPose } from './VehicleSimulation';

export type { WheelPose } from './VehicleSimulation';

export interface VehiclePhysicsOptions {
  bodyRef: React.RefObject<import('@react-three/rapier').RapierRigidBody | null>;
  input: React.RefObject<VehicleInput>;
  telemetryRef: React.RefObject<VehicleTelemetry>;
  wheelPosesRef: React.RefObject<WheelPose[]>;
  respawnVersion: number;
  onTelemetry: (telemetry: VehicleTelemetry) => void;
}

export function useVehiclePhysics({ bodyRef, input, telemetryRef, wheelPosesRef, respawnVersion, onTelemetry }: VehiclePhysicsOptions) {
  const { rapier } = useRapier();
  const simulation = useMemo(() => new VehicleSimulation(genericVehicle), []);
  const telemetryDelay = useRef(0);
  const telemetryCallback = useRef(onTelemetry);
  useLayoutEffect(() => { telemetryCallback.current = onTelemetry; }, [onTelemetry]);
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
    telemetryDelay.current += world.timestep;
    if (telemetryDelay.current >= 0.1) {
      telemetryDelay.current %= 0.1;
      telemetryCallback.current(telemetry);
    }
  });
  return { wheelMounts: genericVehicle.wheelMounts };
}
