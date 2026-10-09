import type { VehicleTelemetry } from '../shared/types';

interface DrivingHUDProps {
  telemetry: VehicleTelemetry;
  paused: boolean;
  onPause: () => void;
  onRespawn: () => void;
}

const kmh = (speedMps: number) => Math.round(Math.abs(speedMps) * 3.6).toString().padStart(3, '0');

const TIRE_LABELS = ['AVG', 'AVD', 'ARG', 'ARD'];
// Repères approximatifs d'une fenêtre de température pneu (froid / optimal / surchauffe) :
// cohérents avec le réglage physique (ambiant 20°C, optimal 85°C) sans y être couplés en dur.
const tireStatus = (tempC: number) => (tempC < 55 ? 'cold' : tempC > 115 ? 'hot' : 'optimal');

export function DrivingHUD({ telemetry, paused, onPause, onRespawn }: DrivingHUDProps) {
  const rpmProgress = Math.min(1, telemetry.engineRpm / 6700);
  const gripPercent = Math.min(100, Math.round(telemetry.slip * 100));

  return (
    <div className="hud-layer" aria-label="Télémétrie de conduite">
      <header className="hud-topbar">
        <div className="hud-brand"><span className="brand-mark">C</span><span>CARDRIVE <small>LAB / 01</small></span></div>
        <div className="track-status"><i /> CIRCUIT DÉMO <span>•</span> SEC / 02:14</div>
        <button className="icon-button pause-button" onClick={onPause} aria-label={paused ? 'Reprendre' : 'Mettre en pause'}>
          {paused ? '▶' : 'Ⅱ'}
        </button>
      </header>

      <section className="telemetry-card speed-card">
        <div className="eyebrow"><span>VITESSE</span><span className="live-dot">● LIVE</span></div>
        <div className="speed-readout">{kmh(telemetry.speedMps)}<span>km/h</span></div>
        <div className="speed-track"><span style={{ width: `${Math.min(100, Math.abs(telemetry.speedMps) / 48 * 100)}%` }} /></div>
        <div className="speed-foot"><span>RWD · PROPULSION</span><span>{telemetry.groundedWheels} / 4 AU SOL</span></div>
      </section>

      <section className="telemetry-card engine-card">
        <div className="eyebrow"><span>RÉGIME MOTEUR</span><span>RPM</span></div>
        <div className="rpm-readout">{Math.round(telemetry.engineRpm).toLocaleString('fr-FR')}<span>tr/min</span></div>
        <div className="rpm-bars" aria-label={`Régime moteur ${Math.round(telemetry.engineRpm)} tours par minute`}>
          {Array.from({ length: 24 }, (_, index) => (
            <i key={index} className={index / 24 < rpmProgress ? (index > 19 ? 'hot' : 'on') : ''} />
          ))}
        </div>
        <div className="engine-foot"><span>BOÎTE AUTO</span><span>MAX 6 400</span></div>
      </section>

      <aside className="gear-card" aria-label={`Rapport ${telemetry.gear}`}>
        <span className="eyebrow">RAPPORT</span>
        <strong>{telemetry.gear < 0 ? 'R' : telemetry.gear}</strong>
        <span className="gear-caption">{telemetry.gear < 0 ? 'ARRIÈRE' : 'AUTO'}</span>
      </aside>

      <section className="grip-card">
        <div className="eyebrow"><span>GLISSEMENT</span><span>{gripPercent}%</span></div>
        <div className="grip-track"><span className={gripPercent > 65 ? 'warning' : ''} style={{ width: `${gripPercent}%` }} /></div>
        <div className="grip-caption">{gripPercent > 65 ? 'LIMITE D’ADHÉRENCE' : 'ADHÉRENCE STABLE'}</div>
      </section>

      <section className="tires-card" aria-label="Température des pneus">
        <div className="eyebrow"><span>PNEUS</span><span>°C</span></div>
        <div className="tires-grid">
          {telemetry.tireTemperaturesC.map((tempC, index) => (
            <div key={TIRE_LABELS[index]} className={`tire-cell ${tireStatus(tempC)}`}>
              <span className="tire-label">{TIRE_LABELS[index]}</span>
              <span className="tire-value">{Math.round(tempC)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="controls-hint" aria-label="Commandes clavier">
        <span><kbd>Z</kbd><kbd>W</kbd> ACCÉLÉRER</span>
        <span><kbd>S</kbd> FREIN / RECUL</span>
        <span><kbd>Q</kbd><kbd>D</kbd> VIRER</span>
        <span><kbd>ESPACE</kbd> FREIN À MAIN</span>
      </div>

      <div className="hud-actions">
        <button className="text-button" onClick={onRespawn}><kbd>R</kbd> REPOSITIONNER</button>
        <button className="text-button" onClick={onPause}><kbd>ÉCHAP</kbd> PAUSE</button>
      </div>
    </div>
  );
}
