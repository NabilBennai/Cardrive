import { describe, expect, it } from 'vitest';
import { periodicNoise2D } from '../src/world/textures/proceduralTextures';

describe('periodicNoise2D', () => {
  const period = 64;
  const seed = 11;

  it('is periodic along x: value at x equals value at x + period', () => {
    for (const x of [0, 5, 17.3, 40]) {
      expect(periodicNoise2D(x, 3, period, seed)).toBeCloseTo(periodicNoise2D(x + period, 3, period, seed), 9);
    }
  });

  it('is periodic along y: value at y equals value at y + period', () => {
    for (const y of [0, 9, 21.5, 55]) {
      expect(periodicNoise2D(4, y, period, seed)).toBeCloseTo(periodicNoise2D(4, y + period, period, seed), 9);
    }
  });

  it('stays within [0, 1]', () => {
    for (let i = 0; i < 50; i += 1) {
      const value = periodicNoise2D(i * 1.7, i * 2.3, period, seed);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
