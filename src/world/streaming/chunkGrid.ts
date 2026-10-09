import type { GeoAnchor } from '../../geo/projection.ts';
import { projectToLocal, unprojectFromLocal } from '../../geo/projection.ts';
import type { GeoBounds } from '../../map/geoProvider.ts';
import type { ChunkKey, GeoPoint, LocalPoint } from '../../shared/types.ts';

/** Doc §8 : « chunks de 256 m, voisinage physique 3×3, rendu 5×5 ». */
export const CHUNK_SIZE_M = 256;
export const PHYSICS_RADIUS_CHUNKS = 1;
export const RENDER_RADIUS_CHUNKS = 2;
/** Marge ajoutée à la bbox de requête d'un chunk (doc §7 étape 1 : « zone bornée avec marge »), pour que les voies qui longent une frontière de tuile soient bien incluses. */
export const CHUNK_FETCH_MARGIN_M = 24;

/**
 * Clé de chunk pour une position locale déjà projetée par rapport à l'ancre MONDE (stable,
 * jamais l'ancre de rendu flottante — doc §6 : « Les clés de chunks... restent stables »).
 * Math.floor arrondit vers -∞ (pas vers 0), ce qui est le comportement correct pour une
 * grille centrée sur l'origine couvrant des coordonnées négatives.
 */
export function chunkKeyAt(worldLocal: LocalPoint, chunkSizeM: number = CHUNK_SIZE_M): ChunkKey {
  return {
    x: Math.floor(worldLocal.xM / chunkSizeM),
    z: Math.floor(worldLocal.zM / chunkSizeM),
  };
}

export function chunkKeyToString(key: ChunkKey): string {
  return `${key.x},${key.z}`;
}

/** Point géographique au centre de la tuile d'un chunk, dérivé une fois de l'ancre monde (stable pour toute la session). */
export function chunkCenterGeoPoint(key: ChunkKey, worldAnchor: GeoAnchor, chunkSizeM: number = CHUNK_SIZE_M): GeoPoint {
  const centerLocal: LocalPoint = {
    xM: (key.x + 0.5) * chunkSizeM,
    yM: 0,
    zM: (key.z + 0.5) * chunkSizeM,
  };
  return unprojectFromLocal(centerLocal, worldAnchor);
}

/** Rectangle géographique de la tuile d'un chunk, élargi d'une marge (doc §7 étape 1 : « zone bornée avec marge »). */
export function chunkBoundsGeo(key: ChunkKey, worldAnchor: GeoAnchor, marginM: number, chunkSizeM: number = CHUNK_SIZE_M): GeoBounds {
  const minLocal: LocalPoint = { xM: key.x * chunkSizeM - marginM, yM: 0, zM: key.z * chunkSizeM - marginM };
  const maxLocal: LocalPoint = { xM: (key.x + 1) * chunkSizeM + marginM, yM: 0, zM: (key.z + 1) * chunkSizeM + marginM };
  const corner1 = unprojectFromLocal(minLocal, worldAnchor);
  const corner2 = unprojectFromLocal(maxLocal, worldAnchor);
  return {
    south: Math.min(corner1.latitudeDeg, corner2.latitudeDeg),
    north: Math.max(corner1.latitudeDeg, corner2.latitudeDeg),
    west: Math.min(corner1.longitudeDeg, corner2.longitudeDeg),
    east: Math.max(corner1.longitudeDeg, corner2.longitudeDeg),
  };
}

/** Les clés d'un carré de (2×radiusChunks+1) de côté centré sur `center`. */
export function neighborhood(center: ChunkKey, radiusChunks: number): ChunkKey[] {
  const keys: ChunkKey[] = [];
  for (let dz = -radiusChunks; dz <= radiusChunks; dz += 1) {
    for (let dx = -radiusChunks; dx <= radiusChunks; dx += 1) {
      keys.push({ x: center.x + dx, z: center.z + dz });
    }
  }
  return keys;
}

/** Enveloppe géographique englobant plusieurs rectangles (fusion de requêtes, doc §8 : « fusionner les zones voisines »). */
export function unionBoundsGeo(bounds: GeoBounds[]): GeoBounds {
  if (bounds.length === 0) throw new Error('unionBoundsGeo requiert au moins un rectangle.');
  let south = Infinity; let north = -Infinity; let west = Infinity; let east = -Infinity;
  for (const b of bounds) {
    south = Math.min(south, b.south); north = Math.max(north, b.north);
    west = Math.min(west, b.west); east = Math.max(east, b.east);
  }
  return { south, north, west, east };
}

/** Clé de chunk d'un point géographique, par rapport à l'ancre monde. */
export function chunkKeyForGeoPoint(point: GeoPoint, worldAnchor: GeoAnchor, chunkSizeM: number = CHUNK_SIZE_M): ChunkKey {
  return chunkKeyAt(projectToLocal(point, worldAnchor), chunkSizeM);
}

/**
 * Position locale (par rapport à `renderAnchor`) du centre d'un chunk (D2 : chaque chunk a sa
 * propre géométrie construite autour de son propre centre géographique — ce décalage est ce
 * qu'il faut ajouter à une coordonnée locale AU chunk pour obtenir une coordonnée locale au
 * repère de rendu courant). Utilisé pour le `<group position=...>` de chaque chunk
 * (StreamingRoadNetwork.tsx) et pour convertir une pose de spawn choisie dans un chunk vers le
 * repère de rendu initial (geoOrchestrator.ts, où renderAnchor === worldAnchor au premier chargement).
 */
export function chunkRenderOffset(key: ChunkKey, worldAnchor: GeoAnchor, renderAnchor: GeoAnchor, chunkSizeM: number = CHUNK_SIZE_M): LocalPoint {
  return projectToLocal(chunkCenterGeoPoint(key, worldAnchor, chunkSizeM), renderAnchor);
}
