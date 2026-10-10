import { describe, expect, it } from 'vitest';
import {
  engineVoiceParams, firingFrequencyHz, IMPACT_MIN_DELTA_V, impactIntensity, impactParams, revLimiterGain, rollingNoiseParams,
  shiftDuck, SHIFT_DUCK_SECONDS, smoothstep, tireSquealParams, volumeToGain, windNoiseParams, type EngineSoundState,
} from '../src/audio/audioModel';
import { DEFAULT_SOUND_PROFILE, soundProfileFor, SOUND_PROFILE_IDS } from '../src/audio/soundProfiles';
import { CAR_CATALOG } from '../src/vehicle/catalog/carCatalog';
import { vehicleConfigFor } from '../src/vehicle/configs/vehicleProfiles';

const baseState: EngineSoundState = { rpm: 3_000, idleRpm: 900, maxRpm: 6_700, load: 0.6, speedMps: 20, secondsSinceShift: 99, timeS: 0 };

describe('firing frequency', () => {
  it('follows the engine speed and the number of cylinders (4-stroke: half the cylinders per revolution)', () => {
    expect(firingFrequencyHz(6_000, { ...DEFAULT_SOUND_PROFILE, cylinders: 4 })).toBeCloseTo(200, 6);
    expect(firingFrequencyHz(6_000, { ...DEFAULT_SOUND_PROFILE, cylinders: 8 })).toBeCloseTo(400, 6);
    expect(firingFrequencyHz(6_000, { ...DEFAULT_SOUND_PROFILE, cylinders: 1, strokes: 2 })).toBeCloseTo(100, 6);
    expect(firingFrequencyHz(0, DEFAULT_SOUND_PROFILE)).toBe(0);
  });
});

describe('engineVoiceParams', () => {
  it('raises pitch, brightness and loudness with engine speed', () => {
    const low = engineVoiceParams({ ...baseState, rpm: 1_200 }, DEFAULT_SOUND_PROFILE);
    const high = engineVoiceParams({ ...baseState, rpm: 6_000 }, DEFAULT_SOUND_PROFILE);
    expect(high.fundamentalHz).toBeGreaterThan(low.fundamentalHz * 4);
    expect(high.filterHz).toBeGreaterThan(low.filterHz);
    expect(high.gain).toBeGreaterThan(low.gain);
  });

  it('is louder, brighter and richer under load than when lifting off', () => {
    const open = engineVoiceParams({ ...baseState, load: 1 }, DEFAULT_SOUND_PROFILE);
    const closed = engineVoiceParams({ ...baseState, load: 0 }, DEFAULT_SOUND_PROFILE);
    expect(open.gain).toBeGreaterThan(closed.gain);
    expect(open.filterHz).toBeGreaterThan(closed.filterHz);
    expect(open.oscillatorGains[1]).toBeGreaterThan(closed.oscillatorGains[1]);
    expect(open.intakeGain).toBeGreaterThan(closed.intakeGain);
    expect(closed.intakeGain).toBe(0);
  });

  it('stays finite and audible at idle', () => {
    const idle = engineVoiceParams({ ...baseState, rpm: 900, load: 0, speedMps: 0 }, DEFAULT_SOUND_PROFILE);
    for (const value of [idle.fundamentalHz, idle.filterHz, idle.gain, ...idle.oscillatorGains]) expect(Number.isFinite(value)).toBe(true);
    expect(idle.gain).toBeGreaterThan(0.05);
    expect(idle.fundamentalHz).toBeGreaterThan(20);
  });

  it('ducks briefly at a gear change and chops the sound at the rev limiter', () => {
    const steady = engineVoiceParams(baseState, DEFAULT_SOUND_PROFILE).gain;
    const shifting = engineVoiceParams({ ...baseState, secondsSinceShift: 0.05 }, DEFAULT_SOUND_PROFILE).gain;
    expect(shifting).toBeLessThan(steady * 0.7);
    expect(shiftDuck(SHIFT_DUCK_SECONDS + 0.01)).toBe(1);
    const gains = new Set<number>();
    for (let t = 0; t < 0.5; t += 0.01) gains.add(revLimiterGain(6_690, 6_700, t));
    expect(gains.size).toBe(2); // alternance coupure / pleine puissance
    expect(revLimiterGain(5_000, 6_700, 0.3)).toBe(1);
  });

  it('gives an electric car a whine that follows speed and never stutters', () => {
    const electric = soundProfileFor('race-future');
    expect(electric.kind).toBe('electric');
    const slow = engineVoiceParams({ ...baseState, rpm: 2_000, speedMps: 8 }, electric);
    const fast = engineVoiceParams({ ...baseState, rpm: 6_000, speedMps: 70 }, electric);
    expect(fast.fundamentalHz).toBeGreaterThan(slow.fundamentalHz);
    expect(fast.roughnessDepth).toBe(0);
    expect(fast.intakeGain).toBe(0);
  });

  it('makes a diesel truck deeper and rougher than a sports car', () => {
    const state = { ...baseState, rpm: 1_500 };
    const truck = engineVoiceParams(state, soundProfileFor('truck'));
    const sports = engineVoiceParams(state, soundProfileFor('sedan-sports'));
    expect(truck.filterHz).toBeLessThan(sports.filterHz * 0.6);
    expect(truck.roughnessDepth).toBeGreaterThan(sports.roughnessDepth * 2);
    expect(truck.oscillatorGains[4]).toBeGreaterThan(sports.oscillatorGains[4]);
  });
});

