import { RigidBody, type RapierRigidBody, CuboidCollider } from '@react-three/rapier';
import { useFrame } from '@react-three/fiber';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { ExtrudeGeometry, Shape, type Group } from 'three';
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

// Gabarit repris de la configuration physique (proche d'une Citroën C3 II phase 2,
// restylage 2013-2016 : ~3,94 x 1,73 x 1,53 m, empattement ~2,47 m) : la carrosserie
// ci-dessous est construite à partir de ces nombres, jamais de valeurs indépendantes,
// pour qu'elle reste toujours cohérente avec le châssis Rapier.
const { lengthM: BODY_LENGTH_M, widthM: BODY_WIDTH_M, heightM: BODY_HEIGHT_M } = genericVehicle.dimensionsM;
const HALF_LENGTH_M = BODY_LENGTH_M / 2;
const HALF_WIDTH_M = BODY_WIDTH_M / 2;
const FRONT_AXLE_Z = genericVehicle.wheelbaseM / 2;
const REAR_AXLE_Z = -genericVehicle.wheelbaseM / 2;
const WHEEL_RADIUS_M = genericVehicle.wheelRadiusM;
// Affaissement visuel au repos des suspensions : doit rester identique dans initialWheelPoses et respawn().
const WHEEL_REST_SUSPENSION_M = 0.41;
// Hauteur du sol sous l'origine du châssis (support de roue + affaissement + rayon) : permet
// de placer toute la carrosserie en coordonnées "hauteur au-dessus du sol", plus lisibles.
const GROUND_OFFSET_M = -(0.08 + WHEEL_REST_SUSPENSION_M + WHEEL_RADIUS_M);

const PAINT_COLOR = '#c9e63f';
const PAINT_SHADOW_COLOR = '#a9c436';
const GLASS_COLOR = '#101d27';
const TRIM_BLACK = '#17191a';
const CHROME_COLOR = '#d9dcd4';
const ALLOY_COLOR = '#c7cac0';
const HEADLIGHT_COLOR = '#fff4e2';
const INDICATOR_AMBER = '#dba23a';
const TAILLIGHT_RED = '#c1382a';
const TAILLIGHT_WHITE = '#e9e6da';
const PLATE_COLOR = '#eef0ea';

/**
 * Silhouette latérale (z = longueur, v = hauteur au sol) extrudée sur toute la largeur :
 * capot court et plongeant, pare-brise incliné, pavillon haut et continu, hayon arrondi,
 * passages de roue creusés dans le bas de caisse. Construite une seule fois au chargement
 * du module (pas de géométrie recréée par frame ni par rendu).
 */
