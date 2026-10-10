import type { BodyDamage } from '../physics/damageModel.ts';

/** Emprise de la carrosserie dans le repère du véhicule (x gauche, y haut, z avant). */
export interface CrumpleBounds {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

export interface Point3 { x: number; y: number; z: number }

/** Profondeur de la zone froissée, en fraction de la longueur (avant, arrière) ou de la largeur (côtés). */
const END_DEPTH_FRACTION = 0.3;
const SIDE_DEPTH_FRACTION = 0.3;

const smoothstep = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
/** Bruit déterministe par position : le froissement est irrégulier mais identique d'une image à l'autre. */
const hash = (x: number, y: number, z: number, salt: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + salt * 4.1414) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * Position d'un sommet après froissement : les sommets proches de la zone endommagée (avant, arrière, gauche, droite) sont repoussés
 * vers l'intérieur de la carrosserie, avec une irrégularité par position ; les autres ne bougent pas. Sans dégâts, la fonction est
 * l'identité. Le collider reste un pavé : seul l'aspect change.
 */
export function crumplePoint(p: Point3, damage: BodyDamage, bounds: CrumpleBounds): Point3 {
  const length = bounds.maxZ - bounds.minZ;
  const width = bounds.maxX - bounds.minX;
  const height = Math.max(1e-6, bounds.maxY - bounds.minY);
  const depthZ = END_DEPTH_FRACTION * length;
  const depthX = SIDE_DEPTH_FRACTION * width;
  const heightShare = (p.y - bounds.minY) / height;
  let { x, y, z } = p;
  const n1 = 0.55 + 0.45 * hash(p.x, p.y, p.z, 1);
  const n2 = hash(p.x, p.y, p.z, 2);
  const n3 = hash(p.x, p.y, p.z, 3) - 0.5;

  if (damage.front > 0) {
    const t = smoothstep((p.z - (bounds.maxZ - depthZ)) / depthZ);
    z -= damage.front * 0.5 * depthZ * t * n1;
    y -= damage.front * 0.15 * depthZ * t * n2 * heightShare;
    x += damage.front * 0.18 * depthZ * t * n3;
  }
  if (damage.rear > 0) {
    const t = smoothstep(((bounds.minZ + depthZ) - p.z) / depthZ);
    z += damage.rear * 0.5 * depthZ * t * n1;
    y -= damage.rear * 0.15 * depthZ * t * n2 * heightShare;
    x += damage.rear * 0.18 * depthZ * t * n3;
  }
  if (damage.left > 0) {
    const t = smoothstep((p.x - (bounds.maxX - depthX)) / depthX);
    x -= damage.left * 0.4 * depthX * t * n1;
    z += damage.left * 0.12 * depthX * t * n3;
  }
  if (damage.right > 0) {
    const t = smoothstep(((bounds.minX + depthX) - p.x) / depthX);
    x += damage.right * 0.4 * depthX * t * n1;
    z += damage.right * 0.12 * depthX * t * n3;
  }
  return { x, y, z };
}

/** Vrai si une zone au moins est abîmée. */
export const hasBodyDamage = (damage: BodyDamage): boolean => damage.front > 0 || damage.rear > 0 || damage.left > 0 || damage.right > 0;
