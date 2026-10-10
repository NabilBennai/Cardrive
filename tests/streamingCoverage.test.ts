import { describe, expect, it } from 'vitest';
import { unprojectFromLocal, type GeoAnchor } from '../src/geo/projection';
import type { RawOsmData, RawOsmNode, RawOsmWay } from '../src/map/geoProvider';
import { buildRoadGraph, type RoadGraph } from '../src/world/roads/roadGraph';
import { buildSidewalkLayout, extractCarriageways } from '../src/world/roads/sidewalkMesh';
import { buildStreamedChunk, splitRawByChunk, splitWaterByChunk } from '../src/world/streaming/chunkOwnership';
import {
  CHUNK_SIZE_M, chunkCenterGeoPoint, chunkKeyForGeoPoint, chunkKeyToString, neighborhood, RENDER_RADIUS_CHUNKS,
} from '../src/world/streaming/chunkGrid';

const worldAnchor: GeoAnchor = { latitudeDeg: 46, longitudeDeg: -1 };
let nextId = 1;

/** Nœud OSM à une position locale (mètres, repère de l'ancre monde). */
const nodeAt = (xM: number, zM: number): RawOsmNode => {
  const geo = unprojectFromLocal({ xM, yM: 0, zM }, worldAnchor);
  return { id: nextId++, latitudeDeg: geo.latitudeDeg, longitudeDeg: geo.longitudeDeg };
};

function wayThrough(points: Array<[number, number]>, tags: Record<string, string>): { nodes: RawOsmNode[]; way: RawOsmWay } {
  const nodes = points.map(([x, z]) => nodeAt(x, z));
  return { nodes, way: { id: nextId++, nodeIds: nodes.map((node) => node.id), tags } };
}

describe('splitWaterByChunk', () => {
  it('copies a lake into every chunk its bounding box touches, and nowhere else', () => {
    const lake = wayThrough([[100, 20], [700, 20], [700, 60], [100, 60], [100, 20]], { water: 'area' });
    const raw: RawOsmData = { nodes: lake.nodes, ways: [lake.way] };
    const keys = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }];
    const buckets = splitWaterByChunk(raw, worldAnchor, keys);
    for (const key of [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }]) expect(buckets.get(chunkKeyToString(key))?.ways, chunkKeyToString(key)).toHaveLength(1);
    for (const key of [{ x: 3, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }]) expect(buckets.get(chunkKeyToString(key))?.ways, chunkKeyToString(key)).toHaveLength(0);
  });
});

describe('cross-chunk sidewalks', () => {
  const graphOf = (points: Array<[number, number]>, highway = 'residential'): RoadGraph => {
    const road = wayThrough(points, { highway });
    return buildRoadGraph({ nodes: road.nodes, ways: [road.way] }, worldAnchor);
  };

  it('keeps only the carriageway segments near the target tile, shifted into its frame', () => {
    const graph = graphOf([[0, 0], [100, 0]]);
    const near = extractCarriageways(graph, 100, 0, 140);
    expect(near).toHaveLength(1);
    expect(near[0].ax).toBeCloseTo(100, 0);
    expect(near[0].bx).toBeCloseTo(200, 0);
    expect(extractCarriageways(graph, 400, 0, 140)).toHaveLength(0); // trop loin pour toucher la tuile
  });

  it('removes the sidewalk where a road from a NEIGHBOURING chunk crosses it', () => {
    // Voie est-ouest du chunk courant ; voie nord-sud d'un autre chunk, déjà exprimée dans le repère du chunk courant.
    const own = graphOf([[-60, 0], [60, 0]]);
    const foreign = extractCarriageways(graphOf([[0, -60], [0, 60]]), 0, 0, 140);
    const without = buildSidewalkLayout(own).collider!.vertices;
    const withForeign = buildSidewalkLayout(own, foreign).collider!.vertices;
    const crossesCarriageway = (vertices: Float32Array) => {
      for (let i = 0; i < vertices.length; i += 3) if (Math.abs(vertices[i]) < 2.5 && Math.abs(vertices[i + 2]) > 3.2) return true;
      return false;
    };
    expect(crossesCarriageway(without)).toBe(true); // sans voisin, le trottoir traverse la route croisée
    expect(crossesCarriageway(withForeign)).toBe(false);
  });
});

describe('streaming along a long road', () => {
  /** Positions monde (m) des points d'une voie présents dans les chunks actifs, reconvertis depuis le repère de chaque chunk. */
  function loadedRoadPoints(raw: RawOsmData, vehicleX: number): Array<{ xM: number; zM: number }> {
    const vehicleGeo = unprojectFromLocal({ xM: vehicleX, yM: 0, zM: 0 }, worldAnchor);
    const center = chunkKeyForGeoPoint(vehicleGeo, worldAnchor);
    const keys = neighborhood(center, RENDER_RADIUS_CHUNKS);
    const buckets = splitRawByChunk(raw, worldAnchor, keys);
    const points: Array<{ xM: number; zM: number }> = [];
    for (const key of keys) {
      const bucket = buckets.get(chunkKeyToString(key)) ?? { nodes: [], ways: [] };
      const chunk = buildStreamedChunk(key, worldAnchor, bucket, { nodes: [], ways: [] });
      const chunkCenter = chunkCenterGeoPoint(key, worldAnchor);
      // Décalage monde du centre du chunk (le repère local d'un chunk est centré sur lui).
      const originX = (chunkCenter.longitudeDeg - worldAnchor.longitudeDeg) * (Math.PI / 180) * 6_378_137 * Math.cos((worldAnchor.latitudeDeg * Math.PI) / 180);
      const originZ = -(chunkCenter.latitudeDeg - worldAnchor.latitudeDeg) * (Math.PI / 180) * 6_378_137;
      for (const node of chunk.graph.nodesById.values()) points.push({ xM: originX + node.local.xM, zM: originZ + node.local.zM });
    }
    return points;
  }

  const roadMadeOfWays = (lengthM: number, wayLengthM: number): RawOsmData => {
    const nodes: RawOsmNode[] = []; const ways: RawOsmWay[] = [];
    for (let start = 0; start < lengthM; start += wayLengthM) {
      const way = wayThrough(Array.from({ length: Math.round(wayLengthM / 50) + 1 }, (_, i) => [start + i * 50, 10] as [number, number]), { highway: 'primary' });
      nodes.push(...way.nodes); ways.push(way.way);
    }
    return { nodes, ways };
  };

  const hasRoadUnder = (raw: RawOsmData, vehicleX: number) => loadedRoadPoints(raw, vehicleX).some((point) => Math.abs(point.xM - vehicleX) < 30 && Math.abs(point.zM - 10) < 5);

  it('always has road geometry under the vehicle on a 4 km road made of ordinary-length ways', () => {
    const raw = roadMadeOfWays(4_000, 300);
    for (let x = 40; x < 3_900; x += 90) expect(hasRoadUnder(raw, x), `x=${x}`).toBe(true);
  });

  it.fails('loses the road behind the vehicle when a single way is longer than the render radius (known limitation, roadmap R-4.6)', () => {
    const raw = roadMadeOfWays(4_000, 4_000);
    expect(CHUNK_SIZE_M * (RENDER_RADIUS_CHUNKS + 0.5)).toBeLessThan(4_000);
    for (let x = 40; x < 3_900; x += 90) expect(hasRoadUnder(raw, x), `x=${x}`).toBe(true);
  });
});
