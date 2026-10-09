import { describe, expect, it } from 'vitest';
import { normalizeLongitudeDeltaDeg, projectToLocal, unprojectFromLocal } from '../src/geo/projection';

describe('geo projection', () => {
  const anchor = { latitudeDeg: 48.8738, longitudeDeg: 2.2950 };

  it('projects east/north correctly: x grows east, z grows south (negative north)', () => {
    const east = projectToLocal({ latitudeDeg: anchor.latitudeDeg, longitudeDeg: anchor.longitudeDeg + 0.01 }, anchor);
    expect(east.xM).toBeGreaterThan(0);
    expect(east.zM).toBeCloseTo(0, 5);

    const north = projectToLocal({ latitudeDeg: anchor.latitudeDeg + 0.01, longitudeDeg: anchor.longitudeDeg }, anchor);
    expect(north.zM).toBeLessThan(0);
    expect(north.xM).toBeCloseTo(0, 5);
  });

  it('round-trips project -> unproject back to the original point', () => {
    const point = { latitudeDeg: anchor.latitudeDeg + 0.004, longitudeDeg: anchor.longitudeDeg - 0.006 };
    const local = projectToLocal(point, anchor);
    const back = unprojectFromLocal(local, anchor);
    expect(back.latitudeDeg).toBeCloseTo(point.latitudeDeg, 9);
    expect(back.longitudeDeg).toBeCloseTo(point.longitudeDeg, 9);
  });

  it('normalizes a longitude delta that crosses the antimeridian to a small value', () => {
    expect(normalizeLongitudeDeltaDeg(359)).toBeCloseTo(-1, 9);
    expect(normalizeLongitudeDeltaDeg(-359)).toBeCloseTo(1, 9);
    expect(normalizeLongitudeDeltaDeg(10)).toBeCloseTo(10, 9);
  });

  it('keeps a near-antimeridian projection small instead of wrapping around the globe', () => {
    const antimeridianAnchor = { latitudeDeg: 0, longitudeDeg: 179.999 };
    const point = { latitudeDeg: 0, longitudeDeg: -179.999 };
    const local = projectToLocal(point, antimeridianAnchor);
    expect(Math.abs(local.xM)).toBeLessThan(1_000);
  });
});
