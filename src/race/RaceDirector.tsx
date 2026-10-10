import { useAfterPhysicsStep, type RapierRigidBody } from '@react-three/rapier';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { CircuitTrack } from '../circuits/circuitGeometry';
import { VEHICLE_FIXED_STEP_S, headingToQuaternion, vehicleSpawnHeightM } from '../vehicle/physics/vehicleBody';
import type { VehicleSpawnPose } from '../vehicle/rendering/GenericCar';
import type { VehicleConfig } from '../shared/types';
import { uprightness } from './bodyPose';
import { RaceTracker, type Standing } from './raceModel';
import { centerlinePoseAt } from './trackPose';
import { TrackProjector } from './trackProjector';

export const PLAYER_ID = 'player';
const PUBLISH_EVERY_STEPS = 6;
/** Distance (m) derrière la voiture à laquelle on la remet en piste après `R` : assez pour sortir d'un mur, sans perdre de terrain. */
const RESPAWN_BEHIND_M = 8;
const SAFE_UPRIGHT = 0.8;

export interface RaceState {
  phase: 'countdown' | 'racing';
  lightsOn: number;
  raceTimeS: number;
  totalLaps: number;
  standings: Standing[];
  /** Rang du joueur (1 = en tête) et nombre de voitures. */
  playerPosition: number;
  carCount: number;
  /** Tour en cours du joueur (1..totalLaps) et nombre de tours terminés. */
  playerLap: number;
  playerFinished: boolean;
  playerFalseStart: boolean;
}

interface RaceDirectorProps {
  track: CircuitTrack;
  totalLaps: number;
  config: VehicleConfig;
  playerBodyRef: React.RefObject<RapierRigidBody | null>;
  /** Voitures adverses : identifiant et corps rigide. */
  opponents: ReadonlyArray<{ id: string; bodyRef: React.RefObject<RapierRigidBody | null> }>;
  /** Passé à vrai quand les feux s'éteignent : les adversaires démarrent. */
  goRef: React.RefObject<{ go: boolean }>;
  /** Pose de remise en piste du joueur (touche R), tenue à jour tant qu'il roule normalement. */
  respawnPoseRef: React.RefObject<VehicleSpawnPose | null>;
  onState: (state: RaceState) => void;
}

/** Écrit la pose de remise en piste (fonction externe : référence partagée avec la voiture). */
function setRespawnPose(target: React.RefObject<VehicleSpawnPose | null>, pose: VehicleSpawnPose): void {
  target.current = pose;
}

/**
 * Chef de course, à monter dans le Canvas : feux de départ, comptage des tours et classement de toutes les voitures (joueur compris)
 * à chaque pas physique, faux départ, arrivée. Il publie l'état vers l'interface à ~10 Hz et à chaque événement.
 */
export function RaceDirector({ track, totalLaps, config, playerBodyRef, opponents, goRef, respawnPoseRef, onState }: RaceDirectorProps) {
  const tracker = useMemo(() => {
    const created = new RaceTracker(track.lengthM, totalLaps);
    created.addCar(PLAYER_ID);
    return created;
  }, [track, totalLaps]);
  useLayoutEffect(() => { opponents.forEach((opponent) => tracker.addCar(opponent.id)); }, [tracker, opponents]);
  const hints = useRef(new Map<string, number | null>());
  const steps = useRef(0);
  const lastPhase = useRef<'countdown' | 'racing'>('countdown');
  const lastFinished = useRef(false);
  const latest = useRef(onState);
  useEffect(() => { latest.current = onState; }, [onState]);
  const projector = useMemo(() => new TrackProjector(track.centerline, track.lengthM), [track]);

  useAfterPhysicsStep(() => {
    tracker.tick(VEHICLE_FIXED_STEP_S);
    const cars = [{ id: PLAYER_ID, bodyRef: playerBodyRef }, ...opponents];
    for (const car of cars) {
      const body = car.bodyRef.current;
      if (!body) continue;
      const position = body.translation();
      const projection = projector.project(position.x, position.z, hints.current.get(car.id) ?? null);
      hints.current.set(car.id, projection.index);
      tracker.update(car.id, projection.sM, position.x, position.z);
      if (car.id === PLAYER_ID) {
        // Point de reprise : tenu à jour tant que le joueur est à plat et sur la piste (un mur ou un tonneau ne doivent pas le fixer).
        if (uprightness(body.rotation()) > SAFE_UPRIGHT && Math.abs(projection.lateralM) < track.widthM / 2) {
          const pose = centerlinePoseAt(track, projection.sM - RESPAWN_BEHIND_M);
          setRespawnPose(respawnPoseRef, {
            position: { x: pose.xM, y: vehicleSpawnHeightM(config), z: pose.zM },
            rotation: headingToQuaternion(pose.headingRad),
          });
        }
      }
    }
    if (tracker.currentPhase === 'racing' && !goRef.current.go) setGo(goRef);

    steps.current += 1;
    const player = tracker.progressOf(PLAYER_ID);
    const finished = player?.finishS != null;
    const phaseChanged = lastPhase.current !== tracker.currentPhase;
    const finishChanged = lastFinished.current !== finished;
    lastPhase.current = tracker.currentPhase;
    lastFinished.current = finished;
    if (phaseChanged || finishChanged || steps.current % PUBLISH_EVERY_STEPS === 0) {
      const standings = tracker.standings();
      const me = standings.find((standing) => standing.id === PLAYER_ID);
      latest.current({
        phase: tracker.currentPhase,
        lightsOn: tracker.lightsOn,
        raceTimeS: tracker.raceTimeS,
        totalLaps,
        standings,
        playerPosition: me?.position ?? 1,
        carCount: standings.length,
        playerLap: Math.min(totalLaps, (player?.lapsCompleted ?? 0) + 1),
        playerFinished: finished,
        playerFalseStart: player?.falseStart ?? false,
      });
    }
  });

  return null;
}

function setGo(ref: React.RefObject<{ go: boolean }>): void {
  ref.current.go = true;
}
