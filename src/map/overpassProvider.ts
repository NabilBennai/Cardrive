import { GeoProviderError, type GeoBounds, type GeoProvider, type RawOsmData, type RawOsmNode, type RawOsmWay } from './geoProvider.ts';

// Plusieurs miroirs publics, essayés dans l'ordre : l'instance officielle sature/rate-limit
// facilement sous usage ponctuel (observé en session : « Service saturé » sur une seule
// requête). kumi.systems et osm.ch sont des miroirs communautaires réputés plus disponibles
// pour ce genre d'usage. Si VITE_OVERPASS_URL est défini, il est seul utilisé (pas de repli).
const DEFAULT_OVERPASS_URLS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const OVERPASS_URLS = import.meta.env.VITE_OVERPASS_URL ? [import.meta.env.VITE_OVERPASS_URL] : DEFAULT_OVERPASS_URLS;
const OVERPASS_TIMEOUT_S = 25;
const CLIENT_TIMEOUT_MS = (OVERPASS_TIMEOUT_S + 5) * 1_000;

const DRIVABLE_HIGHWAY_VALUES = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'service', 'living_street', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
];

/**
 * Requête Overpass QL : voies carrossables ET empreintes de bâtiments dans la zone, avec leurs
 * nœuds (doc §7, étape 1 du pipeline). Une seule requête groupée pour les deux : RawOsmData
 * reste un {nodes, ways} plat, et chaque consommateur (roadGraph.ts / buildingGraph.ts) filtre
 * par le tag qui le concerne (highway / building) sans se soucier de l'autre.
 */
export function buildOverpassQuery(bounds: GeoBounds): string {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const highwayPattern = `^(${DRIVABLE_HIGHWAY_VALUES.join('|')})$`;
  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];(way["highway"~"${highwayPattern}"](${bbox});way["building"](${bbox}););out body;>;out skel qt;`;
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

async function fetchFrom(baseUrl: string, query: string, signal: AbortSignal): Promise<RawOsmData> {
  const timeoutController = new AbortController();
  const forwardAbort = () => timeoutController.abort();
  signal.addEventListener('abort', forwardAbort);
  const timeoutId = setTimeout(forwardAbort, CLIENT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(baseUrl, {
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

/** Seule implémentation concrète de GeoProvider pour cette étape : l'API Overpass publique, avec repli sur plusieurs miroirs. */
export class OverpassProvider implements GeoProvider {
  readonly id = 'overpass';

  constructor(private readonly baseUrls: string[] = OVERPASS_URLS) {}

  async getRoads(bounds: GeoBounds, signal: AbortSignal): Promise<RawOsmData> {
    const query = buildOverpassQuery(bounds);
    let lastError: unknown;
    for (const baseUrl of this.baseUrls) {
      if (signal.aborted) throw lastError ?? new GeoProviderError('network', 'Requête annulée.');
      try {
        return await fetchFrom(baseUrl, query, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        // Erreur réseau/quota/HTTP/réponse invalide sur ce miroir : on essaie le suivant plutôt
        // que d'abandonner — c'est exactement le cas « Service saturé » observé en session.
        lastError = error;
      }
    }
    throw lastError ?? new GeoProviderError('network', 'Aucun fournisseur de cartes disponible.');
  }
}
