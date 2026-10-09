import { CanvasTexture, RepeatWrapping, type Texture } from 'three';

const TWO_PI = Math.PI * 2;
const NOISE_TERMS = 4;
let noiseMaxAmplitude = 0;
for (let i = 1; i <= NOISE_TERMS; i += 1) noiseMaxAmplitude += 1 / i;

/**
 * Bruit périodique, tuilable sans couture par construction : somme de sin/cos dont les
 * fréquences sont des multiples entiers de 2π/periodPx. Par identité trigonométrique,
 * la valeur en x=0 et x=periodPx (et au-delà) est strictement identique — jamais de
 * Math.random() par texel, donc jamais de bord visible au raccord des tuiles.
 */
export function periodicNoise2D(xPx: number, yPx: number, periodPx: number, seed: number): number {
  let value = 0;
  for (let i = 1; i <= NOISE_TERMS; i += 1) {
    const phaseX = (seed * 12.9898 * i) % TWO_PI;
    const phaseY = (seed * 78.233 * i) % TWO_PI;
    value += (Math.sin((TWO_PI * i * xPx) / periodPx + phaseX) * Math.cos((TWO_PI * i * yPx) / periodPx + phaseY)) / i;
  }
  return (value + noiseMaxAmplitude) / (2 * noiseMaxAmplitude);
}

function createCanvas(size: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context indisponible.');
  return { canvas, context };
}

function paintSpeckle(context: CanvasRenderingContext2D, size: number, seed: number, grainCount: number, grainRadius: number, color: string, alpha: number) {
  context.fillStyle = color;
  context.globalAlpha = alpha;
  for (let i = 0; i < grainCount; i += 1) {
    // Position torique : dérivée du bruit périodique, donc les grains se raccordent aussi sans couture.
    const x = periodicNoise2D(i * 37, seed, grainCount, seed + i) * size;
    const y = periodicNoise2D(seed, i * 53, grainCount, seed - i) * size;
    context.beginPath();
    context.arc(x % size, y % size, grainRadius, 0, TWO_PI);
    context.fill();
  }
  context.globalAlpha = 1;
}

function finalizeTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

let asphaltTexture: CanvasTexture | null = null;
let groundTexture: CanvasTexture | null = null;
let facadeTexture: CanvasTexture | null = null;

/** Asphalte sombre avec grain léger et une bande claire au centre (marquage au sol peu coûteux). Singleton partagé. */
export function createAsphaltTexture(): Texture {
  if (asphaltTexture) return asphaltTexture;
  const size = 256;
  const { canvas, context } = createCanvas(size);
  context.fillStyle = '#2b2d2d';
  context.fillRect(0, 0, size, size);
  paintSpeckle(context, size, 11, 90, 1.4, '#383a3a', 0.4);
  paintSpeckle(context, size, 23, 60, 1.1, '#1d1f1f', 0.35);
  context.fillStyle = 'rgba(214, 214, 196, 0.22)';
  context.fillRect(0, size / 2 - 2, size, 4);
  asphaltTexture = finalizeTexture(canvas);
  return asphaltTexture;
}

/** Sol herbeux/terreux, nettement plus clair et plus chaud que l'asphalte pour rester lisible. Singleton partagé. */
export function createGroundTexture(): Texture {
  if (groundTexture) return groundTexture;
  const size = 256;
  const { canvas, context } = createCanvas(size);
  context.fillStyle = '#3a4a2e';
  context.fillRect(0, 0, size, size);
  paintSpeckle(context, size, 7, 140, 2.6, '#4a5e3a', 0.5);
  paintSpeckle(context, size, 19, 100, 2.1, '#2d3a22', 0.4);
  groundTexture = finalizeTexture(canvas);
  return groundTexture;
}

/** Façade gris/beige avec bandes horizontales suggérant des étages, pas de fenêtres détaillées. Singleton partagé. */
export function createFacadeTexture(): Texture {
  if (facadeTexture) return facadeTexture;
  const size = 256;
  const { canvas, context } = createCanvas(size);
  context.fillStyle = '#c7c2b2';
  context.fillRect(0, 0, size, size);
  const floorHeight = size / 8;
  context.fillStyle = 'rgba(90, 84, 70, 0.3)';
  for (let floor = 0; floor < 8; floor += 1) {
    context.fillRect(0, floor * floorHeight, size, 3);
  }
  paintSpeckle(context, size, 31, 70, 1.2, '#b5af9c', 0.3);
  facadeTexture = finalizeTexture(canvas);
  return facadeTexture;
}
