import { useEffect, useState } from 'react';
import { circuitOutlinePath } from '../circuits/outline';
import type { CircuitSource } from '../circuits/f1Circuits2026';
import { formatLapTime } from '../race/lapTimer';
import { recordKey, type RecordBook } from '../race/records';
import { DIFFICULTY_LABELS, LAP_CHOICES, RIVAL_CHOICES, type Difficulty, type RaceSetup } from '../race/raceSetup';

interface CircuitPickerProps {
  onChoose: (circuit: CircuitSource) => void;
  onBack: () => void;
  /** Records du joueur et véhicule choisi : le meilleur tour s'affiche sur chaque carte. */
  records: RecordBook;
  carId: string;
  /** Mode de jeu choisi (contre-la-montre ou course) et ses réglages. */
  setup: RaceSetup;
  onSetupChange: (next: RaceSetup) => void;
}

const OUTLINE_SIZE_PX = 96;

const formatKm = (lengthM: number) => `${(lengthM / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} km`;

export function CircuitPicker({ onChoose, onBack, records, carId, setup, onSetupChange }: CircuitPickerProps) {
  const [circuits, setCircuits] = useState<CircuitSource[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Les tracés (~70 Ko) ne sont chargés qu'à l'ouverture de cet écran, pas dans le bundle initial.
  useEffect(() => {
    let cancelled = false;
    import('../circuits/f1Circuits2026')
      .then((module) => { if (!cancelled) setCircuits(module.F1_CIRCUITS_2026); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="screen" aria-label="Circuits de Formule 1">
      <div className="screen-head">
        <button className="back-button" onClick={onBack} aria-label="Retour au menu">‹</button>
        <div className="brand"><span className="brand-mark">C</span>Cardrive</div>
      </div>
      <div className="screen-body wide">
        <h2>Circuits F1 2026</h2>
        <p className="lead">Les 24 Grands Prix du calendrier, sur des tracés fidèles à la réalité en plan. Le relief n’est pas reproduit : les circuits sont plats.</p>

        <div className="setup-bar" aria-label="Mode de jeu">
          <div className="setup-row">
            <span>Mode</span>
            <div className="segmented" role="group" aria-label="Mode de jeu">
              <button aria-pressed={setup.mode === 'timeattack'} onClick={() => onSetupChange({ ...setup, mode: 'timeattack' })}>Contre-la-montre</button>
              <button aria-pressed={setup.mode === 'race'} onClick={() => onSetupChange({ ...setup, mode: 'race' })}>Course</button>
            </div>
          </div>
          {setup.mode === 'race' && (
            <>
              <div className="setup-row">
                <span>Tours</span>
                <div className="segmented" role="group" aria-label="Nombre de tours">
                  {LAP_CHOICES.map((laps) => <button key={laps} aria-pressed={setup.laps === laps} onClick={() => onSetupChange({ ...setup, laps })}>{laps}</button>)}
                </div>
              </div>
              <div className="setup-row">
                <span>Adversaires</span>
                <div className="segmented" role="group" aria-label="Nombre d'adversaires">
                  {RIVAL_CHOICES.map((rivals) => <button key={rivals} aria-pressed={setup.rivals === rivals} onClick={() => onSetupChange({ ...setup, rivals })}>{rivals}</button>)}
                </div>
              </div>
              <div className="setup-row">
                <span>Difficulté</span>
                <div className="segmented" role="group" aria-label="Difficulté">
                  {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((difficulty) => (
                    <button key={difficulty} aria-pressed={setup.difficulty === difficulty} onClick={() => onSetupChange({ ...setup, difficulty })}>{DIFFICULTY_LABELS[difficulty]}</button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {!circuits && !failed && <p className="status-line"><span className="spinner" /> Chargement des circuits…</p>}
        {failed && <p className="field-status">Impossible de charger les circuits. Rechargez la page.</p>}

        {circuits && (
          <ul className="circuit-grid">
            {circuits.map((circuit) => (
              <li key={circuit.id}>
                <button className="circuit-card" onClick={() => onChoose(circuit)}>
                  <svg viewBox={`0 0 ${OUTLINE_SIZE_PX} ${OUTLINE_SIZE_PX}`} width={OUTLINE_SIZE_PX} height={OUTLINE_SIZE_PX} aria-hidden="true">
                    <path d={circuitOutlinePath(circuit.coordinates, OUTLINE_SIZE_PX)} />
                  </svg>
                  <span className="circuit-info">
                    <span className="circuit-round">Manche {circuit.round}{circuit.status === 'cancelled' ? ' · annulée' : ''}</span>
                    <strong>{circuit.grandPrix}</strong>
                    <span>{circuit.name}</span>
                    <span>{circuit.location}, {circuit.country} · {formatKm(circuit.lengthM)}</span>
                    {records[recordKey(circuit.id, carId)] && (
                      <span className="circuit-record">Meilleur tour · {formatLapTime(records[recordKey(circuit.id, carId)].bestS)}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
