/**
 * Chronométrage d'un tour de circuit fermé. Le circuit est découpé en GATES_PER_LAP portes régulières (la porte 0 est la ligne de
 * départ, les portes 20 et 40 séparent les trois secteurs). La progression est « déroulée » (sans saut de la longueur du tour à 0)
 * et une porte n'est franchie qu'une fois, dans l'ordre : reculer sur la ligne puis la repasser ne compte pas, et un tour dont la
 * progression a sauté (raccourci) ou passé trop de temps hors piste est invalide. Logique pure, sans dépendance au moteur : le
 * temps est celui de la simulation (somme des pas), donc la pause l'arrête naturellement.
 */

export const GATES_PER_LAP = 60;
export const SECTORS = 3;
const GATES_PER_SECTOR = GATES_PER_LAP / SECTORS;
/** Écart latéral toléré (m) au-delà du bord de la piste : les vibreurs font partie du tracé. */
const KERB_TOLERANCE_M = 1.5;
/** Temps cumulé (s) hors piste au-delà duquel un tour n'est plus valide. */
export const MAX_OFF_TRACK_S = 6;
/** Avancée maximale plausible (m) en un pas ; au-delà, la voiture a été téléportée ou a coupé à travers le décor. */
const MAX_STEP_ADVANCE_M = 25;

export type InvalidReason = 'raccourci' | 'repositionnée' | 'hors piste';

export type LapTimerEvent =
  | { type: 'lap-start' }
  | { type: 'sector'; index: number; sectorS: number; cumulativeS: number }
  | { type: 'lap'; lapNumber: number; valid: true; lapS: number; sectorS: number[]; profileS: number[] }
  | { type: 'lap'; lapNumber: number; valid: false; reason: InvalidReason }
  | { type: 'invalid'; reason: InvalidReason };

export interface LapTimerSnapshot {
  started: boolean;
  lapNumber: number;
  currentS: number;
  valid: boolean;
  invalidReason: InvalidReason | null;
  /** Avancement dans le tour courant, 0..1. */
  lapFraction: number;
}

export class LapTimer {
  private timeS = 0;
  private previousS: number | null = null;
  private total = 0;
  private highestGate = 0;
  private started = false;
  private lapNumber = 0;
  private lapStartS = 0;
  private lapStartGate = 0;
  private valid = true;
  private reason: InvalidReason | null = null;
  private offTrackS = 0;
  private sectorStartS = 0;
  private sectors: number[] = [];
  private profile: number[] = [0];
  private pending: LapTimerEvent[] = [];

  constructor(private readonly lengthM: number, private readonly widthM: number) {}

  private get gateM(): number { return this.lengthM / GATES_PER_LAP; }

  /**
   * La voiture a été remise sur la grille : le tour en cours est perdu et le chronomètre attend le prochain passage de la ligne
   * (un tour de lancement), au lieu de laisser le reste du tour compter pour rien.
   */
  reposition(): void {
    if (this.started) this.pending.push({ type: 'invalid', reason: 'repositionnée' });
    this.started = false;
    this.valid = true;
    this.reason = null;
    this.previousS = null;
  }

  snapshot(): LapTimerSnapshot {
    const lapFraction = this.started ? Math.max(0, Math.min(1, (this.total / this.gateM - this.lapStartGate) / GATES_PER_LAP)) : 0;
    return {
      started: this.started,
      lapNumber: this.lapNumber,
      currentS: this.started ? this.timeS - this.lapStartS : 0,
      valid: this.valid,
      invalidReason: this.reason,
      lapFraction,
    };
  }

  private markInvalid(reason: InvalidReason, events: LapTimerEvent[]): void {
    if (!this.started || !this.valid) return;
    this.valid = false;
    this.reason = reason;
    events.push({ type: 'invalid', reason });
  }

