import { RigidBody, type RapierRigidBody, CuboidCollider } from '@react-three/rapier';
import { useFrame } from '@react-three/fiber';
import { useCallback, useLayoutEffect, useRef } from 'react';
import type { Group } from 'three';
import type { VehicleInput, VehicleTelemetry } from '../../shared/types';
import { genericVehicle } from '../configs/genericVehicle';
import { useVehiclePhysics, type WheelPose } from '../physics/useVehiclePhysics';

const rigidBodyMassProperties = {
  mass: genericVehicle.massKg,
  centerOfMass: {
    x: genericVehicle.centerOfGravityM.xM,
    y: genericVehicle.centerOfGravityM.yM,
    z: genericVehicle.centerOfGravityM.zM,
  },
  principalAngularInertia: {
    x: genericVehicle.principalInertiaKgM2.xM,
    y: genericVehicle.principalInertiaKgM2.yM,
    z: genericVehicle.principalInertiaKgM2.zM,
  },
  angularInertiaLocalFrame: { x: 0, y: 0, z: 0, w: 1 },
};

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
  suspensionM: 0.47,
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
          <cylinderGeometry args={[genericVehicle.wheelRadiusM, genericVehicle.wheelRadiusM, 0.22, 24]} />
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
    rigidBody.setTranslation({ x: 38, y: 0.9, z: 0 }, true);
    rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    rigidBody.resetForces(true);
    rigidBody.resetTorques(true);
    wheelPosesRef.current.forEach((wheel) => {
      wheel.suspensionM = 0.47;
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
      position={[38, 0.9, 0]}
      linearDamping={0.08}
      angularDamping={0.5}
      ccd
      canSleep={false}
    >
      <CuboidCollider
        args={[genericVehicle.dimensionsM.widthM / 2, genericVehicle.dimensionsM.heightM / 2, genericVehicle.dimensionsM.lengthM / 2]}
        massProperties={rigidBodyMassProperties}
        friction={0.72}
        restitution={0.08}
      />
      <group>
        <mesh position={[0, 0.12, -0.04]} castShadow receiveShadow>
          <boxGeometry args={[1.78, 0.48, 3.42]} />
          <meshStandardMaterial color="#c9e63f" metalness={0.38} roughness={0.32} />
        </mesh>
        <mesh position={[0, 0.4, -0.25]} castShadow>
          <boxGeometry args={[1.38, 0.48, 1.48]} />
          <meshStandardMaterial color="#252c2b" metalness={0.62} roughness={0.24} />
        </mesh>
        <mesh position={[0, 0.62, -0.24]} castShadow>
          <boxGeometry args={[1.19, 0.12, 1.18]} />
          <meshStandardMaterial color="#111b20" metalness={0.24} roughness={0.18} />
        </mesh>
        <mesh position={[0, 0.04, 1.05]} castShadow>
          <boxGeometry args={[1.7, 0.16, 0.56]} />
          <meshStandardMaterial color="#d7eb69" metalness={0.24} roughness={0.34} />
        </mesh>
        <mesh position={[0, 0.37, 1.55]}>
          <boxGeometry args={[0.62, 0.08, 0.04]} />
          <meshBasicMaterial color="#fff0ce" />
        </mesh>
        <mesh position={[-0.66, 0.36, 1.55]}>
          <boxGeometry args={[0.38, 0.08, 0.04]} />
          <meshBasicMaterial color="#d64f38" />
        </mesh>
        <mesh position={[0.66, 0.36, 1.55]}>
          <boxGeometry args={[0.38, 0.08, 0.04]} />
          <meshBasicMaterial color="#d64f38" />
        </mesh>
        <mesh position={[0, 0.0, -1.62]} castShadow>
          <boxGeometry args={[1.86, 0.1, 0.22]} />
          <meshStandardMaterial color="#232927" roughness={0.58} />
        </mesh>
        {physics.wheelMounts.map((wheel, index) => (
          <Wheel key={index} wheelPosesRef={wheelPosesRef} wheelIndex={index} side={wheel.xM < 0 ? -1 : 1} />
        ))}
      </group>
    </RigidBody>
  );
}
