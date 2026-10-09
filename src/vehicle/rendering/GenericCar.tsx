import { RigidBody, type RapierRigidBody, CuboidCollider } from '@react-three/rapier';
import { useFrame } from '@react-three/fiber';
import { useCallback, useLayoutEffect, useRef } from 'react';
import type { Group } from 'three';
import type { VehicleInput, VehicleTelemetry } from '../../shared/types';
import { genericVehicle } from '../configs/genericVehicle';
import { useVehiclePhysics, type WheelPose } from '../physics/useVehiclePhysics';
import { resetVehicleBody, vehicleMassProperties, VEHICLE_COLLIDER_FRICTION, VEHICLE_COLLIDER_RESTITUTION, VEHICLE_SPAWN } from '../physics/vehicleBody';

const rigidBodyMassProperties = vehicleMassProperties(genericVehicle);

interface GenericCarProps {
  bodyRef: React.RefObject<RapierRigidBody | null>;
  input: React.RefObject<VehicleInput>;
  telemetryRef: React.RefObject<VehicleTelemetry>;
  respawnVersion: number;
  onTelemetry: (telemetry: VehicleTelemetry) => void;
}

const initialWheelPoses = (): WheelPose[] => genericVehicle.wheelMounts.map(({ xM, zM }) => ({
  xM,
  zM,
  suspensionM: 0.41,
  steeringRad: 0,
  spinRad: 0,
}));

function Wheel({ wheelPosesRef, wheelIndex, side }: { wheelPosesRef: React.RefObject<WheelPose[]>; wheelIndex: number; side: number }) {
  const steeringGroup = useRef<Group>(null);
  const spinGroup = useRef<Group>(null);

  useFrame(() => {
    const pose = wheelPosesRef.current[wheelIndex];
    if (steeringGroup.current) {
      steeringGroup.current.position.set(pose.xM, -0.08 - pose.suspensionM, pose.zM);
      steeringGroup.current.rotation.y = pose.steeringRad;
    }
    if (spinGroup.current) spinGroup.current.rotation.x = pose.spinRad;
  });

  return (
    <group ref={steeringGroup}>
      <group ref={spinGroup}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[genericVehicle.wheelRadiusM, genericVehicle.wheelRadiusM, 0.19, 24]} />
          <meshStandardMaterial color="#171a19" roughness={0.82} />
        </mesh>
        <mesh position={[side * 0.116, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.205, 0.205, 0.015, 20]} />
          <meshStandardMaterial color="#c6c9bb" metalness={0.72} roughness={0.28} />
        </mesh>
        <mesh position={[side * 0.127, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.07, 0.07, 0.018, 16]} />
          <meshStandardMaterial color="#e46643" metalness={0.55} roughness={0.32} />
        </mesh>
      </group>
    </group>
  );
}

export function GenericCar({ bodyRef, input, telemetryRef, respawnVersion, onTelemetry }: GenericCarProps) {
  const wheelPosesRef = useRef(initialWheelPoses());
  const physics = useVehiclePhysics({ bodyRef, input, telemetryRef, wheelPosesRef, respawnVersion, onTelemetry });
  const previousRespawnVersion = useRef(respawnVersion);

  const respawn = useCallback(() => {
    const rigidBody = bodyRef.current;
    if (!rigidBody) return;
    resetVehicleBody(rigidBody);
    wheelPosesRef.current.forEach((wheel) => {
      wheel.suspensionM = 0.41;
      wheel.spinRad = 0;
      wheel.steeringRad = 0;
    });
    telemetryRef.current = { speedMps: 0, engineRpm: genericVehicle.idleRpm, gear: 1, slip: 0, groundedWheels: 0, throttle: 0, brake: 0, steering: 0 };
  }, [bodyRef, telemetryRef]);

  useLayoutEffect(() => {
    if (previousRespawnVersion.current !== respawnVersion) {
      previousRespawnVersion.current = respawnVersion;
      respawn();
    }
  }, [respawn, respawnVersion]);

  return (
    <RigidBody
      ref={bodyRef}
      name="generic-car-chassis"
      colliders={false}
      position={[VEHICLE_SPAWN.x, VEHICLE_SPAWN.y, VEHICLE_SPAWN.z]}
      linearDamping={genericVehicle.linearDamping}
      angularDamping={genericVehicle.angularDamping}
      ccd
      canSleep={false}
    >
      <CuboidCollider
        args={[genericVehicle.dimensionsM.widthM / 2, genericVehicle.dimensionsM.heightM / 2, genericVehicle.dimensionsM.lengthM / 2]}
        massProperties={rigidBodyMassProperties}
        friction={VEHICLE_COLLIDER_FRICTION}
        restitution={VEHICLE_COLLIDER_RESTITUTION}
      />
      <group>
        {/* Soubassement : empattement et voie plus larges, silhouette de citadine haute (Citroën C3 phase 2). */}
        <mesh position={[0, 0.16, -0.05]} castShadow receiveShadow>
          <boxGeometry args={[1.6, 0.54, 3.7]} />
          <meshStandardMaterial color="#c9e63f" metalness={0.38} roughness={0.32} />
        </mesh>
        {/* Habitacle haut et carré : trait marquant d'une citadine à vocation pratique. */}
        <mesh position={[0, 0.83, -0.27]} castShadow>
          <boxGeometry args={[1.28, 0.8, 1.6]} />
          <meshStandardMaterial color="#252c2b" metalness={0.62} roughness={0.24} />
        </mesh>
        <mesh position={[0, 1.31, -0.26]} castShadow>
          <boxGeometry args={[1.09, 0.16, 1.28]} />
          <meshStandardMaterial color="#111b20" metalness={0.24} roughness={0.18} />
        </mesh>
        {/* Capot court, face avant arrondie avec barre chromée entre les blocs optiques ronds. */}
        <mesh position={[0, 0.08, 1.14]} castShadow>
          <boxGeometry args={[1.56, 0.2, 0.61]} />
          <meshStandardMaterial color="#d7eb69" metalness={0.24} roughness={0.34} />
        </mesh>
        <mesh position={[0, 0.3, 1.68]}>
          <boxGeometry args={[1.08, 0.05, 0.04]} />
          <meshStandardMaterial color="#c6c9bb" metalness={0.85} roughness={0.2} />
        </mesh>
        <mesh position={[-0.58, 0.26, 1.68]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.17, 0.17, 0.05, 20]} />
          <meshBasicMaterial color="#fff0ce" />
        </mesh>
        <mesh position={[0.58, 0.26, 1.68]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.17, 0.17, 0.05, 20]} />
          <meshBasicMaterial color="#fff0ce" />
        </mesh>
        <mesh position={[0, 0.04, -1.75]} castShadow>
          <boxGeometry args={[1.7, 0.12, 0.24]} />
          <meshStandardMaterial color="#232927" roughness={0.58} />
        </mesh>
        <mesh position={[-0.62, 0.3, -1.84]}>
          <boxGeometry args={[0.32, 0.1, 0.04]} />
          <meshBasicMaterial color="#d64f38" />
        </mesh>
        <mesh position={[0.62, 0.3, -1.84]}>
          <boxGeometry args={[0.32, 0.1, 0.04]} />
          <meshBasicMaterial color="#d64f38" />
        </mesh>
        {physics.wheelMounts.map((wheel, index) => (
          <Wheel key={index} wheelPosesRef={wheelPosesRef} wheelIndex={index} side={wheel.xM < 0 ? -1 : 1} />
        ))}
      </group>
    </RigidBody>
  );
}
