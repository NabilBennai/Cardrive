import { GeoProviderError, type GeoBounds, type GeoProvider, type RawOsmData, type RawOsmNode, type RawOsmWay } from './geoProvider.ts';

const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OVERPASS_URL = import.meta.env.VITE_OVERPASS_URL ?? DEFAULT_OVERPASS_URL;
const OVERPASS_TIMEOUT_S = 25;
const CLIENT_TIMEOUT_MS = (OVERPASS_TIMEOUT_S + 5) * 1_000;

const DRIVABLE_HIGHWAY_VALUES = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'service', 'living_street', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
];

/** Requête Overpass QL : voies carrossables dans la zone, avec leurs nœuds (doc §7, étape 1 du pipeline). */
export function buildOverpassQuery(bounds: GeoBounds): string {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const highwayPattern = `^(${DRIVABLE_HIGHWAY_VALUES.join('|')})$`;
  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];(way["highway"~"${highwayPattern}"](${bbox}););out body;>;out skel qt;`;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

function parseOverpassResponse(body: unknown): RawOsmData {
  if (!body || typeof body !== 'object' || !Array.isArray((body as OverpassResponse).elements)) {
    throw new GeoProviderError('malformed-response', 'La réponse Overpass ne contient pas de tableau "elements".');
  }
  const nodes: RawOsmNode[] = [];
  const ways: RawOsmWay[] = [];
  for (const element of (body as OverpassResponse).elements ?? []) {
    if (element.type === 'node' && typeof element.lat === 'number' && typeof element.lon === 'number') {
      nodes.push({ id: element.id, latitudeDeg: element.lat, longitudeDeg: element.lon });
    } else if (element.type === 'way' && Array.isArray(element.nodes)) {
      ways.push({ id: element.id, nodeIds: element.nodes, tags: element.tags ?? {} });
    }
  }
  return { nodes, ways };
}

/** Seule implémentation concrète de GeoProvider pour cette étape : l'API Overpass publique. */
export class OverpassProvider implements GeoProvider {
  readonly id = 'overpass';

  constructor(private readonly baseUrl: string = OVERPASS_URL) {}

  async getRoads(bounds: GeoBounds, signal: AbortSignal): Promise<RawOsmData> {
    const query = buildOverpassQuery(bounds);
    const timeoutController = new AbortController();
    const forwardAbort = () => timeoutController.abort();
    signal.addEventListener('abort', forwardAbort);
    const timeoutId = setTimeout(forwardAbort, CLIENT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(this.baseUrl, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: timeoutController.signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new GeoProviderError('network', 'Impossible de joindre le fournisseur de cartes.', { cause: error });
    } finally {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', forwardAbort);
    }

    if (response.status === 429 || response.status === 504) {
      throw new GeoProviderError('rate-limited', `Le fournisseur limite les requêtes (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      throw new GeoProviderError('http', `Le fournisseur a répondu HTTP ${response.status}.`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new GeoProviderError('malformed-response', 'La réponse Overpass n\'est pas un JSON valide.', { cause: error });
    }
    return parseOverpassResponse(body);
  }
}
