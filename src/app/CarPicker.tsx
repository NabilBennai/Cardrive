import { CAR_CATALOG, carPreviewUrl } from '../vehicle/catalog/carCatalog';
import { summarizeVehicle, vehicleConfigFor } from '../vehicle/configs/vehicleProfiles';

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
        <p className="lead">Chaque véhicule a sa propre conduite : masse, puissance, adhérence, freinage et transmission dépendent de sa nature. Modèles du Car Kit de Kenney (CC0).</p>

        <ul className="car-grid" role="listbox" aria-label="Voitures">
          {CAR_CATALOG.map((car) => {
            const preview = carPreviewUrl(car);
            const summary = summarizeVehicle(vehicleConfigFor(car.id));
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
                  <span className="car-card-specs">{summary.powerKw} kW · {summary.massKg.toLocaleString('fr-FR')} kg<br />{summary.drive}</span>
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
