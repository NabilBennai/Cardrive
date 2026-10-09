import { describe, expect, it } from 'vitest';
import { formatCacheKey, GENERATOR_VERSION } from '../src/map/geoCache';

// Vitest tourne en environnement Node par défaut ; IndexedDB réel n'est pas garanti disponible.
// Seule la fonction pure de formatage de clé est testée ici ; le comportement IndexedDB réel
// est vérifié manuellement dans le navigateur (voir le plan, section vérification manuelle).
describe('formatCacheKey', () => {
  const bounds = { south: 48.87, west: 2.29, north: 48.88, east: 2.30 };

  it('includes the provider id and generator version', () => {
    const key = formatCacheKey('overpass', bounds, GENERATOR_VERSION);
    expect(key.startsWith(`overpass:${GENERATOR_VERSION}:`)).toBe(true);
  });

  it('quantizes the bounds so near-identical boxes share a key', () => {
    const almostSame = { ...bounds, south: bounds.south + 0.000001 };
    expect(formatCacheKey('overpass', bounds)).toBe(formatCacheKey('overpass', almostSame));
  });

  it('produces different keys for meaningfully different bounds', () => {
    const different = { ...bounds, south: bounds.south + 0.01 };
    expect(formatCacheKey('overpass', bounds)).not.toBe(formatCacheKey('overpass', different));
  });
});
