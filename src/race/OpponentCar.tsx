import { useBeforePhysicsStep, type RapierRigidBody } from '@react-three/rapier';
import { useMemo, useRef, useState } from 'react';
import type { CircuitTrack } from '../circuits/circuitGeometry';
import type { VehicleConfig, VehicleInput, VehicleTelemetry } from '../shared/types';
import { GenericCar, type VehicleSpawnPose } from '../vehicle/rendering/GenericCar';
import { headingToQuaternion, vehicleSpawnHeightM } from '../vehicle/physics/vehicleBody';
import { headingOfRotation } from './bodyPose';
import { AiDriver, aiProfileFor } from './driverAi';
import type { GridSlot } from './grid';
import { createCircuitSurface } from './circuitSurface';
import { StuckDetector } from './stuckDetector';
import { TrackProjector } from './trackProjector';
import { centerlinePoseAt } from './trackPose';

const HOLD_INPUT: VehicleInput = { throttle: 0, brake: 0, steering: 0, handbrake: 1 };

const initialTelemetry = (config: VehicleConfig, slot: GridSlot): VehicleTelemetry => ({
  speedMps: 0, engineRpm: config.idleRpm, gear: 1, slip: 0, groundedWheels: 0, throttle: 0, brake: 0, steering: 0,
  tireTemperaturesC: config.wheelMounts.map(() => config.ambientTemperatureC),
  positionM: { xM: slot.xM, zM: slot.zM },
  headingRad: slot.headingRad,
});

/** Écrit une commande dans la référence d'entrée du véhicule (fonction externe : la référence est un objet partagé avec le solveur). */
function writeInput(target: VehicleInput, next: VehicleInput): void {
  target.throttle = next.throttle;
  target.brake = next.brake;
  target.steering = next.steering;
  target.handbrake = next.handbrake;
}

export interface OpponentSpec {
  id: string;
  slot: GridSlot;
  /** Niveau du pilote, 0..1 (voir aiProfileFor). */
  skill: number;
}

interface OpponentCarProps {
  spec: OpponentSpec;
  track: CircuitTrack;
  config: VehicleConfig;
  modelUrl: string | null;
  bodyRef: React.RefObject<RapierRigidBody | null>;
  /** Vrai une fois les feux éteints : jusque-là, la voiture reste sur sa grille freins serrés. */
  goRef: React.RefObject<{ go: boolean }>;
}

/** Voiture adverse : même solveur de véhicule que le joueur, conduite par le pilote automatique (mêmes commandes que le clavier). */
export function OpponentCar({ spec, track, config, modelUrl, bodyRef, goRef }: OpponentCarProps) {
  const input = useRef<VehicleInput>({ ...HOLD_INPUT });
  const telemetryRef = useRef<VehicleTelemetry>(initialTelemetry(config, spec.slot));
  const respawnPoseRef = useRef<VehicleSpawnPose | null>(null);
  const [respawnVersion, setRespawnVersion] = useState(0);
  const driver = useMemo(() => new AiDriver(track.centerline, track.lengthM, aiProfileFor(config, spec.skill)), [track, config, spec.skill]);
  const projector = useMemo(() => new TrackProjector(track.centerline, track.lengthM), [track]);
  const stuck = useMemo(() => new StuckDetector(), []);
  const surfaceAt = useMemo(() => createCircuitSurface(track), [track]);
  const spawnPose = useMemo<VehicleSpawnPose>(() => ({
    position: { x: spec.slot.xM, y: vehicleSpawnHeightM(config), z: spec.slot.zM },
    rotation: headingToQuaternion(spec.slot.headingRad),
  }), [spec.slot, config]);

  useBeforePhysicsStep((world) => {
    const body = bodyRef.current;
    if (!body) return;
    if (!goRef.current.go) { writeInput(input.current, HOLD_INPUT); return; }
    const position = body.translation();
    const velocity = body.linvel();
    const speedMps = Math.hypot(velocity.x, velocity.z);
    writeInput(input.current, driver.drive({
      xM: position.x, zM: position.z, headingRad: headingOfRotation(body.rotation()), speedMps,
      slip: telemetryRef.current.slip, dtS: world.timestep,
    }));
    // Voiture bloquée (mur, retournée) : après quelques secondes, on la replace sur la ligne centrale, à l'arrêt.
    if (stuck.update(speedMps, world.timestep)) {
      const projection = projector.project(position.x, position.z, null);
      const pose = centerlinePoseAt(track, projection.sM);
      respawnPoseRef.current = {
        position: { x: pose.xM, y: vehicleSpawnHeightM(config), z: pose.zM },
        rotation: headingToQuaternion(pose.headingRad),
      };
      driver.reset();
      setRespawnVersion((version) => version + 1);
    }
  });

  return (
    <GenericCar
      bodyRef={bodyRef}
      input={input}
      telemetryRef={telemetryRef}
      respawnVersion={respawnVersion}
      onTelemetry={noop}
      spawnPose={spawnPose}
      modelUrl={modelUrl}
      config={config}
      drivesClock={false}
      respawnPoseRef={respawnPoseRef}
      surfaceAt={surfaceAt}
    />
  );
}

function noop(): void { /* la télémétrie d'un adversaire n'alimente aucune interface */ }
