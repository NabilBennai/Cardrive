import type { GeoAnchor } from '../../geo/projection.ts';
import { projectToLocal } from '../../geo/projection.ts';
import type { RawOsmData, RawOsmWay } from '../../map/geoProvider.ts';
import type { LocalPoint, SurfaceMaterial } from '../../shared/types.ts';

const DRIVABLE_HIGHWAY_VALUES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'service', 'living_street', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);

const DEFAULT_LANE_WIDTH_M = 3.25;
const DEFAULT_WIDTH_M = 6;

export interface RoadNode {
  id: number;
  local: LocalPoint;
}

export interface RoadWay {
  id: number;
  nodeIds: number[];
  widthM: number;
  surface: SurfaceMaterial;
  name?: string;
}

export interface ExcludedWay {
  id: number;
  reason: 'bridge' | 'tunnel' | 'layer';
}

export interface RoadGraph {
  nodesById: Map<number, RoadNode>;
  ways: RoadWay[];
  /** Nœuds référencés par deux voies ou plus : jonctions à traiter spécifiquement dans roadMesh.ts. */
  junctionNodeIds: Set<number>;
  excluded: ExcludedWay[];
}

/**
 * Levée quand zéro voie carrossable n'est trouvée. Correct pour le chargement initial d'une
 * zone (étape 3 : zone vide = erreur bloquante). Un chunk individuel (étape 4, streaming) doit
 * au contraire INTERCEPTER cette erreur et la traiter comme un RoadGraph vide : un chunk sans
 * route (parc, cours d'eau) est un état normal, pas une erreur — voir useChunkStreamer.ts.
 */
export class EmptyRoadZoneError extends Error {
  constructor() {
    super('Aucune voie carrossable dans cette zone.');
    this.name = 'EmptyRoadZoneError';
  }
}

/** Graphe vide, utilisé par les appelants par chunk pour remplacer un EmptyRoadZoneError intercepté. */
export function emptyRoadGraph(): RoadGraph {
  return { nodesById: new Map(), ways: [], junctionNodeIds: new Set(), excluded: [] };
}

/** width (mètres) > lanes × largeur de voie documentée > défaut documenté, doc §7 étape 4. */
export function estimateWidthM(tags: Record<string, string>): number {
  const widthTag = tags.width ? Number.parseFloat(tags.width) : NaN;
  if (Number.isFinite(widthTag) && widthTag > 0) return widthTag;
  const lanesTag = tags.lanes ? Number.parseInt(tags.lanes, 10) : NaN;
  if (Number.isFinite(lanesTag) && lanesTag > 0) return lanesTag * DEFAULT_LANE_WIDTH_M;
  return DEFAULT_WIDTH_M;
}

function exclusionReasonFor(tags: Record<string, string>): ExcludedWay['reason'] | null {
  if (tags.bridge && tags.bridge !== 'no') return 'bridge';
  if (tags.tunnel && tags.tunnel !== 'no') return 'tunnel';
  const layer = tags.layer ? Number.parseInt(tags.layer, 10) : 0;
  if (Number.isFinite(layer) && layer !== 0) return 'layer';
  return null;
}

/**
 * Doc §7 pipeline, étapes 2-4 : filtre les voies carrossables, exclut/consigne ponts, tunnels et
 * niveaux (« Le MVP GPS reste plat et doit exclure ou signaler les géométries non prises en
 * charge »), détermine les jonctions (nœuds partagés) et projette chaque nœud en mètres via
 * l'ancre géographique de la zone.
 */
export function buildRoadGraph(raw: RawOsmData, anchor: GeoAnchor): RoadGraph {
  const nodesById = new Map<number, RoadNode>();
  for (const node of raw.nodes) {
    nodesById.set(node.id, { id: node.id, local: projectToLocal(node, anchor) });
  }

  const ways: RoadWay[] = [];
  const excluded: ExcludedWay[] = [];
  const nodeUsageCount = new Map<number, number>();

  const drivableWays: RawOsmWay[] = [];
  for (const way of raw.ways) {
    if (!DRIVABLE_HIGHWAY_VALUES.has(way.tags.highway ?? '')) continue;
    const reason = exclusionReasonFor(way.tags);
    if (reason) {
      excluded.push({ id: way.id, reason });
      continue;
    }
    drivableWays.push(way);
  }

  if (drivableWays.length === 0) throw new EmptyRoadZoneError();

  for (const way of drivableWays) {
    for (const nodeId of new Set(way.nodeIds)) {
      nodeUsageCount.set(nodeId, (nodeUsageCount.get(nodeId) ?? 0) + 1);
    }
    ways.push({
      id: way.id,
      nodeIds: way.nodeIds,
      widthM: estimateWidthM(way.tags),
      surface: 'asphalt',
      name: way.tags.name,
    });
  }

  const junctionNodeIds = new Set<number>();
  for (const [nodeId, count] of nodeUsageCount) {
    if (count >= 2) junctionNodeIds.add(nodeId);
  }

  return { nodesById, ways, junctionNodeIds, excluded };
}
