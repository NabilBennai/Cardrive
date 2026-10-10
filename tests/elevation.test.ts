import { describe, expect, it } from 'vitest';
import {
  decodeTerrarium, ElevationField, ElevationTile, pixelSizeM, profileStats, smoothClosedProfile, tileKey, tilesCovering, tileUrl,
} from '../src/geo/elevation';
import { geoToTilePixel, TILE_SIZE_PX } from '../src/map/tileMath';

/** Image Terrarium synthétique : l'altitude de chaque pixel est donnée par `height(x, y)` dans la tuile. */
function makeTile(tile: { z: number; x: number; y: number }, height: (x: number, y: number) => number): ElevationTile {
  const rgba = new Uint8Array(TILE_SIZE_PX * TILE_SIZE_PX * 4);
  for (let y = 0; y < TILE_SIZE_PX; y += 1) {
    for (let x = 0; x < TILE_SIZE_PX; x += 1) {
      const encoded = Math.round((height(x, y) + 32768) * 256);
      const i = (y * TILE_SIZE_PX + x) * 4;
      rgba[i] = Math.floor(encoded / 65536) & 255;
      rgba[i + 1] = Math.floor(encoded / 256) & 255;
      rgba[i + 2] = encoded & 255;
      rgba[i + 3] = 255;
    }
  }
  return new ElevationTile(tile, rgba);
}

describe('décodage Terrarium', () => {
  it('suit la formule R·256 + V + B/256 − 32768', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(129, 44, 128)).toBeCloseTo(256 + 44 + 0.5, 6);
    expect(decodeTerrarium(127, 255, 0)).toBe(-1);
  });

  it('retrouve une altitude encodée, au 1/256 m près', () => {
    const tile = makeTile({ z: 13, x: 0, y: 0 }, () => 423.37);
    expect(tile.at(10, 10)).toBeCloseTo(423.37, 2);
    expect(makeTile({ z: 13, x: 0, y: 0 }, () => -12.5).at(0, 0)).toBeCloseTo(-12.5, 2);
  });

  it('refuse une image incomplète', () => {
    expect(() => new ElevationTile({ z: 1, x: 0, y: 0 }, new Uint8Array(100))).toThrow();
  });
});

describe('tuiles et adresses', () => {
  it('construit l\'adresse et la clé d\'une tuile', () => {
    expect(tileUrl({ z: 13, x: 4, y: 7 })).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/4/7.png');
    expect(tileKey({ z: 13, x: 4, y: 7 })).toBe('13/4/7');
  });

  it('liste les tuiles qui couvrent un rectangle', () => {
    // Rectangle de 4 km sur 4 km à Spa : quelques tuiles au zoom 13.
    const tiles = tilesCovering(50.42, 5.95, 50.46, 6.0, 13);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.length).toBeLessThanOrEqual(9);
    expect(new Set(tiles.map(tileKey)).size).toBe(tiles.length);
    const centre = geoToTilePixel({ latitudeDeg: 50.44, longitudeDeg: 5.975 }, 13).tile;
    expect(tiles.some((t) => t.x === centre.x && t.y === centre.y)).toBe(true);
  });

  it('un pixel mesure environ 12 m au zoom 13 à 50° de latitude, la moitié au zoom 14', () => {
    expect(pixelSizeM(13, 50.4)).toBeGreaterThan(11);
    expect(pixelSizeM(13, 50.4)).toBeLessThan(13);
    expect(pixelSizeM(14, 50.4)).toBeCloseTo(pixelSizeM(13, 50.4) / 2, 6);
  });
});

describe('champ d\'altitudes', () => {
  it('échantillonne par interpolation bilinéaire, y compris à la frontière de deux tuiles', () => {
    const zoom = 13;
    const origin = geoToTilePixel({ latitudeDeg: 50.44, longitudeDeg: 5.975 }, zoom).tile;
    const field = new ElevationField(zoom);
    // Rampe est-ouest continue sur deux tuiles voisines : 0,5 m par pixel.
    field.add(makeTile({ z: zoom, x: origin.x, y: origin.y }, (x) => 100 + 0.5 * x));
    field.add(makeTile({ z: zoom, x: origin.x + 1, y: origin.y }, (x) => 100 + 0.5 * (x + TILE_SIZE_PX)));
    field.add(makeTile({ z: zoom, x: origin.x, y: origin.y + 1 }, (x) => 100 + 0.5 * x));
    field.add(makeTile({ z: zoom, x: origin.x + 1, y: origin.y + 1 }, (x) => 100 + 0.5 * (x + TILE_SIZE_PX)));
    expect(field.tileCount).toBe(4);
    expect(field.memoryBytes).toBe(4 * 256 * 1024);
    const position = geoToTilePixel({ latitudeDeg: 50.44, longitudeDeg: 5.975 }, zoom);
    const expected = 100 + 0.5 * (position.pixelX - 0.5);
    expect(field.sample({ latitudeDeg: 50.44, longitudeDeg: 5.975 })).toBeCloseTo(expected, 1);
    // À cheval sur la frontière entre les deux tuiles : pas de saut.
    const boundaryLon = ((origin.x + 1) / 2 ** zoom) * 360 - 180;
    const left = field.sample({ latitudeDeg: 50.44, longitudeDeg: boundaryLon - 1e-5 })!;
    const right = field.sample({ latitudeDeg: 50.44, longitudeDeg: boundaryLon + 1e-5 })!;
    expect(Math.abs(right - left)).toBeLessThan(0.2);
    expect(right).toBeGreaterThan(left);
  });

  it('renvoie null hors des tuiles chargées et refuse un zoom différent', () => {
    const field = new ElevationField(13);
    expect(field.sample({ latitudeDeg: 50.44, longitudeDeg: 5.975 })).toBeNull();
    expect(() => field.add(makeTile({ z: 12, x: 0, y: 0 }, () => 0))).toThrow();
  });
});

describe('profil le long d\'une boucle', () => {
  it('le lissage garde la moyenne, atténue le bruit et traite la boucle de façon cyclique', () => {
    const base = Array.from({ length: 200 }, (_, i) => 400 + 30 * Math.sin((i / 200) * 2 * Math.PI));
    const noisy = base.map((v, i) => v + (i % 2 === 0 ? 3 : -3));
    const smooth = smoothClosedProfile(noisy, 5, 40);
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean(smooth)).toBeCloseTo(mean(noisy), 6);
    const error = (values: number[]) => Math.sqrt(values.reduce((sum, v, i) => sum + (v - base[i]) ** 2, 0) / values.length);
    expect(error(smooth)).toBeLessThan(error(noisy) / 2);
    // Cyclique : le début et la fin se raccordent (pas d'effet de bord).
    expect(Math.abs(smooth[0] - smooth[199])).toBeLessThan(2);
    expect(smoothClosedProfile([5, 6, 7], 5, 0)).toEqual([5, 6, 7]);
  });

  it('calcule montée, pente maximale et fermeture', () => {
    const profile = [100, 110, 120, 110, 100]; // boucle : montée 20 m, descente 20 m, retour de 100 à 100
    const stats = profileStats(profile, 10);
    expect(stats.minM).toBe(100);
    expect(stats.maxM).toBe(120);
    expect(stats.ascentM).toBe(20);
    expect(stats.maxGrade).toBeCloseTo(1, 6);
    expect(stats.closureErrorM).toBe(0);
  });
});
