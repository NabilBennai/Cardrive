import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { useMemo } from 'react';
import { MeshStandardMaterial } from 'three';
import { createFacadeTexture } from '../textures/proceduralTextures.ts';
import type { BuildingGraph } from './buildingGraph.ts';
import { buildBuildingLayout } from './buildingMesh.ts';

const BASE_Y = 0.02;
const FACADE_TINTS = ['#c7c2b2', '#bdb6a3', '#a9a28d', '#d2ccba', '#b3ad9a'];

interface BuildingsProps {
  graph: BuildingGraph;
}

/**
 * Extrusions simples des empreintes OSM + collision AABB par bâtiment (pas de hull exact,
 * voir le plan : un hull par empreinte coûterait trop cher pour des zones denses). Les
 * matériaux sont mutualisés (une petite palette réutilisée par index), jamais un par bâtiment.
 */
export function Buildings({ graph }: BuildingsProps) {
  const layout = useMemo(() => buildBuildingLayout(graph, BASE_Y, FACADE_TINTS.length), [graph]);
  const materials = useMemo(() => {
    const texture = createFacadeTexture();
    return FACADE_TINTS.map((color) => new MeshStandardMaterial({ map: texture, color, roughness: 0.85 }));
  }, []);

  return (
    <group>
      {layout.map((placement) => (
        <RigidBody key={placement.id} type="fixed" colliders={false}>
          <mesh geometry={placement.geometry} material={materials[placement.materialIndex]} castShadow receiveShadow />
          <CuboidCollider position={placement.aabbCenterM} args={placement.aabbHalfExtentM} />
        </RigidBody>
      ))}
    </group>
  );
}
