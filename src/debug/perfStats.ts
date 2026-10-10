/**
 * Statistiques de performance de la session : fenêtres glissantes pour le temps d'image et les temps de physique,
 * compteurs de scène. Aucun accès à React ni à three.js ici (testable) ; PerfProbe (dans la scène) les alimente et
 * PerfOverlay (DOM) les affiche.
 */

/** Fenêtre glissante de taille fixe : moyenne, maximum et percentile sans allocation à chaque ajout. */
export class RollingWindow {
  private readonly values: Float64Array;
  private count = 0;
  private next = 0;

  constructor(readonly capacity: number) {
    this.values = new Float64Array(capacity);
  }

  push(value: number) {
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  get size() {
    return this.count;
  }

  average(): number {
    if (this.count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.count; i += 1) sum += this.values[i];
    return sum / this.count;
  }

  max(): number {
    let best = 0;
    for (let i = 0; i < this.count; i += 1) best = Math.max(best, this.values[i]);
    return best;
  }

  /** Percentile (0-100) par rang le plus proche ; 0 si la fenêtre est vide. */
  percentile(p: number): number {
    if (this.count === 0) return 0;
    const sorted = Array.from(this.values.subarray(0, this.count)).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
  }

  clear() {
    this.count = 0;
    this.next = 0;
  }
}

const WINDOW_FRAMES = 240;

export const perfStats = {
  /** Durée de chaque image rendue (ms), mesurée par useFrame. */
  frameMs: new RollingWindow(WINDOW_FRAMES),
  /** Durée entre le début et la fin d'un pas physique Rapier (ms). */
  physicsStepMs: new RollingWindow(WINDOW_FRAMES),
  /** Durée du seul solveur du véhicule (pneus, suspension, transmission) par pas (ms). */
  vehicleSolverMs: new RollingWindow(WINDOW_FRAMES),
  /** Durée de construction d'un chunk (graphes de routes, bâtiments, eau) en ms : sur le thread principal, donc visible en saccade. */
  chunkBuildMs: new RollingWindow(WINDOW_FRAMES),
  /** Son : état du contexte audio, fréquence du moteur, niveau de sortie. Alimenté par AudioDriver. */
  audio: { state: 'idle', fundamentalHz: 0, engineGain: 0, squealGain: 0, levelDb: -120 } as { state: string; fundamentalHz: number; engineGain: number; squealGain: number; levelDb: number },
  /** Compteurs du monde streamé, mis à jour par useChunkStreamer et useFloatingOrigin. */
  world: { activeChunks: 0, failedChunks: 0, recenters: 0, chunkCrossings: 0, recenterJumpM: 0, steadyJumpM: 0, vehicleWorldXM: 0 },
  /** Compteurs de scène, rafraîchis périodiquement (pas à chaque image). */
  scene: { triangles: 0, drawCalls: 0, geometries: 0, textures: 0, colliders: 0, bodies: 0 },
};

export interface PerfBudget {
  /** Image p95 au-delà de laquelle la fluidité est dégradée (60 FPS = 16,7 ms ; marge à 20 ms). */
  framePercentile95Ms: number;
  /** Pas physique moyen maximal toléré (le pas fixe dure 16,7 ms : au-delà de ~4 ms le rendu n'a plus de marge). */
  physicsStepMs: number;
  vehicleSolverMs: number;
  triangles: number;
  drawCalls: number;
  /** Construction d'un chunk : au-delà de ~25 ms elle coûte plus d'une image à 60 FPS. */
  chunkBuildMs: number;
}

export const PERF_BUDGET: PerfBudget = { framePercentile95Ms: 20, physicsStepMs: 4, vehicleSolverMs: 1, triangles: 1_500_000, drawCalls: 400, chunkBuildMs: 25 };

export interface PerfSnapshot {
  fps: number;
  frameAverageMs: number;
  framePercentile95Ms: number;
  physicsStepAverageMs: number;
  physicsStepMaxMs: number;
  vehicleSolverAverageMs: number;
  triangles: number;
  drawCalls: number;
  geometries: number;
  textures: number;
  colliders: number;
  bodies: number;
  activeChunks: number;
  failedChunks: number;
  recenters: number;
  /** Nombre de fois où la voiture a changé de chunk (frontières de 256 m franchies) depuis le début de la partie. */
  chunkCrossings: number;
  /** Plus grand saut du vecteur voiture→caméra rendu (m) entre deux images consécutives juste après un recentrage de l'origine flottante. */
  recenterJumpM: number;
  /** Plus grand saut du même vecteur en conduite normale (m) : référence pour juger recenterJumpM. */
  steadyJumpM: number;
  /** Position est-ouest du véhicule (m) dans le repère MONDE (ancre du lieu choisi), indépendante des recentrages. */
  vehicleWorldXM: number;
  audioState: string;
  engineHz: number;
  squealGain: number;
  audioLevelDb: number;
  chunkBuildAverageMs: number;
  chunkBuildMaxMs: number;
}

export function takeSnapshot(): PerfSnapshot {
  const frameAverageMs = perfStats.frameMs.average();
  return {
    fps: frameAverageMs > 0 ? 1000 / frameAverageMs : 0,
    frameAverageMs,
    framePercentile95Ms: perfStats.frameMs.percentile(95),
    physicsStepAverageMs: perfStats.physicsStepMs.average(),
    physicsStepMaxMs: perfStats.physicsStepMs.max(),
    vehicleSolverAverageMs: perfStats.vehicleSolverMs.average(),
    ...perfStats.scene,
    ...perfStats.world,
    audioState: perfStats.audio.state,
    engineHz: perfStats.audio.fundamentalHz,
    squealGain: perfStats.audio.squealGain,
    audioLevelDb: perfStats.audio.levelDb,
    chunkBuildAverageMs: perfStats.chunkBuildMs.average(),
    chunkBuildMaxMs: perfStats.chunkBuildMs.max(),
  };
}

export type BudgetKey = 'frame' | 'physics' | 'vehicle' | 'triangles' | 'drawCalls' | 'chunks';

/** Indicateurs qui dépassent leur budget (liste vide = tout est dans le budget). */
export function budgetViolations(snapshot: PerfSnapshot, budget: PerfBudget = PERF_BUDGET): BudgetKey[] {
  const violations: BudgetKey[] = [];
  if (snapshot.framePercentile95Ms > budget.framePercentile95Ms) violations.push('frame');
  if (snapshot.physicsStepAverageMs > budget.physicsStepMs) violations.push('physics');
  if (snapshot.vehicleSolverAverageMs > budget.vehicleSolverMs) violations.push('vehicle');
  if (snapshot.triangles > budget.triangles) violations.push('triangles');
  if (snapshot.drawCalls > budget.drawCalls) violations.push('drawCalls');
  if (snapshot.chunkBuildMaxMs > budget.chunkBuildMs) violations.push('chunks');
  return violations;
}

export function resetPerfStats() {
  perfStats.frameMs.clear();
  perfStats.physicsStepMs.clear();
  perfStats.vehicleSolverMs.clear();
  perfStats.chunkBuildMs.clear();
  perfStats.audio = { state: 'idle', fundamentalHz: 0, engineGain: 0, squealGain: 0, levelDb: -120 };
  perfStats.world = { activeChunks: 0, failedChunks: 0, recenters: 0, chunkCrossings: 0, recenterJumpM: 0, steadyJumpM: 0, vehicleWorldXM: 0 };
  perfStats.scene = { triangles: 0, drawCalls: 0, geometries: 0, textures: 0, colliders: 0, bodies: 0 };
}
