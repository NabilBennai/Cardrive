import { describe, expect, it } from 'vitest';
import { assembleRings, parseWaterResponse } from '../src/map/waterParse';
import { buildWaterGraph, clipRingToSquare } from '../src/world/water/waterGraph';
import { trimPolyline } from '../src/world/roads/sidewalkMesh';
import { buildStripPrisms } from '../src/world/roads/stripMesh';

const p = (lat: number, lon: number) => ({ lat, lon });

describe('assembleRings', () => {
  it('joins two half-rings, reversing one when needed', () => {
    const a = [p(0, 0), p(0, 1), p(1, 1)];
    const b = [p(0, 0), p(1, 0), p(1, 1)]; // shares both ends, reversed relative to a's continuation
    const rings = assembleRings([a, b]);
    expect(rings).toHaveLength(1);
    expect(rings[0][0]).toEqual(rings[0][rings[0].length - 1]);
  });

  it('drops rings that never close', () => {
    expect(assembleRings([[p(0, 0), p(0, 1), p(1, 1)]])).toHaveLength(0);
  });
});

describe('parseWaterResponse', () => {
  it('emits an area for a closed natural=water way and a line for a river', () => {
    const raw = parseWaterResponse({
      elements: [
        { type: 'way', id: 1, tags: { natural: 'water' }, geometry: [p(0, 0), p(0, 1), p(1, 1), p(0, 0)] },
        { type: 'way', id: 2, tags: { waterway: 'river', width: '20' }, geometry: [p(0, 0), p(1, 1)] },
      ],
    });
    expect(raw.ways.map((w) => w.tags.water)).toEqual(['area', 'line']);
    expect(raw.ways[1].tags.width).toBe('20');
    expect(new Set(raw.nodes.map((n) => n.id)).size).toBe(raw.nodes.length);
  });
});

describe('clipRingToSquare', () => {
  it('clips a ring bigger than the square to the square itself', () => {
    const big = [{ xM: -500, zM: -500 }, { xM: 500, zM: -500 }, { xM: 500, zM: 500 }, { xM: -500, zM: 500 }];
    const clipped = clipRingToSquare(big, 128);
    for (const point of clipped) {
      expect(Math.abs(point.xM)).toBeLessThanOrEqual(128 + 1e-9);
      expect(Math.abs(point.zM)).toBeLessThanOrEqual(128 + 1e-9);
    }
    expect(clipped.length).toBe(4);
  });

  it('returns nothing for a ring fully outside', () => {
    expect(clipRingToSquare([{ xM: 200, zM: 200 }, { xM: 300, zM: 200 }, { xM: 300, zM: 300 }], 128)).toHaveLength(0);
  });
});

describe('buildWaterGraph', () => {
  it('projects a lake around the anchor into a local area', () => {
    const anchor = { latitudeDeg: 46, longitudeDeg: -1 };
    const d = 0.0005;
    const graph = buildWaterGraph({
      nodes: [
        { id: -1, latitudeDeg: 46 - d, longitudeDeg: -1 - d }, { id: -2, latitudeDeg: 46 - d, longitudeDeg: -1 + d },
        { id: -3, latitudeDeg: 46 + d, longitudeDeg: -1 + d }, { id: -4, latitudeDeg: 46 + d, longitudeDeg: -1 - d },
      ],
      ways: [{ id: 1, nodeIds: [-1, -2, -3, -4, -1], tags: { water: 'area' } }],
    }, anchor, 128);
    expect(graph.areas).toHaveLength(1);
    expect(graph.areas[0].ring).toHaveLength(4);
  });
});

describe('trimPolyline', () => {
  const line = [{ xM: 0, zM: 0 }, { xM: 10, zM: 0 }, { xM: 20, zM: 0 }];
  it('trims both ends along the path', () => {
    const trimmed = trimPolyline(line, 3, 5);
    expect(trimmed?.[0]).toEqual({ xM: 3, zM: 0 });
    expect(trimmed?.[trimmed.length - 1]).toEqual({ xM: 15, zM: 0 });
    expect(trimmed).toHaveLength(3);
  });
  it('returns null when nothing meaningful remains', () => {
    expect(trimPolyline(line, 10, 9)).toBeNull();
  });
});

describe('buildStripPrisms', () => {
  it('stays within the requested lateral band and height', () => {
    const out: number[] = [];
    buildStripPrisms(out, [{ xM: 0, zM: 0 }, { xM: 0, zM: 10 }], 3, 5, 0.15, 0);
    let maxY = 0; let minX = Infinity; let maxX = -Infinity;
    for (let i = 0; i < out.length; i += 3) { minX = Math.min(minX, out[i]); maxX = Math.max(maxX, out[i]); maxY = Math.max(maxY, out[i + 1]); }
    expect(maxY).toBeCloseTo(0.15);
    expect(Math.abs(minX)).toBeGreaterThanOrEqual(3 - 1e-9);
    expect(Math.abs(maxX)).toBeLessThanOrEqual(5 + 1e-9);
  });
});
