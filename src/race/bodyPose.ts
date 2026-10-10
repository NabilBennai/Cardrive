/** Cap (rad, convention atan2(forward.x, forward.z)) d'un quaternion de corps rigide dont l'avant est +Z. */
export function headingOfRotation(r: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (r.x * r.z + r.w * r.y), 1 - 2 * (r.x * r.x + r.y * r.y));
}

/** Composante verticale de l'axe haut du véhicule : 1 à plat, 0 sur le flanc, négatif retourné. */
export function uprightness(r: { x: number; y: number; z: number; w: number }): number {
  return 1 - 2 * (r.x * r.x + r.z * r.z);
}
