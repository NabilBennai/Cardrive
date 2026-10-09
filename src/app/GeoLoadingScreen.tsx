import type { GeoLoadErrorKind } from './geoOrchestrator';

export type GeoLoadingScreenState = { kind: 'loading' } | { kind: 'error'; errorKind: GeoLoadErrorKind };

interface GeoLoadingScreenProps {
  state: GeoLoadingScreenState;
  onRetry: () => void;
  onUseDemoTrack: () => void;
}

const ERROR_COPY: Record<GeoLoadErrorKind, { title: string; detail: string }> = {
  network: { title: 'Le réseau\nne répond pas.', detail: 'Impossible de joindre le fournisseur de cartes.' },
  timeout: { title: 'Le réseau\nne répond pas.', detail: 'Le fournisseur de cartes met trop de temps à répondre.' },
  'rate-limited': { title: 'Service\nsaturé.', detail: 'Le fournisseur limite les requêtes, réessayez plus tard.' },
  http: { title: 'Fournisseur\nindisponible.', detail: 'Le fournisseur de cartes a répondu une erreur.' },
  'malformed-response': { title: 'Données\ninvalides.', detail: 'La réponse du fournisseur de cartes est illisible.' },
  'empty-result': { title: 'Aucune route\nici.', detail: 'Cette zone ne contient aucune voie carrossable. Choisissez un autre lieu.' },
};

export function GeoLoadingScreen({ state, onRetry, onUseDemoTrack }: GeoLoadingScreenProps) {
  if (state.kind === 'loading') {
    return (
      <div className="scene-loading" role="status">
        <i /> CHARGEMENT DE LA ZONE
      </div>
    );
  }

  const copy = ERROR_COPY[state.errorKind];
  return (
    <section className="scene-error" role="alert">
      <p className="overline"><i /> CHARGEMENT IMPOSSIBLE</p>
      <h2>{copy.title.split('\n').map((line, index) => <span key={index}>{line}<br /></span>)}</h2>
      <p>{copy.detail}</p>
      <button className="start-button" onClick={onRetry}><span>RÉESSAYER</span><b>↻</b></button>
      <button className="text-button" onClick={onUseDemoTrack}>REVENIR À LA PISTE DÉMO</button>
    </section>
  );
}
