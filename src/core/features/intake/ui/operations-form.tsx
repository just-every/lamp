import { useState, type FormEvent } from "react";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import type { OperationsPreset } from "../vendor-alerts";
import { ComponentOptions, CopyField, SaveNote, ToolHeading } from "./tool-parts";
import { useSourceAutosave } from "./use-source-autosave";
import { toolDoes, toolLabel, type ComponentOption, type Source } from "./tools";

type Row = { componentId: string; tag: string; entity: string; affectedService: string };
const empty = (): Row => ({ componentId: "", tag: "", entity: "", affectedService: "" });

/** Operations uses the existing alert-source card and component matcher rows.
 * Credentials save only on explicit submit and are cleared from the form. */
export function OperationsForm({ tool, source, components, name, onConnected, onSaved, onClose }: { tool: OperationsPreset; source: Source | null; components: ComponentOption[]; name: string; onConnected: () => void; onSaved: () => void; onClose: () => void }) {
  const autosave = useSourceAutosave(source?.id ?? "", onSaved);
  const [rows, setRows] = useState<Row[]>(() => source?.labelMatchers?.map(row => ({ componentId: row.componentId, tag: row.labels.tag ?? "", entity: row.labels.entity ?? "", affectedService: row.labels.affected_service ?? "" })) ?? [empty()]);
  const [closeOnResolve, setClose] = useState(source?.closeAlertOnResolve ?? false);
  const [apiKey, setKey] = useState("");
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [made, setMade] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = rows.length > 0 && rows.every(row => row.componentId && (row.tag.trim() || row.entity.trim() || row.affectedService.trim()));
  const choices = (nextRows: Row[], close: boolean) => ({ name: source?.name ?? name, preset: tool, credentialKind: "bearer-token", closeAlertOnResolve: close, labelMatchers: nextRows.map(row => ({ componentId: row.componentId, labels: { ...(row.tag.trim() ? { tag: row.tag.trim() } : {}), ...(row.entity.trim() ? { entity: row.entity.trim() } : {}), ...(row.affectedService.trim() ? { affected_service: row.affectedService.trim() } : {}) } })) });
  function saveChoices(nextRows: Row[], close: boolean, immediate: boolean) {
    if (source && nextRows.length && nextRows.every(row => row.componentId && (row.tag.trim() || row.entity.trim() || row.affectedService.trim()))) autosave.save(choices(nextRows, close), immediate);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const input = { ...choices(rows, closeOnResolve), ...(apiKey.trim() ? { operationsApiKey: apiKey.trim(), ...(tool === "jsm" ? { atlassianSite: site.trim(), atlassianEmail: email.trim() } : {}) } : {}) };
      const result = await appApi<{ source: Source }>(`/api/app/intake/sources${source ? `/${source.id}` : ""}`, { method: source ? "PUT" : "POST", body: JSON.stringify(input) });
      setKey(""); setEmail(""); setSite("");
      if (!source) { setMade(result.source); onConnected(); } else { onSaved(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The source could not be saved."); }
    finally { setBusy(false); }
  }
  function change(index: number, field: keyof Row, value: string) { const next = rows.map((row, i) => i === index ? { ...row, [field]: value } : row); setRows(next); saveChoices(next, closeOnResolve, field === "componentId"); }
  function remove(index: number) { const next = rows.filter((_, i) => i !== index); setRows(next); saveChoices(next, closeOnResolve, true); }
  return <section className="data-card tool-form" aria-labelledby="tool-form-title">
    <ToolHeading title={source?.name ?? `Connect ${toolLabel(tool)}`} does={toolDoes(tool)} close={{ label: "Close", onClick: onClose }} />
    {made ? <div className="shown-once">
      <p role="status">Copy the bearer token now; it is shown once. In the outgoing Webhook integration, enable Create, Acknowledge, AddNote, Escalate and Close and send the Authorization header below.</p>
      <CopyField label="Webhook address" value={made.endpointUrl} copy="Copy address" />
      <CopyField label="Authorization header" value={`Bearer ${made.token}`} copy="Copy header" />
      <Button type="button" onClick={onClose}>Done</Button>
    </div> : <form className="tool-fields" onSubmit={submit}>
      {source && <><CopyField label="Webhook address" value={source.endpointUrl} copy="Copy address" /><p className="tool-note">{source.responderConnection === "reconnect" ? "Reconnect the provider to resume notes after restore." : source.responderConnection === "connected" ? "The provider connection is saved. A new key replaces it." : "Provider credentials are optional. Connect them to send published updates back as notes."}</p></>}
      {source && <SaveNote phase={autosave.phase} error={autosave.error} retry={autosave.retry} held={autosave.held} />}
      <p className="tool-note">Every filled value in a row must match that alert.</p>
      <ul className="label-rows">{rows.map((row, index) => <li className="label-row service-row" key={index}>
        <label className="form-label">Component<select aria-label={`Component ${index + 1}`} value={row.componentId} onChange={event => change(index, "componentId", event.target.value)}><ComponentOptions components={components} empty="Choose a component" /></select></label>
        <label className="form-label">Tag<input aria-label={`Tag ${index + 1}`} maxLength={500} value={row.tag} onChange={event => change(index, "tag", event.target.value)} placeholder="component:api" /></label>
        <label className="form-label">Entity<input aria-label={`Entity ${index + 1}`} maxLength={500} value={row.entity} onChange={event => change(index, "entity", event.target.value)} /></label>
        {tool === "jsm" && <label className="form-label">Affected service<input aria-label={`Affected service ${index + 1}`} maxLength={500} value={row.affectedService} onChange={event => change(index, "affectedService", event.target.value)} /></label>}
        {rows.length > 1 && <Button type="button" variant="secondary" onClick={() => remove(index)}>Remove</Button>}
      </li>)}</ul>
      <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setRows([...rows, empty()])}>Add a matcher</Button></div>
      <label className="checkbox-label"><input type="checkbox" checked={closeOnResolve} onChange={event => { setClose(event.target.checked); saveChoices(rows, event.target.checked, true); }} />Close alert on resolve</label>
      {tool === "jsm" && <><label className="form-label">Atlassian site<input type="url" placeholder="https://your-site.atlassian.net" value={site} required={Boolean(apiKey)} onChange={event => setSite(event.target.value)} /></label><label className="form-label">Atlassian account email<input type="email" value={email} required={Boolean(apiKey)} autoComplete="off" onChange={event => setEmail(event.target.value)} /></label></>}
      <label className="form-label">{tool === "jsm" ? "Atlassian API token" : "Opsgenie API key"}<input type="password" value={apiKey} autoComplete="new-password" onChange={event => setKey(event.target.value)} /></label>
      <div className="form-actions"><Button disabled={busy || !valid || Boolean(source && !apiKey.trim())}>{busy ? "Saving…" : source ? "Save key" : `Connect ${toolLabel(tool)}`}</Button></div>
    </form>}
    {error && <FormError>{error}</FormError>}
  </section>;
}
