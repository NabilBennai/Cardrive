import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { useMemo } from 'react';
import { Vector3 } from 'three';
import { Buildings } from '../buildings/Buildings.tsx';
import type { BuildingGraph } from '../buildings/buildingGraph.ts';
import { createAsphaltTexture, createGroundTexture } from '../textures/proceduralTextures.ts';
import type { RoadGraph } from './roadGraph.ts';
import { buildJunctionFillerGeometry, buildRoadNetworkLayout, buildWayRibbon } from './roadMesh.ts';

const ROAD_Y = 0.01;
const GROUND_Y = -0.05;
const GROUND_HALF_HEIGHT_M = 0.05;
const GROUND_TILE_SIZE_M = 4;

interface RoadNetworkProps {
  graph: RoadGraph;
  buildingGraph: BuildingGraph;
}

/**
 * Rend une zone OSM projetée en mètres : rubans de chaussée texturés, remplissages de jonction,
 * bâtiments extrudés, et un collider de sol plat couvrant toute la zone (même principe que le
 * sol non accordé-au-tracé de DemoTrack.tsx) pour qu'une sortie de route ne fasse jamais tomber
 * le véhicule.
 */
export function RoadNetwork({ graph, buildingGraph }: RoadNetworkProps) {
  const layout = useMemo(() => buildRoadNetworkLayout(graph, ROAD_Y), [graph]);
  const wayGeometries = useMemo(
    () => layout.wayPoints.map((points, index) => buildWayRibbon(points, layout.wayHalfWidths[index], ROAD_Y)),
    [layout],
  );
  const junctionGeometries = useMemo(
    () => layout.junctions.map((junction) => buildJunctionFillerGeometry(
      new Vector3(junction.positionM[0], junction.positionM[1], junction.positionM[2]),
      junction.halfWidthM,
      ROAD_Y,
    )),
    [layout],
  );
  const asphaltTexture = useMemo(() => createAsphaltTexture(), []);
  const groundTexture = useMemo(() => {
    const texture = createGroundTexture();
    texture.repeat.set(
      (layout.groundBounds.halfExtentM[0] * 2) / GROUND_TILE_SIZE_M,
      (layout.groundBounds.halfExtentM[1] * 2) / GROUND_TILE_SIZE_M,
    );
    return texture;
  }, [layout]);

  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        <mesh position={[layout.groundBounds.centerM[0], GROUND_Y, layout.groundBounds.centerM[1]]} receiveShadow>
          <boxGeometry args={[layout.groundBounds.halfExtentM[0] * 2, GROUND_HALF_HEIGHT_M * 2, layout.groundBounds.halfExtentM[1] * 2]} />
          <meshStandardMaterial map={groundTexture} roughness={0.95} />
        </mesh>
        <CuboidCollider
          position={[layout.groundBounds.centerM[0], GROUND_Y, layout.groundBounds.centerM[1]]}
          args={[layout.groundBounds.halfExtentM[0], GROUND_HALF_HEIGHT_M, layout.groundBounds.halfExtentM[1]]}
        />
      </RigidBody>
      {wayGeometries.map((geometry, index) => (
        <mesh key={`way-${index}`} geometry={geometry} receiveShadow>
          <meshStandardMaterial map={asphaltTexture} roughness={0.9} />
        </mesh>
      ))}
      {junctionGeometries.map((geometry, index) => (
        <mesh key={`junction-${index}`} geometry={geometry} receiveShadow>
          <meshStandardMaterial map={asphaltTexture} roughness={0.9} />
        </mesh>
      ))}
      <Buildings graph={buildingGraph} />
    </group>
  );
}
