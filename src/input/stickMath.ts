export interface StickState {
  /** Décalage visuel du bouton de manette, en pixels, borné au rayon. */
  x: number;
  y: number;
  /** -1..1, direction (x positif = droite). */
  steering: number;
  /** -1..1, positif = accélérateur (vers le haut), négatif = frein (vers le bas). */
  verticalAxis: number;
}

/** Centre dx/dy (coordonnées écran, y positif vers le bas) sur un cercle de rayon `radiusPx`, et dérive direction/accélération. */
export function normalizeStick(dx: number, dy: number, radiusPx: number): StickState {
  const distance = Math.hypot(dx, dy);
  const scale = distance > radiusPx ? radiusPx / distance : 1;
  const x = dx * scale;
  const y = dy * scale;
  return { x, y, steering: radiusPx === 0 ? 0 : x / radiusPx, verticalAxis: radiusPx === 0 ? 0 : -y / radiusPx };
}
