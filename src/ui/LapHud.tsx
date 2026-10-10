import { formatDelta, formatLapTime } from '../race/lapTimer';

export interface LapHudState {
  /** Tour en cours (1, 2…) ; 0 avant le premier passage de la ligne. */
  lapNumber: number;
  started: boolean;
  currentS: number;
  valid: boolean;
  invalidReason: string | null;
  deltaS: number | null;
  bestS: number | null;
  lastS: number | null;
  /** Dernier tour perdu (raison) plutôt que chronométré. */
  lastInvalidReason: string | null;
}

/** Message éphémère (record battu, tour invalide…). */
export interface RaceNotice { id: number; kind: 'record' | 'info' | 'warning'; text: string }

interface LapHudProps {
  state: LapHudState;
  notice: RaceNotice | null;
}

/** Chrono du tour, meilleur tour, dernier tour et écart au meilleur. En haut à gauche, à l'opposé du bouton de pause. */
export function LapHud({ state, notice }: LapHudProps) {
  const delta = state.started && state.valid ? state.deltaS : null;
  const deltaClass = delta === null ? '' : delta <= 0 ? 'ahead' : 'behind';
  return (
    <div className="lap-hud" aria-label="Chronométrage">
      <div className="lap-current">
        <span className="lap-label">{state.started ? `Tour ${state.lapNumber}` : 'Franchissez la ligne pour lancer le chrono'}</span>
        {state.started && (
          <b className={state.valid ? '' : 'invalid'} data-lap="current">{state.valid ? formatLapTime(state.currentS) : 'Tour invalide'}</b>
        )}
        {state.started && !state.valid && state.invalidReason && <span className="lap-reason">{state.invalidReason}</span>}
        {delta !== null && <span className={`lap-delta ${deltaClass}`} data-lap="delta">{formatDelta(delta)}</span>}
      </div>
      <dl className="lap-times">
        <div><dt>Meilleur</dt><dd data-lap="best">{formatLapTime(state.bestS)}</dd></div>
        <div>
          <dt>Dernier</dt>
          <dd data-lap="last">{state.lastInvalidReason ? 'invalide' : formatLapTime(state.lastS)}</dd>
        </div>
      </dl>
      {notice && <p key={notice.id} className={`lap-notice ${notice.kind}`} role="status">{notice.text}</p>}
    </div>
  );
}