function buildBodyShellGeometry() {
  const rearTipZ = -HALF_LENGTH_M;
  const frontTipZ = HALF_LENGTH_M;
  const sillY = 0.16;

  const shape = new Shape();
  shape.moveTo(rearTipZ, sillY);
  shape.quadraticCurveTo(rearTipZ - 0.05, sillY + 0.2, rearTipZ + 0.1, sillY + 0.36);
  shape.lineTo(rearTipZ + 0.24, sillY + 0.44);
  shape.lineTo(REAR_AXLE_Z - 0.22, 0.92);
  shape.lineTo(REAR_AXLE_Z + 0.18, 1.38);
  shape.lineTo(REAR_AXLE_Z + 0.68, 1.47);
  shape.quadraticCurveTo(0.05, 1.52, 0.6, 1.47);
  shape.lineTo(FRONT_AXLE_Z - 0.23, 1.15);
  shape.lineTo(FRONT_AXLE_Z - 0.13, 0.95);
  shape.lineTo(FRONT_AXLE_Z + 0.22, 0.68);
  shape.lineTo(frontTipZ - 0.22, 0.58);
  shape.lineTo(frontTipZ - 0.06, 0.48);
  shape.quadraticCurveTo(frontTipZ + 0.05, sillY + 0.18, frontTipZ, sillY);
  shape.lineTo(frontTipZ - 0.2, sillY);
  shape.quadraticCurveTo(FRONT_AXLE_Z, sillY + 1.14, FRONT_AXLE_Z - 0.5, sillY);
  shape.lineTo(REAR_AXLE_Z + 0.5, sillY);
  shape.quadraticCurveTo(REAR_AXLE_Z, sillY + 1.14, rearTipZ + 0.24, sillY);
  shape.closePath();

  const geometry = new ExtrudeGeometry(shape, {
    depth: BODY_WIDTH_M,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.03,
    bevelSegments: 3,
    curveSegments: 14,
  });
  // Le profil est dessiné dans le plan (longueur, hauteur) et extrudé localement selon Z ;
  // on recentre cette extrusion sur la largeur puis on la fait pivoter pour l'aligner sur X.
  geometry.translate(0, 0, -BODY_WIDTH_M / 2);
  geometry.rotateY(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

const bodyShellGeometry = buildBodyShellGeometry();

const SPOKE_ANGLES = Array.from({ length: 5 }, (_, index) => (index / 5) * Math.PI * 2);
const LUG_ANGLES = Array.from({ length: 5 }, (_, index) => (index / 5) * Math.PI * 2 + Math.PI / 5);
const RIM_OUTER_R = WHEEL_RADIUS_M * 0.82;
const RIM_INNER_R = WHEEL_RADIUS_M * 0.22;

const initialWheelPoses = (): WheelPose[] => genericVehicle.wheelMounts.map(({ xM, zM }) => ({
  xM,
  zM,
  suspensionM: WHEEL_REST_SUSPENSION_M,
  steeringRad: 0,
  spinRad: 0,
  temperatureC: genericVehicle.ambientTemperatureC,
}));

/** Roue à jante aluminium 5 branches : pneu, disque de frein, jante, branches et écrous. */
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
          <cylinderGeometry args={[WHEEL_RADIUS_M, WHEEL_RADIUS_M, 0.19, 28]} />
          <meshStandardMaterial color={TRIM_BLACK} roughness={0.88} />
        </mesh>
        <mesh position={[side * 0.1, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[WHEEL_RADIUS_M * 0.72, WHEEL_RADIUS_M * 0.72, 0.02, 24]} />
          <meshStandardMaterial color="#2a2b2a" metalness={0.3} roughness={0.55} />
        </mesh>
        <mesh position={[side * 0.122, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[RIM_OUTER_R, RIM_OUTER_R, 0.016, 24]} />
          <meshStandardMaterial color={ALLOY_COLOR} metalness={0.85} roughness={0.25} />
        </mesh>
        {SPOKE_ANGLES.map((angle) => (
          <mesh
            key={angle}
            position={[side * 0.123, Math.sin(angle) * RIM_OUTER_R * 0.5, Math.cos(angle) * RIM_OUTER_R * 0.5]}
            rotation={[angle, 0, 0]}
            castShadow
          >
            <boxGeometry args={[0.035, RIM_OUTER_R * 0.8, 0.05]} />
            <meshStandardMaterial color={ALLOY_COLOR} metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
        <mesh position={[side * 0.13, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[RIM_INNER_R, RIM_INNER_R, 0.03, 16]} />
          <meshStandardMaterial color="#9a9c96" metalness={0.75} roughness={0.3} />
        </mesh>
        {LUG_ANGLES.map((angle) => (
          <mesh
            key={angle}
            position={[side * 0.136, Math.sin(angle) * RIM_INNER_R * 0.6, Math.cos(angle) * RIM_INNER_R * 0.6]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.012, 0.012, 0.015, 8]} />
            <meshStandardMaterial color="#48494a" metalness={0.6} roughness={0.4} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Vitrage : baie latérale (portes + custode), pare-brise et lunette inclinés, posés en léger surplomb de la carrosserie. */
function Glasshouse() {
  return (
    <>
      <mesh position={[0, 1.16, -0.02]} castShadow={false}>
        <boxGeometry args={[BODY_WIDTH_M * 1.01, 0.34, FRONT_AXLE_Z - REAR_AXLE_Z - 0.46]} />
        <meshPhysicalMaterial color={GLASS_COLOR} metalness={0.2} roughness={0.12} transparent opacity={0.88} clearcoat={0.6} />
      </mesh>
      <mesh position={[0, 1.05, FRONT_AXLE_Z + 0.02]} rotation={[-0.46, 0, 0]}>
        <boxGeometry args={[BODY_WIDTH_M * 0.92, 0.24, 0.04]} />
        <meshPhysicalMaterial color={GLASS_COLOR} metalness={0.2} roughness={0.12} transparent opacity={0.82} clearcoat={0.6} />
      </mesh>
      <mesh position={[0, 1.16, REAR_AXLE_Z - 0.24]} rotation={[0.72, 0, 0]}>
        <boxGeometry args={[BODY_WIDTH_M * 0.9, 0.28, 0.04]} />
        <meshPhysicalMaterial color={GLASS_COLOR} metalness={0.2} roughness={0.12} transparent opacity={0.82} clearcoat={0.6} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * (HALF_WIDTH_M + 0.006), 1.15, FRONT_AXLE_Z - 0.26]} rotation={[-0.46, 0, 0]}>
            <boxGeometry args={[0.02, 0.44, 0.05]} />
            <meshStandardMaterial color={TRIM_BLACK} roughness={0.7} />
          </mesh>
          <mesh position={[side * (HALF_WIDTH_M + 0.006), 1.16, -0.04]}>
            <boxGeometry args={[0.02, 0.4, 0.05]} />
            <meshStandardMaterial color={TRIM_BLACK} roughness={0.7} />
          </mesh>
          <mesh position={[side * (HALF_WIDTH_M + 0.006), 1.18, REAR_AXLE_Z + 0.28]} rotation={[0.3, 0, 0]}>
            <boxGeometry args={[0.02, 0.42, 0.05]} />
            <meshStandardMaterial color={TRIM_BLACK} roughness={0.7} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/** Face avant : optiques remontant sur les ailes, double barre chromée, antibrouillards, prise d'air basse et plaque. */
function FrontFascia() {
  const tipZ = HALF_LENGTH_M;
  return (
    <>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * (HALF_WIDTH_M - 0.1), 0.52, tipZ - 0.22]} rotation={[0, side * 0.42, 0]}>
          <mesh scale={[0.2, 0.1, 0.09]} castShadow>
            <sphereGeometry args={[1, 20, 16]} />
            <meshStandardMaterial color={HEADLIGHT_COLOR} emissive={HEADLIGHT_COLOR} emissiveIntensity={0.25} metalness={0.1} roughness={0.2} />
          </mesh>
          <mesh position={[0.1, -0.02, 0.085]}>
            <circleGeometry args={[0.025, 16]} />
            <meshBasicMaterial color={INDICATOR_AMBER} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.42, tipZ - 0.08]}>
        <boxGeometry args={[0.72, 0.03, 0.03]} />
        <meshStandardMaterial color={CHROME_COLOR} metalness={0.9} roughness={0.18} />
      </mesh>
      <mesh position={[0, 0.34, tipZ - 0.08]}>
        <boxGeometry args={[0.72, 0.03, 0.03]} />
        <meshStandardMaterial color={CHROME_COLOR} metalness={0.9} roughness={0.18} />
      </mesh>
      {/* Emblème générique (losange chromé) : le double-chevron Citroën n'est pas reproduit, c'est une marque déposée. */}
      <mesh position={[0, 0.38, tipZ - 0.06]} rotation={[Math.PI / 2, 0, Math.PI / 4]}>
        <cylinderGeometry args={[0.055, 0.055, 0.02, 4]} />
        <meshStandardMaterial color={CHROME_COLOR} metalness={0.95} roughness={0.12} />
      </mesh>
      <mesh position={[0, 0.22, tipZ - 0.04]}>
        <boxGeometry args={[1.02, 0.15, 0.05]} />
        <meshStandardMaterial color={TRIM_BLACK} roughness={0.75} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (HALF_WIDTH_M - 0.26), 0.22, tipZ - 0.045]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.055, 0.055, 0.03, 16]} />
          <meshStandardMaterial color={TRIM_BLACK} roughness={0.4} metalness={0.1} />
        </mesh>
      ))}
      <mesh position={[0, 0.28, tipZ - 0.01]}>
        <boxGeometry args={[0.32, 0.11, 0.015]} />
        <meshStandardMaterial color={PLATE_COLOR} roughness={0.5} />
      </mesh>
    </>
  );
}

