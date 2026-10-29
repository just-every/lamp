import type { PageTheme } from "../../../shared/page-theme";
import type { PageSettingsView } from "../service";
import { ThemeLinks } from "./theme-links";
import { ThemeAsset } from "./theme-assets";

const initialPalette: NonNullable<PageTheme["palette"]> = {
  background: "#f8f6f0", surface: "#ffffff", text: "#182d24", link: "#165b3e",
  operational: "#166744", degraded: "#805600", partial: "#985100", major: "#a12b20", maintenance: "#37588b",
};
const colors: Array<[keyof NonNullable<PageTheme["palette"]>, string]> = [
  ["background", "Background"], ["surface", "Surface"], ["text", "Text"], ["link", "Links"],
  ["operational", "Operational"], ["degraded", "Degraded performance"], ["partial", "Partially unavailable"],
  ["major", "Major outage"], ["maintenance", "Maintenance"],
];

export function ThemeSettings({ value, saved, components, onChange, onSettings, busy, setBusy }: {
  value: PageTheme; saved: PageSettingsView; components: Array<{ id: string; name: string }>;
  onChange: (theme: PageTheme) => void;
  onSettings: (settings: PageSettingsView, asset: "font" | "header") => void;
  busy: boolean; setBusy: (busy: boolean) => void;
}) {
  const edit = <K extends keyof PageTheme>(field: K, next: PageTheme[K]) => onChange({ ...value, [field]: next });
  return <section className="data-card" aria-labelledby="theme-title">
    <p className="card-kicker">Public page</p><h2 id="theme-title">Theme</h2>
    <p>Customize your page’s colours, typography and layout. Changes save as you go.</p>
    {Boolean(saved.themeRemovals?.length) && <div className="capability-note" role="status"><div>
      <p>Removed from your saved theme:</p><ul>{saved.themeRemovals!.map((removal, index) => <li key={index}>{removal}</li>)}</ul>
    </div></div>}
    <details className="brand-upload">
      <summary>Colours</summary>
      <div className="page-stack">
        <label className="checkbox-label"><input type="checkbox" checked={value.paletteEnabled} onChange={event => onChange({ ...value, paletteEnabled: event.target.checked, palette: value.palette ?? (event.target.checked ? { ...initialPalette } : null) })} />Use a custom colour palette</label>
        {value.paletteEnabled && value.palette && <>
          <p className="field-note">Text, links and state colours must pass AA contrast on the background and surface before saving.</p>
          <div className="settings-grid">{colors.map(([key, label]) => <label className="form-label" key={key}>{label}
            <span className="colour-field" style={{ gridTemplateColumns: "48px minmax(0, 1fr)" }}>
              <input type="color" aria-label={`Pick ${label.toLowerCase()} colour`} value={/^#[0-9a-f]{6}$/i.test(value.palette![key]) ? value.palette![key] : initialPalette[key]} onChange={event => edit("palette", { ...value.palette!, [key]: event.target.value })} />
              <input aria-label={`${label} hex colour`} required pattern="#[0-9A-Fa-f]{6}" value={value.palette![key]} onChange={event => edit("palette", { ...value.palette!, [key]: event.target.value })} />
            </span>
          </label>)}</div>
        </>}
      </div>
    </details>
    <details className="brand-upload">
      <summary>Font and header image</summary>
      <div className="page-stack">
        <label className="form-label">Page font<select value={value.font} onChange={event => edit("font", event.target.value as PageTheme["font"])}>
          <option value="default">Bundled default font</option><option value="system">Local system sans serif</option>
          <option value="serif">Local system serif</option><option value="mono">Local system monospace</option><option value="uploaded" disabled={!saved.themeAssetAvailability.font}>Uploaded WOFF2 font</option>
        </select><small>Upload a WOFF2 file before choosing the uploaded font.</small></label>
        <ThemeAsset kind="font" present={saved.themeAssetAvailability.font} busy={busy} setBusy={setBusy} onSettings={onSettings} />
        <label className="checkbox-label"><input type="checkbox" checked={value.headerImage} onChange={event => edit("headerImage", event.target.checked)} />Show the uploaded header image</label>
        <ThemeAsset kind="header" present={saved.themeAssetAvailability.header} busy={busy} setBusy={setBusy} onSettings={onSettings} />
      </div>
    </details>
    <details className="brand-upload">
      <summary>Header and footer links</summary>
      <div className="page-stack">
        <ThemeLinks title="Header" value={value.headerLinks} onChange={links => edit("headerLinks", links)} />
        <ThemeLinks title="Footer" value={value.footerLinks} onChange={links => edit("footerLinks", links)} />
      </div>
    </details>
    <details className="brand-upload">
      <summary>Layout and history</summary>
      <div className="page-stack">
        <label className="checkbox-label"><input type="checkbox" checked={value.groupsCollapsed} onChange={event => edit("groupsCollapsed", event.target.checked)} />Collapse component groups by default</label>
        <label className="form-label">History days<input type="number" min={1} max={90} step={1} value={Number.isNaN(value.historyDays) ? "" : value.historyDays} onChange={event => edit("historyDays", event.target.valueAsNumber)} /><small>Show between 1 and 90 days of history.</small></label>
        <div className="page-stack"><h3>Uptime bars</h3>
          {components.length ? components.map(component => <label className="checkbox-label" key={component.id}>
            <input type="checkbox" checked={!value.hiddenUptimeComponentIds.includes(component.id)} onChange={event => edit("hiddenUptimeComponentIds", event.target.checked ? value.hiddenUptimeComponentIds.filter(id => id !== component.id) : [...value.hiddenUptimeComponentIds, component.id])} />Show uptime for {component.name}
          </label>) : <p className="field-note">Add a public component to choose whether its uptime bar appears.</p>}
        </div>
      </div>
    </details>
    <details className="brand-upload">
      <summary>Custom HTML and CSS</summary>
      <div className="page-stack">
        <p className="field-note">Header and footer HTML are sanitized when saved. Scripts, event handlers and external images are removed.</p>
        <label className="form-label">Header HTML<textarea value={value.headerHtml} onChange={event => edit("headerHtml", event.target.value)} rows={6} spellCheck={false} /><small>Up to 8 KB.</small></label>
        <label className="form-label">Footer HTML<textarea value={value.footerHtml} onChange={event => edit("footerHtml", event.target.value)} rows={6} spellCheck={false} /><small>Up to 8 KB.</small></label>
        <label className="form-label">Custom CSS<textarea value={value.customCss} onChange={event => edit("customCss", event.target.value)} rows={8} spellCheck={false} /><small>Applies to your public page. External imports, external URLs, expression() and behavior are refused.</small></label>
      </div>
    </details>
  </section>;
}
