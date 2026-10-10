import type { CircuitTrack } from '../circuits/circuitGeometry.ts';
import { normalOf, tangentAt } from '../circuits/circuitGeometry.ts';

export interface TrackPose {
  xM: number;
  zM: number;
  /** Cap, convention atan2(forward.x, forward.z). */
  headingRad: number;
}

/**
 * Pose sur la ligne centrale à l'abscisse sM (m, modulo la longueur du tour), décalée de lateralM selon la normale de piste
 * (même signe que TrackProjector.lateralM). Sert à la grille de départ et à la remise en piste.
 */
export function centerlinePoseAt(track: CircuitTrack, sM: number, lateralM = 0): TrackPose {
  const points = track.centerline;
  const n = points.length;
  const spacingM = track.lengthM / n;
  const position = (((sM / spacingM) % n) + n) % n;
  const lower = Math.floor(position);
  const t = position - lower;
  const a = points[lower];
  const b = points[(lower + 1) % n];
  const tangent = tangentAt(points, lower);
  const normal = normalOf(tangent);
  return {
    xM: a.xM + (b.xM - a.xM) * t + normal.xM * lateralM,
    zM: a.zM + (b.zM - a.zM) * t + normal.zM * lateralM,
    headingRad: Math.atan2(tangent.xM, tangent.zM),
  };
}
