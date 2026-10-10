import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody, TrimeshCollider } from '@react-three/rapier';
import { useEffect, useMemo } from 'react';
import { DoubleSide, MeshStandardMaterial } from 'three';
import { createCircuitAsphaltTexture, createCircuitGroundTexture, createKerbTexture } from '../world/textures/proceduralTextures';
import type { CircuitTrack } from './circuitGeometry';
import { buildCircuitLayout } from './circuitMesh';

const GROUND_Y = -0.05;
const GROUND_HALF_HEIGHT_M = 0.05;
const GROUND_TILE_M = 4;
/** Le visuel de l'herbe est abaissé de 4 cm sous son collider : à 1 cm d'écart avec la piste, le z-buffer les confond dès quelques dizaines de mètres (plaques d'herbe qui percent l'asphalte). */
const GROUND_VISUAL_DROP_M = 0.04;
const START_LINE_DEPTH_M = 1.4;

const wallMaterial = new MeshStandardMaterial({ color: '#d8dcdf', roughness: 0.8, side: DoubleSide });
const startLineMaterial = new MeshStandardMaterial({ color: '#f4f4ef', roughness: 0.7 });

/** Humidité de la piste (0..1), lue à chaque image pour assombrir et rendre luisant le revêtement. */
interface CircuitSceneProps {
  track: CircuitTrack;
  environmentRef?: React.RefObject<{ wetness: number }>;
}

const DRY_ROUGHNESS = 0.92;

/** Piste mouillée : revêtement plus sombre et plus lisse (fonction externe : le matériau vient d'un useMemo). */
function applyWetLook(material: MeshStandardMaterial, wetness: number): void {
  material.roughness = DRY_ROUGHNESS - 0.62 * wetness;
  material.color.setScalar(1 - 0.32 * wetness);
}

/**
 * Circuit complet dans un seul repère local (l'ancre est la ligne de départ) : pas de chunks ni
 * d'origine flottante, un circuit de F1 tient dans quelques kilomètres. Sol herbeux avec
 * collider, piste et vibreurs (visuels), murs d'enceinte (visuels + collider trimesh).
 */
export function CircuitScene({ track, environmentRef }: CircuitSceneProps) {
  const layout = useMemo(() => buildCircuitLayout(track), [track]);
  const asphaltMaterial = useMemo(() => new MeshStandardMaterial({ map: createCircuitAsphaltTexture(), roughness: 0.92 }), []);
  const kerbMaterial = useMemo(() => new MeshStandardMaterial({ map: createKerbTexture(), roughness: 0.7 }), []);
  const groundTexture = useMemo(() => createCircuitGroundTexture(), []);
  const groundMaterial = useMemo(() => new MeshStandardMaterial({ map: groundTexture, roughness: 0.95 }), [groundTexture]);

  useFrame(() => { if (environmentRef) applyWetLook(asphaltMaterial, environmentRef.current.wetness); });

  const [groundHalfX, groundHalfZ] = layout.ground.halfExtentM;
  useEffect(() => {
    groundTexture.repeat.set((groundHalfX * 2) / GROUND_TILE_M, (groundHalfZ * 2) / GROUND_TILE_M);
  }, [groundTexture, groundHalfX, groundHalfZ]);

  useEffect(() => () => {
    layout.asphalt.dispose();
    layout.kerbs?.dispose();
    layout.walls?.geometry.dispose();
  }, [layout]);

  const groundCenter: [number, number, number] = [layout.ground.centerM[0], GROUND_Y, layout.ground.centerM[1]];

  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        <mesh position={[groundCenter[0], groundCenter[1] - GROUND_VISUAL_DROP_M, groundCenter[2]]} material={groundMaterial} receiveShadow>
          <boxGeometry args={[groundHalfX * 2, GROUND_HALF_HEIGHT_M * 2, groundHalfZ * 2]} />
        </mesh>
        <CuboidCollider position={groundCenter} args={[groundHalfX, GROUND_HALF_HEIGHT_M, groundHalfZ]} />
      </RigidBody>

      <mesh geometry={layout.asphalt} material={asphaltMaterial} receiveShadow />
      {layout.kerbs && <mesh geometry={layout.kerbs} material={kerbMaterial} receiveShadow />}

      <mesh
        position={[track.startLine.xM, 0.02, track.startLine.zM]}
        rotation={[0, track.startLine.headingRad, 0]}
        material={startLineMaterial}
        receiveShadow
      >
        <boxGeometry args={[track.widthM, 0.01, START_LINE_DEPTH_M]} />
      </mesh>

      {layout.walls && (
        <RigidBody type="fixed" colliders={false}>
          <mesh geometry={layout.walls.geometry} material={wallMaterial} castShadow receiveShadow />
          <TrimeshCollider args={[layout.walls.collider.vertices, layout.walls.collider.indices]} />
        </RigidBody>
      )}
    </group>
  );
}
