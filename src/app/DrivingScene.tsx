import { Canvas } from '@react-three/fiber';
import { Physics, type RapierRigidBody } from '@react-three/rapier';
import { Suspense, useEffect } from 'react';
import type { GeoAnchor } from '../geo/projection';
import type { VehicleConfig, VehicleInput, VehicleTelemetry } from '../shared/types';
import { ChaseCamera } from '../camera/ChaseCamera';
import { PerfProbe } from '../debug/PerfProbe';
import { FollowingSun } from './FollowingSun';
import { CircuitScene } from '../circuits/CircuitScene';
import type { CircuitTrack } from '../circuits/circuitGeometry';
import { GenericCar } from '../vehicle/rendering/GenericCar';
import { DemoTrack } from '../world/terrain/DemoTrack';
import { StreamingRoadNetwork } from '../world/streaming/StreamingRoadNetwork';
import { FloatingOriginApplier } from '../world/streaming/FloatingOriginApplier';
import { useFloatingOrigin } from '../world/streaming/useFloatingOrigin';
import type { StreamedChunk } from '../world/streaming/chunkOwnership';
import type { RoadSpawnPose } from '../world/roads/spawnPlacement';
import { headingToQuaternion, vehicleSpawnHeightM, VEHICLE_FIXED_STEP_S } from '../vehicle/physics/vehicleBody';

export type DrivingWorld =
  | { kind: 'demo' }
  | { kind: 'roads'; worldAnchor: GeoAnchor; initialChunks: StreamedChunk[]; spawnPose: RoadSpawnPose }
  | { kind: 'circuit'; track: CircuitTrack };

interface DrivingSceneProps {
  input: React.RefObject<VehicleInput>;
  bodyRef: React.RefObject<RapierRigidBody | null>;
  telemetryRef: React.RefObject<VehicleTelemetry>;
  paused: boolean;
  respawnVersion: number;
  onTelemetry: (next: VehicleTelemetry) => void;
  world: DrivingWorld;
  /** Étape 4 : remonte l'ancre de rendu courante vers App.tsx (corrige la mini-carte après un recentrage — voir plan). */
  onRenderAnchorChange?: (anchor: GeoAnchor) => void;
  onZoneUnavailable?: (unavailable: boolean) => void;
  /** Modèle GLB du catalogue pour la carrosserie ; null/absent : carrosserie procédurale d'origine. */
  carModelUrl?: string | null;
  /** Configuration physique du véhicule choisi. */
  vehicle: VehicleConfig;
}

export function DrivingScene({
  input, bodyRef, telemetryRef, paused, respawnVersion, onTelemetry, world, onRenderAnchorChange, onZoneUnavailable, carModelUrl, vehicle,
}: DrivingSceneProps) {
  const spawnPose = world.kind === 'roads'
    ? { position: { x: world.spawnPose.position.xM, y: vehicleSpawnHeightM(vehicle), z: world.spawnPose.position.zM }, rotation: headingToQuaternion(world.spawnPose.headingRad) }
    : world.kind === 'circuit'
      ? { position: { x: world.track.spawn.xM, y: vehicleSpawnHeightM(vehicle), z: world.track.spawn.zM }, rotation: headingToQuaternion(world.track.spawn.headingRad) }
      : undefined;
  // Toujours appelé (règle des Hooks) ; sans effet pour la démo (worldAnchor fictive, jamais lue).
  const floatingOrigin = useFloatingOrigin(world.kind === 'roads' ? world.worldAnchor : { latitudeDeg: 0, longitudeDeg: 0 }, telemetryRef);

  useEffect(() => {
    if (world.kind === 'roads') onRenderAnchorChange?.(floatingOrigin.renderAnchor);
  }, [world.kind, floatingOrigin.renderAnchor, onRenderAnchorChange]);


  return (
    <Canvas
      className="game-canvas"
      shadows
      dpr={[1, 1.6]}
      camera={{ position: [45, 5, -7], fov: 52, near: 0.1, far: 240 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      fallback={<div className="fatal-state">WebGL n’est pas disponible dans ce navigateur.</div>}
    >
      <color attach="background" args={['#101918']} />
      <fog attach="fog" args={['#101918', 58, 145]} />
      <ambientLight intensity={0.72} />
      <hemisphereLight args={['#dbe5cb', '#27352d', 1.25]} />
      <FollowingSun bodyRef={bodyRef} />
      <Physics gravity={[0, -9.81, 0]} timeStep={VEHICLE_FIXED_STEP_S} interpolate={false} paused={paused}>
        <Suspense fallback={null}>
          {world.kind === 'demo' ? (
            <DemoTrack />
          ) : world.kind === 'circuit' ? (
            <CircuitScene track={world.track} />
          ) : (
            <StreamingRoadNetwork
              worldAnchor={world.worldAnchor}
              renderAnchor={floatingOrigin.renderAnchor}
              telemetryRef={telemetryRef}
              initialChunks={world.initialChunks}
              onZoneUnavailable={onZoneUnavailable}
            />
          )}
          <GenericCar
            bodyRef={bodyRef}
            input={input}
            telemetryRef={telemetryRef}
            respawnVersion={respawnVersion}
            onTelemetry={onTelemetry}
            spawnPose={spawnPose}
            onAfterPhysicsStep={world.kind === 'roads' ? floatingOrigin.onAfterPhysicsStep : undefined}
            modelUrl={carModelUrl}
            config={vehicle}
          />
          <FloatingOriginApplier origin={floatingOrigin} />
          <ChaseCamera bodyRef={bodyRef} snapVersion={respawnVersion} />
          <PerfProbe />
        </Suspense>
      </Physics>
    </Canvas>
  );
}
