import type { GeoAnchor } from '../../geo/projection.ts';
import { projectToLocal } from '../../geo/projection.ts';
import type { RawOsmData } from '../../map/geoProvider.ts';
import type { LocalPoint } from '../../shared/types.ts';

export const DEFAULT_LEVEL_HEIGHT_M = 3;
export const DEFAULT_BUILDING_HEIGHT_M = 6;
export const MAX_BUILDINGS_PER_ZONE = 400;
export const MAX_BUILDING_FOOTPRINT_DIAGONAL_M = 250;

export interface BuildingNode {
  id: number;
  local: LocalPoint;
}

export interface Building {
  id: number;
  nodeIds: number[];
  heightM: number;
  /** Égal à id : permet un hachage déterministe vers la palette de matériaux dans buildingMesh.ts. */
  materialSeed: number;
  name?: string;
}

export interface SkippedBuilding {
  id: number;
  reason: 'open-ring' | 'too-few-points' | 'oversized' | 'zone-cap';
}

export interface BuildingGraph {
  nodesById: Map<number, BuildingNode>;
  buildings: Building[];
  skipped: SkippedBuilding[];
}

/** height (mètres) > building:levels × hauteur d'étage documentée > défaut documenté. */
export function estimateHeightM(tags: Record<string, string>): number {
  const heightTag = tags.height ? Number.parseFloat(tags.height) : NaN;
  if (Number.isFinite(heightTag) && heightTag > 0) return heightTag;
  const levelsTag = tags['building:levels'] ? Number.parseFloat(tags['building:levels']) : NaN;
  if (Number.isFinite(levelsTag) && levelsTag > 0) return levelsTag * DEFAULT_LEVEL_HEIGHT_M;
  return DEFAULT_BUILDING_HEIGHT_M;
}

/**
 * Parcourt les mêmes `way` bruts que buildRoadGraph (filtre symétrique sur le tag `building` au
 * lieu de `highway`) : roadGraph.ts n'a besoin d'aucune modification, il ignore déjà les `way`
 * sans tag `highway`. Zéro bâtiment est un état normal (contrairement à zéro route) : cette
 * fonction ne jette jamais, elle consigne les empreintes ignorées dans `skipped`.
 */
export function buildBuildingGraph(raw: RawOsmData, anchor: GeoAnchor): BuildingGraph {
  const nodesById = new Map<number, BuildingNode>();
  for (const node of raw.nodes) {
    nodesById.set(node.id, { id: node.id, local: projectToLocal(node, anchor) });
  }

  const buildings: Building[] = [];
  const skipped: SkippedBuilding[] = [];

  for (const way of raw.ways) {
    if (!way.tags.building) continue;

    if (buildings.length >= MAX_BUILDINGS_PER_ZONE) {
      skipped.push({ id: way.id, reason: 'zone-cap' });
      continue;
    }

    const nodeIds = way.nodeIds;
    const isClosedRing = nodeIds.length >= 4 && nodeIds[0] === nodeIds[nodeIds.length - 1];
    if (!isClosedRing) {
      skipped.push({ id: way.id, reason: nodeIds.length < 4 ? 'too-few-points' : 'open-ring' });
      continue;
    }

    const points = nodeIds.map((id) => nodesById.get(id)).filter((node): node is BuildingNode => node !== undefined);
    const distinctPoints = new Set(points.slice(0, -1).map((node) => `${node.local.xM},${node.local.zM}`));
    if (distinctPoints.size < 3) {
      skipped.push({ id: way.id, reason: 'too-few-points' });
      continue;
    }

    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (const node of points) {
      minX = Math.min(minX, node.local.xM); maxX = Math.max(maxX, node.local.xM);
      minZ = Math.min(minZ, node.local.zM); maxZ = Math.max(maxZ, node.local.zM);
    }
    const diagonalM = Math.hypot(maxX - minX, maxZ - minZ);
    if (diagonalM > MAX_BUILDING_FOOTPRINT_DIAGONAL_M) {
      skipped.push({ id: way.id, reason: 'oversized' });
      continue;
    }

    buildings.push({
      id: way.id,
      nodeIds,
      heightM: estimateHeightM(way.tags),
      materialSeed: way.id,
      name: way.tags.name,
    });
  }

  return { nodesById, buildings, skipped };
}
