import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { useMemo } from 'react';
import { Vector3 } from 'three';
import type { RoadGraph } from './roadGraph.ts';
import { buildJunctionFillerGeometry, buildRoadNetworkLayout, buildWayRibbon } from './roadMesh.ts';

const ROAD_Y = 0.01;
const GROUND_Y = -0.05;
const GROUND_HALF_HEIGHT_M = 0.05;

interface RoadNetworkProps {
  graph: RoadGraph;
}

/**
 * Rend une zone OSM projetée en mètres : rubans de chaussée, remplissages de jonction, et un
 * collider de sol plat couvrant toute la zone (même principe que le sol non accordé-au-tracé de
 * DemoTrack.tsx) pour qu'une sortie de route ne fasse jamais tomber le véhicule.
 */
export function RoadNetwork({ graph }: RoadNetworkProps) {
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

  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        <mesh position={[layout.groundBounds.centerM[0], GROUND_Y, layout.groundBounds.centerM[1]]} receiveShadow>
          <boxGeometry args={[layout.groundBounds.halfExtentM[0] * 2, GROUND_HALF_HEIGHT_M * 2, layout.groundBounds.halfExtentM[1] * 2]} />
          <meshStandardMaterial color="#1f2a22" roughness={0.95} />
        </mesh>
        <CuboidCollider
          position={[layout.groundBounds.centerM[0], GROUND_Y, layout.groundBounds.centerM[1]]}
          args={[layout.groundBounds.halfExtentM[0], GROUND_HALF_HEIGHT_M, layout.groundBounds.halfExtentM[1]]}
        />
      </RigidBody>
      {wayGeometries.map((geometry, index) => (
        <mesh key={`way-${index}`} geometry={geometry} receiveShadow>
          <meshStandardMaterial color="#2c2f2d" roughness={0.9} />
        </mesh>
      ))}
      {junctionGeometries.map((geometry, index) => (
        <mesh key={`junction-${index}`} geometry={geometry} receiveShadow>
          <meshStandardMaterial color="#2c2f2d" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}
