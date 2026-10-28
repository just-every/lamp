import { useRef, useState } from "react";
import { Button } from "../../../app/client/ui/button";
import { defaultPageTheme, type PageTheme } from "../../../shared/page-theme";
import { ThemePalette } from "./theme-palette";
import { ThemeContent } from "./theme-content";

export interface ThemeComponent { id: string; name: string }

export function ThemeSettings({ value, components, onChange }: {
  value: PageTheme | null; components: ThemeComponent[]; onChange: (theme: PageTheme | null, immediate?: boolean) => void;
}) {
  const current = useRef(value);
  current.current = value;
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const update = <K extends keyof PageTheme>(key: K, next: PageTheme[K], immediate = false) => {
    if (current.current) onChange({ ...current.current, [key]: next }, immediate);
  };

  async function upload(kind: "font" | "image", file: File | undefined) {
    if (!file) return;
    setUploading(true); setUploadStatus(null);
    try {
      const form = new FormData();
      form.set("kind", kind); form.set("asset", file);
      const response = await fetch("/api/app/page-settings/theme-assets", { method: "POST", body: form, headers: { Accept: "application/json" } });
      const result = await response.json() as { error?: string; asset?: { path: string } };
      if (!response.ok || !result.asset) throw new Error(result.error ?? "The upload could not be saved.");
      const theme = current.current;
      if (theme) onChange(kind === "font" ? { ...theme, font: "uploaded", fontAsset: result.asset.path } : { ...theme, headerImage: result.asset.path }, true);
      setUploadStatus(`${kind === "font" ? "Font" : "Image"} uploaded. Its address is ${result.asset.path}`);
    } catch (cause) { setUploadStatus(cause instanceof Error ? cause.message : "The upload could not be saved."); }
    finally { setUploading(false); }
  }

  return <section className="data-card theme-settings" aria-labelledby="theme-title">
    <p className="card-kicker">Your public page</p><h2 id="theme-title">Theme</h2>
    <p>Make the page your own. Valid changes save and publish automatically.</p>
    <label className="checkbox-label"><input type="checkbox" checked={value !== null} onChange={event => onChange(event.target.checked ? structuredClone(defaultPageTheme) : null, true)} />Use a custom theme</label>
    {value && <>
      <ThemePalette value={value.palette} onChange={next => update("palette", next)} />
      <fieldset className="theme-fieldset"><legend>Font and image</legend>
        <div className="settings-grid">
          <label className="form-label">Page font<select value={value.font} onChange={event => update("font", event.target.value as PageTheme["font"], true)}><option value="inter">Inter · bundled</option>{value.fontAsset && <option value="uploaded">Uploaded WOFF2</option>}</select><small>Fonts are served from your page’s own origin.</small></label>
          <label className="form-label">Upload WOFF2 font<input type="file" accept=".woff2,font/woff2" disabled={uploading} onChange={event => { void upload("font", event.target.files?.[0]); event.target.value = ""; }} />{value.fontAsset && <small className="theme-asset-address">{value.fontAsset}</small>}</label>
          <label className="form-label full-width">Upload header image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={event => { void upload("image", event.target.files?.[0]); event.target.value = ""; }} />{value.headerImage && <small className="theme-asset-address">Uploaded image address: {value.headerImage}</small>}</label>
        </div>
        {value.headerImage && <Button type="button" variant="secondary" onClick={() => update("headerImage", null, true)}>Remove header image</Button>}
        {uploadStatus && <p role="status">{uploadStatus}</p>}
      </fieldset>
      <ThemeContent value={value} onChange={update} />
      <fieldset className="theme-fieldset"><legend>Layout and history</legend>
        <label className="checkbox-label"><input type="checkbox" checked={value.groupsExpanded} onChange={event => update("groupsExpanded", event.target.checked, true)} />Expand component groups initially</label>
        <label className="form-label">History days<input type="number" min={1} step={1} value={value.historyDays} onChange={event => update("historyDays", Number(event.target.value))} /></label>
        <div className="theme-uptime"><h3>Component uptime bars</h3><p>Choose which components show an uptime bar on the page.</p>
          {components.length ? components.map(component => <label className="checkbox-label" key={component.id}><input type="checkbox" checked={!value.hiddenUptimeComponents.includes(component.id)} onChange={event => update("hiddenUptimeComponents", event.target.checked ? value.hiddenUptimeComponents.filter(id => id !== component.id) : [...value.hiddenUptimeComponents, component.id], true)} />Show uptime for {component.name}</label>) : <p>Add a public component to choose its uptime visibility.</p>}
        </div>
      </fieldset>
      <fieldset className="theme-fieldset"><legend>Custom CSS</legend>
        <label className="form-label">Page CSS<textarea className="theme-code" rows={7} spellCheck={false} value={value.css} onChange={event => update("css", event.target.value)} /><small>Scoped to your public page and included in its snapshot stylesheet. @import, external url(), expression() and behavior are refused.</small></label>
      </fieldset>
    </>}
  </section>;
}
