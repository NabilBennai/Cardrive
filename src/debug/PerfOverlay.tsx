import { useEffect, useState } from 'react';
import { budgetViolations, takeSnapshot, type BudgetKey, type PerfSnapshot } from './perfStats';

const REFRESH_MS = 500;

const format = (value: number, digits = 1) => value.toFixed(digits);
const formatCount = (value: number) => Math.round(value).toLocaleString('fr-FR');

interface Heap { usedMb: number; limitMb: number }
const readHeap = (): Heap | null => {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return memory ? { usedMb: memory.usedJSHeapSize / 1_048_576, limitMb: memory.jsHeapSizeLimit / 1_048_576 } : null;
};

/** Panneau de performance, affiché ou masqué avec F3. Les valeurs qui dépassent leur budget (voir PERF_BUDGET) sont signalées. */
export function PerfOverlay({ visible }: { visible: boolean }) {
  const [snapshot, setSnapshot] = useState<PerfSnapshot>(takeSnapshot);
  const [heap, setHeap] = useState<Heap | null>(readHeap);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = setInterval(() => { setSnapshot(takeSnapshot()); setHeap(readHeap()); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;
  const violations = new Set<BudgetKey>(budgetViolations(snapshot));
  const row = (label: string, value: string, key?: BudgetKey, id?: string) => (
    <div className={key && violations.has(key) ? 'perf-row over-budget' : 'perf-row'}>
      <span>{label}</span><b data-perf={id}>{value}</b>
    </div>
  );

  return (
    <aside className="perf-overlay" aria-label="Performance" data-perf-overlay>
      <h3>Performance</h3>
      {row('Images / s', format(snapshot.fps, 0), undefined, 'fps')}
      {row('Image moy. · p95', `${format(snapshot.frameAverageMs)} · ${format(snapshot.framePercentile95Ms)} ms`, 'frame', 'frame-p95')}
      {row('Pas physique moy. · max', `${format(snapshot.physicsStepAverageMs, 2)} · ${format(snapshot.physicsStepMaxMs, 2)} ms`, 'physics', 'physics-ms')}
      {row('Solveur véhicule', `${format(snapshot.vehicleSolverAverageMs, 3)} ms`, 'vehicle', 'vehicle-ms')}
      {row('Triangles', formatCount(snapshot.triangles), 'triangles', 'triangles')}
      {row('Appels de rendu', formatCount(snapshot.drawCalls), 'drawCalls', 'draw-calls')}
      {row('Colliders · corps', `${formatCount(snapshot.colliders)} · ${formatCount(snapshot.bodies)}`, undefined, 'colliders')}
      {row('Géométries · textures', `${formatCount(snapshot.geometries)} · ${formatCount(snapshot.textures)}`, undefined, 'gpu-memory')}
      {row('Chunks actifs · échec · franchis · recentrages', `${snapshot.activeChunks} · ${snapshot.failedChunks} · ${snapshot.chunkCrossings} · ${snapshot.recenters}`, undefined, 'chunks')}
      {row('Génération de chunk moy. · max', `${format(snapshot.chunkBuildAverageMs)} · ${format(snapshot.chunkBuildMaxMs)} ms`, 'chunks', 'chunk-build')}
      {row('Saut caméra : recentrage · normal', `${format(snapshot.recenterJumpM, 2)} · ${format(snapshot.steadyJumpM, 2)} m`, undefined, 'jump')}
      {row('Position monde (est)', `${format(snapshot.vehicleWorldXM, 0)} m`, undefined, 'world-x')}
      {heap && row('Mémoire JS', `${format(heap.usedMb, 0)} / ${format(heap.limitMb, 0)} Mo`)}
    </aside>
  );
}
