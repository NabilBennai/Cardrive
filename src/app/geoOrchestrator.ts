import type { GeoAnchor } from '../geo/projection.ts';
import { GeoProviderError, type GeoProviderErrorKind } from '../map/geoProvider.ts';
import { openGeoCache, readGeoCache, writeGeoCache } from '../map/geoCache.ts';
import { boundsAroundPoint } from '../map/predefinedPlaces.ts';
import { OverpassProvider } from '../map/overpassProvider.ts';
import { buildRoadGraph, EmptyRoadZoneError, type RoadGraph } from '../world/roads/roadGraph.ts';
import { pickSpawnPose, type RoadSpawnPose } from '../world/roads/spawnPlacement.ts';
import { buildBuildingGraph, type BuildingGraph } from '../world/buildings/buildingGraph.ts';
import type { GeoPoint } from '../shared/types.ts';

export type GeoLoadErrorKind = GeoProviderErrorKind | 'empty-result';

export class GeoLoadError extends Error {
  constructor(readonly kind: GeoLoadErrorKind, message: string) {
    super(message);
    this.name = 'GeoLoadError';
  }
}

export interface LoadedRoadWorld {
  graph: RoadGraph;
  buildingGraph: BuildingGraph;
  spawnPose: RoadSpawnPose;
  providerId: string;
}

/**
 * Seul point d'entrée qui instancie un fournisseur concret (doc §7 : « Aucun fournisseur
 * concret ne doit être importé par » les couches basses). Cache IndexedDB en premier recours
 * (jamais bloquant s'il échoue), puis réseau, puis construction du graphe et placement du spawn.
 */
export async function loadRoadWorld(place: GeoPoint, signal: AbortSignal): Promise<LoadedRoadWorld> {
  const provider = new OverpassProvider();
  const bounds = boundsAroundPoint(place);
  const anchor: GeoAnchor = place;

  const db = await openGeoCache().catch(() => null);
  const cached = db ? await readGeoCache(db, provider.id, bounds).catch(() => null) : null;

  let raw = cached;
  if (!raw) {
    try {
      raw = await provider.getRoads(bounds, signal);
    } catch (error) {
      if (error instanceof GeoProviderError) throw new GeoLoadError(error.kind, error.message);
      throw error;
    }
    if (db) await writeGeoCache(db, provider.id, bounds, raw).catch(() => {});
  }

  let graph: RoadGraph;
  try {
    graph = buildRoadGraph(raw, anchor);
  } catch (error) {
    if (error instanceof EmptyRoadZoneError) throw new GeoLoadError('empty-result', error.message);
    throw error;
  }

  const spawnPose = pickSpawnPose(graph);
  if (!spawnPose) throw new GeoLoadError('empty-result', 'Aucun segment de route exploitable.');

  // Jamais d'erreur ici : zéro bâtiment dans la zone est un état normal, contrairement à zéro route.
  const buildingGraph = buildBuildingGraph(raw, anchor);

  return { graph, buildingGraph, spawnPose, providerId: provider.id };
}
