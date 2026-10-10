import { useEffect, useState } from 'react';
import { circuitOutlinePath } from '../circuits/outline';
import type { CircuitSource } from '../circuits/f1Circuits2026';

interface CircuitPickerProps {
  onChoose: (circuit: CircuitSource) => void;
  onBack: () => void;
}

const OUTLINE_SIZE_PX = 96;

const formatKm = (lengthM: number) => `${(lengthM / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} km`;

export function CircuitPicker({ onChoose, onBack }: CircuitPickerProps) {
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
