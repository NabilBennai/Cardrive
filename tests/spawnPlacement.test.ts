import { describe, expect, it } from 'vitest';
import { pickSpawnPose } from '../src/world/roads/spawnPlacement';
import type { RoadGraph } from '../src/world/roads/roadGraph';

describe('pickSpawnPose', () => {
  it('picks the longest way and orients the heading along its tangent', () => {
    const graph: RoadGraph = {
      nodesById: new Map([
        [10, { id: 10, local: { xM: 0, yM: 0, zM: 0 } }],
        [20, { id: 20, local: { xM: 0, yM: 0, zM: 40 } }],
        [30, { id: 30, local: { xM: 0, yM: 0, zM: 0 } }],
        [40, { id: 40, local: { xM: 60, yM: 0, zM: 0 } }],
      ]),
      ways: [
        { id: 100, nodeIds: [10, 20], widthM: 6, surface: 'asphalt' },
        { id: 200, nodeIds: [30, 40], widthM: 6, surface: 'asphalt' },
      ],
      junctionNodeIds: new Set(),
      excluded: [],
    };

    const pose = pickSpawnPose(graph);
    expect(pose).not.toBeNull();
    expect(pose!.headingRad).toBeCloseTo(Math.PI / 2, 6);
    expect(pose!.position.xM).toBeCloseTo(30, 6);
    expect(pose!.position.zM).toBeCloseTo(0, 6);
  });

  it('returns null for an empty graph', () => {
    const graph: RoadGraph = { nodesById: new Map(), ways: [], junctionNodeIds: new Set(), excluded: [] };
    expect(pickSpawnPose(graph)).toBeNull();
  });
});
