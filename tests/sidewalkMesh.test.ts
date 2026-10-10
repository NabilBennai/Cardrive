import { describe, expect, it } from 'vitest';
import { buildSidewalkLayout } from '../src/world/roads/sidewalkMesh';
import type { RoadGraph, RoadWay } from '../src/world/roads/roadGraph';

const way = (id: number, nodeIds: number[]): RoadWay => ({ id, nodeIds, widthM: 6, surface: 'asphalt', hasSidewalks: true });
const node = (id: number, xM: number, zM: number) => [id, { id, local: { xM, yM: 0, zM } }] as const;

describe('buildSidewalkLayout', () => {
  it('leaves the carriageway of a crossing road free even without a shared junction node', () => {
    // Deux routes qui se croisent en (0,0) SANS nœud commun : la topologie ne voit aucune jonction.
    const graph: RoadGraph = {
      nodesById: new Map([node(1, -50, 0), node(2, 50, 0), node(3, 0, -50), node(4, 0, 50)]),
      ways: [way(10, [1, 2]), way(20, [3, 4])],
      junctionNodeIds: new Set(),
      excluded: [],
    };
    const { collider } = buildSidewalkLayout(graph);
    expect(collider).not.toBeNull();
    const v = collider!.vertices;
    for (let i = 0; i < v.length; i += 3) {
      const x = v[i]; const z = v[i + 2];
      // Aucun sommet de trottoir au centre de la chaussée de l'autre route (|x|<3 pour la route nord-sud, |z|<3 pour l'est-ouest).
      const insideNorthSouthRoad = Math.abs(x) < 2.5 && Math.abs(z) > 4;
      const insideEastWestRoad = Math.abs(z) < 2.5 && Math.abs(x) > 4;
      expect(insideNorthSouthRoad || insideEastWestRoad).toBe(false);
    }
  });
});

describe('buildSidewalkLayout on a sharp bend', () => {
  it('does not let the sidewalk of a hairpin fold back across its own carriageway', () => {
    // Épingle : la voie monte vers +z puis revient presque sur elle-même.
    const graph: RoadGraph = {
      nodesById: new Map([node(1, 0, 0), node(2, 0, 40), node(3, 4, 0)]),
      ways: [way(10, [1, 2, 3])],
      junctionNodeIds: new Set(),
      excluded: [],
    };
    const { collider } = buildSidewalkLayout(graph);
    const v = collider?.vertices ?? new Float32Array();
    for (let i = 0; i < v.length; i += 3) {
      const x = v[i]; const z = v[i + 2];
      // Distance à l'axe du premier bras (x=0, 0<z<40) : jamais dans la chaussée (|x| < 3) sauf aux extrémités.
      const insideFirstArm = z > 5 && z < 35 && Math.abs(x) < 2.9;
      expect(insideFirstArm).toBe(false);
    }
  });
});
