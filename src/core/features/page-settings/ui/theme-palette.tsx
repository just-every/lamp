import { COMPONENT_STATES } from "../../../shared/domain";
import type { PageTheme } from "../../../shared/page-theme";

function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="form-label">{label}<span className="theme-colour-field">
    <span aria-hidden="true" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(value) ? value : "transparent" }} />
    <input spellCheck={false} maxLength={7} value={value} onChange={event => onChange(event.target.value)} />
  </span></label>;
}

export function ThemePalette({ value, onChange }: { value: PageTheme["palette"]; onChange: (palette: PageTheme["palette"]) => void }) {
  return <fieldset className="theme-fieldset"><legend>Colours</legend>
    <p>Text, links and state colours must each meet 4.5:1 contrast against both background and surface before they can go live.</p>
    <div className="settings-grid">
      {(["background", "surface", "text", "link"] as const).map(key => <ColourField key={key} label={`${key[0]!.toUpperCase()}${key.slice(1)} colour`} value={value[key]} onChange={next => onChange({ ...value, [key]: next })} />)}
      {COMPONENT_STATES.map(state => <ColourField key={state} label={`${state} colour`} value={value.states[state]} onChange={next => onChange({ ...value, states: { ...value.states, [state]: next } })} />)}
    </div>
  </fieldset>;
}
