import { useState } from 'react';
import { PREDEFINED_PLACES } from '../map/predefinedPlaces';
import type { GeoPoint } from '../shared/types';

interface LocationPickerProps {
  onChoosePlace: (place: GeoPoint, label: string) => void;
  onUseDemoTrack: () => void;
  onBack: () => void;
}

export function LocationPicker({ onChoosePlace, onUseDemoTrack, onBack }: LocationPickerProps) {
  const [latitudeText, setLatitudeText] = useState('');
  const [longitudeText, setLongitudeText] = useState('');

  const submitManual = () => {
    const latitudeDeg = Number.parseFloat(latitudeText);
    const longitudeDeg = Number.parseFloat(longitudeText);
    if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) return;
    onChoosePlace({ latitudeDeg, longitudeDeg }, `${latitudeDeg.toFixed(4)}, ${longitudeDeg.toFixed(4)}`);
  };

  return (
    <section className="start-screen location-picker" aria-label="Choix du lieu">
      <div className="start-copy">
        <p className="overline"><i /> ÉTAPE 3 · ZONE RÉELLE (BÊTA)</p>
        <h1>Choisissez<br /><em>une route.</em></h1>
        <p className="intro-copy">Les routes viennent d’OpenStreetMap via Overpass : une requête réseau bornée à une petite zone autour du point choisi.</p>

        <div className="location-list" role="list">
          {PREDEFINED_PLACES.map((place) => (
            <button
              key={place.label}
              className="location-option"
              role="listitem"
              onClick={() => onChoosePlace({ latitudeDeg: place.latitudeDeg, longitudeDeg: place.longitudeDeg }, place.label)}
            >
              {place.label}
            </button>
          ))}
        </div>

        <div className="location-manual">
          <label>
            LATITUDE
            <input type="number" step="any" value={latitudeText} onChange={(event) => setLatitudeText(event.target.value)} placeholder="48.8738" />
          </label>
          <label>
            LONGITUDE
            <input type="number" step="any" value={longitudeText} onChange={(event) => setLongitudeText(event.target.value)} placeholder="2.2950" />
          </label>
          <button className="start-button" onClick={submitManual}><span>CHARGER CETTE ZONE</span><b>↗</b></button>
        </div>

        <div className="location-footer">
          <button className="text-button" onClick={onUseDemoTrack}>PISTE DÉMO HORS LIGNE</button>
          <button className="text-button" onClick={onBack}>RETOUR</button>
        </div>
      </div>
    </section>
  );
}
