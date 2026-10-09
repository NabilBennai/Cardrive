import type { GeoPoint } from '../shared/types.ts';
import type { GeoBounds } from './geoProvider.ts';

export interface PredefinedPlace {
  label: string;
  latitudeDeg: number;
  longitudeDeg: number;
}

/** Doc §7 : « Latitude/longitude manuelles et quelques lieux prédéfinis précèdent la recherche
 *  textuelle. » Un lieu simple (une rue) et un complexe (carrefour à nombreuses branches), pour
 *  valider les deux cas dès le premier test manuel. */
export const PREDEFINED_PLACES: PredefinedPlace[] = [
  { label: 'Mont-Saint-Michel (ruelle unique)', latitudeDeg: 48.6361, longitudeDeg: -1.5115 },
  { label: 'Arc de Triomphe, Paris (carrefour complexe)', latitudeDeg: 48.8738, longitudeDeg: 2.2950 },
];

const METERS_PER_DEGREE_LATITUDE = 111_320;
const DEFAULT_MARGIN_M = 400;

/** Construit un GeoBounds carré d'environ 2×marginM de côté autour d'un point. */
export function boundsAroundPoint(point: GeoPoint, marginM: number = DEFAULT_MARGIN_M): GeoBounds {
  const latRad = (point.latitudeDeg * Math.PI) / 180;
  const deltaLatDeg = marginM / METERS_PER_DEGREE_LATITUDE;
  const deltaLonDeg = marginM / (METERS_PER_DEGREE_LATITUDE * Math.cos(latRad));
  return {
    south: point.latitudeDeg - deltaLatDeg,
    north: point.latitudeDeg + deltaLatDeg,
    west: point.longitudeDeg - deltaLonDeg,
    east: point.longitudeDeg + deltaLonDeg,
  };
}
