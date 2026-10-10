import { useEffect, useState } from 'react';
import type { VehicleTelemetry } from '../shared/types';

interface DrivingHUDProps {
  /** Régime maximal du moteur du véhicule (tr/min) : échelle de la barre de régime. */
  maxRpm: number;
  telemetry: VehicleTelemetry;
  paused: boolean;
  onPause: () => void;
  /** Étape 4, doc §8 : « signaler la limite » quand un chunk voisin tarde à charger. Non bloquant — un sol de secours garantit qu'on ne tombe jamais. */
  zoneUnavailable?: boolean;
}

const kmh = (speedMps: number) => Math.round(Math.abs(speedMps) * 3.6);

const TIRE_LABELS = ['Avant gauche', 'Avant droit', 'Arrière gauche', 'Arrière droit'];
// Repères approximatifs d'une fenêtre de température pneu (froid / optimal / surchauffe) :
// cohérents avec le réglage physique (ambiant 20°C, optimal 85°C) sans y être couplés en dur.
const tireStatus = (tempC: number) => (tempC < 55 ? 'cold' : tempC > 115 ? 'hot' : 'optimal');
const REDLINE_SHARE = 0.82;
/** Le glissement de la télémétrie est normalisé : 1 = pic d'adhérence du pneu. Au-delà de 1,15 le pneu glisse franchement. */
const GRIP_LIMIT_SLIP = 1.15;

export function DrivingHUD({ maxRpm, telemetry, paused, onPause, zoneUnavailable }: DrivingHUDProps) {
  const [showDetails, setShowDetails] = useState(false);
  const rpmShare = Math.min(1, telemetry.engineRpm / maxRpm);
  const gripLimit = telemetry.slip > GRIP_LIMIT_SLIP;
  const gripUsedPercent = Math.min(100, Math.round(telemetry.slip * 100));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'KeyT' && !event.repeat) setShowDetails((value) => !value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="hud-layer" aria-label="Tableau de bord">
      <button className="hud-pause" onClick={onPause} aria-label={paused ? 'Reprendre' : 'Mettre en pause'}>
        {paused ? '▶' : 'Ⅱ'}
      </button>

      {showDetails && (
        <section className="details-panel" aria-label="Détails du véhicule">
          <h3>Détails</h3>
          <div className="detail-row"><span>Régime</span><b>{Math.round(telemetry.engineRpm).toLocaleString('fr-FR')} tr/min</b></div>
          <div className="detail-row"><span>Adhérence</span><b className={gripLimit ? 'warning' : ''}>{gripLimit ? 'Glisse' : `${gripUsedPercent} % utilisé`}</b></div>
          <div className="detail-row"><span>Roues au sol</span><b>{telemetry.groundedWheels} / 4</b></div>
          <div className="tires">
            {telemetry.tireTemperaturesC.map((tempC, index) => (
              <div key={TIRE_LABELS[index]} className="detail-row">
                <span>{TIRE_LABELS[index]}</span>
                <b className={tireStatus(tempC)}>{Math.round(tempC)} °C</b>
              </div>
            ))}
          </div>
        </section>
      )}

      {gripLimit && <p className="limit-pill" role="status">Adhérence limite</p>}

      <section className="cluster" aria-label={`Vitesse ${kmh(telemetry.speedMps)} kilomètres par heure, rapport ${telemetry.gear < 0 ? 'arrière' : telemetry.gear}`}>
        <div className="cluster-main">
          <div className={telemetry.gear < 0 ? 'gear reverse' : 'gear'}>{telemetry.gear < 0 ? 'R' : telemetry.gear}</div>
          <div className="speed"><b>{kmh(telemetry.speedMps)}</b><span>km/h</span></div>
        </div>
        <div className="rpm" role="img" aria-label={`Régime moteur ${Math.round(telemetry.engineRpm)} tours par minute`}>
          <i className={rpmShare > REDLINE_SHARE ? 'high' : ''} style={{ ['--rpm' as string]: `${Math.round(rpmShare * 100)}%` }} />
        </div>
      </section>

      <div className="hud-hint" aria-label="Commandes">
        <span><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> Conduire</span>
        <span><kbd>Espace</kbd> Frein à main</span>
        <span><kbd>R</kbd> Repositionner</span>
        <span><kbd>T</kbd> Détails</span>
      </div>

      {zoneUnavailable && <p className="toast" role="status">Zone suivante indisponible, nouvelle tentative en cours…</p>}
    </div>
  );
}
