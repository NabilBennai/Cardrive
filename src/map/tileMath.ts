import type { GeoPoint } from '../shared/types.ts';

export const TILE_SIZE_PX = 256;

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export interface TilePosition {
  tile: TileCoord;
  /** Position en pixels (0..256) du point à l'intérieur de `tile`. */
  pixelX: number;
  pixelY: number;
}

/** Formule standard des tuiles "slippy map" (projection Web Mercator) utilisée par OSM/la plupart des fournisseurs de tuiles. */
export function geoToTilePixel(point: GeoPoint, zoom: number): TilePosition {
  const n = 2 ** zoom;
  const latRad = (point.latitudeDeg * Math.PI) / 180;
  const xTile = ((point.longitudeDeg + 180) / 360) * n;
  const yTile = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tileX = Math.floor(xTile);
  const tileY = Math.floor(yTile);
  return {
    tile: { z: zoom, x: tileX, y: tileY },
    pixelX: (xTile - tileX) * TILE_SIZE_PX,
    pixelY: (yTile - tileY) * TILE_SIZE_PX,
  };
}
