import type { CircuitTrack } from '../circuits/circuitGeometry.ts';
import type { SurfaceMaterial } from '../shared/types.ts';
import type { SurfaceProvider } from '../vehicle/physics/surfaces.ts';
import { TrackProjector } from './trackProjector.ts';

/** Écart (m) au-delà du bord de la piste couvert par les vibreurs : encore de l'asphalte pour le pneu. */
export const KERB_WIDTH_M = 1.5;
/** Largeur (m) de la bande de gravier (échappatoire) après les vibreurs ; au-delà, de l'herbe. */
export const GRAVEL_WIDTH_M = 7;

/** Surface selon l'écart latéral (m) à la ligne centrale : piste et vibreurs, gravier, puis herbe. */
export function circuitSurfaceAtOffset(lateralM: number, widthM: number): SurfaceMaterial {
  const beyondEdge = Math.abs(lateralM) - widthM / 2;
  if (beyondEdge <= KERB_WIDTH_M) return 'asphalt';
  if (beyondEdge <= KERB_WIDTH_M + GRAVEL_WIDTH_M) return 'gravel';
  return 'grass';
}

/**
 * Fournisseur de surface d'un circuit : la distance à la ligne centrale suffit (le sol est plat et unique). Chaque voiture en
 * crée un à elle, car la recherche locale mémorise un repère par roue.
 */
export function createCircuitSurface(track: CircuitTrack): SurfaceProvider {
  const projector = new TrackProjector(track.centerline, track.lengthM);
  const hints: Array<number | null> = [];
  return (xM, zM, wheelIndex) => {
    const projection = projector.project(xM, zM, hints[wheelIndex] ?? null);
    hints[wheelIndex] = projection.index;
    return circuitSurfaceAtOffset(projection.lateralM, track.widthM);
  };
}
