/**
 * Horloge du dernier pas physique, partagée entre le solveur du véhicule (qui l'écrit à chaque pas) et le lissage visuel
 * (qui la lit à chaque image) : le rendu tourne à une cadence indépendante de la physique (60 Hz fixe).
 */
export const stepClock = {
  /** `performance.now()` au début du dernier pas physique. */
  lastStepWallMs: 0,
  /** Durée réelle (ms) entre les deux derniers pas : borne l'extrapolation. */
  lastIntervalMs: 1000 / 60,
};

export function markPhysicsStep(nowMs: number = performance.now()) {
  if (stepClock.lastStepWallMs > 0) {
    // Un intervalle anormalement long (pause, onglet masqué) ne doit pas autoriser une extrapolation longue.
    stepClock.lastIntervalMs = Math.min(1000 / 20, Math.max(1000 / 240, nowMs - stepClock.lastStepWallMs));
  }
  stepClock.lastStepWallMs = nowMs;
}

/** Temps (s) à extrapoler pour une image rendue à `nowMs` : depuis le dernier pas, jamais plus d'un intervalle de pas. */
export function extrapolationSeconds(nowMs: number = performance.now()): number {
  return Math.max(0, Math.min(nowMs - stepClock.lastStepWallMs, stepClock.lastIntervalMs)) / 1000;
}
