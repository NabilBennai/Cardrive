/** Usure des pneus et consommation de carburant : fonctions pures, appliquées par VehicleSimulation. */

/** Part maximale de l'adhérence perdue par un pneu complètement usé. */
export const MAX_WEAR_GRIP_LOSS = 0.4;
/** Consommation spécifique d'un moteur à essence : kg de carburant par kWh mécanique produit. */
export const FUEL_KG_PER_KWH = 0.27;
/** Puissance minimale prise en compte (W) pour la consommation : au ralenti le moteur brûle déjà un peu. */
export const IDLE_FUEL_POWER_W = 1_500;

/** Facteur d'adhérence d'un pneu usé (0 = neuf, 1 = lisse). Perte progressive : lente au début, plus marquée en fin de vie. */
export function wearGripFactor(wear: number): number {
  const w = Math.max(0, Math.min(1, wear));
  return 1 - MAX_WEAR_GRIP_LOSS * w ** 1.3;
}

/**
 * Usure ajoutée par un pas : proportionnelle à l'énergie de frottement au contact (puissance de glissement × durée), majorée quand
 * la bande est plus chaude que l'optimum (la gomme se dégrade). `fullWearEnergyMJ` est l'énergie qui use complètement le pneu.
 */
export function wearIncrement(slidingPowerW: number, dtS: number, surfaceC: number, optimalC: number, fullWearEnergyMJ: number): number {
  const hotFactor = 1 + Math.max(0, surfaceC - optimalC) / 60;
  return (Math.max(0, slidingPowerW) * dtS * hotFactor) / (fullWearEnergyMJ * 1e6);
}

/** Carburant (kg) brûlé pendant un pas pour une puissance mécanique donnée (W). */
export function fuelBurnedKg(enginePowerW: number, dtS: number): number {
  return (Math.max(enginePowerW, IDLE_FUEL_POWER_W) / 3.6e6) * FUEL_KG_PER_KWH * dtS;
}
