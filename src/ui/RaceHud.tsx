import type { RaceState } from '../race/RaceDirector';
import { PLAYER_ID } from '../race/RaceDirector';
import { formatLapTime } from '../race/lapTimer';
import { FALSE_START_PENALTY_S, LIGHTS } from '../race/raceModel';

const ordinal = (n: number) => (n === 1 ? '1er' : `${n}e`);

interface RaceHudProps {
  state: RaceState | null;
}

/** Feux de départ (au centre, pendant le compte à rebours) et rang / tour du joueur (en haut, au milieu). */
export function RaceHud({ state }: RaceHudProps) {
  if (!state) return null;
  const counting = state.phase === 'countdown';
  const me = state.standings.find((standing) => standing.id === PLAYER_ID);
  const gap = me?.gapAheadM ?? null;
  return (
    <>
      <div className="race-status" aria-label="Course">
        <b data-race="position">{ordinal(state.playerPosition)}</b><span>/ {state.carCount}</span>
        <i aria-hidden="true" />
        <span data-race="lap">Tour {state.playerLap} / {state.totalLaps}</span>
        {gap !== null && !counting && <span data-race="gap">devant : {Math.round(gap)} m</span>}
      </div>
      {counting && (
        <div className="start-lights" role="status" aria-label={`Feux de départ : ${state.lightsOn} sur ${LIGHTS}`} data-lights={state.lightsOn}>
          {Array.from({ length: LIGHTS }, (_, index) => <span key={index} className={index < state.lightsOn ? 'on' : ''} />)}
        </div>
      )}
      {state.playerFalseStart && <p className="false-start" role="status">Faux départ · +{FALSE_START_PENALTY_S} s</p>}
    </>
  );
}

interface RaceResultsProps {
  state: RaceState;
  onReplay: () => void;
  onQuit: () => void;
}

const nameOf = (id: string) => (id === PLAYER_ID ? 'Vous' : `Pilote ${id.replace('ai-', '')}`);

/** Tableau d'arrivée, affiché quand le joueur a franchi la ligne au dernier tour. */
export function RaceResults({ state, onReplay, onQuit }: RaceResultsProps) {
  return (
    <section className="pause-overlay" aria-label="Résultats de la course">
      <div className="pause-panel results-panel">
        <h2>Course terminée</h2>
        <p data-race="result">Vous terminez {ordinal(state.playerPosition)} sur {state.carCount}.</p>
        <ol className="results-list">
          {state.standings.map((standing) => (
            <li key={standing.id} className={standing.id === PLAYER_ID ? 'me' : ''}>
              <span className="results-rank">{standing.position}</span>
              <span className="results-name">{nameOf(standing.id)}</span>
              <span className="results-time">
                {standing.finishS === null
                  ? 'en course'
                  : formatLapTime(standing.finishS + standing.penaltyS)}
                {standing.penaltyS > 0 && standing.finishS !== null ? ` (+${standing.penaltyS} s)` : ''}
              </span>
            </li>
          ))}
        </ol>
        <button className="btn" onClick={onReplay}>Rejouer</button>
        <button className="btn-quiet" onClick={onQuit}>Retour au menu</button>
      </div>
    </section>
  );
}
