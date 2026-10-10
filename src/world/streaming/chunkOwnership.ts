import type { GeoAnchor } from '../../geo/projection.ts';
import type { RawOsmData, RawOsmNode } from '../../map/geoProvider.ts';
import type { ChunkKey, GeoPoint } from '../../shared/types.ts';
import { buildBuildingGraph, type BuildingGraph } from '../buildings/buildingGraph.ts';
import { buildRoadGraph, emptyRoadGraph, EmptyRoadZoneError, type RoadGraph } from '../roads/roadGraph.ts';
import { buildWaterGraph, EMPTY_WATER_GRAPH, type WaterGraph } from '../water/waterGraph.ts';
import { CHUNK_SIZE_M, chunkBoundsGeo, chunkCenterGeoPoint, chunkKeyForGeoPoint, chunkKeyToString } from './chunkGrid.ts';

export interface StreamedChunk {
  key: ChunkKey;
  graph: RoadGraph;
  buildingGraph: BuildingGraph;
  waterGraph: WaterGraph;
}

/**
 * Construit un chunk à partir de données brutes déjà réparties pour lui (voir splitRawByChunk)
 * : projette avec l'ancre fixe du centre du chunk (D2 — géométrie locale au chunk, jamais
 * reconstruite au recentrage), et traite un EmptyRoadZoneError comme un RoadGraph vide (un
 * chunk sans route est normal, contrairement à une zone entière vide à l'étape 3).
 */
export function buildStreamedChunk(key: ChunkKey, worldAnchor: GeoAnchor, roadRaw: RawOsmData, buildingRaw: RawOsmData, waterRaw?: RawOsmData): StreamedChunk {
  const anchor = chunkCenterGeoPoint(key, worldAnchor);
  let graph: RoadGraph;
  try {
    graph = buildRoadGraph(roadRaw, anchor);
  } catch (error) {
    if (error instanceof EmptyRoadZoneError) graph = emptyRoadGraph();
    else throw error;
  }
  const buildingGraph = buildBuildingGraph(buildingRaw, anchor);
  const waterGraph = waterRaw ? buildWaterGraph(waterRaw, anchor, CHUNK_SIZE_M / 2) : EMPTY_WATER_GRAPH;
  return { key, graph, buildingGraph, waterGraph };
}

/**
 * Répartit une réponse brute fusionnée (plusieurs chunks demandés en une seule requête, doc
 * §8 : « fusionner les zones voisines ») entre les chunks demandés. Une voie appartient
 * entièrement au chunk contenant son PREMIER nœud (pas de découpage exact du tracé aux
 * frontières de tuile) : simplification assumée — un chunk voisin est toujours chargé en même
 * temps (voisinage 3×3/5×5), donc la voie qui dépasse légèrement la tuile de son propriétaire
 * ne crée ni trou visuel ni collider dupliqué (elle n'existe que dans les données d'un seul
 * chunk). Une voie dont le premier nœud tombe hors de tout chunk demandé est ignorée ici :
 * elle sera récupérée quand son chunk propriétaire sera lui-même demandé.
 */
export function splitRawByChunk(raw: RawOsmData, worldAnchor: GeoAnchor, neededKeys: ChunkKey[]): Map<string, RawOsmData> {
  const neededKeySet = new Set(neededKeys.map(chunkKeyToString));
  const nodesById = new Map<number, RawOsmNode>();
  for (const node of raw.nodes) nodesById.set(node.id, node);

  const buckets = new Map<string, RawOsmData>();
  for (const keyStr of neededKeySet) buckets.set(keyStr, { nodes: [], ways: [] });

  for (const way of raw.ways) {
    const firstNode = nodesById.get(way.nodeIds[0]);
    if (!firstNode) continue;
    const geoPoint: GeoPoint = { latitudeDeg: firstNode.latitudeDeg, longitudeDeg: firstNode.longitudeDeg };
    const keyStr = chunkKeyToString(chunkKeyForGeoPoint(geoPoint, worldAnchor));
    const bucket = buckets.get(keyStr);
    if (!bucket) continue;
    bucket.ways.push(way);
    for (const nodeId of way.nodeIds) {
      const node = nodesById.get(nodeId);
      if (node) bucket.nodes.push(node);
    }
  }

  return buckets;
}

/**
 * Contrairement aux routes/bâtiments (propriété par premier nœud), une surface d'eau est copiée
 * dans CHAQUE chunk demandé que sa boîte englobante touche : un fleuve ou un lac dépasse très
 * largement une tuile de 256 m, et s'il n'appartenait qu'au chunk de son premier nœud il
 * disparaîtrait dès que celui-ci est évincé alors qu'on longe encore la rive. Chaque chunk
 * découpe ensuite sa part (buildWaterGraph).
 */
export function splitWaterByChunk(raw: RawOsmData, worldAnchor: GeoAnchor, neededKeys: ChunkKey[]): Map<string, RawOsmData> {
  const nodesById = new Map<number, RawOsmNode>();
  for (const node of raw.nodes) nodesById.set(node.id, node);

  const buckets = new Map<string, RawOsmData>();
  const bounds = neededKeys.map((key) => ({ keyStr: chunkKeyToString(key), box: chunkBoundsGeo(key, worldAnchor, 0) }));
  for (const { keyStr } of bounds) buckets.set(keyStr, { nodes: [], ways: [] });

  for (const way of raw.ways) {
    const wayNodes = way.nodeIds.map((id) => nodesById.get(id)).filter((node): node is RawOsmNode => node !== undefined);
    if (wayNodes.length === 0) continue;
    let south = Infinity; let north = -Infinity; let west = Infinity; let east = -Infinity;
    for (const node of wayNodes) {
      south = Math.min(south, node.latitudeDeg); north = Math.max(north, node.latitudeDeg);
      west = Math.min(west, node.longitudeDeg); east = Math.max(east, node.longitudeDeg);
    }
    for (const { keyStr, box } of bounds) {
      if (north < box.south || south > box.north || east < box.west || west > box.east) continue;
      const bucket = buckets.get(keyStr);
      if (!bucket) continue;
      bucket.ways.push(way);
      bucket.nodes.push(...wayNodes);
    }
  }
  return buckets;
}
