import { useFrame } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';
import { unprojectFromLocal, type GeoAnchor } from '../../geo/projection.ts';
import { openGeoCache, readGeoCache, writeGeoCache } from '../../map/geoCache.ts';
import type { RawOsmData } from '../../map/geoProvider.ts';
import { perfStats } from '../../debug/perfStats.ts';
import { OverpassProvider, sharedMirrorHealth } from '../../map/overpassProvider.ts';
import type { VehicleTelemetry } from '../../shared/types.ts';
import {
  CHUNK_FETCH_MARGIN_M, chunkBoundsGeo, chunkKeyForGeoPoint, chunkKeyToString,
  neighborhood, RENDER_RADIUS_CHUNKS, unionBoundsGeo,
} from './chunkGrid.ts';
import { buildStreamedChunk, splitRawByChunk, splitWaterByChunk, type StreamedChunk } from './chunkOwnership.ts';
import { ChunkStore, FAILURE_BACKOFF_MS } from './chunkStateMachine.ts';

export type { StreamedChunk } from './chunkOwnership.ts';

/** Construit un chunk en mesurant sa durée (visible dans le panneau de performance, F3). */
function timedBuild(...args: Parameters<typeof buildStreamedChunk>): StreamedChunk {
  const start = performance.now();
  const chunk = buildStreamedChunk(...args);
  perfStats.chunkBuildMs.push(performance.now() - start);
  return chunk;
}

export interface ChunkStreamerHandle {
  activeChunks: StreamedChunk[];
  /** Vrai si un chunk nécessaire échoue depuis un moment (doc §8 : « signaler la limite »). Non bloquant : le sol de secours (StreamingRoadNetwork.tsx) garantit qu'on ne tombe jamais. */
  zoneUnavailable: boolean;
}

const CHECK_INTERVAL_S = 0.4;
const EMPTY_RAW: RawOsmData = { nodes: [], ways: [] };

/**
 * Orchestrateur de streaming vivant, appelé depuis un composant monté dans l'arbre R3F
 * (StreamingRoadNetwork.tsx) — nécessaire pour useFrame. Ne connaît rien de renderAnchor que
 * pour convertir la position télémétrie (relative à renderAnchor) en point géographique ; les
 * clés/limites de chunk utilisent toujours worldAnchor (doc §6 : clés stables).
 *
 * Toute la logique impure (horloge, I/O réseau/cache, mutation du ChunkStore) vit DANS le
 * callback useFrame, jamais pendant le rendu — les règles strictes de ce projet (eslint
 * react-hooks/refs, react-hooks/purity) interdisent de lire un ref ou d'appeler Date.now()
 * pendant le rendu. activeChunks/zoneUnavailable sont de vrais états React, mis à jour depuis
 * useFrame, et lus tels quels (lecture pure) à la fin de ce hook.
 */
