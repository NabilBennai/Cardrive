import type { GeoPoint } from '../shared/types.ts';
import { geoToTilePixel, TILE_SIZE_PX, type TileCoord } from '../map/tileMath.ts';

/**
 * Altitudes : tuiles « Terrarium » des Terrain Tiles d'AWS (PNG RVB, mètres = R·256 + V + B/256 − 32768, projection Web Mercator,
 * 256 × 256 pixels par tuile). Ce module est pur : il décode et échantillonne des tuiles déjà téléchargées ; le téléchargement
 * (fetch, cache) est fourni par l'appelant.
 */

/** Gabarit de l'adresse des tuiles, CORS ouvert (vérifié) ; zoom maximal publié : 14. */
export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TERRARIUM_MAX_ZOOM = 14;
/** Mention à afficher quand les altitudes servent (le jeu de données agrège des sources publiques américaines et européennes). */
export const ELEVATION_ATTRIBUTION = 'Altitudes : AWS Terrain Tiles (SRTM, 3DEP, EU-DEM, GMTED — USGS, Copernicus)';

export const tileUrl = (tile: TileCoord): string => TERRARIUM_URL.replace('{z}', String(tile.z)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y));
export const tileKey = (tile: TileCoord): string => `${tile.z}/${tile.x}/${tile.y}`;

/** Altitude (m) d'un pixel Terrarium. */
export const decodeTerrarium = (r: number, g: number, b: number): number => r * 256 + g + b / 256 - 32768;

/** Tuile d'altitudes décodée : 256 × 256 valeurs flottantes (256 Ko). */
export class ElevationTile {
  readonly tile: TileCoord;
  readonly values: Float32Array;

  /** `rgba` : pixels de l'image de la tuile (4 octets par pixel, 256 × 256). */
  constructor(tile: TileCoord, rgba: Uint8Array | Uint8ClampedArray) {
    this.tile = tile;
    if (rgba.length < TILE_SIZE_PX * TILE_SIZE_PX * 4) throw new Error('Tuile d\'altitude incomplète.');
    this.values = new Float32Array(TILE_SIZE_PX * TILE_SIZE_PX);
    for (let i = 0; i < this.values.length; i += 1) this.values[i] = decodeTerrarium(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  }

  /** Valeur du pixel (x, y), bornée aux bords de la tuile. */
  at(x: number, y: number): number {
    const cx = Math.max(0, Math.min(TILE_SIZE_PX - 1, x));
    const cy = Math.max(0, Math.min(TILE_SIZE_PX - 1, y));
    return this.values[cy * TILE_SIZE_PX + cx];
  }
}

/** Tuiles nécessaires pour couvrir un rectangle géographique (marge d'un pixel comprise). */
export function tilesCovering(south: number, west: number, north: number, east: number, zoom: number): TileCoord[] {
  const a = geoToTilePixel({ latitudeDeg: north, longitudeDeg: west }, zoom).tile;
  const b = geoToTilePixel({ latitudeDeg: south, longitudeDeg: east }, zoom).tile;
  const tiles: TileCoord[] = [];
  for (let y = a.y; y <= b.y; y += 1) for (let x = a.x; x <= b.x; x += 1) tiles.push({ z: zoom, x, y });
  return tiles;
}

/**
 * Altitudes d'une zone : ensemble de tuiles du même zoom, échantillonnées par interpolation bilinéaire (y compris à cheval sur deux
 * tuiles). Un point hors des tuiles chargées renvoie null.
 */
export class ElevationField {
  readonly zoom: number;
  private readonly tiles = new Map<string, ElevationTile>();

  constructor(zoom: number) {
    this.zoom = zoom;
  }

  add(tile: ElevationTile): void {
    if (tile.tile.z !== this.zoom) throw new Error(`Zoom ${tile.tile.z} différent de celui du champ (${this.zoom}).`);
    this.tiles.set(tileKey(tile.tile), tile);
  }

