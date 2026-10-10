/** Détecte une voiture immobilisée (mur, retournement) : vrai quand elle est restée sous la vitesse seuil assez longtemps. */
export class StuckDetector {
  private stoppedS = 0;

  constructor(private readonly speedThresholdMps = 1.5, private readonly afterS = 4) {}

  /** À appeler à chaque pas avec la vitesse et la durée du pas ; renvoie vrai UNE fois, puis repart de zéro. */
  update(speedMps: number, dtS: number): boolean {
    this.stoppedS = speedMps < this.speedThresholdMps ? this.stoppedS + dtS : 0;
    if (this.stoppedS <= this.afterS) return false;
    this.stoppedS = 0;
    return true;
  }

  reset(): void { this.stoppedS = 0; }
}
