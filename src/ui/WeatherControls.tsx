import {
  AIR_TEMPERATURE_C, RAIN_LABELS, TEMPERATURE_LABELS, type AirTemperature, type Rain, type WeatherSettings,
} from '../world/weather/weatherModel';

interface WeatherControlsProps {
  weather: WeatherSettings;
  onChange: (next: WeatherSettings) => void;
}

/** Choix de la pluie et de la température de l'air (menu de pause et écran des circuits). */
export function WeatherControls({ weather, onChange }: WeatherControlsProps) {
  return (
    <>
      <div className="setup-row">
        <span>Météo</span>
        <div className="segmented" role="group" aria-label="Pluie">
          {(Object.keys(RAIN_LABELS) as Rain[]).map((rain) => (
            <button key={rain} aria-pressed={weather.rain === rain} onClick={() => onChange({ ...weather, rain })}>{RAIN_LABELS[rain]}</button>
          ))}
        </div>
      </div>
      <div className="setup-row">
        <span>Température</span>
        <div className="segmented" role="group" aria-label="Température de l'air">
          {(Object.keys(AIR_TEMPERATURE_C) as AirTemperature[]).map((temperature) => (
            <button key={temperature} aria-pressed={weather.temperature === temperature} onClick={() => onChange({ ...weather, temperature })}>{TEMPERATURE_LABELS[temperature]}</button>
          ))}
        </div>
      </div>
    </>
  );
}
