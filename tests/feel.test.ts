import { describe, expect, it, vi } from 'vitest';
import { AUDIO_SETTINGS_KEY, DEFAULT_AUDIO_SETTINGS, loadAudioSettings, sanitizeAudioSettings, saveAudioSettings } from '../src/audio/audioSettings';
import { impactChannel, originShiftChannel } from '../src/feel/feelBus';
import {
  BASE_FOV_DEG, cameraShakeAmplitude, fovForSpeed, MAX_FOV_BOOST_DEG, skidMarkAlpha, smokeRatePerSecond, smoothingFactor, sparkCount,
} from '../src/feel/feelMath';

describe('camera feel', () => {
  it('opens the field of view with speed within bounds, and not at all when disabled', () => {
    expect(fovForSpeed(0)).toBe(BASE_FOV_DEG);
    expect(fovForSpeed(80)).toBeCloseTo(BASE_FOV_DEG + MAX_FOV_BOOST_DEG, 6);
    expect(fovForSpeed(35)).toBeGreaterThan(fovForSpeed(20));
    expect(fovForSpeed(80, false)).toBe(BASE_FOV_DEG);
  });

  it('shakes lightly at very high speed and strongly after a crash, never at a standstill', () => {
    expect(cameraShakeAmplitude(0, 0)).toBe(0);
    expect(cameraShakeAmplitude(20, 0)).toBe(0);
    expect(cameraShakeAmplitude(70, 0)).toBeGreaterThan(0);
    expect(cameraShakeAmplitude(70, 0)).toBeLessThan(0.02);
    expect(cameraShakeAmplitude(10, 1)).toBeGreaterThan(0.3);
  });

  it('keeps the frame-rate independent smoothing between 0 and 1', () => {
    expect(smoothingFactor(5, 0)).toBe(0);
    expect(smoothingFactor(5, 1 / 60)).toBeLessThan(smoothingFactor(5, 1 / 30));
    expect(smoothingFactor(5, 10)).toBeLessThanOrEqual(1);
  });
});

describe('tire effects', () => {
  it('leaves a mark before the tire smokes, and only smokes under heavy sliding', () => {
    expect(skidMarkAlpha(1_000)).toBe(0);
    expect(skidMarkAlpha(8_000)).toBeGreaterThan(0);
    expect(smokeRatePerSecond(8_000)).toBe(0); // virage soutenu : trace sans fumée
    expect(smokeRatePerSecond(60_000)).toBeGreaterThan(50); // patinage / blocage : fumée
    expect(skidMarkAlpha(100_000)).toBeLessThanOrEqual(0.6);
  });

  it('throws sparks only for real impacts, in growing numbers', () => {
    expect(sparkCount(0.05)).toBe(0);
    expect(sparkCount(0.3)).toBeGreaterThan(0);
    expect(sparkCount(1)).toBeGreaterThan(sparkCount(0.3));
  });
});

describe('feel bus', () => {
  it('delivers events to subscribers until they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = impactChannel.subscribe(listener);
    impactChannel.emit({ intensity: 0.5, x: 1, y: 0, z: 2, dirX: 1, dirZ: 0 });
    unsubscribe();
    impactChannel.emit({ intensity: 1, x: 0, y: 0, z: 0, dirX: 0, dirZ: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].intensity).toBe(0.5);
    expect(impactChannel.size).toBe(0);
  });

  it('keeps delivering to the others when a listener unsubscribes during an emission', () => {
    const second = vi.fn();
    const stop = originShiftChannel.subscribe(() => stop());
    const stopSecond = originShiftChannel.subscribe(second);
    originShiftChannel.emit({ dx: 1, dy: 0, dz: 2 });
    expect(second).toHaveBeenCalledTimes(1);
    stopSecond();
  });
});

describe('audio settings', () => {
  const memoryStorage = () => {
    const data = new Map<string, string>();
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  };

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    saveAudioSettings({ master: 0.3, engine: 0.5, effects: 0.9, muted: true, cameraEffects: false }, storage);
    expect(loadAudioSettings(storage)).toEqual({ master: 0.3, engine: 0.5, effects: 0.9, muted: true, cameraEffects: false });
  });

  it('falls back to defaults for missing, corrupt or out-of-range content, field by field', () => {
    expect(loadAudioSettings(memoryStorage())).toEqual(DEFAULT_AUDIO_SETTINGS);
    const corrupt = memoryStorage();
    corrupt.setItem(AUDIO_SETTINGS_KEY, '{not json');
    expect(loadAudioSettings(corrupt)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(sanitizeAudioSettings({ master: 5, engine: -2, effects: 'x', muted: 'oui', cameraEffects: 1 }))
      .toEqual({ ...DEFAULT_AUDIO_SETTINGS, master: 1, engine: 0 });
    expect(sanitizeAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('survives unavailable storage', () => {
    const blocked = { getItem: () => { throw new Error('bloqué'); }, setItem: () => { throw new Error('bloqué'); } };
    expect(loadAudioSettings(blocked)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(() => saveAudioSettings(DEFAULT_AUDIO_SETTINGS, blocked)).not.toThrow();
    expect(() => saveAudioSettings(DEFAULT_AUDIO_SETTINGS, null)).not.toThrow();
  });
});
