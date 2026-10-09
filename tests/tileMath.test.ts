import { describe, expect, it } from 'vitest';
import { geoToTilePixel, TILE_SIZE_PX } from '../src/map/tileMath';

describe('geoToTilePixel', () => {
  it('places the equator/prime-meridian point exactly on a tile boundary at zoom 1', () => {
    const { tile, pixelX, pixelY } = geoToTilePixel({ latitudeDeg: 0, longitudeDeg: 0 }, 1);
    expect(tile).toEqual({ z: 1, x: 1, y: 1 });
    expect(pixelX).toBeCloseTo(0, 6);
    expect(pixelY).toBeCloseTo(0, 6);
  });

  it('moves to a higher tile x (and stays in range) as longitude increases eastward', () => {
    const west = geoToTilePixel({ latitudeDeg: 45, longitudeDeg: 2 }, 15);
    const east = geoToTilePixel({ latitudeDeg: 45, longitudeDeg: 3 }, 15);
    const westGlobalX = west.tile.x * TILE_SIZE_PX + west.pixelX;
    const eastGlobalX = east.tile.x * TILE_SIZE_PX + east.pixelX;
    expect(eastGlobalX).toBeGreaterThan(westGlobalX);
  });

  it('moves to a lower tile y (toward the top of the map) as latitude increases northward', () => {
    const south = geoToTilePixel({ latitudeDeg: 45, longitudeDeg: 2 }, 15);
    const north = geoToTilePixel({ latitudeDeg: 46, longitudeDeg: 2 }, 15);
    const southGlobalY = south.tile.y * TILE_SIZE_PX + south.pixelY;
    const northGlobalY = north.tile.y * TILE_SIZE_PX + north.pixelY;
    expect(northGlobalY).toBeLessThan(southGlobalY);
  });

  it('keeps the sub-tile pixel offsets within [0, TILE_SIZE_PX)', () => {
    const { pixelX, pixelY } = geoToTilePixel({ latitudeDeg: 43.499018, longitudeDeg: -1.4554525 }, 17);
    expect(pixelX).toBeGreaterThanOrEqual(0);
    expect(pixelX).toBeLessThan(TILE_SIZE_PX);
    expect(pixelY).toBeGreaterThanOrEqual(0);
    expect(pixelY).toBeLessThan(TILE_SIZE_PX);
  });
});
