import type { ChangeEvent } from "react";

import { EditableRow } from "./editable-row";
import { PagePreview } from "../../page-settings/ui/page-preview";
import { readFileAsDataUrl } from "../../../app/client/ui/mark-image";

export interface FoundMark { src: string; vector: boolean; from: string | null }
export interface FoundPage {
  pageName: string; tagline: string; accentColor: string; timezone: string;
  mark: FoundMark | null; components: string[]; statusPage: string | null;
}

const zones = () => { try { return Intl.supportedValuesOf("timeZone"); } catch { return []; } };
const shortUrl = (value: string) => value.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
const markHost = (value: string) => new URL(value).hostname.replace(/^www\./, "");

/** What Lamp found, every fact editable, beside a preview of the page it makes. */
export function FoundCard({ page, browserZone, address, onChange }: { page: FoundPage; browserZone: string | null; address: string; onChange: (next: Partial<FoundPage>) => void }) {
  async function chooseMark(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onChange({ mark: { src: await readFileAsDataUrl(file), vector: file.type === "image/svg+xml", from: null } });
  }
  const timezones = zones();
  const components = page.components.map((name) => name.trim()).filter(Boolean);
  return <div className="found-card data-card">
    <div className="found-list">
      <EditableRow label="Page name" name="page name" value={page.pageName} editor={<label className="form-label">Page name<input required maxLength={120} value={page.pageName} onChange={(event) => onChange({ pageName: event.target.value })} /></label>} />
      <EditableRow label="Tagline" name="tagline" value={page.tagline} editor={<label className="form-label">Tagline<textarea required maxLength={280} value={page.tagline} onChange={(event) => onChange({ tagline: event.target.value })} /></label>} />
      <EditableRow label="Logo and marks" name="logo" value={page.mark
        ? <span className="found-mark"><img src={page.mark.src} alt="" /><small>{page.mark.from ? `From ${markHost(page.mark.from)}` : "Your logo"}</small></span>
        : <span className="found-muted">A letter mark from your page name</span>}
        editor={<div className="found-mark-editor"><label className="form-label">Logo file<input type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" onChange={chooseMark} /></label>{page.mark ? <button type="button" className="text-link" onClick={() => onChange({ mark: null })}>Use a letter mark</button> : null}</div>} />
      <EditableRow label="Accent colour" name="accent colour" value={<span className="found-colour"><i style={{ background: page.accentColor }} />{page.accentColor.toUpperCase()}</span>}
        editor={<label className="form-label">Accent colour<span className="found-colour-editor"><input type="color" aria-label="Pick accent colour" value={/^#[0-9a-f]{6}$/i.test(page.accentColor) ? page.accentColor : "#000000"} onChange={(event) => onChange({ accentColor: event.target.value.toUpperCase() })} /><input required pattern="#[0-9A-Fa-f]{6}" value={page.accentColor} onChange={(event) => onChange({ accentColor: event.target.value })} /></span></label>} />
      <EditableRow label="Time zone" name="time zone" value={<>{page.timezone}{browserZone === page.timezone ? <span className="found-muted"> (from your browser)</span> : null}</>}
        editor={<label className="form-label">Time zone{timezones.length ? <select value={page.timezone} onChange={(event) => onChange({ timezone: event.target.value })}>{(timezones.includes(page.timezone) ? timezones : [page.timezone, ...timezones]).map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select> : <input required maxLength={100} value={page.timezone} onChange={(event) => onChange({ timezone: event.target.value })} />}</label>} />
      <EditableRow label={components.length ? `Components (${components.length} found)` : "Components"} name="components" value={components.length ? <ul className="found-components">{components.map((name, index) => <li key={index}>{name}</li>)}</ul> : <span className="found-muted">None yet; add them any time</span>}
        editor={<><textarea id="first-run-components" aria-label="Components" rows={Math.max(3, page.components.length)} aria-describedby="first-run-components-help" value={page.components.join("\n")} onChange={(event) => onChange({ components: event.target.value.split("\n").map((name) => name.trimStart()).slice(0, 20) })} /><small className="field-hint" id="first-run-components-help">One per line.</small></>} />
      {page.statusPage ? <div className="found-row" data-found="status page"><p className="found-label">Your current status page</p><div className="found-value">{shortUrl(page.statusPage)}<small className="found-muted found-note">Move its history in later from Settings.</small></div></div> : null}
    </div>
    <div className="found-preview">
      <PagePreview pageName={page.pageName || "Status"} accentColor={page.accentColor} markSrc={page.mark?.src ?? null} components={components.map((name) => ({ name }))} address={address} />
      <p className="found-caption">Preview of {address}</p>
    </div>
  </div>;
}
