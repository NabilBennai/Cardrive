import type { SurfaceMaterial } from '../../shared/types.ts';

export interface SurfaceProperties {
  /** Multiplicateur de l'adhérence maximale du pneu (1 = asphalte sec). */
  gripFactor: number;
  /** Multiplicateur de la résistance au roulement (1 = asphalte). */
  rollingFactor: number;
  /** Vrai pour une surface meuble qui soulève de la poussière (effets visuels et sonores). */
  loose: boolean;
}

/**
 * Propriétés des surfaces. Valeurs d'ordre de grandeur réalistes pour des pneus de route : l'herbe sèche et le gravier offrent
 * environ la moitié de l'adhérence de l'asphalte et freinent beaucoup plus la voiture au roulage (le pneu s'enfonce).
 */
export const SURFACES: Readonly<Record<SurfaceMaterial, SurfaceProperties>> = {
  asphalt: { gripFactor: 1, rollingFactor: 1, loose: false },
  concrete: { gripFactor: 0.95, rollingFactor: 1, loose: false },
  gravel: { gripFactor: 0.55, rollingFactor: 5, loose: true },
  grass: { gripFactor: 0.5, rollingFactor: 3.5, loose: true },
};

/** Donne la surface sous un point (repère de rendu courant). Absente : asphalte partout. */
export type SurfaceProvider = (xM: number, zM: number, wheelIndex: number) => SurfaceMaterial;
