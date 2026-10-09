import type { GeoAnchor } from '../../geo/projection.ts';
import type { RawOsmData, RawOsmNode } from '../../map/geoProvider.ts';
import type { ChunkKey, GeoPoint } from '../../shared/types.ts';
import { buildBuildingGraph, type BuildingGraph } from '../buildings/buildingGraph.ts';
import { buildRoadGraph, emptyRoadGraph, EmptyRoadZoneError, type RoadGraph } from '../roads/roadGraph.ts';
import { chunkCenterGeoPoint, chunkKeyForGeoPoint, chunkKeyToString } from './chunkGrid.ts';

export interface StreamedChunk {
  key: ChunkKey;
  graph: RoadGraph;
  buildingGraph: BuildingGraph;
}

/**
 * Construit un chunk à partir de données brutes déjà réparties pour lui (voir splitRawByChunk)
 * : projette avec l'ancre fixe du centre du chunk (D2 — géométrie locale au chunk, jamais
 * reconstruite au recentrage), et traite un EmptyRoadZoneError comme un RoadGraph vide (un
 * chunk sans route est normal, contrairement à une zone entière vide à l'étape 3).
 */
export function buildStreamedChunk(key: ChunkKey, worldAnchor: GeoAnchor, roadRaw: RawOsmData, buildingRaw: RawOsmData): StreamedChunk {
  const anchor = chunkCenterGeoPoint(key, worldAnchor);
  let graph: RoadGraph;
  try {
    graph = buildRoadGraph(roadRaw, anchor);
  } catch (error) {
    if (error instanceof EmptyRoadZoneError) graph = emptyRoadGraph();
    else throw error;
  }
  const buildingGraph = buildBuildingGraph(buildingRaw, anchor);
  return { key, graph, buildingGraph };
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
