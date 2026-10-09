import type { GeoPoint, LocalPoint } from '../shared/types.ts';

export const EARTH_RADIUS_M = 6_378_137;

/** Ancre géographique immuable d'une zone chargée (doc §6 : « point d'ancrage géographique immuable »). */
export interface GeoAnchor {
  latitudeDeg: number;
  longitudeDeg: number;
}

const degToRad = (deg: number) => (deg * Math.PI) / 180;
const radToDeg = (rad: number) => (rad * 180) / Math.PI;

/** Ramène un écart de longitude dans [-180, 180] pour ne pas franchir l'antiméridien en ligne droite. */
export function normalizeLongitudeDeltaDeg(deltaDeg: number): number {
  let normalized = deltaDeg % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  return normalized;
}

/**
 * Approximation locale documentée (doc §6) : x = R × cos(latitudeOrigine) × deltaLongitude ;
 * z = -R × deltaLatitude ; angles en radians. Convention de scène X = est, Y = altitude, Z = sud
 * (le nord correspond donc à -Z). Valable uniquement pour de petites zones autour de l'ancre.
 */
export function projectToLocal(point: GeoPoint, anchor: GeoAnchor): LocalPoint {
  const deltaLatDeg = point.latitudeDeg - anchor.latitudeDeg;
  const deltaLonDeg = normalizeLongitudeDeltaDeg(point.longitudeDeg - anchor.longitudeDeg);
  const xM = EARTH_RADIUS_M * Math.cos(degToRad(anchor.latitudeDeg)) * degToRad(deltaLonDeg);
  const zM = -EARTH_RADIUS_M * degToRad(deltaLatDeg);
  return { xM, yM: 0, zM };
}

/** Inverse de projectToLocal, pour les tests et pour retrouver un point géographique à partir d'une position locale. */
export function unprojectFromLocal(point: LocalPoint, anchor: GeoAnchor): GeoPoint {
  const deltaLatDeg = radToDeg(-point.zM / EARTH_RADIUS_M);
  const deltaLonDeg = radToDeg(point.xM / (EARTH_RADIUS_M * Math.cos(degToRad(anchor.latitudeDeg))));
  return {
    latitudeDeg: anchor.latitudeDeg + deltaLatDeg,
    longitudeDeg: anchor.longitudeDeg + deltaLonDeg,
  };
}
