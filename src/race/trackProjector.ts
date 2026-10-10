import type { PlanarPoint } from '../circuits/circuitGeometry.ts';

export interface TrackProjection {
  /** Abscisse curviligne (m) le long de la ligne centrale, dans [0, longueur[ ; 0 = ligne de départ. */
  sM: number;
  /** Écart latéral signé (m) à la ligne centrale : positif à gauche du sens de marche (même convention que normalOf). */
  lateralM: number;
  /** Indice du segment le plus proche (repère de la recherche suivante). */
  index: number;
  /** Vrai si la recherche locale a échoué et qu'on a dû chercher sur tout le circuit (voiture très loin de la piste ou repositionnée). */
  global: boolean;
}

/** Demi-fenêtre de recherche locale, en échantillons (≈ 150 m à 3 m par échantillon). */
const WINDOW_SAMPLES = 50;
/** Au-delà de cette distance (m) à la ligne centrale, le résultat local n'est plus fiable : on cherche partout. */
const LOCAL_TRUST_M = 80;

/**
 * Projette une position sur la ligne centrale fermée d'un circuit. La recherche locale autour du dernier segment connu évite de
 * « sauter » sur une autre portion proche (croisement de Suzuka, épingles, lignes droites parallèles) ; la recherche globale ne sert
 * que lorsque la voiture est repositionnée ou très loin de la piste.
 */
export class TrackProjector {
  private readonly count: number;
  private readonly spacingM: number;

  constructor(private readonly centerline: PlanarPoint[], readonly lengthM: number) {
    this.count = centerline.length;
    this.spacingM = lengthM / this.count;
  }

  project(xM: number, zM: number, hintIndex: number | null): TrackProjection {
    if (hintIndex !== null) {
      const local = this.search(xM, zM, hintIndex - WINDOW_SAMPLES, hintIndex + WINDOW_SAMPLES);
      if (local.distanceM <= LOCAL_TRUST_M) return { ...local.projection, global: false };
    }
    return { ...this.search(xM, zM, 0, this.count - 1).projection, global: true };
  }

  private search(xM: number, zM: number, from: number, to: number): { projection: Omit<TrackProjection, 'global'>; distanceM: number } {
    const n = this.count;
    let bestDistance = Infinity;
    let bestIndex = 0;
    let bestT = 0;
    let bestLateral = 0;
    for (let k = from; k <= to; k += 1) {
      const i = ((k % n) + n) % n;
      const a = this.centerline[i];
      const b = this.centerline[(i + 1) % n];
      const abx = b.xM - a.xM;
      const abz = b.zM - a.zM;
      const lengthSq = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((xM - a.xM) * abx + (zM - a.zM) * abz) / lengthSq));
      const dx = xM - (a.xM + abx * t);
      const dz = zM - (a.zM + abz * t);
      const distance = Math.hypot(dx, dz);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
        bestT = t;
        // Normale gauche (-tz, tx) du segment.
        bestLateral = (dx * -abz + dz * abx) / Math.sqrt(lengthSq);
      }
    }
    return {
      projection: { sM: (bestIndex + bestT) * this.spacingM, lateralM: bestLateral, index: bestIndex },
      distanceM: bestDistance,
    };
  }
}
