import { useAfterPhysicsStep } from '@react-three/rapier';
import { useEffect, useRef } from 'react';
import { VEHICLE_FIXED_STEP_S } from '../../vehicle/physics/vehicleBody';
import { AIR_TEMPERATURE_C, stepWetness, type WeatherSettings } from './weatherModel';

/** Conditions du moment, lues par toutes les voitures (solveur), par la pluie et par les matériaux de piste. */
export interface Environment {
  wetness: number;
  airC: number;
}

/** Variation minimale de l'humidité (0..1) avant d'en informer l'interface : évite de redessiner l'écran à chaque pas. */
const REPORT_STEP = 0.02;

/** Écrit dans l'environnement partagé (fonction externe : la référence est lue par le solveur). */
function updateEnvironment(target: Environment, wetness: number, airC: number): void {
  target.wetness = wetness;
  target.airC = airC;
}

interface WeatherDriverProps {
  weather: WeatherSettings;
  environmentRef: React.RefObject<Environment>;
  onWetnessChange: (wetness: number) => void;
}

/**
 * À monter dans le Canvas : fait évoluer l'humidité de la piste avec le temps de simulation (la pause l'arrête) et applique la
 * température de l'air choisie. Ne rend rien.
 */
export function WeatherDriver({ weather, environmentRef, onWetnessChange }: WeatherDriverProps) {
  const reported = useRef(-1);
  const latest = useRef({ weather, onWetnessChange });
  useEffect(() => { latest.current = { weather, onWetnessChange }; }, [weather, onWetnessChange]);

  useAfterPhysicsStep(() => {
    const env = environmentRef.current;
    const wetness = stepWetness(env.wetness, latest.current.weather.rain, VEHICLE_FIXED_STEP_S);
    updateEnvironment(env, wetness, AIR_TEMPERATURE_C[latest.current.weather.temperature]);
    if (Math.abs(wetness - reported.current) >= REPORT_STEP || (wetness === 0 && reported.current !== 0)) {
      reported.current = wetness;
      latest.current.onWetnessChange(wetness);
    }
  });

  return null;
}
