import type { GeoPoint } from '../shared/types.ts';

export interface RecentPlace {
  label: string;
  point: GeoPoint;
}

export const RECENT_PLACES_KEY = 'cardrive.recentPlaces';
export const MAX_RECENT_PLACES = 5;

const isRecentPlace = (value: unknown): value is RecentPlace => {
  const place = value as RecentPlace | null;
  return typeof place?.label === 'string'
    && Number.isFinite(place.point?.latitudeDeg)
    && Number.isFinite(place.point?.longitudeDeg);
};

/** Deux lieux à ~1 m près sont considérés identiques (même adresse resélectionnée). */
const samePlace = (a: RecentPlace, b: RecentPlace) =>
  a.point.latitudeDeg.toFixed(5) === b.point.latitudeDeg.toFixed(5) && a.point.longitudeDeg.toFixed(5) === b.point.longitudeDeg.toFixed(5);

/** Ajoute `place` en tête, retire son doublon éventuel, tronque à MAX_RECENT_PLACES. Pure, donc testable sans navigateur. */
export function withRecentPlace(existing: RecentPlace[], place: RecentPlace): RecentPlace[] {
  return [place, ...existing.filter((entry) => !samePlace(entry, place))].slice(0, MAX_RECENT_PLACES);
}

/** localStorage peut être absent, plein ou bloqué (navigation privée) : toute erreur se traduit par « pas de mémoire », jamais par un plantage. */
export function loadRecentPlaces(): RecentPlace[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_PLACES_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isRecentPlace).slice(0, MAX_RECENT_PLACES) : [];
  } catch {
    return [];
  }
}

export function saveRecentPlace(place: RecentPlace): RecentPlace[] {
  const next = withRecentPlace(loadRecentPlaces(), place);
  try {
    localStorage.setItem(RECENT_PLACES_KEY, JSON.stringify(next));
  } catch {
    // Mémoire indisponible : le lieu reste utilisable pour cette session, simplement non mémorisé.
  }
  return next;
}
