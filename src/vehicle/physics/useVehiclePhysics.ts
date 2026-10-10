import { useBeforePhysicsStep, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { impactChannel } from '../../feel/feelBus';
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
  /** Usure des pneus et carburant ; absent : désactivés. */
  wearEnabled?: boolean;
  /** Incrémenté pour changer les pneus et refaire le plein. */
  serviceVersion?: number;
  /** Conditions du moment (humidité de la piste, température de l'air), partagées par toutes les voitures de la scène. */
  environmentRef?: React.RefObject<{ wetness: number; airC: number }>;
  /** Dégâts selon l'énergie des chocs (voiture du joueur seulement) ; absent : désactivés. */
  damageEnabled?: boolean;
  /** Incrémenté pour réparer la voiture. */
  repairVersion?: number;
}

export function useVehiclePhysics({ config, bodyRef, input, telemetryRef, wheelPosesRef, respawnVersion, onTelemetry, onAfterStep, drivesClock = true, surfaceAt, tractionControl = 'off', transmission = 'auto', wearEnabled = false, serviceVersion = 0, environmentRef, damageEnabled = false, repairVersion = 0 }: VehiclePhysicsOptions) {
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
  useLayoutEffect(() => { simulation.setWearEnabled(wearEnabled); }, [simulation, wearEnabled]);
  useLayoutEffect(() => { simulation.setDamageEnabled(damageEnabled); }, [simulation, damageEnabled]);
  const repairedVersion = useRef(repairVersion);
  useLayoutEffect(() => {
    if (repairedVersion.current === repairVersion) return;
    repairedVersion.current = repairVersion;
    simulation.repairCar();
  }, [simulation, repairVersion]);
  // Les chocs du joueur (détectés par AudioDriver) abîment la voiture dans la zone touchée.
  useEffect(() => {
    if (!damageEnabled || !drivesClock) return undefined;
    return impactChannel.subscribe((event) => {
      const body = bodyRef.current;
      if (!body) return;
      const r = body.rotation();
      const heading = Math.atan2(2 * (r.x * r.z + r.w * r.y), 1 - 2 * (r.x * r.x + r.y * r.y));
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);
      simulation.registerImpact(event.intensity, event.dirX * cos - event.dirZ * sin, event.dirX * sin + event.dirZ * cos);
    });
  }, [simulation, damageEnabled, drivesClock, bodyRef]);
  const servicedVersion = useRef(serviceVersion);
  useLayoutEffect(() => {
    if (servicedVersion.current === serviceVersion) return;
    servicedVersion.current = serviceVersion;
    simulation.service();
  }, [simulation, serviceVersion]);
  useLayoutEffect(() => {
    simulation.reset();
    wheelPosesRef.current = simulation.wheelPoses;
    telemetryDelay.current = 0;
  }, [respawnVersion, simulation, wheelPosesRef]);

  useBeforePhysicsStep((world) => {
    const body = bodyRef.current;
    if (!body) return;
    if (environmentRef) simulation.setEnvironment(environmentRef.current.wetness, environmentRef.current.airC);
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
  return { wheelMounts: config.wheelMounts, simulation };
}
