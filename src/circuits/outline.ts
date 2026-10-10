/**
 * Tracé SVG d'un circuit (vignette) : projection équirectangulaire locale, mise à l'échelle pour
 * tenir dans un carré `sizePx` avec une marge, en conservant les proportions. Nord en haut.
 */
export function circuitOutlinePath(coordinates: Array<[number, number]>, sizePx: number, paddingPx = 6): string {
  const meanLat = coordinates.reduce((sum, [, lat]) => sum + lat, 0) / coordinates.length;
  const lonScale = Math.cos((meanLat * Math.PI) / 180);
  const xs = coordinates.map(([lon]) => lon * lonScale);
  const ys = coordinates.map(([, lat]) => -lat);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = (sizePx - 2 * paddingPx) / span;
  const offsetX = (sizePx - (maxX - minX) * scale) / 2;
  const offsetY = (sizePx - (maxY - minY) * scale) / 2;
  const commands = coordinates.map((_, i) => `${i === 0 ? 'M' : 'L'}${(offsetX + (xs[i] - minX) * scale).toFixed(1)} ${(offsetY + (ys[i] - minY) * scale).toFixed(1)}`);
  return `${commands.join('')}Z`;
}
