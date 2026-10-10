import { describe, expect, it } from 'vitest';
import { budgetViolations, PERF_BUDGET, RollingWindow, type PerfSnapshot } from '../src/debug/perfStats';

describe('RollingWindow', () => {
  it('computes average, max and percentiles over the samples pushed', () => {
    const window = new RollingWindow(100);
    for (let i = 1; i <= 100; i += 1) window.push(i);
    expect(window.average()).toBe(50.5);
    expect(window.max()).toBe(100);
    expect(window.percentile(95)).toBe(95);
    expect(window.percentile(50)).toBe(50);
    expect(window.size).toBe(100);
  });

  it('keeps only the most recent samples once full', () => {
    const window = new RollingWindow(4);
    for (const value of [1, 1, 1, 1, 9, 9, 9, 9]) window.push(value);
    expect(window.average()).toBe(9);
    expect(window.size).toBe(4);
  });

  it('is safe when empty', () => {
    const window = new RollingWindow(8);
    expect([window.average(), window.max(), window.percentile(95)]).toEqual([0, 0, 0]);
    window.push(3);
    window.clear();
    expect(window.size).toBe(0);
  });
});

describe('budgetViolations', () => {
  const healthy: PerfSnapshot = {
    fps: 60, frameAverageMs: 16.6, framePercentile95Ms: 17.5, physicsStepAverageMs: 0.6, physicsStepMaxMs: 1.4, vehicleSolverAverageMs: 0.1,
    triangles: 400_000, drawCalls: 120, geometries: 200, textures: 20, colliders: 300, bodies: 40,
    activeChunks: 25, failedChunks: 0, recenters: 0, chunkCrossings: 0, recenterJumpM: 0, steadyJumpM: 0.2, vehicleWorldXM: 1200, looseShare: 0, audioState: 'running', engineHz: 120, squealGain: 0, audioLevelDb: -30, chunkBuildAverageMs: 6, chunkBuildMaxMs: 12,
  };

  it('reports nothing for a scene within budget', () => {
    expect(budgetViolations(healthy)).toEqual([]);
  });

  it('flags each indicator that exceeds its budget', () => {
    const slow = { ...healthy, framePercentile95Ms: PERF_BUDGET.framePercentile95Ms + 1, physicsStepAverageMs: 5, triangles: 2_000_000, drawCalls: 500, vehicleSolverAverageMs: 2, chunkBuildMaxMs: 40 };
    expect(budgetViolations(slow).sort()).toEqual(['chunks', 'drawCalls', 'frame', 'physics', 'triangles', 'vehicle']);
  });
});
