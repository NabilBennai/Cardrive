import type { RapierRigidBody } from '@react-three/rapier';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { perfStats } from '../../debug/perfStats.ts';
import { computeRecenterOffset, shouldRecenter } from '../../geo/floatingOrigin.ts';
import type { GeoAnchor } from '../../geo/projection.ts';
import { translateVehicleBody } from '../../vehicle/physics/vehicleBody.ts';
import type { LocalPoint, VehicleTelemetry } from '../../shared/types.ts';

export interface FloatingOriginHandle {
  /** Ancre de rendu courante : tous les objets Three.js/Rapier sont positionnés par rapport à elle. Change à chaque recentrage. */
  renderAnchor: GeoAnchor;
  /** À appeler à chaque pas physique (voir GenericCar.onAfterPhysicsStep / useVehiclePhysics.onAfterStep) : DÉCIDE un recentrage, sans l'appliquer. */
  onAfterPhysicsStep: (telemetry: VehicleTelemetry, body: RapierRigidBody) => void;
  /**
   * Applique le recentrage décidé : déplace le châssis Rapier et renvoie le décalage appliqué (à soustraire aussi de la
   * caméra), ou null s'il n'y avait rien à faire. À appeler depuis un `useLayoutEffect` du MÊME arbre R3F que les chunks
   * (voir FloatingOriginApplier), de sorte que châssis, chunks et caméra changent de repère dans la même validation.
   */
  applyPendingRecenter: () => LocalPoint | null;
}

interface PendingRecenter {
  nextAnchor: GeoAnchor;
  offsetLocal: LocalPoint;
  body: RapierRigidBody;
}

/**
 * Origine flottante (doc §6) : quand le véhicule s'éloigne de plus de ~1 km de l'origine de rendu, celle-ci est ramenée
 * sur lui pour garder la précision des flottants. Indépendant du streaming de chunks (useChunkStreamer.ts lit
 * `renderAnchor` mais cette fonction ne connaît rien des chunks).
 *
 * Le recentrage se fait en deux temps, pour être atomique à l'écran :
 *   1. `onAfterPhysicsStep` (dans le pas physique) constate le dépassement et PLANIFIE : nouvelle ancre et décalage, en un
 *      seul lot d'états React ;
 *   2. `applyPendingRecenter`, appelé dans la validation qui déplace les groupes de chunks, translate alors le châssis
 *      (vitesse conservée, voir translateVehicleBody) et corrige la télémétrie ; FloatingOriginApplier décale la caméra du
 *      même vecteur (elle garde son retard naturel sur la voiture : la replacer à sa position idéale la ferait « sauter »).
 * Avant ce découpage, le châssis était déplacé immédiatement dans le pas physique alors que chunks et caméra attendaient
 * le rendu suivant, et l'interpolation de Rapier faisait glisser la voiture de l'ancien au nouveau repère : un saut de
 * plusieurs centaines de mètres du vecteur voiture→caméra sur une ou deux images, mesuré par le panneau de performance
 * (F3). Cette interpolation est désormais remplacée par l'extrapolation de GenericCar, qui ne garde aucun état passé.
 */
export function useFloatingOrigin(worldAnchor: GeoAnchor, telemetryRef?: React.RefObject<VehicleTelemetry>): FloatingOriginHandle {
  const [renderAnchor, setRenderAnchor] = useState<GeoAnchor>(worldAnchor);
  const renderAnchorRef = useRef(renderAnchor);
  const pendingRef = useRef<PendingRecenter | null>(null);
  useLayoutEffect(() => { renderAnchorRef.current = renderAnchor; }, [renderAnchor]);

  const onAfterPhysicsStep = useCallback((telemetry: VehicleTelemetry, body: RapierRigidBody) => {
    if (pendingRef.current) return;
    const localPosition = { xM: telemetry.positionM.xM, yM: 0, zM: telemetry.positionM.zM };
    if (!shouldRecenter(localPosition)) return;
    const { nextAnchor, offsetLocal } = computeRecenterOffset(renderAnchorRef.current, localPosition);
    pendingRef.current = { nextAnchor, offsetLocal, body };
    setRenderAnchor(nextAnchor);
  }, []);

  const applyPendingRecenter = useCallback((): LocalPoint | null => {
    const pending = pendingRef.current;
    if (!pending) return null;
    pendingRef.current = null;
    translateVehicleBody(pending.body, pending.offsetLocal);
    renderAnchorRef.current = pending.nextAnchor;
    // La télémétrie du dernier pas est encore dans l'ancien repère : on la recale pour que le streaming et la mini-carte
    // lisent une position cohérente avec la nouvelle ancre jusqu'au prochain pas physique.
    const telemetry = telemetryRef?.current;
    if (telemetry && telemetryRef) {
      telemetryRef.current = { ...telemetry, positionM: { xM: telemetry.positionM.xM - pending.offsetLocal.xM, zM: telemetry.positionM.zM - pending.offsetLocal.zM } };
    }
    perfStats.world.recenters += 1;
    return pending.offsetLocal;
  }, [telemetryRef]);

  return { renderAnchor, onAfterPhysicsStep, applyPendingRecenter };
}
