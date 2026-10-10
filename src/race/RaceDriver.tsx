import { useFrame } from '@react-three/fiber';
import { useAfterPhysicsStep, type RapierRigidBody } from '@react-three/rapier';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Group } from 'three';
import type { CircuitTrack } from '../circuits/circuitGeometry';
import { extrapolationSeconds } from '../vehicle/physics/stepClock';
import { VEHICLE_FIXED_STEP_S } from '../vehicle/physics/vehicleBody';
import { GhostRecorder, sampleGhost, type Ghost } from './ghost';
import { deltaToProfile, LapTimer, type LapTimerEvent, type LapTimerSnapshot } from './lapTimer';
import { TrackProjector } from './trackProjector';

/** Nombre de pas physiques entre deux publications vers l'interface (60 Hz / 4 = 15 Hz : assez pour un chrono lisible sans surcharger React). */
const PUBLISH_EVERY_STEPS = 4;

export interface RaceSnapshot extends LapTimerSnapshot {
  /** Écart (s) au tour de référence (meilleur tour enregistré) ; null sans référence. */
  deltaS: number | null;
  /** Abscisse (m) de la voiture le long du tour, utile au débogage et aux tests. */
  sM: number;
}

interface RaceDriverProps {
  track: CircuitTrack;
  bodyRef: React.RefObject<RapierRigidBody | null>;
  respawnVersion: number;
  /** Temps cumulé (s) aux portes du meilleur tour enregistré pour ce circuit et ce véhicule ; null sans record. */
  referenceProfileS: readonly number[] | null;
  /** Fantôme du meilleur tour enregistré, rejoué en transparence ; null sans fantôme. */
  ghost: Ghost | null;
  /** Hauteur (m) du centre du fantôme au-dessus de la piste. */
  ghostHeightM: number;
  /** Un tour valide vient d'être terminé : voici sa trace (à conserver si c'est un record). */
  onLapGhost: (ghost: Ghost) => void;
  onSnapshot: (snapshot: RaceSnapshot) => void;
  onEvent: (event: LapTimerEvent) => void;
}

/**
 * À monter dans le Canvas sur un circuit : projette la voiture sur la ligne centrale à chaque pas physique et alimente le chronomètre.
 * Ne rend rien. Le temps est celui de la simulation : en pause, il s'arrête.
 */
export function RaceDriver({ track, bodyRef, respawnVersion, referenceProfileS, ghost, ghostHeightM, onLapGhost, onSnapshot, onEvent }: RaceDriverProps) {
  const projector = useMemo(() => new TrackProjector(track.centerline, track.lengthM), [track]);
  const timer = useMemo(() => new LapTimer(track.lengthM, track.widthM), [track]);
  const hint = useRef<number | null>(null);
  const steps = useRef(0);
  const recorder = useMemo(() => new GhostRecorder(), []);
  const ghostGroup = useRef<Group>(null);
  const latest = useRef({ referenceProfileS, onSnapshot, onEvent, onLapGhost });
  useEffect(() => { latest.current = { referenceProfileS, onSnapshot, onEvent, onLapGhost }; }, [referenceProfileS, onSnapshot, onEvent, onLapGhost]);

  // Repositionner la voiture perd le tour en cours ; la projection repart d'une recherche globale.
  useLayoutEffect(() => {
    timer.reposition();
    hint.current = null;
  }, [timer, respawnVersion]);

  useAfterPhysicsStep(() => {
    const body = bodyRef.current;
    if (!body) return;
    const position = body.translation();
    const projection = projector.project(position.x, position.z, hint.current);
    hint.current = projection.index;
    const events = timer.step(VEHICLE_FIXED_STEP_S, projection.sM, projection.lateralM);
    for (const event of events) {
      if (event.type === 'lap-start') recorder.reset();
      if (event.type === 'lap' && event.valid) latest.current.onLapGhost(recorder.finish(event.lapS));
      latest.current.onEvent(event);
    }
    const lapState = timer.snapshot();
    if (lapState.started) {
      const rotation = body.rotation();
      const headingRad = Math.atan2(2 * (rotation.x * rotation.z + rotation.w * rotation.y), 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y));
      recorder.add(lapState.currentS, position.x, position.z, headingRad);
    }
    steps.current += 1;
    if (events.length > 0 || steps.current % PUBLISH_EVERY_STEPS === 0) {
      const snapshot = timer.snapshot();
      const reference = latest.current.referenceProfileS;
      const deltaS = snapshot.started && snapshot.valid && reference ? deltaToProfile(reference, snapshot.lapFraction, snapshot.currentS) : null;
      latest.current.onSnapshot({ ...snapshot, deltaS, sM: projection.sM });
    }
  });

  // Le fantôme suit le temps du tour en cours, prolongé entre deux pas physiques comme la voiture (voir stepClock).
  useFrame(() => {
    const group = ghostGroup.current;
    if (!group) return;
    const lap = timer.snapshot();
    const pose = ghost && lap.started ? sampleGhost(ghost, lap.currentS + extrapolationSeconds()) : null;
    group.visible = pose !== null;
    if (pose) {
      group.position.set(pose.xM, ghostHeightM, pose.zM);
      group.rotation.y = pose.headingRad;
    }
  });

  return (
    <group ref={ghostGroup} visible={false}>
      <mesh>
        <boxGeometry args={[1.8, 0.9, 4.1]} />
        <meshBasicMaterial color="#6fd0ff" transparent opacity={0.32} depthWrite={false} />
      </mesh>
    </group>
  );
}
