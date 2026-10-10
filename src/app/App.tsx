import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RapierRigidBody } from '@react-three/rapier';
import { useDrivingInput } from '../input/useDrivingInput';
import { useTouchDrivingInput } from '../input/useTouchDrivingInput';
import type { GeoAnchor } from '../geo/projection';
import type { GeoPoint, VehicleTelemetry } from '../shared/types';
import { DrivingHUD } from '../ui/DrivingHUD';
import { TouchControls } from '../ui/TouchControls';
import { LocationPicker } from './LocationPicker';
import { CarPicker } from './CarPicker';
import { CircuitPicker } from './CircuitPicker';
import { buildCircuitTrack, type CircuitTrack } from '../circuits/circuitGeometry';
import type { CircuitSource } from '../circuits/f1Circuits2026';
import { carModelUrl, findCar, loadSelectedCarId, saveSelectedCarId } from '../vehicle/catalog/carCatalog';
import { vehicleConfigFor } from '../vehicle/configs/vehicleProfiles';
import { GeoLoadingScreen, type GeoLoadingScreenState } from './GeoLoadingScreen';
import { GeoLoadError, loadRoadWorld, type LoadedRoadWorld } from './geoOrchestrator';
import type { DrivingWorld } from './DrivingScene';
import { Minimap } from '../ui/Minimap';
import { CircuitMinimap } from '../ui/CircuitMinimap';