/** Face arrière : feux rouge/blanc d'angle, troisième feu stop, essuie-glace, plaque et pare-chocs. */
function RearFascia() {
  const tipZ = -HALF_LENGTH_M;
  return (
    <>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * (HALF_WIDTH_M - 0.04), 0.56, tipZ + 0.2]} castShadow>
            <boxGeometry args={[0.12, 0.34, 0.3]} />
            <meshStandardMaterial color={TAILLIGHT_RED} emissive={TAILLIGHT_RED} emissiveIntensity={0.15} roughness={0.3} />
          </mesh>
          <mesh position={[side * (HALF_WIDTH_M - 0.04), 0.46, tipZ + 0.33]}>
            <boxGeometry args={[0.1, 0.1, 0.02]} />
            <meshStandardMaterial color={TAILLIGHT_WHITE} roughness={0.35} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 1.46, REAR_AXLE_Z + 0.6]}>
        <boxGeometry args={[0.4, 0.04, 0.04]} />
        <meshStandardMaterial color={TAILLIGHT_RED} emissive={TAILLIGHT_RED} emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[-0.3, 1.14, REAR_AXLE_Z - 0.3]} rotation={[0.72, 0, 0.1]}>
        <cylinderGeometry args={[0.008, 0.008, 0.26, 6]} />
        <meshStandardMaterial color={TRIM_BLACK} roughness={0.6} />
      </mesh>
      {/* Emblème générique (ovale chromé) : pas de logo Citroën reproduit. */}
      <mesh position={[0, 0.55, tipZ + 0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.02, 20]} />
        <meshStandardMaterial color={CHROME_COLOR} metalness={0.9} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.3, tipZ + 0.01]}>
        <boxGeometry args={[0.32, 0.11, 0.015]} />
        <meshStandardMaterial color={PLATE_COLOR} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.2, tipZ + 0.03]}>
        <boxGeometry args={[BODY_WIDTH_M * 0.98, 0.16, 0.06]} />
        <meshStandardMaterial color={TRIM_BLACK} roughness={0.7} />
      </mesh>
    </>
  );
}

