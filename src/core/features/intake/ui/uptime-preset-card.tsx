import { useState, type FormEvent } from "react";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import type { AlertSourceEndpointView } from "../service";

export function UptimePresetCard({ sources, onSaved }: { sources: AlertSourceEndpointView[]; onSaved: () => void }) {
  const components = useAppData<{ components: Array<{ id: string; name: string }> }>("/api/app/components");
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [rows, setRows] = useState([{ monitorId: "", componentId: "" }]);
  const [saved, setSaved] = useState<AlertSourceEndpointView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  function edit(source: AlertSourceEndpointView) { setEditing(source.id); setName(source.name); setRows(source.monitorMappings ?? []); setSecret(""); setSaved(null); setError(null); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const result = await appApi<{ source: AlertSourceEndpointView }>(editing ? `/api/app/intake/sources/${editing}` : "/api/app/intake/sources", { method: editing ? "PUT" : "POST", body: JSON.stringify({ name: name || "Uptime alerts", preset: "uptime", credentialKind: "hmac-sha256", ...(secret ? { signingSecret: secret } : {}), monitorMappings: rows }) });
      setSaved(result.source); setEditing(result.source.id); setSecret(""); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The Uptime source could not be saved."); }
    finally { setSaving(false); }
  }
  return <section className="data-card preset-card uptime-source-card" aria-labelledby="uptime-title">
    <div><h2 id="uptime-title">Connect Uptime</h2><p>Map monitor IDs to components. Confirmed failures create private drafts. Recovery closes only drafts that were never published.</p></div>
    <form className="alert-editor-form" onSubmit={save}>
      <label className="form-label">Uptime label<input maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="Production Uptime" /></label>
      <div className="form-label"><label htmlFor="uptime-hmac-key">Uptime HMAC key</label><input id="uptime-hmac-key" aria-describedby="uptime-key-help" type="password" autoComplete="new-password" required={!editing} value={secret} onChange={event => setSecret(event.target.value)} /><small id="uptime-key-help">{editing ? "Leave blank to retain the saved secret." : "Use the signing secret from Uptime's JSON webhook destination."}</small></div>
      {rows.map((row, index) => <fieldset className="full-width grouped-mapping" key={index}><legend>Uptime monitor mapping {index + 1}</legend>
        <label className="form-label">Uptime monitor ID {index + 1}<input required maxLength={200} value={row.monitorId} onChange={event => setRows(current => current.map((item, i) => i === index ? { ...item, monitorId: event.target.value } : item))} /></label>
        <label className="form-label">Uptime component {index + 1}<select required value={row.componentId} onChange={event => setRows(current => current.map((item, i) => i === index ? { ...item, componentId: event.target.value } : item))}><option value="">Choose a component</option>{components.data?.components.map(component => <option key={component.id} value={component.id}>{component.name}</option>)}</select></label>
        {rows.length > 1 && <Button type="button" variant="secondary" onClick={() => setRows(current => current.filter((_, i) => i !== index))}>Remove Uptime mapping {index + 1}</Button>}
      </fieldset>)}
      <div className="form-actions full-width"><Button type="button" variant="secondary" onClick={() => setRows(current => [...current, { monitorId: "", componentId: "" }])}>Add Uptime monitor</Button><Button disabled={saving}>{saving ? "Saving…" : editing ? "Save Uptime source" : "Create Uptime source"}</Button>{editing && <Button type="button" variant="secondary" onClick={() => { setEditing(null); setName(""); setRows([{ monitorId: "", componentId: "" }]); setSaved(null); }}>New Uptime source</Button>}</div>
    </form>
    {error && <FormError>{error}</FormError>}
    {saved && <div className="preset-created" role="status"><p>Uptime source saved. In Uptime, select the default signed JSON webhook destination, keep signing enabled, and paste this endpoint. Lamp checks X-Lamp-Timestamp and X-Lamp-Signature with a five-minute window.</p><label className="form-label">Uptime endpoint<input readOnly value={saved.endpointUrl} onFocus={event => event.target.select()} /></label></div>}
    {sources.length > 0 && <div className="form-actions">{sources.map(source => <Button key={source.id} type="button" variant="secondary" onClick={() => edit(source)}>Edit Uptime mappings for {source.name}</Button>)}</div>}
  </section>;
}
