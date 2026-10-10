import type { RawOsmData, RawOsmNode, RawOsmWay } from './geoProvider.ts';

interface LatLon { lat: number; lon: number }

interface GeomElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: LatLon[];
  members?: Array<{ type: string; role?: string; geometry?: LatLon[] }>;
}

const sameLatLon = (a: LatLon, b: LatLon) => a.lat === b.lat && a.lon === b.lon;

/**
 * Raccorde des segments (membres `outer` d'une relation multipolygone, découpés en plusieurs
 * voies) en anneaux fermés par correspondance exacte des extrémités. Les anneaux qui ne se
 * ferment pas (relation tronquée) sont abandonnés plutôt que devinés.
 */
export function assembleRings(segments: LatLon[][]): LatLon[][] {
  const remaining = segments.filter((segment) => segment.length >= 2).map((segment) => segment.slice());
  const rings: LatLon[][] = [];
  while (remaining.length > 0) {
    const ring = remaining.pop() as LatLon[];
    let extended = true;
    while (extended && !sameLatLon(ring[0], ring[ring.length - 1])) {
      extended = false;
      const tail = ring[ring.length - 1];
      for (let i = 0; i < remaining.length; i += 1) {
        const candidate = remaining[i];
        if (sameLatLon(candidate[0], tail)) ring.push(...candidate.slice(1));
        else if (sameLatLon(candidate[candidate.length - 1], tail)) ring.push(...candidate.slice(0, -1).reverse());
        else continue;
        remaining.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (ring.length >= 4 && sameLatLon(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

/**
 * Convertit une réponse `out geom` en RawOsmData synthétique (nœuds à id négatif uniques,
 * une voie par anneau extérieur ou par cours d'eau) : ainsi le cache, la répartition par chunk
 * et la projection existants s'appliquent sans changement. Tags : `water=area|line`, et pour
 * les lignes `waterway` + `width` éventuel. Les îles (anneaux intérieurs) sont ignorées.
 */
export function parseWaterResponse(body: unknown): RawOsmData {
  const elements = (body as { elements?: GeomElement[] } | null)?.elements;
  if (!Array.isArray(elements)) throw new Error('La réponse Overpass (eau) ne contient pas de tableau "elements".');

  const nodes: RawOsmNode[] = [];
  const ways: RawOsmWay[] = [];
  let nextId = -1;

  const addWay = (id: number, points: LatLon[], tags: Record<string, string>) => {
    const nodeIds: number[] = [];
    for (const point of points) {
      nodes.push({ id: nextId, latitudeDeg: point.lat, longitudeDeg: point.lon });
      nodeIds.push(nextId);
      nextId -= 1;
    }
    ways.push({ id, nodeIds, tags });
  };

  for (const element of elements) {
    if (element.type === 'way' && element.geometry && element.geometry.length >= 2) {
      const tags = element.tags ?? {};
      const isLine = tags.waterway === 'river' || tags.waterway === 'canal' || tags.waterway === 'stream';
      if (isLine) {
        addWay(element.id, element.geometry, { water: 'line', waterway: tags.waterway, ...(tags.width ? { width: tags.width } : {}) });
      } else if (element.geometry.length >= 4 && sameLatLon(element.geometry[0], element.geometry[element.geometry.length - 1])) {
        addWay(element.id, element.geometry, { water: 'area' });
      }
    } else if (element.type === 'relation' && element.members) {
      const outers = element.members
        .filter((member) => member.type === 'way' && member.role === 'outer' && member.geometry)
        .map((member) => member.geometry as LatLon[]);
      assembleRings(outers).forEach((ring, index) => addWay(element.id * 100 + index, ring, { water: 'area' }));
    }
  }
  return { nodes, ways };
}
