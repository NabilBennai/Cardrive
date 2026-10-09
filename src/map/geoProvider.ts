/** Rectangle géographique en degrés WGS84. */
export interface GeoBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export type GeoProviderErrorKind = 'network' | 'timeout' | 'rate-limited' | 'http' | 'malformed-response';

export class GeoProviderError extends Error {
  readonly kind: GeoProviderErrorKind;

  constructor(kind: GeoProviderErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GeoProviderError';
    this.kind = kind;
  }
}

export interface RawOsmNode {
  id: number;
  latitudeDeg: number;
  longitudeDeg: number;
}

export interface RawOsmWay {
  id: number;
  nodeIds: number[];
  tags: Record<string, string>;
}

export interface RawOsmData {
  nodes: RawOsmNode[];
  ways: RawOsmWay[];
}

/**
 * Doc §7 : « GeoProvider expose une opération annulable getRoads(bounds, signal). Aucun
 * fournisseur concret ne doit être importé par VehiclePhysics. » Seul src/app/geoOrchestrator.ts
 * instancie un fournisseur concret ; le reste de l'application ne dépend que de cette interface.
 */
export interface GeoProvider {
  readonly id: string;
  getRoads(bounds: GeoBounds, signal: AbortSignal): Promise<RawOsmData>;
}