describe('sound profiles', () => {
  it('has a profile for every vehicle of the catalogue, and falls back to a default for unknown ids', () => {
    for (const car of CAR_CATALOG) expect(SOUND_PROFILE_IDS, car.id).toContain(car.id);
    expect(soundProfileFor('inconnu')).toBe(DEFAULT_SOUND_PROFILE);
    expect(soundProfileFor(null)).toBe(DEFAULT_SOUND_PROFILE);
  });

  it('puts every engine below its own redline into an audible range for its idle and maximum speed', () => {
    for (const car of CAR_CATALOG) {
      const config = vehicleConfigFor(car.id);
      const profile = soundProfileFor(car.id);
      const at = (rpm: number) => engineVoiceParams({ rpm, idleRpm: config.idleRpm, maxRpm: config.maximumRpm, load: 1, speedMps: 30, secondsSinceShift: 99, timeS: 0 }, profile);
      expect(at(config.idleRpm).fundamentalHz, car.id).toBeGreaterThan(15);
      expect(at(config.upshiftRpm).fundamentalHz, car.id).toBeLessThan(3_500);
      expect(at(config.upshiftRpm).fundamentalHz, car.id).toBeGreaterThan(at(config.idleRpm).fundamentalHz);
    }
  });
});

describe('effects', () => {
  it('starts squealing as the tire approaches its limit, but not when parked or gripping', () => {
    expect(tireSquealParams(0.4, 25).gain).toBe(0);
    expect(tireSquealParams(1.0, 25).gain).toBeGreaterThan(0);
    expect(tireSquealParams(1.8, 25).gain).toBeGreaterThan(tireSquealParams(1.2, 25).gain);
    expect(tireSquealParams(2, 1).gain).toBe(0);
    expect(tireSquealParams(2, 30).hz).toBeGreaterThan(tireSquealParams(2, 8).hz);
  });

  it('scales rolling noise and wind with speed, and silences rolling noise when airborne', () => {
    expect(rollingNoiseParams(30, 4).gain).toBeGreaterThan(rollingNoiseParams(10, 4).gain);
    expect(rollingNoiseParams(30, 0).gain).toBe(0);
    expect(windNoiseParams(60).gain).toBeGreaterThan(windNoiseParams(30).gain * 3);
    expect(windNoiseParams(0).gain).toBe(0);
  });

  it('ignores normal braking and acceleration but reacts to a crash, saturating at 1', () => {
    expect(impactIntensity(0.3)).toBe(0); // freinage appuyé : ≈ 0,16 m/s par pas
    expect(impactIntensity(IMPACT_MIN_DELTA_V - 0.01)).toBe(0);
    expect(impactIntensity(8)).toBeGreaterThan(0.1);
    expect(impactIntensity(15)).toBeGreaterThan(impactIntensity(8));
    expect(impactIntensity(60)).toBe(1);
    expect(impactParams(1).durationS).toBeGreaterThan(impactParams(0.1).durationS);
    expect(impactParams(1).thumpHz).toBeLessThan(impactParams(0.1).thumpHz);
  });

  it('maps a volume slider to a perceptual gain curve', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBe(0.25);
    expect(volumeToGain(2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
  });
});

describe('roulement sur sol meuble', () => {
  it('est plus fort et plus grave sur gravier ou herbe que sur asphalte', async () => {
    const { rollingNoiseParams } = await import('../src/audio/audioModel');
    const road = rollingNoiseParams(20, 4, 0);
    const gravel = rollingNoiseParams(20, 4, 1);
    expect(gravel.gain).toBeGreaterThan(road.gain * 1.5);
    expect(gravel.hz).toBeLessThan(road.hz);
    expect(rollingNoiseParams(20, 4).gain).toBe(road.gain);
    expect(rollingNoiseParams(20, 4, 5).gain).toBe(gravel.gain);
  });
});
