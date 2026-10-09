import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE_M, chunkBoundsGeo, chunkCenterGeoPoint, chunkKeyAt, chunkKeyForGeoPoint,
  neighborhood, unionBoundsGeo,
} from '../src/world/streaming/chunkGrid';

const worldAnchor = { latitudeDeg: 48.8738, longitudeDeg: 2.2950 };

describe('chunkKeyAt', () => {
  it('floors toward -Infinity, not toward zero, for negative coordinates', () => {
    expect(chunkKeyAt({ xM: -1, yM: 0, zM: -1 })).toEqual({ x: -1, z: -1 });
    expect(chunkKeyAt({ xM: -CHUNK_SIZE_M - 1, yM: 0, zM: 0 })).toEqual({ x: -2, z: 0 });
  });

  it('places a point exactly on a chunk boundary in the chunk starting at that boundary', () => {
    expect(chunkKeyAt({ xM: CHUNK_SIZE_M, yM: 0, zM: 0 })).toEqual({ x: 1, z: 0 });
    expect(chunkKeyAt({ xM: CHUNK_SIZE_M - 0.001, yM: 0, zM: 0 })).toEqual({ x: 0, z: 0 });
  });
});

describe('chunkKeyAt <-> chunkCenterGeoPoint round trip', () => {
  it('a chunk center geo point projects back inside its own chunk key', () => {
    for (const key of [{ x: 0, z: 0 }, { x: 3, z: -2 }, { x: -5, z: 7 }]) {
      const center = chunkCenterGeoPoint(key, worldAnchor);
      const resolvedKey = chunkKeyForGeoPoint(center, worldAnchor);
      expect(resolvedKey).toEqual(key);
    }
  });
});

describe('neighborhood', () => {
  it('returns exactly 9 keys for radius 1 (3x3)', () => {
    expect(neighborhood({ x: 0, z: 0 }, 1)).toHaveLength(9);
  });

  it('returns exactly 25 keys for radius 2 (5x5)', () => {
    expect(neighborhood({ x: 2, z: -1 }, 2)).toHaveLength(25);
  });

  it('is centered on the given key', () => {
    const keys = neighborhood({ x: 5, z: 5 }, 1);
    expect(keys).toContainEqual({ x: 5, z: 5 });
    expect(keys).toContainEqual({ x: 4, z: 4 });
    expect(keys).toContainEqual({ x: 6, z: 6 });
  });
});

describe('unionBoundsGeo', () => {
  it('contains every input bounds rectangle', () => {
    const a = chunkBoundsGeo({ x: 0, z: 0 }, worldAnchor, 0);
    const b = chunkBoundsGeo({ x: 3, z: -2 }, worldAnchor, 0);
    const union = unionBoundsGeo([a, b]);
    for (const bounds of [a, b]) {
      expect(union.south).toBeLessThanOrEqual(bounds.south);
      expect(union.north).toBeGreaterThanOrEqual(bounds.north);
      expect(union.west).toBeLessThanOrEqual(bounds.west);
      expect(union.east).toBeGreaterThanOrEqual(bounds.east);
    }
  });

  it('throws on an empty list rather than returning a degenerate box', () => {
    expect(() => unionBoundsGeo([])).toThrow();
  });
});
