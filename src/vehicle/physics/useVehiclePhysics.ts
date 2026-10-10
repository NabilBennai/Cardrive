import { useBeforePhysicsStep, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { VehicleConfig, VehicleInput, VehicleTelemetry } from '../../shared/types';
import { perfStats } from '../../debug/perfStats';
import { markPhysicsStep } from './stepClock';
import type { SurfaceProvider } from './surfaces';
import { VehicleSimulation, type TractionControl, type Transmission, type WheelPose } from './VehicleSimulation';

export type { WheelPose } from './VehicleSimulation';

export interface VehiclePhysicsOptions {
  /** Configuration physique du véhicule (masse, moteur, pneus…) : voir vehicleProfiles.ts. */
  config: VehicleConfig;
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
  /**
   * Vrai (défaut) pour la voiture du joueur : son pas règle l'horloge d'extrapolation visuelle (stepClock). Les voitures
   * adverses ne doivent pas y toucher, sinon l'intervalle mesuré entre deux pas devient celui qui sépare deux voitures.
   */
  drivesClock?: boolean;
  /** Surface sous chaque roue (circuits) ; absent : asphalte partout. */
  surfaceAt?: SurfaceProvider;
  /** Contrôle de traction ; absent : désactivé. */
  tractionControl?: TractionControl;
  /** Boîte de vitesses ; absent : automatique. */
  transmission?: Transmission;
}

export function useVehiclePhysics({ config, bodyRef, input, telemetryRef, wheelPosesRef, respawnVersion, onTelemetry, onAfterStep, drivesClock = true, surfaceAt, tractionControl = 'off', transmission = 'auto' }: VehiclePhysicsOptions) {
  const { rapier } = useRapier();
  const simulation = useMemo(() => new VehicleSimulation(config), [config]);
  const telemetryDelay = useRef(0);
  const telemetryCallback = useRef(onTelemetry);
  const afterStepCallback = useRef(onAfterStep);
  useLayoutEffect(() => { telemetryCallback.current = onTelemetry; }, [onTelemetry]);
  useLayoutEffect(() => { afterStepCallback.current = onAfterStep; }, [onAfterStep]);
  useLayoutEffect(() => { simulation.setSurfaceProvider(surfaceAt ?? null); }, [simulation, surfaceAt]);
  useLayoutEffect(() => { simulation.setTractionControl(tractionControl); }, [simulation, tractionControl]);
  useLayoutEffect(() => { simulation.setTransmission(transmission); }, [simulation, transmission]);
  useLayoutEffect(() => {
    simulation.reset();
    wheelPosesRef.current = simulation.wheelPoses;
    telemetryDelay.current = 0;
  }, [respawnVersion, simulation, wheelPosesRef]);

  useBeforePhysicsStep((world) => {
    const body = bodyRef.current;
    if (!body) return;
    const solverStart = performance.now();
    if (drivesClock) markPhysicsStep(solverStart);
    const telemetry = simulation.step(world, rapier, body, input.current);
    if (drivesClock) perfStats.vehicleSolverMs.push(performance.now() - solverStart);
    telemetryRef.current = telemetry;
    afterStepCallback.current?.(telemetry, body);
    telemetryDelay.current += world.timestep;
    if (telemetryDelay.current >= 0.1) {
      telemetryDelay.current %= 0.1;
      telemetryCallback.current(telemetry);
    }
  });
  return { wheelMounts: config.wheelMounts };
}
