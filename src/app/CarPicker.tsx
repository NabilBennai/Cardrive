import { CAR_CATALOG, carPreviewUrl } from '../vehicle/catalog/carCatalog';

interface CarPickerProps {
  selectedId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
}

export function CarPicker({ selectedId, onSelect, onBack }: CarPickerProps) {
  return (
    <section className="start-screen car-picker" aria-label="Choix de la voiture">
      <div className="start-copy">
        <p className="overline"><i /> GARAGE</p>
        <h1>Choisissez<br /><em>une voiture.</em></h1>
        <p className="intro-copy">Modèles du Car Kit de Kenney (CC0). L'habillage change ; la conduite reste celle du prototype.</p>

        <ul className="car-grid" role="listbox" aria-label="Catalogue de voitures">
          {CAR_CATALOG.map((car) => {
            const preview = carPreviewUrl(car);
            return (
              <li key={car.id}>
                <button
                  className={car.id === selectedId ? 'car-card selected' : 'car-card'}
                  role="option"
                  aria-selected={car.id === selectedId}
                  onClick={() => onSelect(car.id)}
                >
                  {preview ? <img src={preview} alt="" loading="lazy" width={96} height={96} /> : <span className="car-card-placeholder">R-01</span>}
                  <span>{car.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="location-footer">
          <button className="text-button" onClick={onBack}>VALIDER</button>
        </div>
      </div>
    </section>
  );
}
