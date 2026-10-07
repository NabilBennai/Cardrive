import { describe, expect, it } from 'vitest';
import { calculateSuspensionForceN, interpolateTorqueNm, maximumLongitudinalForceN } from '../src/vehicle/physics/vehicleMath';

describe('vehicle force helpers', () => {
  it('produces spring force only while compressed and caps rebound damping', () => {
    expect(calculateSuspensionForceN(0.5, 0.5, 30_000, 3_000, 0, 12_000)).toBe(0);
    expect(calculateSuspensionForceN(0.4, 0.5, 30_000, 3_000, 0, 12_000)).toBeCloseTo(3_000);
    expect(calculateSuspensionForceN(0.6, 0.5, 30_000, 3_000, -1, 12_000)).toBe(0);
    expect(calculateSuspensionForceN(0, 0.5, 30_000, 3_000, 2, 12_000)).toBe(12_000);
  });

  it('limits longitudinal tire force to the grip left by lateral force', () => {
    expect(maximumLongitudinalForceN(0, 1_000)).toBe(1_000);
    expect(maximumLongitudinalForceN(600, 1_000)).toBe(800);
    expect(maximumLongitudinalForceN(1_200, 1_000)).toBe(0);
  });

  it('interpolates engine torque between documented curve points', () => {
    const curve = [{ rpm: 1_000, torqueNm: 180 }, { rpm: 3_000, torqueNm: 260 }];
    expect(interpolateTorqueNm(500, curve)).toBe(180);
    expect(interpolateTorqueNm(2_000, curve)).toBe(220);
    expect(interpolateTorqueNm(4_000, curve)).toBe(260);
  });
});
