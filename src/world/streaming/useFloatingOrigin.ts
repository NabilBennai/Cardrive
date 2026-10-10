import type { RapierRigidBody } from '@react-three/rapier';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { perfStats } from '../../debug/perfStats.ts';
import { computeRecenterOffset, shouldRecenter } from '../../geo/floatingOrigin.ts';
import type { GeoAnchor } from '../../geo/projection.ts';
import { translateVehicleBody } from '../../vehicle/physics/vehicleBody.ts';
import type { VehicleTelemetry } from '../../shared/types.ts';

export interface FloatingOriginHandle {
  /** Ancre de rendu courante : tous les objets Three.js/Rapier sont positionnés par rapport à elle. Change à chaque recentrage. */
  renderAnchor: GeoAnchor;
  /** Compteur indépendant de respawnVersion, incrémenté à chaque recentrage — voir DrivingScene.tsx (composé avec respawnVersion pour ChaseCamera.snapVersion). */
  cameraSnapVersion: number;
  /** À appeler depuis useBeforePhysicsStep (voir GenericCar.onAfterPhysicsStep/useVehiclePhysics.onAfterStep) : vérifie et applique le recentrage à la frontière du pas physique, comme demandé par la doc §6. */
  onAfterPhysicsStep: (telemetry: VehicleTelemetry, body: RapierRigidBody) => void;
}

/**
 * Active l'origine flottante écrite et testée depuis l'étape 3 (src/geo/floatingOrigin.ts) mais
 * jamais branchée jusqu'ici. Indépendant du streaming de chunks (useChunkStreamer.ts lit
 * `renderAnchor` mais cette fonction ne connaît rien des chunks) — séparation des
 * responsabilités, chacune révisable isolément.
 *
 * Risque connu, non résolu, non vérifiable cette session (pas d'outil navigateur) :
 * @react-three/rapier (^2.2.0) n'expose aucune API documentée pour réinitialiser son tampon
 * d'interpolation lors d'une téléportation de corps. Faire le décalage à la frontière d'un pas
 * physique et préserver la vitesse (translateVehicleBody, contrairement à resetVehicleBody) est
 * la meilleure pratique disponible, mais un bref scintillement visuel au moment exact du
 * recentrage (environ une fois par km parcouru) reste possible.
 */
export function useFloatingOrigin(worldAnchor: GeoAnchor): FloatingOriginHandle {
  const [renderAnchor, setRenderAnchor] = useState<GeoAnchor>(worldAnchor);
  const [cameraSnapVersion, setCameraSnapVersion] = useState(0);
  const renderAnchorRef = useRef(renderAnchor);
  useLayoutEffect(() => { renderAnchorRef.current = renderAnchor; }, [renderAnchor]);

  const onAfterPhysicsStep = useCallback((telemetry: VehicleTelemetry, body: RapierRigidBody) => {
    const localPosition = { xM: telemetry.positionM.xM, yM: 0, zM: telemetry.positionM.zM };
    if (!shouldRecenter(localPosition)) return;
    const { nextAnchor, offsetLocal } = computeRecenterOffset(renderAnchorRef.current, localPosition);
    translateVehicleBody(body, offsetLocal);
    renderAnchorRef.current = nextAnchor;
    setRenderAnchor(nextAnchor);
    setCameraSnapVersion((value) => value + 1);
    perfStats.world.recenters += 1;
  }, []);

  return { renderAnchor, cameraSnapVersion, onAfterPhysicsStep };
}
