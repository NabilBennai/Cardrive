import type { SurfaceMaterial } from '../../shared/types.ts';

/** Pluie choisie par le joueur et température de l'air : les deux conditions du jeu. */
export type Rain = 'dry' | 'light' | 'heavy';
export type AirTemperature = 'cool' | 'mild' | 'hot';

export interface WeatherSettings {
  rain: Rain;
  temperature: AirTemperature;
}

export const DEFAULT_WEATHER: WeatherSettings = { rain: 'dry', temperature: 'mild' };
export const RAIN_LABELS: Record<Rain, string> = { dry: 'Sec', light: 'Pluie légère', heavy: 'Forte pluie' };
export const TEMPERATURE_LABELS: Record<AirTemperature, string> = { cool: 'Frais · 10 °C', mild: 'Tempéré · 20 °C', hot: 'Chaud · 32 °C' };
export const AIR_TEMPERATURE_C: Record<AirTemperature, number> = { cool: 10, mild: 20, hot: 32 };

/** Humidité maximale de la piste (0 sèche … 1 noyée) atteinte sous chaque pluie, et vitesse à laquelle elle monte (par seconde). */
const WETNESS_CAP: Record<Rain, number> = { dry: 0, light: 0.55, heavy: 1 };
const WETNESS_RISE_PER_S: Record<Rain, number> = { dry: 0, light: 0.012, heavy: 0.03 };
/** Séchage (par seconde) quand il ne pleut plus ou moins fort : une piste détrempée sèche en ≈ 3 minutes. */
const WETNESS_DRY_PER_S = 1 / 180;
/** Refroidissement (°C) de la piste et des pneus par une piste entièrement mouillée. */
const WET_COOLING_C = 6;
/** Épaisseur du film d'eau (mm) sur une piste entièrement mouillée. */
const MAX_WATER_DEPTH_MM = 2;

const clamp = (value: number, lower: number, upper: number) => Math.max(lower, Math.min(upper, value));

/** Humidité de la piste après un pas : elle monte vers le plafond de la pluie en cours, et redescend en séchant. */
export function stepWetness(wetness: number, rain: Rain, dtS: number): number {
  const cap = WETNESS_CAP[rain];
  if (wetness < cap) return Math.min(cap, wetness + WETNESS_RISE_PER_S[rain] * dtS);
  if (wetness > cap) return Math.max(cap, wetness - WETNESS_DRY_PER_S * dtS);
  return wetness;
}

/** Épaisseur du film d'eau (mm). */
export function waterDepthMm(wetness: number): number {
  return MAX_WATER_DEPTH_MM * clamp(wetness, 0, 1) ** 1.2;
}

/** Facteur d'adhérence d'une surface mouillée : l'asphalte perd jusqu'à 38 %, l'herbe jusqu'à 45 %, le gravier un peu moins. */
export function wetGripFactor(surface: SurfaceMaterial, wetness: number): number {
  const w = clamp(wetness, 0, 1);
  if (surface === 'gravel') return 1 - 0.22 * w;
  if (surface === 'grass') return 1 - 0.45 * w;
  return 1 - 0.38 * w;
}

/** Résistance au roulement supplémentaire d'un sol mouillé (le pneu pousse l'eau, la boue s'alourdit). */
export function wetRollingFactor(surface: SurfaceMaterial, wetness: number): number {
  const w = clamp(wetness, 0, 1);
  return 1 + (surface === 'gravel' || surface === 'grass' ? 0.4 : 0.1) * w;
}

/**
 * Vitesse (m/s) à laquelle un pneu commence à aquaplaner : d'autant plus basse que l'eau est profonde et que le pneu est usé.
 * Infinie sous 1 mm d'eau (la sculpture évacue le film).
 */
export function aquaplaningSpeedMps(wetness: number, tireWear: number): number {
  const depth = waterDepthMm(wetness);
  if (depth < 1) return Number.POSITIVE_INFINITY;
  return Math.max(9, 36 - 4.7 * depth) * (1 - 0.25 * clamp(tireWear, 0, 1));
}

/** Facteur d'adhérence dû à l'aquaplanage : 1 sous le seuil, jusqu'à 0,45 bien au-dessus (8 m/s de plage de transition). */
export function aquaplaningGripFactor(speedMps: number, wetness: number, tireWear: number): number {
  const threshold = aquaplaningSpeedMps(wetness, tireWear);
  if (!Number.isFinite(threshold)) return 1;
  const t = clamp((Math.abs(speedMps) - threshold) / 8, 0, 1);
  return 1 - 0.55 * t * t * (3 - 2 * t);
}

/** Température (°C) à prendre pour le refroidissement des pneus : l'air, abaissé par l'eau sur la piste. */
export function effectiveAmbientC(airC: number, wetness: number): number {
  return airC - WET_COOLING_C * clamp(wetness, 0, 1);
}

/** Humidité de la piste au début d'une partie sous cette pluie : elle est déjà mouillée, pas à sécher puis à se mouiller. */
export function initialWetness(rain: Rain): number {
  return WETNESS_CAP[rain];
}

/** Intensité de pluie (0..1) pour les effets visuels et sonores. */
export function rainIntensity(rain: Rain): number {
  return rain === 'heavy' ? 1 : rain === 'light' ? 0.4 : 0;
}

const isRain = (value: unknown): value is Rain => value === 'dry' || value === 'light' || value === 'heavy';
const isTemperature = (value: unknown): value is AirTemperature => value === 'cool' || value === 'mild' || value === 'hot';

export const WEATHER_KEY = 'cardrive.weather';

interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function sanitizeWeather(value: unknown): WeatherSettings {
  const candidate = (typeof value === 'object' && value !== null ? value : {}) as Partial<WeatherSettings>;
  return {
    rain: isRain(candidate.rain) ? candidate.rain : DEFAULT_WEATHER.rain,
    temperature: isTemperature(candidate.temperature) ? candidate.temperature : DEFAULT_WEATHER.temperature,
  };
}

const browserStorage = (): Storage | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

export function loadWeather(storage: Storage | null = browserStorage()): WeatherSettings {
  try {
    const raw = storage?.getItem(WEATHER_KEY);
    return sanitizeWeather(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_WEATHER };
  }
}

export function saveWeather(settings: WeatherSettings, storage: Storage | null = browserStorage()): void {
  try { storage?.setItem(WEATHER_KEY, JSON.stringify(settings)); } catch { /* stockage indisponible */ }
}
