import { Canvas } from '@react-three/fiber';
import { Physics, type RapierRigidBody } from '@react-three/rapier';
import { createRef, Suspense, useEffect, useMemo, useRef } from 'react';
import type { GeoAnchor } from '../geo/projection';
import type { VehicleConfig, VehicleInput, VehicleTelemetry } from '../shared/types';
import { ChaseCamera } from '../camera/ChaseCamera';
import { AudioDriver } from '../audio/AudioDriver';
import { PerfProbe } from '../debug/PerfProbe';
import { RaceDriver, type RaceSnapshot } from '../race/RaceDriver';
import type { LapTimerEvent } from '../race/lapTimer';
import type { Ghost } from '../race/ghost';
import type { GridSlot } from '../race/grid';
import { createCircuitSurface } from '../race/circuitSurface';
import { OpponentCar, type OpponentSpec } from '../race/OpponentCar';
import { RolloverGuard } from '../race/RolloverGuard';
import { PlayerAutopilot } from '../race/PlayerAutopilot';
import { RaceDirector, type RaceState } from '../race/RaceDirector';
import { TireEffects } from '../feel/TireEffects';
import type { TractionControl, Transmission, WheelPose } from '../vehicle/physics/VehicleSimulation';
import { FollowingSun } from './FollowingSun';
import { CircuitScene } from '../circuits/CircuitScene';
import type { CircuitTrack } from '../circuits/circuitGeometry';
import { GenericCar, type VehicleSpawnPose } from '../vehicle/rendering/GenericCar';
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
  /** Identifiant du catalogue du véhicule (caractère du moteur) ; null pour le prototype. */
  carId: string | null;
  /** Tremblement de caméra et champ de vision variable (réglage du joueur). */
  cameraEffects: boolean;
  /** Chronométrage (circuits uniquement). */
  race?: {
    referenceProfileS: readonly number[] | null;
    ghost: Ghost | null;
    onLapGhost: (ghost: Ghost) => void;
    onSnapshot: (snapshot: RaceSnapshot) => void;
    onEvent: (event: LapTimerEvent) => void;
  };
  /** Contrôle de traction du joueur (aide à la conduite). */
  tractionControl?: TractionControl;
  /** Boîte de vitesses du joueur (automatique par défaut). */
  transmission?: Transmission;
  /** Voiture du joueur retournée (état) et remise en piste d'office en course. */
  onFlippedChange?: (flipped: boolean) => void;
  onAutoRecover?: () => void;
  /** Crochet de test (`?autopilot`) : le pilote automatique conduit la voiture du joueur sur un circuit. */
  autopilot?: boolean;
  /** Course contre des adversaires pilotés par l'IA (circuits uniquement). */
  field?: {
    laps: number;
    opponents: OpponentSpec[];
    playerSlot: GridSlot;
    opponentModelUrl: string | null;
    onState: (state: RaceState) => void;
  };
}

export function DrivingScene({
  input, bodyRef, telemetryRef, paused, respawnVersion, onTelemetry, world, onRenderAnchorChange, onZoneUnavailable, carModelUrl, vehicle, carId, cameraEffects, race, field, autopilot, tractionControl, transmission, onFlippedChange, onAutoRecover,
}: DrivingSceneProps) {
  // Poses de roues du solveur, partagées avec les effets de pneus (fumée, traces).
  const wheelPosesRef = useRef<WheelPose[] | null>(null);
  // Course : corps des adversaires (pour le chef de course), signal de départ et point de reprise du joueur.
  // Sur circuit, l'herbe et le gravier hors de la piste adhèrent moins que l'asphalte.
  const playerSurface = useMemo(() => (world.kind === 'circuit' ? createCircuitSurface(world.track) : undefined), [world]);
  const goRef = useRef({ go: false });
  const playerRespawnPoseRef = useRef<VehicleSpawnPose | null>(null);
  const opponentBodies = useMemo(() => (field ? field.opponents.map((opponent) => ({ id: opponent.id, bodyRef: createRef<RapierRigidBody>() })) : []), [field]);
  const spawnPose = world.kind === 'roads'
    ? { position: { x: world.spawnPose.position.xM, y: vehicleSpawnHeightM(vehicle), z: world.spawnPose.position.zM }, rotation: headingToQuaternion(world.spawnPose.headingRad) }
    : world.kind === 'circuit'
      ? {
        position: { x: field?.playerSlot.xM ?? world.track.spawn.xM, y: vehicleSpawnHeightM(vehicle), z: field?.playerSlot.zM ?? world.track.spawn.zM },
        rotation: headingToQuaternion(field?.playerSlot.headingRad ?? world.track.spawn.headingRad),
      }
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
            wheelPosesOutRef={wheelPosesRef}
            respawnPoseRef={field ? playerRespawnPoseRef : undefined}
            surfaceAt={playerSurface}
            tractionControl={tractionControl}
            transmission={transmission}
          />
          <FloatingOriginApplier origin={floatingOrigin} />
          <ChaseCamera bodyRef={bodyRef} snapVersion={respawnVersion} effects={cameraEffects} />
          <TireEffects wheelPosesRef={wheelPosesRef} bodyRef={bodyRef} paused={paused} />
          <AudioDriver bodyRef={bodyRef} telemetryRef={telemetryRef} wheelPosesRef={wheelPosesRef} vehicle={vehicle} carId={carId} paused={paused} respawnVersion={respawnVersion} />
          {world.kind === 'circuit' && race && (
            <RaceDriver track={world.track} bodyRef={bodyRef} respawnVersion={respawnVersion} referenceProfileS={race.referenceProfileS} ghost={race.ghost} ghostHeightM={vehicleSpawnHeightM(vehicle) * 0.6} onLapGhost={race.onLapGhost} onSnapshot={race.onSnapshot} onEvent={race.onEvent} />
          )}
          {world.kind === 'circuit' && autopilot && (
            <PlayerAutopilot track={world.track} config={vehicle} bodyRef={bodyRef} input={input} telemetryRef={telemetryRef} respawnVersion={respawnVersion} />
          )}
          {world.kind === 'circuit' && field && (
            <>
              {field.opponents.map((opponent, index) => (
                <OpponentCar
                  key={opponent.id}
                  spec={opponent}
                  track={world.track}
                  config={vehicle}
                  modelUrl={field.opponentModelUrl}
                  bodyRef={opponentBodies[index].bodyRef}
                  goRef={goRef}
                />
              ))}
              <RaceDirector
                track={world.track}
                totalLaps={field.laps}
                config={vehicle}
                playerBodyRef={bodyRef}
                opponents={opponentBodies}
                goRef={goRef}
                respawnPoseRef={playerRespawnPoseRef}
                onState={field.onState}
              />
            </>
          )}
          {onFlippedChange && <RolloverGuard bodyRef={bodyRef} onFlippedChange={onFlippedChange} onAutoRecover={field ? onAutoRecover : undefined} />}
          <PerfProbe />
        </Suspense>
      </Physics>
    </Canvas>
  );
}
