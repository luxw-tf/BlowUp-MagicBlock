import { updateSettings, useSettings, type Settings } from '../state/settings';

function Slider({ label, k }: { label: string; k: 'master' | 'sfx' | 'music' }) {
  const s = useSettings();
  return (
    <label className="setting">
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={s[k]} onChange={(e) => updateSettings({ [k]: Number(e.target.value) } as Partial<Settings>)} />
      <span className="val">{Math.round(s[k] * 100)}</span>
    </label>
  );
}

function Toggle({ label, k }: { label: string; k: 'reducedShake' | 'reducedEffects' | 'shadows' | 'aimGuide' }) {
  const s = useSettings();
  return (
    <label className="setting toggle">
      <span>{label}</span>
      <input type="checkbox" checked={s[k]} onChange={(e) => updateSettings({ [k]: e.target.checked } as Partial<Settings>)} />
    </label>
  );
}

export function SettingsPanel({ onClose, onLeave }: { onClose: () => void; onLeave?: () => void }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel settings">
        <h2>Settings</h2>
        <h3>Audio</h3>
        <Slider label="Master" k="master" />
        <Slider label="Effects" k="sfx" />
        <Slider label="Music" k="music" />
        <h3>Graphics</h3>
        <Toggle label="Shadows" k="shadows" />
        <Toggle label="Reduced effects" k="reducedEffects" />
        <Toggle label="Reduced screen shake" k="reducedShake" />
        <h3>Controls</h3>
        <Toggle label="Aim guide while holding" k="aimGuide" />
        <div className="controls-grid">
          <kbd>WASD</kbd>
          <span>move</span>
          <kbd>Mouse</kbd>
          <span>aim</span>
          <kbd>LMB</kbd>
          <span>throw bomb</span>
          <kbd>RMB</kbd>
          <span>tag (close range)</span>
          <kbd>Space</kbd>
          <span>dash</span>
          <kbd>E</kbd>
          <span>use item</span>
          <kbd>Esc</kbd>
          <span>settings</span>
        </div>
        <div className="row">
          <button className="btn primary" onClick={onClose}>
            Resume
          </button>
          {onLeave && (
            <button className="btn ghost" onClick={onLeave}>
              Leave match
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
