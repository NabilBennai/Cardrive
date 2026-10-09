import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RapierRigidBody } from '@react-three/rapier';
import { useDrivingInput } from '../input/useDrivingInput';
import type { VehicleTelemetry } from '../shared/types';
import { DrivingHUD } from '../ui/DrivingHUD';

const DrivingScene = lazy(() => import('./DrivingScene').then(({ DrivingScene: scene }) => ({ default: scene })));

class SceneErrorBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="scene-error" role="alert">
          <p className="overline"><i /> INITIALISATION IMPOSSIBLE</p>
          <h2>La piste<br />ne répond pas.</h2>
          <p>La scène physique n’a pas pu démarrer.</p>
          <button className="start-button" onClick={this.props.onRetry}><span>RÉESSAYER</span><b>↻</b></button>
        </section>
      );
    }
    return this.props.children;
  }
}

const idleTelemetry: VehicleTelemetry = {
  speedMps: 0,
  engineRpm: 900,
  gear: 1,
  slip: 0,
  groundedWheels: 0,
  throttle: 0,
  brake: 0,
  steering: 0,
  tireTemperaturesC: [20, 20, 20, 20],
};

export function App() {
  const gameFocus = useRef<HTMLDivElement>(null);
  const vehicleBody = useRef<RapierRigidBody>(null);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [tabHidden, setTabHidden] = useState(document.hidden);
  const [respawnVersion, setRespawnVersion] = useState(0);
  const [sceneAttempt, setSceneAttempt] = useState(0);
  const [telemetry, setTelemetry] = useState(idleTelemetry);
  const telemetryRef = useRef(idleTelemetry);
  const pauseGame = useCallback(() => setPaused((value) => !value), []);
  const respawn = useCallback(() => setRespawnVersion((value) => value + 1), []);
  const input = useDrivingInput(playing, paused || tabHidden, gameFocus, pauseGame, respawn);
  const onTelemetry = useCallback((next: VehicleTelemetry) => {
    telemetryRef.current = next;
    setTelemetry(next);
  }, []);
  const startGame = useCallback(() => {
    setPlaying(true);
    setPaused(false);
    requestAnimationFrame(() => gameFocus.current?.focus());
  }, []);
  const resumeGame = useCallback(() => {
    setPaused(false);
    requestAnimationFrame(() => gameFocus.current?.focus());
  }, []);

  useEffect(() => {
    const onVisibility = () => setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const physicsPaused = useMemo(() => !playing || paused || tabHidden, [playing, paused, tabHidden]);

  return (
    <main
      className="game-shell"
      ref={gameFocus}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.target instanceof HTMLCanvasElement) gameFocus.current?.focus();
      }}
      aria-label="Cardrive, simulateur de conduite"
    >
      {playing && (
        <SceneErrorBoundary key={sceneAttempt} onRetry={() => setSceneAttempt((value) => value + 1)}>
          <Suspense fallback={<div className="scene-loading"><i /> INITIALISATION DE LA PISTE</div>}>
            <DrivingScene bodyRef={vehicleBody} input={input} telemetryRef={telemetryRef} paused={physicsPaused} respawnVersion={respawnVersion} onTelemetry={onTelemetry} />
          </Suspense>
        </SceneErrorBoundary>
      )}

      {!playing && (
        <section className="start-screen">
          <svg className="start-route" viewBox="0 0 680 460" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="route-edge" x1="64" y1="70" x2="608" y2="378" gradientUnits="userSpaceOnUse">
                <stop stopColor="#d4ed55" stopOpacity=".06" />
                <stop offset=".58" stopColor="#d4ed55" stopOpacity=".8" />
                <stop offset="1" stopColor="#d4ed55" stopOpacity=".12" />
              </linearGradient>
              <filter id="route-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <ellipse cx="340" cy="230" rx="258" ry="156" stroke="#bfc7b3" strokeOpacity=".13" strokeWidth="30" />
            <ellipse cx="340" cy="230" rx="258" ry="156" stroke="#f1f2e5" strokeOpacity=".22" strokeWidth="1" />
            <ellipse cx="340" cy="230" rx="258" ry="156" stroke="url(#route-edge)" strokeWidth="2" strokeDasharray="1 14" strokeLinecap="round" />
            <path d="M82 224c10-84 113-148 250-150m273 163c-8 78-95 137-218 148" stroke="#eff0e7" strokeOpacity=".27" strokeWidth="1" strokeDasharray="4 10" />
            <circle cx="593" cy="226" r="8" fill="#d4ed55" filter="url(#route-glow)" />
            <circle cx="593" cy="226" r="3" fill="#f6f6e8" />
            <path d="M570 226h-42" stroke="#d4ed55" strokeOpacity=".7" strokeWidth="1" />
            <text x="516" y="214" fill="#eff0e7" fillOpacity=".57" fontFamily="monospace" fontSize="9" letterSpacing="2">START / 01</text>
            <text x="292" y="235" fill="#eff0e7" fillOpacity=".19" fontFamily="monospace" fontSize="9" letterSpacing="3">TEST LOOP</text>
          </svg>
          <div className="start-topline"><span>SIMULATEUR DE CONDUITE</span><span>VERSION 0.1 / DÉMO LOCALE</span></div>
          <div className="start-copy">
            <p className="overline"><i /> ZONE DE TEST · PISTE 01</p>
            <h1>La route<br /><em>vous attend.</em></h1>
            <p className="intro-copy">Prenez le volant du prototype R-01.<br />Une piste, quatre roues, et la physique pour seule limite.</p>
            <button className="start-button" onClick={startGame}><span>PRENDRE LE VOLANT</span><b>↗</b></button>
            <p className="start-note">CLAVIER · ZQSD / WASD <span>•</span> DÉMO HORS LIGNE</p>
          </div>
          <div className="start-bottom"><span>01 — 04 ROUE MOTRICE ARRIÈRE</span><span>CONSTRUIT POUR LA ROUTE</span></div>
          <div className="start-coordinate">48°51′ N&nbsp;&nbsp; 02°21′ E<br /><small>ENVIRONNEMENT DE TEST</small></div>
        </section>
      )}

      {playing && <DrivingHUD telemetry={telemetry} paused={paused || tabHidden} onPause={pauseGame} onRespawn={respawn} />}

      {playing && (paused || tabHidden) && (
        <section className="pause-overlay" aria-label="Jeu en pause">
          <div className="pause-panel">
            <p className="overline"><i /> SESSION SUSPENDUE</p>
            <h2>{tabHidden ? 'Reprenez<br />la piste.' : 'À vous<br />de jouer.'}</h2>
            <p>La simulation est en pause.<br />Votre véhicule reste en sécurité.</p>
            <button className="start-button" onClick={resumeGame}><span>REPRENDRE</span><b>↗</b></button>
            <button className="pause-respawn" onClick={respawn}>REPOSITIONNER SUR LA PISTE</button>
          </div>
        </section>
      )}
    </main>
  );
}