  /** Avance d'un pas de simulation. sM est l'abscisse curviligne projetée, lateralM l'écart à l'axe ; renvoie les événements survenus. */
  step(dtS: number, sM: number, lateralM: number): LapTimerEvent[] {
    const events = this.pending;
    this.pending = [];
    const startTime = this.timeS;
    this.timeS += dtS;

    if (this.previousS === null) {
      // Première mesure (ou après repositionnement) : on se cale sans compter d'avancée. Avant le premier départ, une voiture juste
      // derrière la ligne a une progression légèrement négative, et c'est la ligne qui déclenchera le chronomètre.
      this.total = sM > this.lengthM / 2 ? sM - this.lengthM : sM;
      this.previousS = sM;
      this.highestGate = Math.floor(this.total / this.gateM);
      return events;
    }

    let delta = sM - this.previousS;
    if (delta > this.lengthM / 2) delta -= this.lengthM;
    else if (delta < -this.lengthM / 2) delta += this.lengthM;
    this.previousS = sM;
    if (Math.abs(delta) > MAX_STEP_ADVANCE_M) {
      // Saut de progression : on se cale sur la nouvelle position (même tour, au plus proche) et le tour est perdu.
      this.markInvalid('raccourci', events);
      const base = Math.round((this.total - sM) / this.lengthM) * this.lengthM;
      this.total = sM + base;
      this.highestGate = Math.max(this.highestGate, Math.floor(this.total / this.gateM));
      return events;
    }

    const previousTotal = this.total;
    this.total += delta;

    if (this.started && Math.abs(lateralM) > this.widthM / 2 + KERB_TOLERANCE_M) {
      this.offTrackS += dtS;
      if (this.offTrackS > MAX_OFF_TRACK_S) this.markInvalid('hors piste', events);
    }

    const gateNow = Math.floor(this.total / this.gateM);
    for (let gate = this.highestGate + 1; gate <= gateNow; gate += 1) {
      const fraction = delta === 0 ? 1 : Math.max(0, Math.min(1, (gate * this.gateM - previousTotal) / delta));
      this.crossGate(gate, startTime + fraction * dtS, events);
    }
    this.highestGate = Math.max(this.highestGate, gateNow);
    return events;
  }

  private crossGate(gate: number, crossingS: number, events: LapTimerEvent[]): void {
    if (gate % GATES_PER_LAP === 0) {
      if (this.started) {
        events.push(this.valid
          ? {
            type: 'lap', lapNumber: this.lapNumber, valid: true, lapS: crossingS - this.lapStartS,
            sectorS: [...this.sectors, crossingS - this.sectorStartS], profileS: [...this.profile, crossingS - this.lapStartS],
          }
          : { type: 'lap', lapNumber: this.lapNumber, valid: false, reason: this.reason ?? 'raccourci' });
      }
      this.started = true;
      this.lapNumber += 1;
      this.lapStartS = crossingS;
      this.lapStartGate = gate;
      this.sectorStartS = crossingS;
      this.sectors = [];
      this.profile = [0];
      this.valid = true;
      this.reason = null;
      this.offTrackS = 0;
      events.push({ type: 'lap-start' });
      return;
    }
    if (!this.started) return;
    this.profile.push(crossingS - this.lapStartS);
    if (gate % GATES_PER_SECTOR === 0) {
      const sectorS = crossingS - this.sectorStartS;
      this.sectors.push(sectorS);
      this.sectorStartS = crossingS;
      events.push({ type: 'sector', index: this.sectors.length - 1, sectorS, cumulativeS: crossingS - this.lapStartS });
    }
  }
}

/**
 * Écart (s) au tour de référence : temps écoulé moins temps que la référence mettait pour atteindre la même fraction du tour
 * (profil de temps cumulé aux portes, interpolé). Négatif = en avance.
 */
export function deltaToProfile(referenceProfileS: readonly number[], lapFraction: number, elapsedS: number): number | null {
  if (referenceProfileS.length < 2) return null;
  const position = Math.max(0, Math.min(1, lapFraction)) * (referenceProfileS.length - 1);
  const lower = Math.min(Math.floor(position), referenceProfileS.length - 2);
  const t = position - lower;
  const referenceS = referenceProfileS[lower] + (referenceProfileS[lower + 1] - referenceProfileS[lower]) * t;
  return elapsedS - referenceS;
}

/** « 1:23.456 » ; absent ou invalide → « –:––.––– ». */
export function formatLapTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '–:––.–––';
  const totalMs = Math.round(seconds * 1000);
  const minutes = Math.floor(totalMs / 60_000);
  const rest = totalMs - minutes * 60_000;
  return `${minutes}:${String(Math.floor(rest / 1000)).padStart(2, '0')}.${String(rest % 1000).padStart(3, '0')}`;
}

/** « +0.312 » / « −0.120 » ; vide si inconnu. */
export function formatDelta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  return `${seconds < 0 ? '−' : '+'}${Math.abs(seconds).toFixed(3)}`;
}
