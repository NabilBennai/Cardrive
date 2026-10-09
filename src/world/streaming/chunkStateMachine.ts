import type { ChunkKey } from '../../shared/types.ts';
import type { StreamedChunk } from './chunkOwnership.ts';
import { chunkKeyToString } from './chunkGrid.ts';

/** Doc §8 : « Cycle : absent → demandé → données disponibles → généré → actif → éviction. » Plus `failed` (échecs réessayables avec temporisation). */
export type ChunkState = 'requested' | 'generated' | 'active' | 'failed';

export interface ChunkRecord {
  key: ChunkKey;
  state: ChunkState;
  /** Référence STABLE (jamais recréée tant que l'état n'est pas regénéré) — essentiel pour que
   *  React/Three ne reconstruisent pas la géométrie d'un chunk inchangé à chaque tick (D2). */
  chunk?: StreamedChunk;
  failedAtMs?: number;
}

/** Doc §8 : « réessayables avec temporisation, sans boucle de requêtes. » */
export const FAILURE_BACKOFF_MS = 4_000;

/**
 * État vivant des chunks, indépendant de React (vit dans un état React stable, voir
 * useChunkStreamer.ts). « absent » n'a pas d'état propre : un chunk absent est simplement une
 * clé sans entrée dans la Map.
 */
export class ChunkStore {
  private readonly records = new Map<string, ChunkRecord>();

  get(keyStr: string): ChunkRecord | undefined {
    return this.records.get(keyStr);
  }

  entries(): IterableIterator<[string, ChunkRecord]> {
    return this.records.entries();
  }

  /** Parmi les clés nécessaires, celles qui peuvent être demandées maintenant : absentes, ou en échec depuis plus de FAILURE_BACKOFF_MS. */
  pickFetchable(neededKeys: ChunkKey[], nowMs: number): ChunkKey[] {
    return neededKeys.filter((key) => {
      const record = this.records.get(chunkKeyToString(key));
      if (!record) return true;
      if (record.state === 'failed') return nowMs - (record.failedAtMs ?? 0) >= FAILURE_BACKOFF_MS;
      return false;
    });
  }

  markRequested(keys: ChunkKey[]): void {
    for (const key of keys) {
      this.records.set(chunkKeyToString(key), { key, state: 'requested' });
    }
  }

  markGenerated(key: ChunkKey, chunk: StreamedChunk): void {
    this.records.set(chunkKeyToString(key), { key, state: 'generated', chunk });
  }

  markFailed(key: ChunkKey, nowMs: number): void {
    this.records.set(chunkKeyToString(key), { key, state: 'failed', failedAtMs: nowMs });
  }

  markActive(keys: ChunkKey[]): void {
    for (const key of keys) {
      const keyStr = chunkKeyToString(key);
      const record = this.records.get(keyStr);
      if (record && record.state !== 'requested' && record.state !== 'failed' && record.state !== 'active') {
        this.records.set(keyStr, { ...record, state: 'active' });
      }
    }
  }

  /** Retire du magasin toute clé hors du voisinage de rendu courant ; retourne les clés évincées (pour libérer géométries/colliders côté React). */
  evictOutside(renderKeys: ChunkKey[]): ChunkKey[] {
    const renderKeySet = new Set(renderKeys.map(chunkKeyToString));
    const evicted: ChunkKey[] = [];
    for (const [keyStr, record] of this.records) {
      if (!renderKeySet.has(keyStr)) {
        evicted.push(record.key);
        this.records.delete(keyStr);
      }
    }
    return evicted;
  }
}
