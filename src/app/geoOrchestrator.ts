import type { GeoAnchor } from '../geo/projection.ts';
import { GeoProviderError, type GeoProviderErrorKind, type RawOsmData } from '../map/geoProvider.ts';
import { openGeoCache, readGeoCache, writeGeoCache } from '../map/geoCache.ts';
import { OverpassProvider } from '../map/overpassProvider.ts';
import { pickSpawnPose, type RoadSpawnPose } from '../world/roads/spawnPlacement.ts';
import { buildStreamedChunk, splitRawByChunk, type StreamedChunk } from '../world/streaming/chunkOwnership.ts';
import {
  CHUNK_FETCH_MARGIN_M, chunkBoundsGeo, chunkKeyToString, chunkRenderOffset,
  neighborhood, PHYSICS_RADIUS_CHUNKS, unionBoundsGeo,
} from '../world/streaming/chunkGrid.ts';
import type { ChunkKey, GeoPoint, LocalPoint } from '../shared/types.ts';

export type GeoLoadErrorKind = GeoProviderErrorKind | 'empty-result';

export class GeoLoadError extends Error {
  constructor(readonly kind: GeoLoadErrorKind, message: string) {
    super(message);
    this.name = 'GeoLoadError';
  }
}

export interface LoadedRoadWorld {
  worldAnchor: GeoAnchor;
  initialChunks: StreamedChunk[];
  spawnPose: RoadSpawnPose;
  providerId: string;
}

const EMPTY_RAW: RawOsmData = { nodes: [], ways: [] };
/** Le lieu choisi EST l'ancre monde, donc son propre chunk a toujours la clé {0,0} (doc §6 : ancre immuable de la première zone). */
const SPAWN_CHUNK_KEY: ChunkKey = { x: 0, z: 0 };

/**
 * Seul point d'entrée qui instancie un fournisseur concret (doc §7 : « Aucun fournisseur
 * concret ne doit être importé par » les couches basses). Charge le voisinage 3×3 (9 chunks)
 * autour du lieu choisi — pas une grande zone unique comme à l'étape 3 — pour alimenter
 * directement useChunkStreamer.ts au montage de la scène (pas de re-fetch redondant) : voir
 * étape 4, streaming de chunks.
 */
export async function loadRoadWorld(place: GeoPoint, signal: AbortSignal): Promise<LoadedRoadWorld> {
  const provider = new OverpassProvider();
  const worldAnchor: GeoAnchor = place;
  const db = await openGeoCache().catch(() => null);

  const spawnNeighborhood = neighborhood(SPAWN_CHUNK_KEY, PHYSICS_RADIUS_CHUNKS);
  const initialChunks: StreamedChunk[] = [];
  const stillMissing: ChunkKey[] = [];

  for (const key of spawnNeighborhood) {
    const bounds = chunkBoundsGeo(key, worldAnchor, CHUNK_FETCH_MARGIN_M);
    const cachedRoads = db ? await readGeoCache(db, `${provider.id}-roads-chunk`, bounds).catch(() => null) : null;
    const cachedBuildings = db ? await readGeoCache(db, `${provider.id}-buildings-chunk`, bounds).catch(() => null) : null;
    if (cachedRoads && cachedBuildings) initialChunks.push(buildStreamedChunk(key, worldAnchor, cachedRoads, cachedBuildings));
    else stillMissing.push(key);
  }

  if (stillMissing.length > 0) {
    const bounds = unionBoundsGeo(stillMissing.map((key) => chunkBoundsGeo(key, worldAnchor, CHUNK_FETCH_MARGIN_M)));
    let roadsRaw: RawOsmData;
    try {
      roadsRaw = await provider.getRoads(bounds, signal);
    } catch (error) {
      if (error instanceof GeoProviderError) throw new GeoLoadError(error.kind, error.message);
      throw error;
    }
    // Best-effort (un bâtiment manquant ne doit jamais empêcher de charger le lieu).
    const buildingsRaw = await provider.getBuildings(bounds, signal).catch(() => EMPTY_RAW);

    const roadBuckets = splitRawByChunk(roadsRaw, worldAnchor, stillMissing);
    const buildingBuckets = splitRawByChunk(buildingsRaw, worldAnchor, stillMissing);
    for (const key of stillMissing) {
      const keyStr = chunkKeyToString(key);
      const roadRaw = roadBuckets.get(keyStr) ?? EMPTY_RAW;
      const buildingRaw = buildingBuckets.get(keyStr) ?? EMPTY_RAW;
      initialChunks.push(buildStreamedChunk(key, worldAnchor, roadRaw, buildingRaw));
      if (db) {
        const chunkBounds = chunkBoundsGeo(key, worldAnchor, CHUNK_FETCH_MARGIN_M);
        writeGeoCache(db, `${provider.id}-roads-chunk`, chunkBounds, roadRaw).catch(() => {});
        writeGeoCache(db, `${provider.id}-buildings-chunk`, chunkBounds, buildingRaw).catch(() => {});
      }
    }
  }

  // Priorité au chunk du lieu choisi lui-même ; sinon le premier voisin qui a une route
  // exploitable. Chaque chunk a sa PROPRE ancre locale (D2 — jamais de fusion de graphes
  // d'ancres différentes, ce qui mélangerait des repères incompatibles) : la pose choisie dans
  // le repère local du chunk est convertie vers le repère de rendu initial (renderAnchor ===
  // worldAnchor au tout premier chargement, avant tout recentrage) via chunkRenderOffset.
  const orderedChunks = [...initialChunks].sort((a, b) => {
    const aIsSpawn = a.key.x === SPAWN_CHUNK_KEY.x && a.key.z === SPAWN_CHUNK_KEY.z;
    const bIsSpawn = b.key.x === SPAWN_CHUNK_KEY.x && b.key.z === SPAWN_CHUNK_KEY.z;
    return Number(bIsSpawn) - Number(aIsSpawn);
  });
  let spawnPose: RoadSpawnPose | null = null;
  for (const chunk of orderedChunks) {
    const localPose = pickSpawnPose(chunk.graph);
    if (!localPose) continue;
    const offset = chunkRenderOffset(chunk.key, worldAnchor, worldAnchor);
    const position: LocalPoint = {
      xM: offset.xM + localPose.position.xM,
      yM: 0,
      zM: offset.zM + localPose.position.zM,
    };
    spawnPose = { position, headingRad: localPose.headingRad };
    break;
  }
  if (!spawnPose) throw new GeoLoadError('empty-result', 'Aucun segment de route exploitable.');

  return { worldAnchor, initialChunks, spawnPose, providerId: provider.id };
}
