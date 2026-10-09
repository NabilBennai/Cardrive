import { describe, expect, it } from 'vitest';
import { computeRecenterOffset, RECENTER_THRESHOLD_M, shouldRecenter } from '../src/geo/floatingOrigin';

describe('floating origin (written and tested, not yet wired into any loop)', () => {
  it('does not require recentering under the threshold', () => {
    expect(shouldRecenter({ xM: 500, yM: 0, zM: 500 })).toBe(false);
  });

  it('requires recentering once the threshold is exceeded', () => {
    expect(shouldRecenter({ xM: RECENTER_THRESHOLD_M + 1, yM: 0, zM: 0 })).toBe(true);
  });

  it('computes a next anchor whose local projection matches the current position exactly', () => {
    const currentAnchor = { latitudeDeg: 48.8738, longitudeDeg: 2.2950 };
    const localPosition = { xM: 1_200, yM: 0, zM: -800 };
    const { nextAnchor, offsetLocal } = computeRecenterOffset(currentAnchor, localPosition);
    expect(offsetLocal.xM).toBeCloseTo(localPosition.xM, 6);
    expect(offsetLocal.zM).toBeCloseTo(localPosition.zM, 6);
    expect(nextAnchor.latitudeDeg).not.toBe(currentAnchor.latitudeDeg);
  });
});