const isTouchDevice = typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0);

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
          <h2>La scène ne démarre pas.</h2>
          <p>Le moteur physique n’a pas pu s’initialiser. Réessayez ; si le problème persiste, rechargez la page.</p>
          <button className="btn" onClick={this.props.onRetry}>Réessayer</button>
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
  positionM: { xM: 0, zM: 0 },
  headingRad: 0,
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
  const keyboardInput = useDrivingInput(playing, paused || tabHidden, gameFocus, pauseGame, respawn);
  const touchInput = useTouchDrivingInput(playing, paused || tabHidden);
  const input = isTouchDevice ? touchInput.inputRef : keyboardInput;

  // Étape 3 : choix du lieu, chargement OSM/Overpass, piste de démo toujours disponible hors ligne.
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showCarPicker, setShowCarPicker] = useState(false);
  const [showCircuitPicker, setShowCircuitPicker] = useState(false);
  const [circuitTrack, setCircuitTrack] = useState<CircuitTrack | null>(null);
  const [selectedCarId, setSelectedCarId] = useState(loadSelectedCarId);
  const selectedCar = findCar(selectedCarId);
  const vehicleConfig = useMemo(() => vehicleConfigFor(selectedCarId), [selectedCarId]);
  const chooseCar = useCallback((id: string) => { setSelectedCarId(id); saveSelectedCarId(id); }, []);
  const [useDemoTrack, setUseDemoTrack] = useState(true);
  const [roadWorld, setRoadWorld] = useState<LoadedRoadWorld | null>(null);
  const [geoScreen, setGeoScreen] = useState<GeoLoadingScreenState | null>(null);
  const [lastPlace, setLastPlace] = useState<GeoPoint | null>(null);
  // Étape 4 : ancre de rendu courante, remontée depuis DrivingScene à chaque recentrage
  // d'origine flottante — la mini-carte doit s'en servir, pas lastPlace (qui reste l'ancre
  // MONDE immuable et dérive de la position réelle après le premier recentrage).
  const [renderAnchor, setRenderAnchor] = useState<GeoAnchor | null>(null);
  const [zoneUnavailable, setZoneUnavailable] = useState(false);
  const geoAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => geoAbortRef.current?.abort(), []);

  const requestRoadWorld = useCallback((place: GeoPoint) => {
    geoAbortRef.current?.abort();
    const controller = new AbortController();
    geoAbortRef.current = controller;
    setLastPlace(place);
    setCircuitTrack(null);
    setRenderAnchor(null);
    setZoneUnavailable(false);
    setGeoScreen({ kind: 'loading' });
    loadRoadWorld(place, controller.signal).then((world) => {
      if (controller.signal.aborted) return;
      setRoadWorld(world);
      setUseDemoTrack(false);
      setGeoScreen(null);
      setShowLocationPicker(false);
      setPlaying(true);
      setPaused(false);
      requestAnimationFrame(() => gameFocus.current?.focus());
    }).catch((error) => {
      if (controller.signal.aborted) return;
      const kind = error instanceof GeoLoadError ? error.kind : 'network';
      setGeoScreen({ kind: 'error', errorKind: kind });
    });
  }, []);

  const startDemoTrack = useCallback(() => {
    geoAbortRef.current?.abort();
    setCircuitTrack(null);
    setUseDemoTrack(true);
    setRenderAnchor(null);
    setZoneUnavailable(false);
    setGeoScreen(null);
    setShowLocationPicker(false);
    setPlaying(true);
    setPaused(false);
    requestAnimationFrame(() => gameFocus.current?.focus());
  }, []);
  const startCircuit = useCallback((source: CircuitSource) => {
    geoAbortRef.current?.abort();
    const track = buildCircuitTrack(source);
    setCircuitTrack(track);
    setLastPlace(track.anchor);
    setUseDemoTrack(false);
    setRenderAnchor(null);
    setZoneUnavailable(false);
    setGeoScreen(null);
    setShowCircuitPicker(false);
    setPlaying(true);
    setPaused(false);
    requestAnimationFrame(() => gameFocus.current?.focus());
  }, []);
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
  const drivingWorld: DrivingWorld = useMemo(
    () => (circuitTrack
      ? { kind: 'circuit', track: circuitTrack }
      : !useDemoTrack && roadWorld
      ? { kind: 'roads', worldAnchor: roadWorld.worldAnchor, initialChunks: roadWorld.initialChunks, spawnPose: roadWorld.spawnPose }
      : { kind: 'demo' }),
    [useDemoTrack, roadWorld, circuitTrack],
  );

  return (
    <main
      className={isTouchDevice ? 'game-shell has-touch-controls' : 'game-shell'}
      ref={gameFocus}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.target instanceof HTMLCanvasElement) gameFocus.current?.focus();
      }}
      aria-label="Cardrive, simulateur de conduite"
    >
      {playing && (
        <SceneErrorBoundary key={sceneAttempt} onRetry={() => setSceneAttempt((value) => value + 1)}>
          <Suspense fallback={<div className="scene-loading"><span className="spinner" /> Chargement de la piste…</div>}>
            <DrivingScene
              bodyRef={vehicleBody}
              input={input}
              telemetryRef={telemetryRef}
              paused={physicsPaused}
              respawnVersion={respawnVersion}
              onTelemetry={onTelemetry}
              world={drivingWorld}
              onRenderAnchorChange={setRenderAnchor}
              onZoneUnavailable={setZoneUnavailable}
              carModelUrl={carModelUrl(selectedCar)}
              vehicle={vehicleConfig}
            />
          </Suspense>
        </SceneErrorBoundary>
      )}

      {!playing && showCircuitPicker && (
        <CircuitPicker onChoose={startCircuit} onBack={() => setShowCircuitPicker(false)} />
      )}

      {!playing && showCarPicker && (
        <CarPicker selectedId={selectedCarId} onSelect={chooseCar} onBack={() => setShowCarPicker(false)} />
      )}

      {!playing && showLocationPicker && !geoScreen && !showCarPicker && !showCircuitPicker && (
        <LocationPicker
          onChoosePlace={requestRoadWorld}
          onUseDemoTrack={startDemoTrack}
          onBack={() => setShowLocationPicker(false)}
        />
      )}

      {!playing && geoScreen && (
        <GeoLoadingScreen
          state={geoScreen}
          onRetry={() => lastPlace && requestRoadWorld(lastPlace)}
          onUseDemoTrack={startDemoTrack}
        />
      )}

      {!playing && !showLocationPicker && !geoScreen && !showCarPicker && !showCircuitPicker && (
        <section className="screen" aria-label="Menu principal">
          <div className="brand"><span className="brand-mark">C</span>Cardrive</div>
          <div className="screen-body">
            <h1>Prenez la route.</h1>
            <p className="lead">Un simulateur de conduite en 3D. Roulez sur une piste d’essai ou dans n’importe quelle ville du monde, grâce aux cartes OpenStreetMap.</p>
            <div className="menu">
              <button className="menu-row primary" onClick={startGame}>
                <div><strong>Jouer</strong><span>Piste d’essai, sans connexion</span></div><i>›</i>
              </button>
              <button className="menu-row" onClick={() => setShowLocationPicker(true)}>
                <div><strong>Lieu réel</strong><span>Rouler dans une vraie ville (bêta)</span></div><i>›</i>
              </button>
              <button className="menu-row" onClick={() => setShowCircuitPicker(true)}>
                <div><strong>Circuits F1 2026</strong><span>Les 24 tracés du calendrier</span></div><i>›</i>
              </button>
              <button className="menu-row" onClick={() => setShowCarPicker(true)}>
                <div><strong>Garage</strong><span>{selectedCar.label}</span></div><i>›</i>
              </button>
            </div>
            <p className="screen-hint"><span><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> pour conduire</span><span><kbd>Espace</kbd> frein à main</span></p>
          </div>
        </section>
      )}

      {playing && <DrivingHUD maxRpm={vehicleConfig.maximumRpm} telemetry={telemetry} paused={paused || tabHidden} onPause={pauseGame} zoneUnavailable={!useDemoTrack && zoneUnavailable} />}

      {playing && isTouchDevice && !(paused || tabHidden) && (
        <TouchControls setStick={touchInput.setStick} setHandbrake={touchInput.setHandbrake} />
      )}

      {playing && circuitTrack && (
        <div className="minimap-panel">
          <CircuitMinimap track={circuitTrack} positionM={telemetry.positionM} headingRad={telemetry.headingRad} />
        </div>
      )}

      {playing && !circuitTrack && !useDemoTrack && (renderAnchor ?? lastPlace) && (
        <div className="minimap-panel">
          <Minimap anchor={(renderAnchor ?? lastPlace)!} positionM={telemetry.positionM} headingRad={telemetry.headingRad} />
          <p className="minimap-attribution">© OpenStreetMap contributors</p>
        </div>
      )}

      {playing && !circuitTrack && !useDemoTrack && (
        <p className="osm-attribution">© contributeurs OpenStreetMap · données via Overpass API</p>
      )}

      {playing && (paused || tabHidden) && (
        <section className="pause-overlay" aria-label="Jeu en pause">
          <div className="pause-panel">
            <h2>Pause</h2>
            <p>{tabHidden ? 'La simulation a été suspendue quand vous avez quitté l’onglet.' : 'La simulation est suspendue.'}</p>
            <button className="btn" onClick={resumeGame}>Reprendre</button>
            <button className="btn-quiet" onClick={respawn}>Repositionner la voiture</button>
            <dl className="controls-list">
              <dt><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd></dt><dd>Accélérer, braquer, freiner</dd>
              <dt><kbd>Espace</kbd></dt><dd>Frein à main</dd>
              <dt><kbd>R</kbd></dt><dd>Repositionner</dd>
              <dt><kbd>T</kbd></dt><dd>Afficher les détails</dd>
              <dt><kbd>Échap</kbd></dt><dd>Pause</dd>
            </dl>
          </div>
        </section>
      )}
    </main>
  );
}