  get tileCount(): number { return this.tiles.size; }

  /** Octets de mémoire occupés par les valeurs décodées. */
  get memoryBytes(): number { return this.tiles.size * TILE_SIZE_PX * TILE_SIZE_PX * 4; }

  /** Pixel global (coordonnées de pixel de la mosaïque entière) → valeur, ou null si sa tuile n'est pas chargée. */
  private pixel(globalX: number, globalY: number): number | null {
    const tileX = Math.floor(globalX / TILE_SIZE_PX);
    const tileY = Math.floor(globalY / TILE_SIZE_PX);
    const tile = this.tiles.get(`${this.zoom}/${tileX}/${tileY}`);
    return tile ? tile.at(globalX - tileX * TILE_SIZE_PX, globalY - tileY * TILE_SIZE_PX) : null;
  }

  sample(point: GeoPoint): number | null {
    const position = geoToTilePixel(point, this.zoom);
    // Les pixels sont des échantillons ponctuels centrés sur leur case : on interpole entre centres.
    const gx = position.tile.x * TILE_SIZE_PX + position.pixelX - 0.5;
    const gy = position.tile.y * TILE_SIZE_PX + position.pixelY - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const v00 = this.pixel(x0, y0);
    const v10 = this.pixel(x0 + 1, y0);
    const v01 = this.pixel(x0, y0 + 1);
    const v11 = this.pixel(x0 + 1, y0 + 1);
    if (v00 === null || v10 === null || v01 === null || v11 === null) return null;
    return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
  }
}

/** Taille d'un pixel (m) au zoom et à la latitude donnés (Web Mercator). */
export const pixelSizeM = (zoom: number, latitudeDeg: number): number =>
  (40_075_016.686 * Math.cos((latitudeDeg * Math.PI) / 180)) / (TILE_SIZE_PX * 2 ** zoom);

/**
 * Lissage d'un profil d'altitude le long d'une ligne fermée (moyenne glissante de `windowM` de large, cyclique). Les altitudes issues
 * de modèles numériques de terrain sont bruitées (arbres, bâtiments, résolution de 10 à 30 m) : sans lissage, la pente d'une route
 * serait fausse.
 */
export function smoothClosedProfile(values: readonly number[], spacingM: number, windowM: number): number[] {
  const n = values.length;
  const half = Math.max(0, Math.round(windowM / spacingM / 2));
  if (half === 0 || n === 0) return values.slice();
  const out: number[] = [];
  let sum = 0;
  for (let k = -half; k <= half; k += 1) sum += values[((k % n) + n) % n];
  for (let i = 0; i < n; i += 1) {
    out.push(sum / (2 * half + 1));
    sum += values[(i + half + 1) % n] - values[(((i - half) % n) + n) % n];
  }
  return out;
}

export interface ProfileStats {
  minM: number;
  maxM: number;
  /** Somme des montées (m). */
  ascentM: number;
  /** Pente maximale en valeur absolue (rapport, 0,1 = 10 %). */
  maxGrade: number;
  /** Écart entre la fin et le début du profil (m) : devrait valoir 0 pour une boucle fermée. */
  closureErrorM: number;
}

/** Statistiques d'un profil échantillonné tous les `spacingM` mètres le long d'une boucle. */
export function profileStats(values: readonly number[], spacingM: number): ProfileStats {
  let ascentM = 0;
  let maxGrade = 0;
  for (let i = 0; i < values.length; i += 1) {
    const delta = values[(i + 1) % values.length] - values[i];
    if (delta > 0) ascentM += delta;
    maxGrade = Math.max(maxGrade, Math.abs(delta) / spacingM);
  }
  return {
    minM: Math.min(...values),
    maxM: Math.max(...values),
    ascentM,
    maxGrade,
    closureErrorM: values.length > 1 ? values[values.length - 1] - values[0] : 0,
  };
}
