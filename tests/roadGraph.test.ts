import { describe, expect, it } from 'vitest';
import { buildRoadGraph, EmptyRoadZoneError, estimateWidthM } from '../src/world/roads/roadGraph';
import type { RawOsmData } from '../src/map/geoProvider';

const anchor = { latitudeDeg: 48, longitudeDeg: 2 };

describe('estimateWidthM', () => {
  it('prefers the width tag when present', () => {
    expect(estimateWidthM({ width: '7.5' })).toBe(7.5);
  });

  it('falls back to lanes times the documented per-lane width', () => {
    expect(estimateWidthM({ lanes: '2' })).toBeCloseTo(6.5);
  });

  it('falls back to the documented default when neither tag is present', () => {
    expect(estimateWidthM({})).toBe(6);
  });
});

describe('buildRoadGraph', () => {
  it('marks a node shared by two ways as a junction', () => {
    const raw: RawOsmData = {
      nodes: [
        { id: 1, latitudeDeg: 48, longitudeDeg: 2 },
        { id: 2, latitudeDeg: 48.001, longitudeDeg: 2 },
        { id: 3, latitudeDeg: 48.002, longitudeDeg: 2 },
        { id: 4, latitudeDeg: 48.001, longitudeDeg: 2.001 },
      ],
      ways: [
        { id: 10, nodeIds: [1, 2, 3], tags: { highway: 'residential' } },
        { id: 11, nodeIds: [2, 4], tags: { highway: 'residential' } },
      ],
    };
    const graph = buildRoadGraph(raw, anchor);
    expect(graph.junctionNodeIds.has(2)).toBe(true);
    expect(graph.junctionNodeIds.has(1)).toBe(false);
    expect(graph.ways).toHaveLength(2);
  });

  it('excludes bridge, tunnel and nonzero-layer ways with the right reason, keeping a normal way', () => {
    const raw: RawOsmData = {
      nodes: [
        { id: 1, latitudeDeg: 48, longitudeDeg: 2 },
        { id: 2, latitudeDeg: 48.001, longitudeDeg: 2 },
      ],
      ways: [
        { id: 20, nodeIds: [1, 2], tags: { highway: 'residential', bridge: 'yes' } },
        { id: 21, nodeIds: [1, 2], tags: { highway: 'residential', tunnel: 'yes' } },
        { id: 22, nodeIds: [1, 2], tags: { highway: 'residential', layer: '1' } },
        { id: 23, nodeIds: [1, 2], tags: { highway: 'residential' } },
      ],
    };
    const graph = buildRoadGraph(raw, anchor);
    expect(graph.ways.map((way) => way.id)).toEqual([23]);
    expect(graph.excluded).toEqual(expect.arrayContaining([
      { id: 20, reason: 'bridge' },
      { id: 21, reason: 'tunnel' },
      { id: 22, reason: 'layer' },
    ]));
  });

  it('throws EmptyRoadZoneError when no drivable way remains after filtering', () => {
    const raw: RawOsmData = {
      nodes: [{ id: 1, latitudeDeg: 48, longitudeDeg: 2 }, { id: 2, latitudeDeg: 48.001, longitudeDeg: 2 }],
      ways: [{ id: 30, nodeIds: [1, 2], tags: { highway: 'footway' } }],
    };
    expect(() => buildRoadGraph(raw, anchor)).toThrow(EmptyRoadZoneError);
  });
});
