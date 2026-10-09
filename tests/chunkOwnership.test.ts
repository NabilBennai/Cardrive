import { describe, expect, it } from 'vitest';
import { unprojectFromLocal } from '../src/geo/projection';
import { splitRawByChunk } from '../src/world/streaming/chunkOwnership';
import type { RawOsmData } from '../src/map/geoProvider';

const worldAnchor = { latitudeDeg: 48.8738, longitudeDeg: 2.2950 };
// Chunk {x:0,z:0} couvre le local [0,256)x[0,256) ; chunk {x:1,z:0} couvre [256,512)x[0,256).
const geoAt = (xM: number, zM: number) => unprojectFromLocal({ xM, yM: 0, zM }, worldAnchor);

describe('splitRawByChunk', () => {
  it('assigns a way fully inside one chunk to that chunk', () => {
    const nodes = [
      { id: 1, ...geoAt(50, 50) },
      { id: 2, ...geoAt(100, 100) },
    ];
    const raw: RawOsmData = { nodes, ways: [{ id: 10, nodeIds: [1, 2], tags: { highway: 'residential' } }] };
    const buckets = splitRawByChunk(raw, worldAnchor, [{ x: 0, z: 0 }, { x: 1, z: 0 }]);
    expect(buckets.get('0,0')?.ways.map((w) => w.id)).toEqual([10]);
    expect(buckets.get('1,0')?.ways).toEqual([]);
  });

  it('assigns a way whose first node is in chunk A but crosses into B entirely to A (no split, no duplicate)', () => {
    const nodes = [
      { id: 1, ...geoAt(200, 50) }, // chunk {0,0}
      { id: 2, ...geoAt(300, 50) }, // chunk {1,0}
    ];
    const raw: RawOsmData = { nodes, ways: [{ id: 20, nodeIds: [1, 2], tags: { highway: 'residential' } }] };
    const buckets = splitRawByChunk(raw, worldAnchor, [{ x: 0, z: 0 }, { x: 1, z: 0 }]);
    expect(buckets.get('0,0')?.ways.map((w) => w.id)).toEqual([20]);
    expect(buckets.get('1,0')?.ways).toEqual([]);
    // Les deux nœuds sont copiés dans le chunk propriétaire, pour que le tracé complet y soit géométriquement résoluble.
    expect(buckets.get('0,0')?.nodes.map((n) => n.id).sort()).toEqual([1, 2]);
  });

  it('drops a way whose first node falls outside every requested chunk, without error', () => {
    const nodes = [
      { id: 1, ...geoAt(5_000, 5_000) }, // loin de tout chunk demandé
      { id: 2, ...geoAt(5_050, 5_050) },
    ];
    const raw: RawOsmData = { nodes, ways: [{ id: 30, nodeIds: [1, 2], tags: { highway: 'residential' } }] };
    const buckets = splitRawByChunk(raw, worldAnchor, [{ x: 0, z: 0 }]);
    expect(buckets.get('0,0')?.ways).toEqual([]);
  });
});
