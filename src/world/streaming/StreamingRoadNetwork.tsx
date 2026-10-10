import { CuboidCollider, RigidBody, TrimeshCollider } from '@react-three/rapier';
import { useEffect, useMemo } from 'react';
import { DoubleSide, MeshStandardMaterial, Vector3 } from 'three';
import { RECENTER_THRESHOLD_M } from '../../geo/floatingOrigin.ts';
import type { GeoAnchor } from '../../geo/projection.ts';
import type { VehicleTelemetry } from '../../shared/types.ts';
import { buildBuildingLayout } from '../buildings/buildingMesh.ts';
import { buildJunctionFillerGeometry, buildRoadNetworkLayout, buildWayRibbon } from '../roads/roadMesh.ts';
import { buildSidewalkLayout, extractCarriageways, type ForeignCarriageway } from '../roads/sidewalkMesh.ts';
import { buildWaterLayout } from '../water/waterMesh.ts';
import { createAsphaltTexture, createFacadeTexture, createGroundTexture } from '../textures/proceduralTextures.ts';
import { CHUNK_SIZE_M, chunkKeyToString, chunkRenderOffset } from './chunkGrid.ts';
import { useChunkStreamer, type StreamedChunk } from './useChunkStreamer.ts';

const ROAD_Y = 0.01;
const GROUND_Y = -0.05;
const GROUND_HALF_HEIGHT_M = 0.05;
const BUILDING_BASE_Y = 0.02;
const FACADE_TINTS = ['#c7c2b2', '#bdb6a3', '#a9a28d', '#d2ccba', '#b3ad9a'];
// Marge au-delà du 5x5 effectivement chargé : le sol de secours doit toujours couvrir au moins
// ça, même pendant les quelques dixièmes de seconde où un chunk vient d'être évincé/pas encore généré.
const GROUND_MARGIN_M = CHUNK_SIZE_M;

interface StreamingRoadNetworkProps {
  worldAnchor: GeoAnchor;
  renderAnchor: GeoAnchor;
  telemetryRef: React.RefObject<VehicleTelemetry>;
  initialChunks: StreamedChunk[];
  onZoneUnavailable?: (unavailable: boolean) => void;
}

interface ChunkGroupProps {
  chunk: StreamedChunk;
  offset: [number, number, number];
  materials: MeshStandardMaterial[];
  asphaltTexture: ReturnType<typeof createAsphaltTexture>;
  foreignCarriageways: ForeignCarriageway[];
}

/**
 * Un chunk actif : rubans de route + jonctions (visuel, pas de collider — aucune route n'a de
 * collider dédié dans ce projet, voir RigidBody/CuboidCollider de sol dans le composant
 * parent) et bâtiments extrudés (AABB collider chacun). Démonté fréquemment (éviction, doc
 * §7 : « libérer les géométries... à l'éviction »), donc nettoyage explicite au démontage —
 * contrairement à l'ancienne RoadNetwork.tsx (zone unique, jamais démontée).
 */
/** Distance au-delà de la tuile d'un chunk dans laquelle on prend en compte les chaussées voisines. */
const NEIGHBOR_REACH_M = CHUNK_SIZE_M / 2 + 12;
const NO_FOREIGN: ForeignCarriageway[] = [];
// Tableaux conservés d'un rendu à l'autre tant que le voisinage chargé d'un chunk ne change pas :
// sinon chaque chargement/éviction d'un chunk reconstruirait les trottoirs (et colliders) des 25.
const foreignCache = new Map<string, { signature: string; segments: ForeignCarriageway[] }>();

function foreignCarriagewaysFor(chunk: StreamedChunk, chunks: StreamedChunk[], worldAnchor: GeoAnchor): ForeignCarriageway[] {
  const neighbors = chunks.filter((other) => other !== chunk && Math.abs(other.key.x - chunk.key.x) <= 1 && Math.abs(other.key.z - chunk.key.z) <= 1);
  if (neighbors.length === 0) return NO_FOREIGN;
  const signature = neighbors.map((other) => chunkKeyToString(other.key)).sort().join('|');
  const cacheKey = chunkKeyToString(chunk.key);
  const cached = foreignCache.get(cacheKey);
  if (cached?.signature === signature) return cached.segments;
  const origin = chunkRenderOffset(chunk.key, worldAnchor, worldAnchor);
  const segments = neighbors.flatMap((other) => {
    const o = chunkRenderOffset(other.key, worldAnchor, worldAnchor);
    return extractCarriageways(other.graph, o.xM - origin.xM, o.zM - origin.zM, NEIGHBOR_REACH_M);
  });
  foreignCache.set(cacheKey, { signature, segments });
  return segments;
}

const sidewalkMaterial = new MeshStandardMaterial({ color: '#9a9b96', roughness: 0.95, side: DoubleSide });
const waterMaterial = new MeshStandardMaterial({ color: '#2f6f9f', roughness: 0.25, metalness: 0.1, side: DoubleSide });

