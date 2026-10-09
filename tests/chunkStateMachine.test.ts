import { describe, expect, it } from 'vitest';
import { emptyRoadGraph } from '../src/world/roads/roadGraph';
import { ChunkStore, FAILURE_BACKOFF_MS } from '../src/world/streaming/chunkStateMachine';
import type { StreamedChunk } from '../src/world/streaming/chunkOwnership';

const emptyBuildingGraph = () => ({ nodesById: new Map(), buildings: [], skipped: [] });
const makeChunk = (key: { x: number; z: number }): StreamedChunk => ({ key, graph: emptyRoadGraph(), buildingGraph: emptyBuildingGraph() });

describe('ChunkStore', () => {
  it('follows the full cycle: requested -> generated -> active, and reflects it in get()', () => {
    const store = new ChunkStore();
    const key = { x: 0, z: 0 };
    store.markRequested([key]);
    expect(store.get('0,0')?.state).toBe('requested');
    const chunk = makeChunk(key);
    store.markGenerated(key, chunk);
    expect(store.get('0,0')?.state).toBe('generated');
    expect(store.get('0,0')?.chunk).toBe(chunk); // référence stable, pas une copie
    store.markActive([key]);
    expect(store.get('0,0')?.state).toBe('active');
  });

  it('does not offer a failed chunk for refetch before the backoff elapses, but does after', () => {
    const store = new ChunkStore();
    const key = { x: 1, z: 1 };
    store.markFailed(key, 1_000);
    expect(store.pickFetchable([key], 1_000 + FAILURE_BACKOFF_MS - 1)).toEqual([]);
    expect(store.pickFetchable([key], 1_000 + FAILURE_BACKOFF_MS)).toEqual([key]);
  });

  it('offers an absent chunk for fetch immediately', () => {
    const store = new ChunkStore();
    expect(store.pickFetchable([{ x: 9, z: 9 }], 0)).toEqual([{ x: 9, z: 9 }]);
  });

  it('does not offer a generated/active chunk for refetch', () => {
    const store = new ChunkStore();
    const key = { x: 2, z: 2 };
    store.markGenerated(key, makeChunk(key));
    expect(store.pickFetchable([key], 0)).toEqual([]);
  });

  it('evictOutside removes exactly the keys outside the new render set and returns them', () => {
    const store = new ChunkStore();
    const inside = { x: 0, z: 0 };
    const outside = { x: 10, z: 10 };
    store.markGenerated(inside, makeChunk(inside));
    store.markGenerated(outside, makeChunk(outside));
    const evicted = store.evictOutside([inside]);
    expect(evicted).toEqual([outside]);
    expect(store.get('0,0')).toBeDefined();
    expect(store.get('10,10')).toBeUndefined();
  });
});
