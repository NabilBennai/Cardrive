import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildBuildingLayout, buildFootprintExtrusion } from '../src/world/buildings/buildingMesh';
import type { BuildingGraph } from '../src/world/buildings/buildingGraph';

describe('buildFootprintExtrusion', () => {
  it('keeps the XZ bounding box identical to the input footprint (no axis swap/inversion) and extrudes Y by heightM from baseY', () => {
    const points = [
      new Vector3(10, 0, -20),
      new Vector3(16, 0, -20),
      new Vector3(16, 0, -14),
      new Vector3(10, 0, -14),
    ];
    const heightM = 9;
    const baseY = 0.02;
    const geometry = buildFootprintExtrusion(points, heightM, baseY);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox as Box3;

    expect(box.min.x).toBeCloseTo(10, 5);
    expect(box.max.x).toBeCloseTo(16, 5);
    expect(box.min.z).toBeCloseTo(-20, 5);
    expect(box.max.z).toBeCloseTo(-14, 5);
    expect(box.min.y).toBeCloseTo(baseY, 5);
    expect(box.max.y).toBeCloseTo(baseY + heightM, 5);
  });
});

describe('buildBuildingLayout', () => {
  const graph: BuildingGraph = {
    nodesById: new Map([
      [1, { id: 1, local: { xM: 0, yM: 0, zM: 0 } }],
      [2, { id: 2, local: { xM: 5, yM: 0, zM: 0 } }],
      [3, { id: 3, local: { xM: 5, yM: 0, zM: 5 } }],
      [4, { id: 4, local: { xM: 0, yM: 0, zM: 5 } }],
    ]),
    buildings: [
      { id: 42, nodeIds: [1, 2, 3, 4, 1], heightM: 9, materialSeed: 42 },
      { id: 47, nodeIds: [1, 2, 3, 4, 1], heightM: 9, materialSeed: 47 },
    ],
    skipped: [],
  };

  it('produces a deterministic materialIndex within [0, paletteSize)', () => {
    const layout = buildBuildingLayout(graph, 0, 5);
    expect(layout[0].materialIndex).toBe(42 % 5);
    expect(layout[1].materialIndex).toBe(47 % 5);
    for (const placement of layout) {
      expect(placement.materialIndex).toBeGreaterThanOrEqual(0);
      expect(placement.materialIndex).toBeLessThan(5);
    }
  });

  it('repeats the same materialIndex for the same id/paletteSize across calls', () => {
    const first = buildBuildingLayout(graph, 0, 5);
    const second = buildBuildingLayout(graph, 0, 5);
    expect(first.map((p) => p.materialIndex)).toEqual(second.map((p) => p.materialIndex));
  });
});
