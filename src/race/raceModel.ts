/**
 * Déroulement d'une course : feux de départ, comptage des tours et classement en direct de toutes les voitures, arrivée, faux départ.
 * Logique pure, pilotée par le temps de simulation et l'abscisse curviligne de chaque voiture (voir TrackProjector).
 */

/** Durée (s) de chaque feu rouge, puis délai aléatoire fixe avant l'extinction (« go »). */
export const LIGHT_INTERVAL_S = 0.9;
export const LIGHTS = 3;
/** Délai (s) entre l'allumage du dernier feu et le départ. */
export const HOLD_AFTER_LIGHTS_S = 0.8;
/** Déplacement (m) toléré avant le départ : au-delà, faux départ. */
export const FALSE_START_DISTANCE_M = 1.5;
export const FALSE_START_PENALTY_S = 5;

export type RacePhase = 'countdown' | 'racing';

export interface CarProgress {
  id: string;
  /** Distance déroulée (m) depuis la ligne : négative sur la grille, longueur du tour × tours + position pour une course complète. */
  distanceM: number;
  lapsCompleted: number;
  /** Instant d'arrivée (s depuis le départ) ; null tant que la voiture roule. */
  finishS: number | null;
  penaltyS: number;
  falseStart: boolean;
}

export interface Standing extends CarProgress {
  /** Rang (1 = en tête). */
  position: number;
  /** Retard (m) sur la voiture qui précède, pour l'affichage. */
  gapAheadM: number | null;
}

export class RaceTracker {
  private phase: RacePhase = 'countdown';
  private clockS = 0;
  private raceStartS = 0;
  private readonly cars = new Map<string, CarProgress & { previousS: number | null; origin: [number, number] | null }>();

  constructor(private readonly lengthM: number, readonly totalLaps: number) {}

  addCar(id: string): void {
    this.cars.set(id, { id, distanceM: 0, lapsCompleted: 0, finishS: null, penaltyS: 0, falseStart: false, previousS: null, origin: null });
  }

  get currentPhase(): RacePhase { return this.phase; }

  /** Temps (s) de course écoulé depuis l'extinction des feux ; 0 pendant le compte à rebours. */
  get raceTimeS(): number { return this.phase === 'racing' ? this.clockS - this.raceStartS : 0; }

  /** Nombre de feux allumés (0..LIGHTS) ; 0 quand ils sont éteints (départ donné). */
  get lightsOn(): number {
    if (this.phase === 'racing') return 0;
    return Math.min(LIGHTS, Math.floor(this.clockS / LIGHT_INTERVAL_S) + 1);
  }

  /** Durée totale (s) avant le départ. */
  static get countdownS(): number { return LIGHTS * LIGHT_INTERVAL_S + HOLD_AFTER_LIGHTS_S; }

  /** Avance l'horloge d'un pas de simulation. */
  tick(dtS: number): void {
    this.clockS += dtS;
    if (this.phase === 'countdown' && this.clockS >= RaceTracker.countdownS) {
      this.phase = 'racing';
      this.raceStartS = RaceTracker.countdownS;
    }
  }

  /**
   * Position d'une voiture : sM abscisse projetée (0..longueur), x/z position réelle (pour le faux départ). Pendant le compte à
   * rebours la distance est celle de la grille (négative) ; ensuite elle s'accumule sans saut.
   */
  update(id: string, sM: number, xM: number, zM: number): void {
    const car = this.cars.get(id);
    if (!car) return;
    if (car.previousS === null) {
      car.distanceM = sM > this.lengthM / 2 ? sM - this.lengthM : sM;
      car.previousS = sM;
      car.origin = [xM, zM];
      return;
    }
    let delta = sM - car.previousS;
    if (delta > this.lengthM / 2) delta -= this.lengthM;
    else if (delta < -this.lengthM / 2) delta += this.lengthM;
    car.previousS = sM;
    car.distanceM += delta;
    if (this.phase === 'countdown') {
      if (car.origin && !car.falseStart && Math.hypot(xM - car.origin[0], zM - car.origin[1]) > FALSE_START_DISTANCE_M) {
        car.falseStart = true;
        car.penaltyS = FALSE_START_PENALTY_S;
      }
      return;
    }
    car.lapsCompleted = Math.max(0, Math.floor(car.distanceM / this.lengthM));
    if (car.finishS === null && car.lapsCompleted >= this.totalLaps) car.finishS = this.raceTimeS;
  }

  /** Classement : les arrivés par temps (pénalité comprise), puis les autres par distance parcourue décroissante. */
  standings(): Standing[] {
    const all = [...this.cars.values()];
    all.sort((a, b) => {
      const aDone = a.finishS !== null; const bDone = b.finishS !== null;
      if (aDone && bDone) return (a.finishS! + a.penaltyS) - (b.finishS! + b.penaltyS);
      if (aDone) return -1;
      if (bDone) return 1;
      return b.distanceM - a.distanceM;
    });
    return all.map((car, index) => ({
      id: car.id,
      distanceM: car.distanceM,
      lapsCompleted: car.lapsCompleted,
      finishS: car.finishS,
      penaltyS: car.penaltyS,
      falseStart: car.falseStart,
      position: index + 1,
      gapAheadM: index === 0 ? null : all[index - 1].distanceM - car.distanceM,
    }));
  }

  progressOf(id: string): CarProgress | null {
    const car = this.cars.get(id);
    return car ? { id: car.id, distanceM: car.distanceM, lapsCompleted: car.lapsCompleted, finishS: car.finishS, penaltyS: car.penaltyS, falseStart: car.falseStart } : null;
  }
}
