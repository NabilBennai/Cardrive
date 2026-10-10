import type { CircuitTrack } from '../circuits/circuitGeometry.ts';
import { centerlinePoseAt } from './trackPose.ts';

export interface GridSlot {
  xM: number;
  zM: number;
  headingRad: number;
  /** Abscisse curviligne (m) du slot, négative avant la ligne de départ (0 = ligne). */
  sM: number;
  /** Rang sur la grille : 0 = pole. */
  index: number;
}

/** Distance (m) entre deux rangées de la grille et décalage latéral (m) de chaque côté de l'axe. */
export const GRID_ROW_SPACING_M = 9;
export const GRID_LATERAL_OFFSET_M = 2.4;
/** Distance (m) entre la pole et la ligne de départ. */
export const GRID_POLE_SETBACK_M = 6;

/**
 * Grille de départ : deux files décalées derrière la ligne, comme en course (la file de droite est un demi-pas plus avancée).
 * Tous les emplacements sont sur la piste (le décalage latéral reste sous la demi-largeur) et orientés selon la tangente.
 */
export function buildGrid(track: CircuitTrack, count: number): GridSlot[] {
  const lateral = Math.min(GRID_LATERAL_OFFSET_M, Math.max(0, track.widthM / 2 - 2));
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / 2);
    const side = index % 2 === 0 ? 1 : -1;
    const distanceBehind = GRID_POLE_SETBACK_M + row * GRID_ROW_SPACING_M + (index % 2) * (GRID_ROW_SPACING_M / 2);
    const pose = centerlinePoseAt(track, track.lengthM - distanceBehind, side * lateral);
    return { ...pose, sM: -distanceBehind, index };
  });
}
