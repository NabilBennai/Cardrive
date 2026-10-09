import type { GeoAnchor } from '../geo/projection.ts';
import { GeoProviderError, type GeoProviderErrorKind, type RawOsmData } from '../map/geoProvider.ts';
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

const EMPTY_RAW: RawOsmData = { nodes: [], ways: [] };

/**
 * Seul point d'entrée qui instancie un fournisseur concret (doc §7 : « Aucun fournisseur
 * concret ne doit être importé par » les couches basses). Routes et bâtiments sont deux
 * requêtes/caches séparés (voir overpassProvider.ts : la requête combinée était trop lourde
 * pour les miroirs publics légers et produisait de faux « aucune route » sur des zones qui en
 * ont réellement). Les routes sont sur le chemin critique ; les bâtiments sont best-effort —
 * un échec de leur côté dégrade silencieusement vers zéro bâtiment plutôt que de bloquer le
 * chargement du lieu.
 */
export async function loadRoadWorld(place: GeoPoint, signal: AbortSignal): Promise<LoadedRoadWorld> {
  const provider = new OverpassProvider();
  const bounds = boundsAroundPoint(place);
  const anchor: GeoAnchor = place;
  const db = await openGeoCache().catch(() => null);

  const roadsCacheKey = `${provider.id}-roads`;
  let raw = db ? await readGeoCache(db, roadsCacheKey, bounds).catch(() => null) : null;
  if (!raw) {
    try {
      raw = await provider.getRoads(bounds, signal);
    } catch (error) {
      if (error instanceof GeoProviderError) throw new GeoLoadError(error.kind, error.message);
      throw error;
    }
    if (db) await writeGeoCache(db, roadsCacheKey, bounds, raw).catch(() => {});
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

  const buildingsCacheKey = `${provider.id}-buildings`;
  let buildingsRaw = db ? await readGeoCache(db, buildingsCacheKey, bounds).catch(() => null) : null;
  if (!buildingsRaw) {
    try {
      buildingsRaw = await provider.getBuildings(bounds, signal);
      if (db) await writeGeoCache(db, buildingsCacheKey, bounds, buildingsRaw).catch(() => {});
    } catch {
      // Best-effort : un bâtiment manquant ne doit jamais empêcher de rouler.
      buildingsRaw = EMPTY_RAW;
    }
  }
  // Jamais d'erreur ici non plus : zéro bâtiment dans la zone est un état normal.
  const buildingGraph = buildBuildingGraph(buildingsRaw, anchor);

  return { graph, buildingGraph, spawnPose, providerId: provider.id };
}
