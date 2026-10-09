import type { GeoBounds, RawOsmData } from './geoProvider.ts';

const DATABASE_NAME = 'cardrive-geo-cache';
const DATABASE_VERSION = 1;
const STORE_NAME = 'zones';

/** Doc §8 : « Versionner les clés de cache avec le fournisseur et la version du générateur. »
 *  À incrémenter si le format de sortie de roadGraph/roadMesh change de façon incompatible. */
export const GENERATOR_VERSION = 1;
export const MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const MAX_ENTRIES = 40;

interface GeoCacheRecord {
  key: string;
  storedAtMs: number;
  lastAccessMs: number;
  providerId: string;
  generatorVersion: number;
  bounds: GeoBounds;
  data: RawOsmData;
}

const quantize = (value: number) => value.toFixed(4);

/** Clé de cache, exportée et pure pour être testable sans navigateur : providerId:generatorVersion:bbox arrondie. */
export function formatCacheKey(providerId: string, bounds: GeoBounds, generatorVersion: number = GENERATOR_VERSION): string {
  const bbox = `${quantize(bounds.south)},${quantize(bounds.west)},${quantize(bounds.north)},${quantize(bounds.east)}`;
  return `${providerId}:${generatorVersion}:${bbox}`;
}

export function openGeoCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      store.createIndex('lastAccessMs', 'lastAccessMs');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function readGeoCache(db: IDBDatabase, providerId: string, bounds: GeoBounds): Promise<RawOsmData | null> {
  return new Promise((resolve, reject) => {
    const key = formatCacheKey(providerId, bounds);
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => {
      const record = request.result as GeoCacheRecord | undefined;
      if (!record) { resolve(null); return; }
      if (Date.now() - record.storedAtMs > MAX_AGE_MS) {
        store.delete(key);
        resolve(null);
        return;
      }
      record.lastAccessMs = Date.now();
      store.put(record);
      resolve(record.data);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function writeGeoCache(db: IDBDatabase, providerId: string, bounds: GeoBounds, data: RawOsmData): Promise<void> {
  const record: GeoCacheRecord = {
    key: formatCacheKey(providerId, bounds),
    storedAtMs: Date.now(),
    lastAccessMs: Date.now(),
    providerId,
    generatorVersion: GENERATOR_VERSION,
    bounds,
    data,
  };
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  await evictOldestBeyondCap(db);
}

/** Éviction LRU par nombre d'entrées (doc §8 : « borner la taille par éviction LRU »). */
async function evictOldestBeyondCap(db: IDBDatabase): Promise<void> {
  const count = await new Promise<number>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const overflow = count - MAX_ENTRIES;
  if (overflow <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const index = transaction.objectStore(STORE_NAME).index('lastAccessMs');
    let deleted = 0;
    const cursorRequest = index.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || deleted >= overflow) { resolve(); return; }
      cursor.delete();
      deleted += 1;
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
}
