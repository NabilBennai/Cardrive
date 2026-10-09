import type { LocalPoint } from '../shared/types.ts';
import { type GeoAnchor, projectToLocal, unprojectFromLocal } from './projection.ts';

/**
 * Doc §6 : « Prévoir une origine flottante dès les interfaces, l'activer avec le streaming »,
 * avec un « seuil initial d'environ 1 km ». Activée à l'étape 4 (streaming de chunks) : voir
 * src/world/streaming/useFloatingOrigin.ts, qui appelle ces fonctions depuis le pas physique
 * (via GenericCar.onAfterPhysicsStep / useVehiclePhysics.onAfterStep) et répercute le décalage
 * sur le châssis (translateVehicleBody), les groupes de chunks (offset recalculé, jamais la
 * géométrie) et la caméra (snap instantané, voir ChaseCamera.tsx / DrivingScene.tsx).
 */
export const RECENTER_THRESHOLD_M = 1_000;

export function shouldRecenter(localPosition: LocalPoint, thresholdM: number = RECENTER_THRESHOLD_M): boolean {
  const distanceM = Math.hypot(localPosition.xM, localPosition.zM);
  return distanceM > thresholdM;
}

export interface RecenterResult {
  nextAnchor: GeoAnchor;
  /** Décalage local à appliquer (soustraire) à tout ce qui partage le repère courant pour que la position devienne (0, y, 0). */
  offsetLocal: LocalPoint;
}

/**
 * Calcule la nouvelle ancre géographique correspondant à la position locale courante, et le
 * décalage local qui ramène cette position à l'origine. Le décalage ne modifie pas la vitesse et
 * ne doit pas apparaître comme un déplacement physique : l'appelant doit l'appliquer d'un seul
 * coup au châssis, aux chunks, aux colliders, à la caméra et aux historiques d'interpolation.
 */
export function computeRecenterOffset(currentAnchor: GeoAnchor, localPosition: LocalPoint): RecenterResult {
  const nextAnchor = unprojectFromLocal(localPosition, currentAnchor);
  const offsetLocal = projectToLocal(nextAnchor, currentAnchor);
  return { nextAnchor, offsetLocal };
}
