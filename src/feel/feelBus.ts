/**
 * Petit bus d'événements entre la physique et tout ce qui « réagit » (sons, étincelles, tremblement de caméra), et pour
 * les décalages d'origine flottante que doivent suivre les objets non rattachés aux chunks (particules, traces de pneus,
 * caméra). Hors React : les émetteurs vivent dans la boucle physique ou dans une validation de l'arbre R3F.
 */

export interface ImpactEvent {
  /** 0 à 1 : voir impactIntensity (audioModel.ts). */
  intensity: number;
  /** Point approximatif du contact, en repère de rendu courant. */
  x: number;
  y: number;
  z: number;
  /** Direction horizontale du mouvement juste avant le choc (unitaire) : les étincelles partent vers l'arrière. */
  dirX: number;
  dirZ: number;
}

export interface OriginShiftEvent {
  /** Décalage soustrait à toutes les positions pour passer au nouveau repère (même vecteur que la voiture). */
  dx: number;
  dy: number;
  dz: number;
}

type Listener<T> = (event: T) => void;

function createChannel<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    subscribe(listener: Listener<T>): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    emit(event: T) {
      for (const listener of [...listeners]) listener(event);
    },
    get size() {
      return listeners.size;
    },
  };
}

export const impactChannel = createChannel<ImpactEvent>();
export const originShiftChannel = createChannel<OriginShiftEvent>();
