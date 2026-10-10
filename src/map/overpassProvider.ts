import { parseWaterResponse } from './waterParse.ts';
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
 * Deux requêtes SÉPARÉES plutôt qu'une seule groupée (routes + bâtiments) : constaté en
 * session que la requête combinée est trop lourde pour les miroirs publics légers — une
 * instance répond 500, une autre renvoie un JSON valide mais vide (aucune erreur détectable),
 * l'officielle expire en 504, alors que la MÊME zone interrogée pour les routes seules
 * fonctionne normalement sur plusieurs miroirs. Séparer rend chaque requête plus légère et
 * isole l'échec : un échec sur les bâtiments (optionnels, voir OverpassProvider.getBuildings)
 * ne doit jamais empêcher de charger les routes (doc §7, critère central de l'étape 3).
 */
export function buildHighwayQuery(bounds: GeoBounds): string {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const highwayPattern = `^(${DRIVABLE_HIGHWAY_VALUES.join('|')})$`;
  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];(way["highway"~"${highwayPattern}"](${bbox}););out body;>;out skel qt;`;
}

export function buildBuildingQuery(bounds: GeoBounds): string {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];(way["building"](${bbox}););out body;>;out skel qt;`;
}

/** Eau : surfaces (natural=water, rives) + cours d'eau linéaires, avec géométrie inline (`out geom`) car les relations multipolygones (grands fleuves, bassins) n'ont pas de nœuds propres exploitables via `out skel`. */
export function buildWaterQuery(bounds: GeoBounds): string {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];(way["natural"="water"](${bbox});relation["natural"="water"](${bbox});way["waterway"="riverbank"](${bbox});way["waterway"~"^(river|canal|stream)$"](${bbox}););out geom;`;
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

async function fetchFrom(baseUrl: string, query: string, signal: AbortSignal, parse: (body: unknown) => RawOsmData = parseOverpassResponse): Promise<RawOsmData> {
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
  return parse(body);
}

/** Seule implémentation concrète de GeoProvider pour cette étape : l'API Overpass publique, avec repli sur plusieurs miroirs. */
export class OverpassProvider implements GeoProvider {
  readonly id = 'overpass';

  constructor(private readonly baseUrls: string[] = OVERPASS_URLS) {}

  /**
   * Essaie chaque miroir dans l'ordre. `isAcceptable` permet de ne PAS se satisfaire d'une
   * réponse vide « suspecte » (cas observé : un miroir renvoie 0 élément sans erreur alors que
   * la zone en contient réellement) et d'essayer le miroir suivant ; si tous les miroirs
   * répondent mais sont tous vides, on accepte la dernière réponse vide (zone réellement vide,
   * pas un échec réseau).
   */
  private async fetchWithFallback(query: string, signal: AbortSignal, isAcceptable: (result: RawOsmData) => boolean, parse?: (body: unknown) => RawOsmData): Promise<RawOsmData> {
    let lastError: unknown;
    let lastEmptyResult: RawOsmData | null = null;
    for (const baseUrl of this.baseUrls) {
      if (signal.aborted) throw lastError ?? new GeoProviderError('network', 'Requête annulée.');
      try {
        const result = await fetchFrom(baseUrl, query, signal, parse);
        if (isAcceptable(result)) return result;
        lastEmptyResult = result;
      } catch (error) {
        if (signal.aborted) throw error;
        lastError = error;
      }
    }
    if (lastEmptyResult) return lastEmptyResult;
    throw lastError ?? new GeoProviderError('network', 'Aucun fournisseur de cartes disponible.');
  }

  async getRoads(bounds: GeoBounds, signal: AbortSignal): Promise<RawOsmData> {
    return this.fetchWithFallback(buildHighwayQuery(bounds), signal, (result) => result.ways.length > 0);
  }

  /** Best-effort : zéro bâtiment est un résultat valide (pas de nouvelle tentative sur une réponse vide). */
  async getBuildings(bounds: GeoBounds, signal: AbortSignal): Promise<RawOsmData> {
    return this.fetchWithFallback(buildBuildingQuery(bounds), signal, () => true);
  }

  /** Best-effort : l'eau n'est jamais un prérequis pour rouler. Contrairement aux bâtiments, une réponse vide est recoupée auprès des autres miroirs : l'eau est rare, et certains miroirs (osm.ch) à couverture partielle répondent vide sans erreur, ce qui masquerait un fleuve bien réel. */
  async getWater(bounds: GeoBounds, signal: AbortSignal): Promise<RawOsmData> {
    return this.fetchWithFallback(buildWaterQuery(bounds), signal, (result) => result.ways.length > 0, parseWaterResponse);
  }
}
