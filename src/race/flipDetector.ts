/**
 * Détecte une voiture retournée ou couchée : l'axe haut du châssis est resté sous le seuil, à faible vitesse, assez longtemps.
 * `uprightness` vaut 1 à plat, 0 sur le flanc, -1 sur le toit (voir bodyPose.uprightness).
 */
export class FlipDetector {
  private flippedS = 0;

  constructor(private readonly uprightThreshold = 0.35, private readonly slowSpeedMps = 4, private readonly afterS = 2) {}

  /** Renvoie vrai tant que la voiture est considérée comme retournée. */
  update(uprightness: number, speedMps: number, dtS: number): boolean {
    this.flippedS = uprightness < this.uprightThreshold && speedMps < this.slowSpeedMps ? this.flippedS + dtS : 0;
    return this.flippedS >= this.afterS;
  }

  reset(): void { this.flippedS = 0; }
}
