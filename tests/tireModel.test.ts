import { describe, expect, it } from 'vitest';
import {
  convectionCoefficient, loadAdjustedGrip, magicCurve, shapeFactor, staticWheelLoadN, stepTireThermal,
  temperatureGripFactor, thermalParamsFor, tireForce, type TireForceParams, type TireThermalState,
} from '../src/vehicle/physics/tireModel';

const params: TireForceParams = {
  baseGrip: 1, peakSlipRatio: 0.12, peakSlipAngleRad: 0.13, slidingRatio: 0.82, loadSensitivity: 0.08, referenceLoadN: 2700,
};

describe('magic formula curve', () => {
  it('peaks at s = 1 with a value of 1, and falls to the sliding ratio at large slip', () => {
    expect(magicCurve(1, 0.82)).toBeCloseTo(1, 6);
    expect(magicCurve(0.5, 0.82)).toBeLessThan(1);
    expect(magicCurve(1.5, 0.82)).toBeLessThan(1);
    expect(magicCurve(1_000, 0.82)).toBeCloseTo(0.82, 2);
    // Rend la courbe croissante jusqu'au pic.
    let previous = 0;
    for (let s = 0.05; s <= 1; s += 0.05) { const value = magicCurve(s, 0.82); expect(value).toBeGreaterThan(previous); previous = value; }
  });

  it('derives the shape factor so that the asymptote equals the sliding ratio', () => {
    for (const ratio of [0.7, 0.82, 0.9]) expect(Math.sin((shapeFactor(ratio) * Math.PI) / 2)).toBeCloseTo(ratio, 6);
  });
});

describe('tire force', () => {
  const load = 2700;

  it('reaches mu x load at the peak slip, longitudinally and laterally, with the right sign', () => {
    const longitudinal = tireForce(params, 0.12, 0, load, 1);
    expect(longitudinal.fxN).toBeCloseTo(load, 0);
    expect(Math.abs(longitudinal.fyN)).toBeLessThan(1e-6);
    const lateral = tireForce(params, 0, 0.13, load, 1);
    expect(lateral.fyN).toBeCloseTo(-load, 0); // glissement vers la droite → force vers la gauche
    expect(tireForce(params, 0, -0.13, load, 1).fyN).toBeCloseTo(load, 0);
    expect(tireForce(params, -0.12, 0, load, 1).fxN).toBeCloseTo(-load, 0);
  });

  it('has a realistic cornering stiffness of about 15 to 25 times the load per radian', () => {
    const small = 0.01;
    const stiffness = -tireForce(params, 0, small, load, 1).fyN / small / load;
    expect(stiffness).toBeGreaterThan(15);
    expect(stiffness).toBeLessThan(25);
  });

  it('loses lateral grip when the wheel also spins (friction ellipse), without any ad hoc rule', () => {
    const pure = Math.abs(tireForce(params, 0, 0.13, load, 1).fyN);
    const spinning = Math.abs(tireForce(params, 0.12, 0.13, load, 1).fyN);
    expect(spinning).toBeLessThan(pure);
    const combined = tireForce(params, 0.12, 0.13, load, 1);
    expect(Math.hypot(combined.fxN, combined.fyN)).toBeLessThanOrEqual(combined.peakN * 1.0001);
  });

  it('grips relatively less under heavier load but still produces more force', () => {
    expect(loadAdjustedGrip(params, 4000)).toBeLessThan(loadAdjustedGrip(params, 2000));
    expect(tireForce(params, 0.12, 0, 4000, 1).fxN).toBeGreaterThan(tireForce(params, 0.12, 0, 2000, 1).fxN);
  });

  it('scales with the temperature grip factor and is zero without load', () => {
    expect(tireForce(params, 0.12, 0, load, 0.8).fxN).toBeCloseTo(0.8 * load, 0);
    expect(tireForce(params, 0.12, 0.1, 0, 1).fxN).toBe(0);
  });
});

describe('tire temperature and grip', () => {
  it('is maximal at the optimum, only mildly reduced when cold, more reduced when overheated', () => {
    expect(temperatureGripFactor(80, 80, 55, 0.5)).toBe(1);
    const cold = temperatureGripFactor(20, 80, 55, 0.5);
    expect(cold).toBeGreaterThan(0.85); // un pneu de route froid garde l'essentiel de son grip
    expect(cold).toBeLessThan(1);
    expect(temperatureGripFactor(140, 80, 55, 0.5)).toBeLessThan(0.85);
    expect(temperatureGripFactor(400, 80, 55, 0.5)).toBe(0.5);
  });
});