function ChunkGroup({ chunk, offset, materials, asphaltTexture, foreignCarriageways }: ChunkGroupProps) {
  const layout = useMemo(() => buildRoadNetworkLayoutSubset(chunk), [chunk]);
  const buildingLayout = useMemo(() => buildBuildingLayout(chunk.buildingGraph, BUILDING_BASE_Y, materials.length), [chunk, materials.length]);
  const sidewalkLayout = useMemo(() => buildSidewalkLayout(chunk.graph, foreignCarriageways), [chunk, foreignCarriageways]);
  const waterLayout = useMemo(() => buildWaterLayout(chunk.waterGraph), [chunk]);

  useEffect(() => () => {
    for (const geometry of layout.wayGeometries) geometry.dispose();
    for (const geometry of layout.junctionGeometries) geometry.dispose();
    for (const placement of buildingLayout) placement.geometry.dispose();
    sidewalkLayout.visual?.dispose();
    for (const geometry of waterLayout.surfaces) geometry.dispose();
  }, [layout, buildingLayout, sidewalkLayout, waterLayout]);

  return (
    <group position={offset}>
      {layout.wayGeometries.map((geometry, index) => (
        <mesh key={`way-${index}`} geometry={geometry} receiveShadow>
          <meshStandardMaterial map={asphaltTexture} roughness={0.9} />
        </mesh>
      ))}
      {layout.junctionGeometries.map((geometry, index) => (
        <mesh key={`junction-${index}`} geometry={geometry} receiveShadow>
          <meshStandardMaterial map={asphaltTexture} roughness={0.9} />
        </mesh>
      ))}
      {sidewalkLayout.visual && (
        <mesh geometry={sidewalkLayout.visual} material={sidewalkMaterial} receiveShadow castShadow />
      )}
      {sidewalkLayout.collider && sidewalkLayout.visual && (
        <RigidBody key={sidewalkLayout.visual.uuid} type="fixed" colliders={false}>
          <TrimeshCollider args={[sidewalkLayout.collider.vertices, sidewalkLayout.collider.indices]} />
        </RigidBody>
      )}
      {waterLayout.surfaces.map((geometry, index) => (
        <mesh key={`water-${index}`} geometry={geometry} material={waterMaterial} />
      ))}
      {waterLayout.collider && (
        <RigidBody type="fixed" colliders={false}>
          <TrimeshCollider args={[waterLayout.collider.vertices, waterLayout.collider.indices]} />
        </RigidBody>
      )}
      {buildingLayout.map((placement) => (
        <RigidBody key={placement.id} type="fixed" colliders={false}>
          <mesh geometry={placement.geometry} material={materials[placement.materialIndex]} castShadow receiveShadow />
          <CuboidCollider position={placement.aabbCenterM} args={placement.aabbHalfExtentM} />
        </RigidBody>
      ))}
    </group>
  );
}

function buildRoadNetworkLayoutSubset(chunk: StreamedChunk) {
  const layout = buildRoadNetworkLayout(chunk.graph, ROAD_Y);
  const wayGeometries = layout.wayPoints.map((points, index) => buildWayRibbon(points, layout.wayHalfWidths[index], ROAD_Y));
  const junctionGeometries = layout.junctions.map((junction) => buildJunctionFillerGeometry(
    new Vector3(junction.positionM[0], junction.positionM[1], junction.positionM[2]),
    junction.halfWidthM,
    ROAD_Y,
  ));
  return { wayGeometries, junctionGeometries };
}

export function StreamingRoadNetwork({ worldAnchor, renderAnchor, telemetryRef, initialChunks, onZoneUnavailable }: StreamingRoadNetworkProps) {
  const streamer = useChunkStreamer(worldAnchor, renderAnchor, telemetryRef, initialChunks);

  useEffect(() => { onZoneUnavailable?.(streamer.zoneUnavailable); }, [streamer.zoneUnavailable, onZoneUnavailable]);

  // Textures/matériaux partagés, construits une seule fois (pas par chunk) — réutilisent les
  // singletons de proceduralTextures.ts déjà employés à l'étape « bâtiments + textures ».
  const asphaltTexture = useMemo(() => createAsphaltTexture(), []);
  const groundTexture = useMemo(() => createGroundTexture(), []);
  const materials = useMemo(() => {
    const facadeTexture = createFacadeTexture();
    return FACADE_TINTS.map((color) => new MeshStandardMaterial({ map: facadeTexture, color, roughness: 0.85 }));
  }, []);

  // Sol de secours unique : toujours présent quel que soit l'état de chargement des chunks
  // (doc §8 : « une erreur réseau ne doit pas faire tomber la voiture dans le vide »). Centré
  // sur renderAnchor (origine locale courante, [0,0,0]) avec un demi-côté couvrant au moins
  // RECENTER_THRESHOLD_M : par définition le véhicule est toujours à moins de cette distance
  // de renderAnchor (sinon un recentrage aurait déjà eu lieu), donc ce sol statique (pas de
  // suivi par frame nécessaire) le couvre en permanence, y compris pendant les quelques
  // dixièmes de seconde où un chunk vient d'être évincé/pas encore généré.
  const groundHalfExtentM = RECENTER_THRESHOLD_M + GROUND_MARGIN_M;
  const groundCenter: [number, number, number] = [0, GROUND_Y, 0];
  useEffect(() => {
    const tileSizeM = 4;
    groundTexture.repeat.set((groundHalfExtentM * 2) / tileSizeM, (groundHalfExtentM * 2) / tileSizeM);
  }, [groundTexture, groundHalfExtentM]);

  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        <mesh position={groundCenter} receiveShadow>
          <boxGeometry args={[groundHalfExtentM * 2, GROUND_HALF_HEIGHT_M * 2, groundHalfExtentM * 2]} />
          <meshStandardMaterial map={groundTexture} roughness={0.95} />
        </mesh>
        <CuboidCollider position={groundCenter} args={[groundHalfExtentM, GROUND_HALF_HEIGHT_M, groundHalfExtentM]} />
      </RigidBody>
      {streamer.activeChunks.map((chunk) => {
        const local = chunkRenderOffset(chunk.key, worldAnchor, renderAnchor);
        const offset: [number, number, number] = [local.xM, 0, local.zM];
        return <ChunkGroup key={`${chunk.key.x},${chunk.key.z}`} chunk={chunk} offset={offset} materials={materials} asphaltTexture={asphaltTexture} foreignCarriageways={foreignCarriagewaysFor(chunk, streamer.activeChunks, worldAnchor)} />;
      })}
    </group>
  );
}
