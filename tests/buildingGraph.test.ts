import { describe, expect, it } from 'vitest';
import {
  buildBuildingGraph,
  DEFAULT_BUILDING_HEIGHT_M,
  DEFAULT_LEVEL_HEIGHT_M,
  estimateHeightM,
  MAX_BUILDINGS_PER_ZONE,
} from '../src/world/buildings/buildingGraph';
import type { RawOsmData } from '../src/map/geoProvider';

const anchor = { latitudeDeg: 48, longitudeDeg: 2 };

describe('estimateHeightM', () => {
  it('prefers the height tag', () => {
    expect(estimateHeightM({ height: '12.5' })).toBe(12.5);
  });

  it('falls back to building:levels times the documented per-level height', () => {
    expect(estimateHeightM({ 'building:levels': '4' })).toBe(4 * DEFAULT_LEVEL_HEIGHT_M);
  });

  it('falls back to the documented default when neither tag is present', () => {
    expect(estimateHeightM({})).toBe(DEFAULT_BUILDING_HEIGHT_M);
  });
});

function square(idBase: number, cx: number, cz: number, size: number) {
  return {
    nodes: [
      { id: idBase, latitudeDeg: anchor.latitudeDeg + cz, longitudeDeg: anchor.longitudeDeg + cx },
      { id: idBase + 1, latitudeDeg: anchor.latitudeDeg + cz, longitudeDeg: anchor.longitudeDeg + cx + size },
      { id: idBase + 2, latitudeDeg: anchor.latitudeDeg + cz + size, longitudeDeg: anchor.longitudeDeg + cx + size },
      { id: idBase + 3, latitudeDeg: anchor.latitudeDeg + cz + size, longitudeDeg: anchor.longitudeDeg + cx },
    ],
    nodeIds: [idBase, idBase + 1, idBase + 2, idBase + 3, idBase],
  };
}

describe('buildBuildingGraph', () => {
  it('parses a valid closed footprint into one Building, projected via the given anchor', () => {
    const shape = square(1, 0.001, 0.001, 0.0005);
    const raw: RawOsmData = {
      nodes: shape.nodes,
      ways: [{ id: 100, nodeIds: shape.nodeIds, tags: { building: 'yes' } }],
    };
    const graph = buildBuildingGraph(raw, anchor);
    expect(graph.buildings).toHaveLength(1);
    expect(graph.buildings[0].id).toBe(100);
    expect(graph.nodesById.size).toBe(4);
    expect(graph.skipped).toHaveLength(0);
  });

  it('skips an open ring without throwing', () => {
    const shape = square(1, 0.001, 0.001, 0.0005);
    const raw: RawOsmData = {
      nodes: shape.nodes,
      // Pas de fermeture : le dernier id n'est pas égal au premier.
      ways: [{ id: 100, nodeIds: shape.nodeIds.slice(0, -1), tags: { building: 'yes' } }],
    };
    const graph = buildBuildingGraph(raw, anchor);
    expect(graph.buildings).toHaveLength(0);
    expect(graph.skipped).toEqual([{ id: 100, reason: 'open-ring' }]);
  });

  it('skips a degenerate footprint (fewer than 3 distinct points)', () => {
    const raw: RawOsmData = {
      nodes: [
        { id: 1, latitudeDeg: 48, longitudeDeg: 2 },
        { id: 2, latitudeDeg: 48, longitudeDeg: 2 },
      ],
      ways: [{ id: 100, nodeIds: [1, 2, 1, 2, 1], tags: { building: 'yes' } }],
    };
    const graph = buildBuildingGraph(raw, anchor);
    expect(graph.buildings).toHaveLength(0);
    expect(graph.skipped[0].reason).toBe('too-few-points');
  });

  it('skips an oversized footprint', () => {
    const shape = square(1, 0, 0, 0.01); // ~1.1km-scale square, well above the diagonal cap
    const raw: RawOsmData = {
      nodes: shape.nodes,
      ways: [{ id: 100, nodeIds: shape.nodeIds, tags: { building: 'yes' } }],
    };
    const graph = buildBuildingGraph(raw, anchor);
    expect(graph.buildings).toHaveLength(0);
    expect(graph.skipped[0]).toEqual({ id: 100, reason: 'oversized' });
  });

  it('caps the number of accepted buildings per zone and reports the remainder, never throwing', () => {
    const nodes: RawOsmData['nodes'] = [];
    const ways: RawOsmData['ways'] = [];
    const total = MAX_BUILDINGS_PER_ZONE + 5;
    for (let i = 0; i < total; i += 1) {
      const shape = square(i * 10, i * 0.0001, 0, 0.00002);
      nodes.push(...shape.nodes);
      ways.push({ id: i, nodeIds: shape.nodeIds, tags: { building: 'yes' } });
    }
    const graph = buildBuildingGraph({ nodes, ways }, anchor);
    expect(graph.buildings).toHaveLength(MAX_BUILDINGS_PER_ZONE);
    expect(graph.skipped).toHaveLength(5);
    expect(graph.skipped.every((entry) => entry.reason === 'zone-cap')).toBe(true);
  });

  it('ignores highway-only data (no building tag anywhere) without error', () => {
    const raw: RawOsmData = {
      nodes: [{ id: 1, latitudeDeg: 48, longitudeDeg: 2 }, { id: 2, latitudeDeg: 48.001, longitudeDeg: 2 }],
      ways: [{ id: 1, nodeIds: [1, 2], tags: { highway: 'residential' } }],
    };
    const graph = buildBuildingGraph(raw, anchor);
    expect(graph.buildings).toEqual([]);
    expect(graph.skipped).toEqual([]);
  });
});