describe('tire thermal model', () => {
  const thermal = thermalParamsFor(staticWheelLoadN(1105));
  const ambientC = 20;
  const dt = 1 / 60;
  const run = (state: TireThermalState, seconds: number, input: { slidingPowerW: number; hysteresisPowerW: number; speedMps: number }) => {
    let current = state;
    for (let i = 0; i < Math.round(seconds / dt); i += 1) current = stepTireThermal(current, { ...input, ambientC }, thermal, dt);
    return current;
  };

  it('stays at ambient temperature with no heat input', () => {
    const result = run({ surfaceC: ambientC, carcassC: ambientC }, 600, { slidingPowerW: 0, hysteresisPowerW: 0, speedMps: 0 });
    expect(result.surfaceC).toBeCloseTo(ambientC, 6);
    expect(result.carcassC).toBeCloseTo(ambientC, 6);
  });

  it('cools down gradually: a hot tire at rest loses half its excess temperature in 8 to 16 minutes', () => {
    const excessAfter = (minutes: number) => run({ surfaceC: 100, carcassC: 100 }, minutes * 60, { slidingPowerW: 0, hysteresisPowerW: 0, speedMps: 0 }).carcassC - ambientC;
    expect(excessAfter(1)).toBeGreaterThan(70); // pas instantané : la carcasse est inertielle
    expect(excessAfter(8)).toBeGreaterThan(40); // plus de la moitié de l'excès (80 °C) est encore là
    expect(excessAfter(16)).toBeLessThan(40);
    expect(excessAfter(60)).toBeLessThan(5);
  });

  it('cools faster when driving (forced convection) than when parked', () => {
    const parked = run({ surfaceC: 100, carcassC: 100 }, 120, { slidingPowerW: 0, hysteresisPowerW: 0, speedMps: 0 });
    const rolling = run({ surfaceC: 100, carcassC: 100 }, 120, { slidingPowerW: 0, hysteresisPowerW: 0, speedMps: 30 });
    expect(rolling.carcassC).toBeLessThan(parked.carcassC);
    expect(rolling.surfaceC).toBeLessThan(parked.surfaceC);
    expect(convectionCoefficient(30)).toBeGreaterThan(convectionCoefficient(0) * 3);
  });

  it('settles at a modest temperature when cruising at 108 km/h, nowhere near an overheated tire', () => {
    const hysteresisPowerW = 0.012 * 2700 * 30;
    const cruising = run({ surfaceC: ambientC, carcassC: ambientC }, 1800, { slidingPowerW: 0, hysteresisPowerW, speedMps: 30 });
    expect(cruising.carcassC).toBeGreaterThan(30);
    expect(cruising.carcassC).toBeLessThan(65);
    expect(cruising.surfaceC).toBeLessThan(cruising.carcassC + 1);
  });

  it('heats the tread within seconds under a burnout but not instantly, and stays bounded', () => {
    const afterOneSecond = run({ surfaceC: ambientC, carcassC: ambientC }, 1, { slidingPowerW: 60_000, hysteresisPowerW: 0, speedMps: 3 });
    const afterTenSeconds = run({ surfaceC: ambientC, carcassC: ambientC }, 10, { slidingPowerW: 60_000, hysteresisPowerW: 0, speedMps: 3 });
    expect(afterOneSecond.surfaceC).toBeGreaterThan(30);
    expect(afterOneSecond.surfaceC).toBeLessThan(80);
    expect(afterTenSeconds.surfaceC).toBeGreaterThan(afterOneSecond.surfaceC);
    expect(afterTenSeconds.carcassC).toBeLessThan(afterTenSeconds.surfaceC); // la carcasse suit, plus lentement
    expect(afterTenSeconds.surfaceC).toBeLessThanOrEqual(260);
  });

  it('does not heat a tire from moderate cornering (about 0.3 g) by tens of degrees in a few seconds', () => {
    // Fy ≈ 0,3 × 2700 N avec une vitesse de glissement latérale de ~0,15 m/s.
    const result = run({ surfaceC: ambientC, carcassC: ambientC }, 10, { slidingPowerW: 810 * 0.15, hysteresisPowerW: 0.012 * 2700 * 20, speedMps: 20 });
    expect(result.surfaceC - ambientC).toBeLessThan(6);
  });

  it('scales with wheel load: a heavy truck tire changes temperature more slowly than a kart tire', () => {
    const kart = thermalParamsFor(staticWheelLoadN(180));
    const truck = thermalParamsFor(staticWheelLoadN(12_000));
    expect(truck.carcassCapacityJPerC).toBeGreaterThan(kart.carcassCapacityJPerC * 5);
  });
});
