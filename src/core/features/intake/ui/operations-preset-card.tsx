import { useRef, useState, type FormEvent } from "react";

import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { isOperationsPreset } from "../operations";
import type { AlertSourceEndpointView } from "../service";
import { OperationsSourceCard } from "./operations-source-card";

type Preset = "jsm" | "opsgenie";
type Mapping = { componentId: string; tag: string; entity: string };
const emptyMapping = (): Mapping => ({ componentId: "", tag: "", entity: "" });

export function OperationsPresetCard({ sources, onSaved }: { sources: AlertSourceEndpointView[]; onSaved: () => void }) {
  const components = useAppData<{ components: Array<{ id: string; name: string }> }>("/api/app/components");
  const tokenInput = useRef<HTMLInputElement>(null);
  const credentialsInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset>("jsm");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [rows, setRows] = useState<Mapping[]>([emptyMapping()]);
  const [closeAlertOnResolve, setCloseAlertOnResolve] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [host, setHost] = useState("https://api.opsgenie.com");
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState<AlertSourceEndpointView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const tool = preset === "jsm" ? "JSM" : "Opsgenie";

  function clearCredentials() {
    setSite(""); setEmail(""); setApiToken(""); setHost("https://api.opsgenie.com"); setApiKey("");
  }

  function reset() {
    setEditing(null); setName(""); setToken(""); setRows([emptyMapping()]); setCloseAlertOnResolve(false);
    setConnecting(false); clearCredentials(); setSaved(null); setError(null);
  }

  function edit(source: AlertSourceEndpointView, connect = false) {
    if (!isOperationsPreset(source.preset)) return;
    setEditing(source.id); setPreset(source.preset); setName(source.name); setToken("");
    setCloseAlertOnResolve(Boolean(source.closeAlertOnResolve)); setConnecting(connect);
    clearCredentials(); setSaved(null); setError(null);
    const mappings = (source.labelMatchers ?? []).map(row => ({ componentId: row.componentId, tag: row.labels.tag ?? "", entity: row.labels.entity ?? "" }));
    setRows(mappings.length ? mappings : [emptyMapping()]);
    if (connect) requestAnimationFrame(() => credentialsInput.current?.focus());
    else tokenInput.current?.focus();
  }

  function updateRow(index: number, field: keyof Mapping, value: string) {
    setRows(current => current.map((row, i) => i === index ? { ...row, [field]: value } : row));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null); setSaved(null);
    try {
      const labelMatchers = rows.map((row, index) => {
        if (!row.componentId || (!row.tag.trim() && !row.entity.trim())) throw new Error(`Mapping ${index + 1} needs a component and an exact tag or entity.`);
        return { componentId: row.componentId, labels: { ...(row.tag ? { tag: row.tag } : {}), ...(row.entity ? { entity: row.entity } : {}) } };
      });
      if (connecting && (preset === "jsm" ? !site.trim() || !email.trim() || !apiToken.trim() : !apiKey.trim())) {
        throw new Error(preset === "jsm" ? "Enter the Atlassian site, account email, and API token to connect JSM." : "Enter an Opsgenie API key to connect outbound notes.");
      }
      const operationsCredentials = !connecting ? undefined : preset === "jsm"
        ? { site: site.trim(), email: email.trim(), apiToken: apiToken.trim() }
        : { host, apiKey: apiKey.trim() };
      const result = await appApi<{ source: AlertSourceEndpointView }>(editing ? `/api/app/intake/sources/${editing}` : "/api/app/intake/sources", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({ name: name.trim() || `${tool} alerts`, preset, credentialKind: "bearer-token", labelMatchers, closeAlertOnResolve, ...(token.trim() ? { bearerToken: token } : {}), ...(operationsCredentials ? { operationsCredentials } : {}) }),
      });
      setSaved(result.source); setEditing(result.source.id); setToken(""); setConnecting(false); clearCredentials(); onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `The ${tool} source could not be saved.`);
    } finally { setSaving(false); }
  }

  return <section className="data-card preset-card grouped-source-card" aria-labelledby="operations-title">
    <div><p className="card-kicker">Responder communication</p><h2 id="operations-title">Connect JSM and Opsgenie</h2><p>Map alert tags or entities to components. Incoming alerts create private drafts; acknowledgments and escalations enter the brief. Responder notes remain internal. Optional API credentials send published updates back to responders.</p></div>
    <form className="alert-editor-form" onSubmit={save}>
      <label className="form-label">Operations tool<select disabled={saving || Boolean(editing)} value={preset} onChange={event => { setPreset(event.target.value as Preset); clearCredentials(); }}><option value="jsm">Jira Service Management Operations</option><option value="opsgenie">Opsgenie</option></select></label>
      <label className="form-label">Connection name<input disabled={saving} maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder={`Production ${tool}`} /></label>
      <label className="form-label full-width">{editing ? "Replacement inbound bearer token (optional)" : "Inbound bearer token (optional)"}<input ref={tokenInput} disabled={saving} type="password" autoComplete="new-password" value={token} onChange={event => setToken(event.target.value)} aria-describedby="operations-token-help" /><small id="operations-token-help">{editing ? "Leave blank to keep the saved token. Enter a replacement to rotate it; update the webhook header in your tool after saving." : "Leave blank for Lamp to generate a token and show it once after creation. Or enter a token you already hold."}</small></label>
      <p className="full-width">Use an exact tag such as <code>component:api</code>, an entity such as <code>api</code>, or both. Both values in a row must match when supplied. Every matching row attaches its component. Unmapped alerts appear in Receipts.</p>
      {components.error && <div className="full-width"><FormError>{components.error}</FormError><Button type="button" variant="secondary" onClick={components.refresh}>Reload components</Button></div>}
      {rows.map((row, index) => <fieldset className="full-width grouped-mapping" key={index} disabled={saving}>
        <legend>{tool} component mapping {index + 1}</legend>
        <label className="form-label">Component {index + 1}<select required value={row.componentId} onChange={event => updateRow(index, "componentId", event.target.value)}><option value="">Choose a component</option>{components.data?.components.map(component => <option key={component.id} value={component.id}>{component.name}</option>)}</select></label>
        <label className="form-label">Alert tag {index + 1}<input maxLength={500} value={row.tag} onChange={event => updateRow(index, "tag", event.target.value)} placeholder="component:api" /></label>
        <label className="form-label">Alert entity {index + 1}<input maxLength={500} value={row.entity} onChange={event => updateRow(index, "entity", event.target.value)} placeholder="api" /></label>
        {rows.length > 1 && <Button type="button" variant="secondary" onClick={() => setRows(current => current.filter((_, i) => i !== index))}>Remove {tool} mapping {index + 1}</Button>}
      </fieldset>)}
      <div className="form-actions full-width"><Button type="button" variant="secondary" disabled={saving || rows.length >= 200} onClick={() => setRows(current => [...current, emptyMapping()])}>Add component mapping</Button></div>
      <label className="form-label full-width"><span><input aria-label="Close alert on resolve" disabled={saving} type="checkbox" checked={closeAlertOnResolve} onChange={event => setCloseAlertOnResolve(event.target.checked)} /> Close alert on resolve</span><small>A Resolved publication also closes the linked {tool} alert when outbound credentials are connected. Incoming Close events never publish a customer update.</small></label>
      <label className="form-label full-width"><span><input disabled={saving} type="checkbox" checked={connecting} onChange={event => { setConnecting(event.target.checked); clearCredentials(); }} /> {editing ? `Connect or replace ${tool} outbound credentials` : `Connect ${tool} outbound notes (optional)`}</span><small>Inbound webhooks use the separate bearer token. API credentials are stored encrypted and never displayed. {editing && "Leave this off to retain saved credentials. "}Saving credentials does not contact the provider.</small></label>
      {connecting && <fieldset className="full-width grouped-mapping" disabled={saving}>
        <legend>{tool} outbound credentials</legend>
        {preset === "jsm" ? <>
          <label className="form-label">Atlassian site<input aria-label="Atlassian site" ref={credentialsInput} required type="url" autoComplete="off" value={site} onChange={event => setSite(event.target.value)} placeholder="https://name.atlassian.net" /><small>Use your HTTPS Atlassian site ending in .atlassian.net.</small></label>
          <label className="form-label">Atlassian account email<input required type="email" autoComplete="off" maxLength={320} value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label className="form-label">Atlassian API token<input required type="password" autoComplete="new-password" value={apiToken} onChange={event => setApiToken(event.target.value)} /></label>
        </> : <>
          <label className="form-label">Opsgenie API region<select value={host} onChange={event => setHost(event.target.value)}><option value="https://api.opsgenie.com">US — api.opsgenie.com</option><option value="https://api.eu.opsgenie.com">EU — api.eu.opsgenie.com</option></select></label>
          <label className="form-label">Opsgenie API key<input ref={credentialsInput} required type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} /></label>
        </>}
        <p>Enter all credentials again when reconnecting after a restore. Saved values cannot be retrieved.</p>
      </fieldset>}
      <div className="form-actions full-width">
        <Button disabled={saving || components.loading || Boolean(components.error)}>{saving ? "Saving…" : connecting ? `Save and connect ${tool}` : editing ? `Save ${tool} source` : `Create ${tool} endpoint`}</Button>
        {editing && <Button type="button" variant="secondary" disabled={saving} onClick={reset}>New operations source</Button>}
      </div>
    </form>
    {error && <FormError>{error}</FormError>}
    {saved && <div className="preset-created" role="status">
      <p>{tool} source saved. Configure the outgoing Webhook integration with this endpoint and a custom <code>Authorization: Bearer</code> header.</p>
      <label className="form-label">{tool} endpoint<input readOnly value={saved.endpointUrl} onFocus={event => event.target.select()} /></label>
      {saved.token && <><p><strong>Copy this authorization header now. The generated token is shown only once.</strong></p><label className="form-label">{tool} authorization header<input readOnly autoComplete="off" value={`Authorization: Bearer ${saved.token}`} onFocus={event => event.target.select()} /></label></>}
    </div>}
    <div className="preset-created"><p>In the tool's outgoing Webhook integration, enable Create, Acknowledge, AddNote, Escalate, and Close. Send the alert payload with its alertId and configured tags or entity. Set the custom header name to <code>Authorization</code> and its value to <code>Bearer</code> followed by a space and your token.</p><p>Alerts stay private until an operator publishes. Close records recovery; an already published incident still needs an operator's resolution update. API credentials are optional and only enable outbound publication notes and the selected close behavior.</p></div>
    {sources.filter(source => isOperationsPreset(source.preset)).map(source => <OperationsSourceCard key={source.id} source={source} disabled={saving} onEdit={() => edit(source)} onReconnect={() => edit(source, true)} onErased={() => { if (editing === source.id) reset(); onSaved(); }} />)}
  </section>;
}
