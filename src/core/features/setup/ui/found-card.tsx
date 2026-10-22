import type { ChangeEvent } from "react";

import { EditableRow } from "./editable-row";
import { FoundComponents, foundLayout } from "./found-components";
import { PagePreview } from "../../page-settings/ui/page-preview";
import { readFileAsDataUrl } from "../../../app/client/ui/mark-image";

export interface FoundMark { src: string; vector: boolean; from: string | null }
/** The status page the business already runs, as its public feeds listed it when setup read it. */
export interface FoundExisting {
  url: string; host: string; source: "statuspage" | "instatus" | "betterstack";
  components: Array<{ id: string; name: string; group: string | null }>; pastIncidents: number;
}
export interface FoundPage {
  pageName: string; tagline: string; accentColor: string; timezone: string;
  mark: FoundMark | null; statusPage: string | null;
  /** Components outside any group, and the page's own groups with theirs. */
  components: string[]; groups: Array<{ name: string; components: string[] }>;
  existing: FoundExisting | null;
  /** The owner chose to bring the existing page's past incidents across as resolved history. */
  history: boolean;
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
  const layout = foundLayout(page);
  // In the public page's order: each group's components, then the rest.
  const components = [...layout.groups.flatMap((group) => group.components.map((name) => ({ name, group: group.name }))), ...layout.components.map((name) => ({ name, group: null }))];
  const pastIncidents = page.existing?.pastIncidents ?? 0;
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
      <FoundComponents page={page} onChange={onChange} />
      {page.statusPage ? <div className="found-row" data-found="status page"><p className="found-label">Your current status page</p><div className="found-value">{shortUrl(page.statusPage)}
        {pastIncidents ? <label className="found-history"><input type="checkbox" aria-labelledby="first-run-history" aria-describedby="first-run-history-note" checked={page.history} onChange={(event) => onChange({ history: event.target.checked })} /><span><span id="first-run-history">Bring its incident history too</span><small id="first-run-history-note" className="found-muted found-note">{pastIncidents} past incident{pastIncidents === 1 ? "" : "s"}, added as resolved history. No one is notified.</small></span></label>
          : page.existing ? null : <small className="found-muted found-note">Move its history in later from Settings.</small>}</div></div> : null}
    </div>
    <div className="found-preview">
      <PagePreview pageName={page.pageName || "Status"} accentColor={page.accentColor} markSrc={page.mark?.src ?? null} components={components} address={address} />
      <p className="found-caption">Preview of {address}</p>
    </div>
  </div>;
}
