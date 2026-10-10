import { CAR_CATALOG, carPreviewUrl } from '../vehicle/catalog/carCatalog';

interface CarPickerProps {
  selectedId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
}

export function CarPicker({ selectedId, onSelect, onBack }: CarPickerProps) {
  return (
    <section className="screen" aria-label="Garage">
      <div className="screen-head">
        <button className="back-button" onClick={onBack} aria-label="Retour au menu">‹</button>
        <div className="brand"><span className="brand-mark">C</span>Cardrive</div>
      </div>
      <div className="screen-body wide">
        <h2>Garage</h2>
        <p className="lead">Choisissez votre voiture. Seul l’aspect change : tous les modèles se conduisent comme le prototype. Modèles du Car Kit de Kenney (CC0).</p>

        <ul className="car-grid" role="listbox" aria-label="Voitures">
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
                  {preview ? <img src={preview} alt="" loading="lazy" width={96} height={72} /> : <span className="car-card-placeholder">R-01</span>}
                  <span>{car.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="screen-footer">
          <button className="btn" onClick={onBack}>Valider</button>
        </div>
      </div>
    </section>
  );
}
