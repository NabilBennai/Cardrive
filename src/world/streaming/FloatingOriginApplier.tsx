import { useLayoutEffect } from 'react';
import { originShiftChannel } from '../../feel/feelBus';
import type { FloatingOriginHandle } from './useFloatingOrigin';

/**
 * À monter DANS le Canvas, avec les chunks. Son `useLayoutEffect` s'exécute dans la même validation de l'arbre R3F que le
 * repositionnement des groupes de chunks (qui dépend de `renderAnchor`) : le châssis Rapier change alors de repère en même
 * temps qu'eux, avant le rendu suivant. Le décalage est ensuite publié : la caméra de poursuite, les particules et les traces
 * de pneus se déplacent du même vecteur (ils ne sont rattachés à aucun chunk). Voir useFloatingOrigin.ts.
 */
export function FloatingOriginApplier({ origin }: { origin: FloatingOriginHandle }) {
  const { renderAnchor, applyPendingRecenter } = origin;
  useLayoutEffect(() => {
    const offset = applyPendingRecenter();
    if (offset) originShiftChannel.emit({ dx: offset.xM, dy: offset.yM, dz: offset.zM });
  }, [renderAnchor, applyPendingRecenter]);
  return null;
}
