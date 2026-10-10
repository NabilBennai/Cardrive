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
import { LapHud } from '../ui/LapHud';
import { RaceHud, RaceResults } from '../ui/RaceHud';
import { WeatherControls } from '../ui/WeatherControls';
import { loadWeather, saveWeather, type WeatherSettings } from '../world/weather/weatherModel';
import type { RaceState } from '../race/RaceDirector';
import { buildRaceField, loadRaceSetup, saveRaceSetup, type RaceField, type RaceSetup } from '../race/raceSetup';
import { useRaceSession } from '../race/useRaceSession';
import { PerfOverlay } from '../debug/PerfOverlay';
import { AudioSettingsPanel } from '../audio/AudioSettingsPanel';
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from '../audio/audioSettings';
import { getGameAudio } from '../audio/GameAudio';
import { loadAssists, saveAssists, TRACTION_LABELS, TRANSMISSION_LABELS, type AssistSettings } from '../vehicle/assists';
import type { TractionControl, Transmission } from '../vehicle/physics/VehicleSimulation';

/** Crochet de test : `?autopilot` fait conduire la voiture du joueur par le pilote automatique (circuits uniquement). */
const autopilotRequested = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('autopilot');

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
  const [showPerf, setShowPerf] = useState(false);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(loadAudioSettings);
  const updateAudioSettings = useCallback((patch: Partial<AudioSettings>) => {
    setAudioSettings((current) => {
      const next = { ...current, ...patch };
      saveAudioSettings(next);
      return next;
    });
  }, []);
  const [assists, setAssists] = useState<AssistSettings>(loadAssists);
  const chooseTractionControl = useCallback((tractionControl: TractionControl) => {
    setAssists((current) => {
      const next = { ...current, tractionControl };
      saveAssists(next);
      return next;
    });
  }, []);
  const chooseTransmission = useCallback((transmission: Transmission) => {
    setAssists((current) => {
      const next = { ...current, transmission };
      saveAssists(next);
      return next;
    });
  }, []);
  const [weather, setWeather] = useState<WeatherSettings>(loadWeather);
  const chooseWeather = useCallback((next: WeatherSettings) => { setWeather(next); saveWeather(next); }, []);
  /** Humidité de la piste (0..1), remontée par la scène : sert au message « piste mouillée ». */
  const [wetness, setWetness] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const chooseWear = useCallback((wearAndFuel: boolean) => {
    setAssists((current) => {
      const next = { ...current, wearAndFuel };
      saveAssists(next);
      return next;
    });
  }, []);
  const chooseDamage = useCallback((damage: boolean) => {
    setAssists((current) => {
      const next = { ...current, damage };
      saveAssists(next);
      return next;
    });
  }, []);
  const [repairVersion, setRepairVersion] = useState(0);
  const [serviceVersion, setServiceVersion] = useState(0);
  const [showCarPicker, setShowCarPicker] = useState(false);
  const [showCircuitPicker, setShowCircuitPicker] = useState(false);
  const [circuitTrack, setCircuitTrack] = useState<CircuitTrack | null>(null);
  const [raceSetup, setRaceSetup] = useState<RaceSetup>(loadRaceSetup);
  const chooseRaceSetup = useCallback((next: RaceSetup) => { setRaceSetup(next); saveRaceSetup(next); }, []);
  // Course : grille et adversaires de la partie en cours (null en contre-la-montre), état du chef de course, numéro de manche (remonte la scène).
  const [raceField, setRaceField] = useState<RaceField | null>(null);
  const [raceState, setRaceState] = useState<RaceState | null>(null);
  const [raceRun, setRaceRun] = useState(0);
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
    setRaceField(null);
    setRaceState(null);
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
    setRaceField(null);
    setRaceState(null);
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
    setRaceField(raceSetup.mode === 'race' ? buildRaceField(raceSetup, track) : null);
    setRaceState(null);
    setRaceRun((value) => value + 1);
    setRespawnVersion(0);
    setLastPlace(track.anchor);
    setUseDemoTrack(false);
    setRenderAnchor(null);
    setZoneUnavailable(false);
    setGeoScreen(null);
    setShowCircuitPicker(false);
    setPlaying(true);
    setPaused(false);
    requestAnimationFrame(() => gameFocus.current?.focus());
  }, [raceSetup]);
  const onTelemetry = useCallback((next: VehicleTelemetry) => {
    telemetryRef.current = next;
    setTelemetry(next);
  }, []);
  const startGame = useCallback(() => {
    setCircuitTrack(null);
    setRaceField(null);
    setRaceState(null);
    setUseDemoTrack(true);
    setPlaying(true);
    setPaused(false);
    requestAnimationFrame(() => gameFocus.current?.focus());
  }, []);
  /** Retour au menu principal depuis une partie (la scène est démontée, tout l'état de partie est remis à zéro). */
  const quitToMenu = useCallback(() => {
    setPlaying(false);
    setPaused(false);
    setCircuitTrack(null);
    setRaceField(null);
    setRaceState(null);
    setUseDemoTrack(true);
    setRespawnVersion(0);
  }, []);
  /** Nouvelle manche sur le même circuit, mêmes réglages : la scène est remontée pour repartir de la grille. */
  const replayRace = useCallback(() => {
    setRaceState(null);
    setRespawnVersion(0);
    setRaceRun((value) => value + 1);
    setPaused(false);
    requestAnimationFrame(() => gameFocus.current?.focus());
  }, []);
  const resumeGame = useCallback(() => {
    setPaused(false);
    requestAnimationFrame(() => gameFocus.current?.focus());
  }, []);

  // Le son ne peut démarrer qu'après un geste de l'utilisateur : on se branche sur le tout premier, quel qu'il soit.
  useEffect(() => { getGameAudio().unlockOnFirstGesture(); }, []);
  useEffect(() => { getGameAudio().setSettings(audioSettings); }, [audioSettings]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'KeyM' && !event.repeat && !(event.target instanceof HTMLInputElement)) setAudioSettings((current) => {
        const next = { ...current, muted: !current.muted };
        saveAudioSettings(next);
        return next;
      });
      if (event.code === 'F3' && !event.repeat) { event.preventDefault(); setShowPerf((value) => !value); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onVisibility = () => setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const raceSession = useRaceSession(circuitTrack?.id ?? null, selectedCarId);
  const raceProps = useMemo(
    () => (circuitTrack ? { referenceProfileS: raceSession.referenceProfileS, ghost: raceSession.ghost, onLapGhost: raceSession.onLapGhost, onSnapshot: raceSession.onSnapshot, onEvent: raceSession.onEvent } : undefined),
    [circuitTrack, raceSession.referenceProfileS, raceSession.ghost, raceSession.onLapGhost, raceSession.onSnapshot, raceSession.onEvent],
  );

  const fieldProps = useMemo(
    () => (raceField ? { laps: raceField.laps, opponents: raceField.opponents, playerSlot: raceField.playerSlot, opponentModelUrl: carModelUrl(selectedCar), onState: setRaceState } : undefined),
    [raceField, selectedCar],
  );

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
        <SceneErrorBoundary key={`${sceneAttempt}:${raceRun}`} onRetry={() => setSceneAttempt((value) => value + 1)}>
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
              carId={selectedCarId === 'prototype' ? null : selectedCarId}
              cameraEffects={audioSettings.cameraEffects}
              race={raceProps}
              field={fieldProps}
              autopilot={autopilotRequested}
              tractionControl={assists.tractionControl}
              transmission={isTouchDevice ? 'auto' : assists.transmission}
              wearEnabled={assists.wearAndFuel}
              serviceVersion={serviceVersion}
              damageEnabled={assists.damage}
              repairVersion={repairVersion}
              weather={weather}
              onWetnessChange={setWetness}
              onFlippedChange={setFlipped}
              onAutoRecover={respawn}
            />
          </Suspense>
        </SceneErrorBoundary>
      )}

      {!playing && showCircuitPicker && (
        <CircuitPicker onChoose={startCircuit} onBack={() => setShowCircuitPicker(false)} records={raceSession.records} carId={selectedCarId} setup={raceSetup} onSetupChange={chooseRaceSetup} weather={weather} onWeatherChange={chooseWeather} />
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

      {playing && <PerfOverlay visible={showPerf} />}

      {playing && <DrivingHUD maxRpm={vehicleConfig.maximumRpm} tireOptimalC={vehicleConfig.tireOptimalTemperatureC} telemetry={telemetry} paused={paused || tabHidden} onPause={pauseGame} zoneUnavailable={!useDemoTrack && zoneUnavailable} />}

      {playing && isTouchDevice && !(paused || tabHidden) && (
        <TouchControls setStick={touchInput.setStick} setHandbrake={touchInput.setHandbrake} />
      )}

      {playing && wetness > 0.3 && <p className="limit-pill wet-pill" role="status">{wetness > 0.75 ? 'Piste détrempée · risque d’aquaplanage' : 'Piste mouillée'}</p>}
      {playing && flipped && <p className="limit-pill flip-pill" role="status">Voiture retournée · appuyez sur R pour la remettre sur ses roues{raceField ? ' (remise en piste automatique)' : ''}</p>}
      {playing && circuitTrack && <LapHud state={raceSession.hud} notice={raceSession.notice} />}
      {playing && circuitTrack && raceField && <RaceHud state={raceState} />}
      {playing && raceField && raceState?.playerFinished && <RaceResults state={raceState} onReplay={replayRace} onQuit={quitToMenu} />}

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
            <button className="btn-quiet" onClick={quitToMenu}>Quitter vers le menu</button>
            <fieldset className="settings-group">
              <legend>Conditions et aides à la conduite</legend>
              <WeatherControls weather={weather} onChange={chooseWeather} />
              {!isTouchDevice && (
                <div className="setup-row">
                  <span>Boîte de vitesses</span>
                  <div className="segmented" role="group" aria-label="Boîte de vitesses">
                    {(Object.keys(TRANSMISSION_LABELS) as Transmission[]).map((mode) => (
                      <button key={mode} aria-pressed={assists.transmission === mode} onClick={() => chooseTransmission(mode)}>{TRANSMISSION_LABELS[mode]}</button>
                    ))}
                  </div>
                </div>
              )}
              <div className="setup-row">
                <span>Contrôle de traction</span>
                <div className="segmented" role="group" aria-label="Contrôle de traction">
                  {(Object.keys(TRACTION_LABELS) as TractionControl[]).map((level) => (
                    <button key={level} aria-pressed={assists.tractionControl === level} onClick={() => chooseTractionControl(level)}>{TRACTION_LABELS[level]}</button>
                  ))}
                </div>
              </div>
              <div className="setup-row">
                <span>Usure et carburant</span>
                <div className="segmented" role="group" aria-label="Usure et carburant">
                  <button aria-pressed={!assists.wearAndFuel} onClick={() => chooseWear(false)}>Désactivés</button>
                  <button aria-pressed={assists.wearAndFuel} onClick={() => chooseWear(true)}>Activés</button>
                </div>
              </div>
              <div className="setup-row">
                <span>Dégâts</span>
                <div className="segmented" role="group" aria-label="Dégâts">
                  <button aria-pressed={!assists.damage} onClick={() => chooseDamage(false)}>Désactivés</button>
                  <button aria-pressed={assists.damage} onClick={() => chooseDamage(true)}>Activés</button>
                </div>
              </div>
              {assists.damage && <button className="btn-quiet" onClick={() => { setRepairVersion((value) => value + 1); resumeGame(); }}>Réparer la voiture</button>}
              {assists.wearAndFuel && <button className="btn-quiet" onClick={() => { setServiceVersion((value) => value + 1); resumeGame(); }}>Pneus neufs et plein</button>}
            </fieldset>
            <AudioSettingsPanel settings={audioSettings} onChange={updateAudioSettings} />
            <dl className="controls-list">
              <dt><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd></dt><dd>Accélérer, braquer, freiner</dd>
              <dt><kbd>Espace</kbd></dt><dd>Frein à main</dd>
              <dt><kbd>R</kbd></dt><dd>Repositionner</dd>
              <dt><kbd>T</kbd></dt><dd>Afficher les détails</dd>
              <dt><kbd>E</kbd><kbd>C</kbd></dt><dd>Rapport supérieur / inférieur (boîte manuelle)</dd>
              <dt><kbd>M</kbd></dt><dd>Couper ou rétablir le son</dd>
              <dt><kbd>Échap</kbd></dt><dd>Pause</dd>
            </dl>
          </div>
        </section>
      )}
    </main>
  );
}