/** Rétroviseurs, poignées de porte et bas de caisse. */
function SideDetails() {
  return (
    <>
      {[-1, 1].map((side) => (
        <group key={side}>
          <group position={[side * (HALF_WIDTH_M + 0.03), 1.06, FRONT_AXLE_Z - 0.35]} rotation={[0, side * 0.1, 0]}>
            <mesh castShadow>
              <boxGeometry args={[0.07, 0.11, 0.2]} />
              <meshStandardMaterial color={PAINT_COLOR} metalness={0.3} roughness={0.35} />
            </mesh>
            <mesh position={[side * 0.025, 0, -0.03]}>
              <boxGeometry args={[0.015, 0.08, 0.13]} />
              <meshStandardMaterial color={GLASS_COLOR} metalness={0.6} roughness={0.15} />
            </mesh>
            <mesh position={[0, -0.04, 0.1]}>
              <boxGeometry args={[0.05, 0.025, 0.03]} />
              <meshStandardMaterial color={INDICATOR_AMBER} emissive={INDICATOR_AMBER} emissiveIntensity={0.3} />
            </mesh>
          </group>
          <mesh position={[side * (HALF_WIDTH_M + 0.004), 0.92, FRONT_AXLE_Z - 0.58]}>
            <boxGeometry args={[0.012, 0.03, 0.09]} />
            <meshStandardMaterial color={CHROME_COLOR} metalness={0.85} roughness={0.25} />
          </mesh>
          <mesh position={[side * (HALF_WIDTH_M + 0.004), 0.92, REAR_AXLE_Z + 0.58]}>
            <boxGeometry args={[0.012, 0.03, 0.09]} />
            <meshStandardMaterial color={CHROME_COLOR} metalness={0.85} roughness={0.25} />
          </mesh>
          <mesh position={[side * (HALF_WIDTH_M - 0.015), 0.2, 0]}>
            <boxGeometry args={[0.03, 0.06, genericVehicle.wheelbaseM + 0.3]} />
            <meshStandardMaterial color={TRIM_BLACK} roughness={0.75} />
          </mesh>
        </group>
      ))}
    </>
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
      wheel.suspensionM = WHEEL_REST_SUSPENSION_M;
      wheel.spinRad = 0;
      wheel.steeringRad = 0;
      wheel.temperatureC = genericVehicle.ambientTemperatureC;
    });
    telemetryRef.current = {
      speedMps: 0, engineRpm: genericVehicle.idleRpm, gear: 1, slip: 0, groundedWheels: 0, throttle: 0, brake: 0, steering: 0,
      tireTemperaturesC: wheelPosesRef.current.map((wheel) => wheel.temperatureC),
    };
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
        args={[BODY_WIDTH_M / 2, BODY_HEIGHT_M / 2, BODY_LENGTH_M / 2]}
        massProperties={rigidBodyMassProperties}
        friction={VEHICLE_COLLIDER_FRICTION}
        restitution={VEHICLE_COLLIDER_RESTITUTION}
      />
      <group position={[0, GROUND_OFFSET_M, 0]}>
        <mesh geometry={bodyShellGeometry} castShadow receiveShadow>
          <meshStandardMaterial color={PAINT_COLOR} metalness={0.42} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.17, 0]}>
          <boxGeometry args={[BODY_WIDTH_M * 1.002, 0.1, BODY_LENGTH_M - 0.1]} />
          <meshStandardMaterial color={PAINT_SHADOW_COLOR} metalness={0.2} roughness={0.55} />
        </mesh>
        <Glasshouse />
        <FrontFascia />
        <RearFascia />
        <SideDetails />
      </group>
      {physics.wheelMounts.map((wheel, index) => (
        <Wheel key={index} wheelPosesRef={wheelPosesRef} wheelIndex={index} side={wheel.xM < 0 ? -1 : 1} />
      ))}
    </RigidBody>
  );
}