export function useChunkStreamer(
  worldAnchor: GeoAnchor,
  renderAnchor: GeoAnchor,
  telemetryRef: React.RefObject<VehicleTelemetry>,
  initialChunks: StreamedChunk[],
): ChunkStreamerHandle {
  const [store] = useState(() => {
    const initialStore = new ChunkStore();
    for (const chunk of initialChunks) initialStore.markGenerated(chunk.key, chunk);
    return initialStore;
  });
  const [provider] = useState(() => new OverpassProvider(undefined, sharedMirrorHealth));
  const dbRef = useRef<IDBDatabase | null>(null);
  const fetchLockRef = useRef(false);
  const timeSinceCheckRef = useRef(0);
  const lastVehicleKeyRef = useRef<string | null>(null);

  const [activeChunks, setActiveChunks] = useState<StreamedChunk[]>(() => initialChunks.slice());
  const [zoneUnavailable, setZoneUnavailable] = useState(false);

  useEffect(() => {
    openGeoCache().then((db) => { dbRef.current = db; }).catch(() => { dbRef.current = null; });
  }, []);

  const runFetchCycle = useCallback(async (fetchable: ReturnType<typeof neighborhood>) => {
    const db = dbRef.current;
    const stillMissing: ReturnType<typeof neighborhood> = [];
    for (const key of fetchable) {
      const bounds = chunkBoundsGeo(key, worldAnchor, CHUNK_FETCH_MARGIN_M);
      const cachedRoads = db ? await readGeoCache(db, `${provider.id}-roads-chunk`, bounds).catch(() => null) : null;
      const cachedBuildings = db ? await readGeoCache(db, `${provider.id}-buildings-chunk`, bounds).catch(() => null) : null;
      const cachedWater = db ? await readGeoCache(db, `${provider.id}-water-chunk`, bounds).catch(() => null) : null;
      if (cachedRoads && cachedBuildings && cachedWater) store.markGenerated(key, timedBuild(key, worldAnchor, cachedRoads, cachedBuildings, cachedWater));
      else stillMissing.push(key);
    }
    if (stillMissing.length === 0) return;

    store.markRequested(stillMissing);
    const bounds = unionBoundsGeo(stillMissing.map((key) => chunkBoundsGeo(key, worldAnchor, CHUNK_FETCH_MARGIN_M)));
    const controller = new AbortController();
    try {
      const [roadsRaw, buildingsRaw, waterRaw] = await Promise.all([
        provider.getRoads(bounds, controller.signal),
        // Best-effort (comme geoOrchestrator.ts) : un bâtiment manquant ne doit jamais empêcher de rouler.
        provider.getBuildings(bounds, controller.signal).catch(() => EMPTY_RAW),
        provider.getWater(bounds, controller.signal).catch(() => EMPTY_RAW),
      ]);
      const roadBuckets = splitRawByChunk(roadsRaw, worldAnchor, stillMissing);
      const buildingBuckets = splitRawByChunk(buildingsRaw, worldAnchor, stillMissing);
      const waterBuckets = splitWaterByChunk(waterRaw, worldAnchor, stillMissing);
      for (const key of stillMissing) {
        const keyStr = chunkKeyToString(key);
        const roadRaw = roadBuckets.get(keyStr) ?? EMPTY_RAW;
        const buildingRaw = buildingBuckets.get(keyStr) ?? EMPTY_RAW;
        const waterChunkRaw = waterBuckets.get(keyStr) ?? EMPTY_RAW;
        store.markGenerated(key, timedBuild(key, worldAnchor, roadRaw, buildingRaw, waterChunkRaw));
        if (db) {
          const chunkBounds = chunkBoundsGeo(key, worldAnchor, CHUNK_FETCH_MARGIN_M);
          writeGeoCache(db, `${provider.id}-roads-chunk`, chunkBounds, roadRaw).catch(() => {});
          writeGeoCache(db, `${provider.id}-buildings-chunk`, chunkBounds, buildingRaw).catch(() => {});
          writeGeoCache(db, `${provider.id}-water-chunk`, chunkBounds, waterChunkRaw).catch(() => {});
        }
      }
    } catch {
      // Échec réseau/quota/HTTP sur la requête routes (les bâtiments sont déjà best-effort ci-dessus) :
      // les chunks visés passent en échec, réessayables après FAILURE_BACKOFF_MS (doc §8, jamais de boucle).
      for (const key of stillMissing) store.markFailed(key, Date.now());
    }
  }, [provider, store, worldAnchor]);

  useFrame((_, delta) => {
    timeSinceCheckRef.current += delta;
    if (timeSinceCheckRef.current < CHECK_INTERVAL_S) return;
    timeSinceCheckRef.current = 0;

    const telemetry = telemetryRef.current;
    if (!telemetry) return;
    const geoPoint = unprojectFromLocal({ xM: telemetry.positionM.xM, yM: 0, zM: telemetry.positionM.zM }, renderAnchor);
    const vehicleKey = chunkKeyForGeoPoint(geoPoint, worldAnchor);
    const renderKeys = neighborhood(vehicleKey, RENDER_RADIUS_CHUNKS);
    const vehicleKeyString = chunkKeyToString(vehicleKey);
    if (lastVehicleKeyRef.current !== null && lastVehicleKeyRef.current !== vehicleKeyString) perfStats.world.chunkCrossings += 1;
    lastVehicleKeyRef.current = vehicleKeyString;

    store.evictOutside(renderKeys);
    store.markActive(renderKeys);

    if (!fetchLockRef.current) {
      const fetchable = store.pickFetchable(renderKeys, Date.now());
      if (fetchable.length > 0) {
        fetchLockRef.current = true;
        runFetchCycle(fetchable).finally(() => { fetchLockRef.current = false; });
      }
    }

    const nowMs = Date.now();
    const nextActive: StreamedChunk[] = [];
    let nextUnavailable = false;
    let failedChunks = 0;
    for (const [, record] of store.entries()) {
      if ((record.state === 'active' || record.state === 'generated') && record.chunk) nextActive.push(record.chunk);
      if (record.state === 'failed') failedChunks += 1;
      if (record.state === 'failed' && nowMs - (record.failedAtMs ?? 0) < FAILURE_BACKOFF_MS * 3) nextUnavailable = true;
    }
    perfStats.world.activeChunks = nextActive.length;
    perfStats.world.failedChunks = failedChunks;
    // Même contenu qu'avant : on garde la référence pour ne pas invalider les mémos en aval (trottoirs inter-chunks) toutes les 0,4 s.
    setActiveChunks((previous) => (previous.length === nextActive.length && previous.every((chunk) => nextActive.includes(chunk)) ? previous : nextActive));
    setZoneUnavailable(nextUnavailable);
  });

  return { activeChunks, zoneUnavailable };
}
