import { useEffect, useRef, useState } from 'react';
import { loadRecentPlaces, saveRecentPlace, type RecentPlace } from '../map/recentPlaces';
import { MIN_QUERY_LENGTH, searchAddress, type GeocodeResult } from '../map/geocodeProvider';
import type { GeoPoint } from '../shared/types';

interface LocationPickerProps {
  onChoosePlace: (place: GeoPoint, label: string) => void;
  onUseDemoTrack: () => void;
  onBack: () => void;
}

const SEARCH_DEBOUNCE_MS = 450;

export function LocationPicker({ onChoosePlace, onUseDemoTrack, onBack }: LocationPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [recents, setRecents] = useState<RecentPlace[]>(loadRecentPlaces);
  const abortRef = useRef<AbortController | null>(null);

  const queryLongEnough = query.trim().length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    abortRef.current?.abort();
    if (!queryLongEnough) return;
    const timer = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      setSearching(true);
      setSearchError(false);
      searchAddress(query, controller.signal)
        .then((found) => { if (!controller.signal.aborted) { setResults(found); setSearching(false); } })
        .catch(() => { if (!controller.signal.aborted) { setSearchError(true); setSearching(false); } });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, queryLongEnough]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const choose = (place: GeoPoint, label: string) => {
    abortRef.current?.abort();
    setResults([]);
    setQuery('');
    setRecents(saveRecentPlace({ label, point: place }));
    onChoosePlace(place, label);
  };

  return (
    <section className="screen" aria-label="Choix du lieu">
      <div className="screen-head">
        <button className="back-button" onClick={onBack} aria-label="Retour au menu">‹</button>
        <div className="brand"><span className="brand-mark">C</span>Cardrive</div>
      </div>
      <div className="screen-body">
        <h2>Où voulez-vous rouler ?</h2>
        <p className="lead">Entrez une adresse ou une ville. Les routes viennent d’OpenStreetMap et se chargent autour de ce point.</p>

        <div className="search-field">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Adresse, ville, lieu…"
            aria-label="Rechercher une adresse"
            autoComplete="off"
            autoFocus
          />
        </div>
        {queryLongEnough && searching && <p className="field-status">Recherche en cours…</p>}
        {queryLongEnough && searchError && <p className="field-status">Recherche indisponible. Réessayez dans un instant.</p>}
        {queryLongEnough && results.length > 0 && (
          <ul className="option-list" role="listbox">
            {results.map((result) => (
              <li key={`${result.point.latitudeDeg},${result.point.longitudeDeg}`}>
                <button className="option" role="option" onClick={() => choose(result.point, result.label)}>
                  {result.label}
                </button>
              </li>
            ))}
          </ul>
        )}

        {!queryLongEnough && recents.length > 0 && (
          <>
            <p className="group-title">Derniers lieux</p>
            <ul className="option-list">
              {recents.map((recent) => (
                <li key={`${recent.point.latitudeDeg},${recent.point.longitudeDeg}`}>
                  <button className="option" onClick={() => choose(recent.point, recent.label)}>
                    {recent.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="screen-footer">
          <button className="btn-quiet" onClick={onUseDemoTrack}>Jouer sur la piste d’essai</button>
        </div>
      </div>
    </section>
  );
}
