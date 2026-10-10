export interface CarCatalogEntry {
  id: string;
  label: string;
  /** Fichier GLB sous public/models/cars/, ou null pour la carrosserie procédurale d'origine (GenericCar). */
  modelFile: string | null;
  /** Vignette sous public/models/cars/previews/, ou null. */
  previewFile: string | null;
}

export const DEFAULT_CAR_ID = 'prototype';

const kenney = (id: string, label: string): CarCatalogEntry => ({ id, label, modelFile: `${id}.glb`, previewFile: `${id}.png` });

/**
 * Catalogue : la carrosserie procédurale d'origine + une sélection du Car Kit de Kenney
 * (CC0, https://kenney.nl/assets/car-kit ; licence copiée dans public/models/cars). Seul
 * l'habillage visuel change : la physique reste celle du véhicule générique (voir GenericCar).
 */
export const CAR_CATALOG: CarCatalogEntry[] = [
  { id: DEFAULT_CAR_ID, label: 'Prototype R-01', modelFile: null, previewFile: null },
  kenney('sedan', 'Berline'),
  kenney('sedan-sports', 'Berline sport'),
  kenney('hatchback-sports', 'Compacte sport'),
  kenney('suv', 'SUV'),
  kenney('suv-luxury', 'SUV de luxe'),
  kenney('van', 'Fourgonnette'),
  kenney('taxi', 'Taxi'),
  kenney('police', 'Police'),
  kenney('race', 'Course'),
  kenney('race-future', 'Course futuriste'),
  kenney('delivery', 'Livraison'),
  kenney('ambulance', 'Ambulance'),
  kenney('firetruck', 'Pompiers'),
  kenney('garbage-truck', 'Benne à ordures'),
  kenney('truck', 'Camion'),
  kenney('tractor', 'Tracteur'),
  kenney('kart-oobi', 'Kart'),
];

export function findCar(id: string | null | undefined): CarCatalogEntry {
  return CAR_CATALOG.find((car) => car.id === id) ?? CAR_CATALOG[0];
}

export const SELECTED_CAR_KEY = 'cardrive.selectedCar';

/** localStorage peut être absent ou bloqué : on retombe alors sur la voiture par défaut. */
export function loadSelectedCarId(): string {
  try {
    return findCar(localStorage.getItem(SELECTED_CAR_KEY)).id;
  } catch {
    return DEFAULT_CAR_ID;
  }
}

export function saveSelectedCarId(id: string) {
  try {
    localStorage.setItem(SELECTED_CAR_KEY, id);
  } catch {
    // Non mémorisée : valable pour cette session uniquement.
  }
}

export function carModelUrl(car: CarCatalogEntry): string | null {
  return car.modelFile ? `${import.meta.env.BASE_URL}models/cars/${car.modelFile}` : null;
}

export function carPreviewUrl(car: CarCatalogEntry): string | null {
  return car.previewFile ? `${import.meta.env.BASE_URL}models/cars/previews/${car.previewFile}` : null;
}
