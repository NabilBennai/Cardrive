import { BufferGeometry, Float32BufferAttribute, Shape, ShapeGeometry } from 'three';
import { buildStripPrisms, toTrimesh } from '../roads/stripMesh.ts';
import type { PlanarPoint, WaterGraph } from './waterGraph.ts';

export const WATER_Y = 0.02;
/** Hauteur du mur invisible qui rend l'eau infranchissable (la voiture ne « roule » pas sur un fleuve). */
export const WATER_BARRIER_HEIGHT_M = 1.2;

export interface WaterLayout {
  surfaces: BufferGeometry[];
  /** Maillage de collision fusionné (murs invisibles), ou null s'il n'y a pas d'eau. */
  collider: { vertices: Float32Array; indices: Uint32Array } | null;
}

/** Même convention d'axes que buildFootprintExtrusion : forme auteurée en (x, -z), puis rotateX(-90°). */
function buildAreaSurface(ring: PlanarPoint[], y: number): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(ring[0].xM, -ring[0].zM);
  for (let i = 1; i < ring.length; i += 1) shape.lineTo(ring[i].xM, -ring[i].zM);
  shape.closePath();
  const geometry = new ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

/** Murs verticaux (sans toit) le long du contour : suffisant pour bloquer, et peu de triangles même pour un grand fleuve. */
function appendRingWalls(out: number[], ring: PlanarPoint[], heightM: number) {
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    out.push(
      a.xM, 0, a.zM, b.xM, 0, b.zM, b.xM, heightM, b.zM,
      a.xM, 0, a.zM, b.xM, heightM, b.zM, a.xM, heightM, a.zM,
    );
  }
}

export function buildWaterLayout(graph: WaterGraph): WaterLayout {
  const surfaces: BufferGeometry[] = [];
  const colliderPositions: number[] = [];

  for (const area of graph.areas) {
    surfaces.push(buildAreaSurface(area.ring, WATER_Y));
    appendRingWalls(colliderPositions, area.ring, WATER_BARRIER_HEIGHT_M);
  }
  for (const line of graph.lines) {
    const half = line.widthM / 2;
    // Visuel : prisme de hauteur nulle (dessus seul visible, flancs dégénérés).
    const flat: number[] = [];
    buildStripPrisms(flat, line.points, -half, half, 0, WATER_Y);
    const surface = new BufferGeometry();
    surface.setAttribute('position', new Float32BufferAttribute(flat, 3));
    surface.computeVertexNormals();
    surfaces.push(surface);
    buildStripPrisms(colliderPositions, line.points, -half, half, WATER_BARRIER_HEIGHT_M, 0);
  }

  return { surfaces, collider: colliderPositions.length > 0 ? toTrimesh(colliderPositions) : null };
}
