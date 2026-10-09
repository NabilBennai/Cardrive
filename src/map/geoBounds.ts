import type { GeoPoint } from '../shared/types.ts';
import type { GeoBounds } from './geoProvider.ts';

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
