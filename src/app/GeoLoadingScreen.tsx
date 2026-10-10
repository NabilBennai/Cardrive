import type { GeoLoadErrorKind } from './geoOrchestrator';

export type GeoLoadingScreenState = { kind: 'loading' } | { kind: 'error'; errorKind: GeoLoadErrorKind };

interface GeoLoadingScreenProps {
  state: GeoLoadingScreenState;
  onRetry: () => void;
  onUseDemoTrack: () => void;
}

const ERROR_COPY: Record<GeoLoadErrorKind, { title: string; detail: string }> = {
  network: { title: 'Pas de connexion aux cartes.', detail: 'Impossible de joindre le fournisseur de cartes. Vérifiez votre connexion puis réessayez.' },
  timeout: { title: 'Le fournisseur met trop de temps.', detail: 'Le fournisseur de cartes ne répond pas assez vite. Réessayez dans un instant.' },
  'rate-limited': { title: 'Service saturé.', detail: 'Le fournisseur limite les requêtes. Patientez un peu avant de réessayer.' },
  http: { title: 'Fournisseur indisponible.', detail: 'Le fournisseur de cartes a renvoyé une erreur. Réessayez, ou choisissez la piste d’essai.' },
  'malformed-response': { title: 'Données illisibles.', detail: 'La réponse du fournisseur de cartes est invalide. Réessayez dans un instant.' },
  'empty-result': { title: 'Aucune route ici.', detail: 'Cette zone ne contient aucune route carrossable. Choisissez un autre lieu.' },
};

export function GeoLoadingScreen({ state, onRetry, onUseDemoTrack }: GeoLoadingScreenProps) {
  if (state.kind === 'loading') {
    return (
      <div className="scene-loading" role="status">
        <span className="spinner" /> Chargement de la zone…
      </div>
    );
  }

  const copy = ERROR_COPY[state.errorKind];
  return (
    <section className="scene-error" role="alert">
      <h2>{copy.title}</h2>
      <p>{copy.detail}</p>
      <button className="btn" onClick={onRetry}>Réessayer</button>
      <button className="btn-quiet" onClick={onUseDemoTrack}>Jouer sur la piste d’essai</button>
    </section>
  );
}
