import type { AudioSettings } from './audioSettings';

interface AudioSettingsPanelProps {
  settings: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
}

const SLIDERS: Array<{ key: 'master' | 'engine' | 'effects'; label: string }> = [
  { key: 'master', label: 'Volume général' },
  { key: 'engine', label: 'Moteur' },
  { key: 'effects', label: 'Pneus, vent et chocs' },
];

/** Réglages du son et du ressenti, affichés dans le menu pause. Chaque changement est mémorisé par l'appelant. */
export function AudioSettingsPanel({ settings, onChange }: AudioSettingsPanelProps) {
  return (
    <fieldset className="settings-group">
      <legend>Son et ressenti</legend>
      {SLIDERS.map(({ key, label }) => (
        <label key={key} className="slider-row">
          <span>{label}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(settings[key] * 100)}
            disabled={settings.muted}
            onChange={(event) => onChange({ [key]: Number(event.target.value) / 100 })}
            aria-valuetext={`${Math.round(settings[key] * 100)} %`}
          />
          <output>{Math.round(settings[key] * 100)}</output>
        </label>
      ))}
      <label className="check-row">
        <input type="checkbox" checked={settings.muted} onChange={(event) => onChange({ muted: event.target.checked })} />
        <span>Sans son <kbd>M</kbd></span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={settings.cameraEffects} onChange={(event) => onChange({ cameraEffects: event.target.checked })} />
        <span>Effets de caméra (tremblement, champ de vision)</span>
      </label>
    </fieldset>
  );
}
