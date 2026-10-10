import { useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import type { FloatingOriginHandle } from './useFloatingOrigin';

/**
 * À monter DANS le Canvas, avec les chunks. Son `useLayoutEffect` s'exécute dans la même validation de l'arbre R3F que le
 * repositionnement des groupes de chunks (qui dépend de `renderAnchor`) : le châssis Rapier et la caméra changent alors de
 * repère en même temps qu'eux, avant le rendu suivant. La caméra est décalée du même vecteur que le monde, sans être
 * replacée : elle conserve son retard de suivi (≈ 13 m à 185 km/h), donc aucun saut visible. Voir useFloatingOrigin.ts.
 */
export function FloatingOriginApplier({ origin }: { origin: FloatingOriginHandle }) {
  const camera = useThree((state) => state.camera);
  const { renderAnchor, applyPendingRecenter } = origin;
  useLayoutEffect(() => {
    const offset = applyPendingRecenter();
    if (offset) camera.position.set(camera.position.x - offset.xM, camera.position.y - offset.yM, camera.position.z - offset.zM);
  }, [renderAnchor, applyPendingRecenter, camera]);
  return null;
}
