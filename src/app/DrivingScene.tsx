import { Canvas } from '@react-three/fiber';
import { Physics, type RapierRigidBody } from '@react-three/rapier';
import { Suspense } from 'react';
import type { VehicleInput, VehicleTelemetry } from '../shared/types';
import { ChaseCamera } from '../camera/ChaseCamera';
import { GenericCar } from '../vehicle/rendering/GenericCar';
import { DemoTrack } from '../world/terrain/DemoTrack';
import { VEHICLE_FIXED_STEP_S } from '../vehicle/physics/vehicleBody';

interface DrivingSceneProps {
  input: React.RefObject<VehicleInput>;
  bodyRef: React.RefObject<RapierRigidBody | null>;
  telemetryRef: React.RefObject<VehicleTelemetry>;
  paused: boolean;
  respawnVersion: number;
  onTelemetry: (next: VehicleTelemetry) => void;
}

export function DrivingScene({ input, bodyRef, telemetryRef, paused, respawnVersion, onTelemetry }: DrivingSceneProps) {
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
      <directionalLight position={[-30, 48, 20]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-75} shadow-camera-right={75} shadow-camera-top={75} shadow-camera-bottom={-75} />
      <Physics gravity={[0, -9.81, 0]} timeStep={VEHICLE_FIXED_STEP_S} interpolate paused={paused}>
        <Suspense fallback={null}>
          <DemoTrack />
          <GenericCar bodyRef={bodyRef} input={input} telemetryRef={telemetryRef} respawnVersion={respawnVersion} onTelemetry={onTelemetry} />
          <ChaseCamera bodyRef={bodyRef} snapVersion={respawnVersion} />
        </Suspense>
      </Physics>
    </Canvas>
  );
}
