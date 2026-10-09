import { useEffect, useRef, useState } from 'react';
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
    onChoosePlace(place, label);
  };

  return (
    <section className="start-screen location-picker" aria-label="Choix du lieu">
      <div className="start-copy">
        <p className="overline"><i /> ÉTAPE 3 · ZONE RÉELLE (BÊTA)</p>
        <h1>Choisissez<br /><em>une route.</em></h1>
        <p className="intro-copy">Les routes viennent d’OpenStreetMap via Overpass : une requête réseau bornée à une petite zone autour de l’adresse choisie.</p>

        <div className="location-search">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher une adresse, une ville…"
            aria-label="Rechercher une adresse"
            autoComplete="off"
          />
          {queryLongEnough && searching && <p className="location-search-status">Recherche…</p>}
          {queryLongEnough && searchError && <p className="location-search-status">Recherche indisponible, réessayez.</p>}
          {queryLongEnough && results.length > 0 && (
            <ul className="location-suggestions" role="listbox">
              {results.map((result) => (
                <li key={`${result.point.latitudeDeg},${result.point.longitudeDeg}`}>
                  <button className="location-option" role="option" onClick={() => choose(result.point, result.label)}>
                    {result.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="location-footer">
          <button className="text-button" onClick={onUseDemoTrack}>PISTE DÉMO HORS LIGNE</button>
          <button className="text-button" onClick={onBack}>RETOUR</button>
        </div>
      </div>
    </section>
  );
}
