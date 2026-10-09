import { BufferGeometry, ExtrudeGeometry, Shape, Vector3 } from 'three';
import type { BuildingGraph } from './buildingGraph.ts';

export interface BuildingPlacement {
  id: number;
  geometry: BufferGeometry;
  aabbCenterM: [number, number, number];
  aabbHalfExtentM: [number, number, number];
  materialIndex: number;
}

/**
 * Extrude une empreinte fermée (points en mètres locaux xM/zM) verticalement de baseY à
 * baseY+heightM. Le Shape est auteuré en (x, -z) : ExtrudeGeometry extrude par défaut selon
 * +Z local pour une forme dans le plan XY, donc rotateX(-90°) qui ramène cette extrusion vers
 * +Y (hauteur) monde ferait aussi passer Z-local→-Z-monde ; authorer -z annule exactement ce
 * flip de signe, donnant X monde = xM, Y monde = hauteur, Z monde = zM — vérifié par
 * tests/buildingMesh.test.ts (bounding box XZ inchangée, pas d'inversion/échange d'axes).
 */
export function buildFootprintExtrusion(points: Vector3[], heightM: number, baseY: number): BufferGeometry {
  const ring = points[0].distanceToSquared(points[points.length - 1]) < 1e-6 ? points.slice(0, -1) : points;

  const shape = new Shape();
  shape.moveTo(ring[0].x, -ring[0].z);
  for (let i = 1; i < ring.length; i += 1) shape.lineTo(ring[i].x, -ring[i].z);
  shape.closePath();

  const geometry = new ExtrudeGeometry(shape, { depth: heightM, bevelEnabled: false, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, baseY, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/** Résout le graphe (déjà projeté en mètres) en géométries extrudées, AABB (pour le collider) et index de matériau déterministe. */
export function buildBuildingLayout(graph: BuildingGraph, baseY: number, paletteSize: number): BuildingPlacement[] {
  const placements: BuildingPlacement[] = [];

  for (const building of graph.buildings) {
    const points = building.nodeIds
      .map((id) => graph.nodesById.get(id))
      .filter((node): node is NonNullable<typeof node> => node !== undefined)
      .map((node) => new Vector3(node.local.xM, 0, node.local.zM));
    if (points.length < 3) continue;

    const geometry = buildFootprintExtrusion(points, building.heightM, baseY);

    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
    }

    placements.push({
      id: building.id,
      geometry,
      aabbCenterM: [(minX + maxX) / 2, baseY + building.heightM / 2, (minZ + maxZ) / 2],
      aabbHalfExtentM: [(maxX - minX) / 2, building.heightM / 2, (maxZ - minZ) / 2],
      materialIndex: building.materialSeed % paletteSize,
    });
  }

  return placements;
}
