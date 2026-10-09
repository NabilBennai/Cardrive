import { describe, expect, it } from 'vitest';
import { normalizeStick } from '../src/input/stickMath';

describe('normalizeStick', () => {
  it('maps the center (no drag) to zero steering and zero vertical axis', () => {
    const state = normalizeStick(0, 0, 48);
    expect(state.x).toBe(0);
    expect(state.y).toBe(0);
    expect(state.steering).toBeCloseTo(0);
    expect(state.verticalAxis).toBeCloseTo(0);
  });

  it('maps a pure rightward drag to positive steering and zero vertical axis', () => {
    const state = normalizeStick(24, 0, 48);
    expect(state.steering).toBeCloseTo(0.5);
    expect(state.verticalAxis).toBeCloseTo(0);
  });

  it('maps a pure upward drag (negative screen y) to positive vertical axis (throttle)', () => {
    const state = normalizeStick(0, -24, 48);
    expect(state.verticalAxis).toBeCloseTo(0.5);
    expect(state.steering).toBeCloseTo(0);
  });

  it('maps a pure downward drag to negative vertical axis (brake)', () => {
    const state = normalizeStick(0, 24, 48);
    expect(state.verticalAxis).toBeCloseTo(-0.5);
  });

  it('clamps a drag beyond the radius onto the circle edge', () => {
    const state = normalizeStick(200, 0, 48);
    expect(state.x).toBeCloseTo(48);
    expect(state.steering).toBeCloseTo(1);
  });

  it('clamps a diagonal drag beyond the radius to unit distance, not unit per axis', () => {
    const state = normalizeStick(200, 200, 48);
    expect(Math.hypot(state.x, state.y)).toBeCloseTo(48);
  });
});
