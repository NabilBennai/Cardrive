import type { GeoPoint } from '../shared/types.ts';

export interface GeocodeResult {
  label: string;
  point: GeoPoint;
}

/**
 * Recherche d'adresse par Nominatim (OpenStreetMap), doc §7 : « La recherche textuelle » /
 * « Le géocodage est un adaptateur distinct avec soumission explicite, cache et limites ; ne
 * pas faire d'autocomplétion sans fournisseur autorisant cet usage. » Nominatim autorise un
 * usage léger côté client pour ce type d'application (politique d'usage publique, pas de clé
 * requise), à condition de limiter le débit — d'où le debounce et la longueur minimale côté
 * UI (LocationPicker.tsx), pas une requête par frappe brute.
 */
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const RESULT_LIMIT = 5;
export const MIN_QUERY_LENGTH = 3;

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

export async function searchAddress(query: string, signal: AbortSignal): Promise<GeocodeResult[]> {
  if (query.trim().length < MIN_QUERY_LENGTH) return [];
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=${RESULT_LIMIT}&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Nominatim a répondu HTTP ${response.status}.`);
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) return [];
  return (body as NominatimResult[])
    .map((entry) => {
      const latitudeDeg = Number.parseFloat(entry.lat);
      const longitudeDeg = Number.parseFloat(entry.lon);
      if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) return null;
      return { label: entry.display_name, point: { latitudeDeg, longitudeDeg } };
    })
    .filter((result): result is GeocodeResult => result !== null);
}
