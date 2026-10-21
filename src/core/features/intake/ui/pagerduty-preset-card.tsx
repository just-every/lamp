import { useRef, useState, type FormEvent } from "react";

import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import type { AlertSourceEndpointView } from "../service";
import { PagerDutySourceCard } from "./pagerduty-source-card";

type Mapping = { componentId: string; serviceId: string; serviceName: string };
const emptyMapping = (): Mapping => ({ componentId: "", serviceId: "", serviceName: "" });

export function PagerDutyPresetCard({ sources, onSaved }: { sources: AlertSourceEndpointView[]; onSaved: () => void }) {
  const components = useAppData<{ components: Array<{ id: string; name: string }> }>("/api/app/components");
  const apiKeyInput = useRef<HTMLInputElement>(null);
  const signingSecretInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [rows, setRows] = useState<Mapping[]>([emptyMapping()]);
  const [saved, setSaved] = useState<AlertSourceEndpointView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editingSource = saved?.id === editing ? saved : sources.find(source => source.id === editing);

  function reset() {
    setEditing(null); setName(""); setSecret(""); setApiKey(""); setFromEmail(""); setReconnecting(false);
    setRows([emptyMapping()]); setSaved(null); setError(null);
  }

  function edit(source: AlertSourceEndpointView, reconnect = false) {
    setEditing(source.id); setName(source.name); setSecret(""); setApiKey(""); setFromEmail("");
    setReconnecting(reconnect); setSaved(null); setError(null);
    const mappings = (source.labelMatchers ?? []).map(row => ({ componentId: row.componentId, serviceId: row.labels.service_id ?? "", serviceName: row.labels.service_name ?? "" }));
    setRows(mappings.length ? mappings : [emptyMapping()]);
    if (reconnect) apiKeyInput.current?.focus();
    else signingSecretInput.current?.focus();
  }

  function updateRow(index: number, field: keyof Mapping, value: string) {
    setRows(current => current.map((row, i) => i === index ? { ...row, [field]: value } : row));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null); setSaved(null);
    try {
      if (reconnecting && !apiKey.trim()) throw new Error("Enter a replacement PagerDuty REST API key to reconnect.");
      const labelMatchers = rows.map((row, index) => {
        if (!row.componentId || (!row.serviceId.trim() && !row.serviceName.trim())) throw new Error(`Mapping ${index + 1} needs a component and a service ID or service name.`);
        return { componentId: row.componentId, labels: { ...(row.serviceId ? { service_id: row.serviceId } : {}), ...(row.serviceName ? { service_name: row.serviceName } : {}) } };
      });
      const result = await appApi<{ source: AlertSourceEndpointView }>(editing ? `/api/app/intake/sources/${editing}` : "/api/app/intake/sources", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({ name: name.trim() || "PagerDuty alerts", preset: "pagerduty", credentialKind: "hmac-sha256", labelMatchers, ...(secret.trim() ? { signingSecret: secret } : {}), ...(apiKey.trim() ? { pagerDutyApiKey: apiKey.trim(), ...(fromEmail.trim() ? { pagerDutyFromEmail: fromEmail.trim() } : {}) } : {}) }),
      });
      setSaved(result.source); setEditing(result.source.id); setSecret(""); setApiKey(""); setFromEmail(""); setReconnecting(false); onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The PagerDuty source could not be saved.");
    } finally { setSaving(false); }
  }

  return <section className="data-card preset-card grouped-source-card" aria-labelledby="pagerduty-title">
    <div><p className="card-kicker">Responder communication</p><h2 id="pagerduty-title">Connect PagerDuty</h2><p>Signed PagerDuty incidents create private drafts on mapped components. Acknowledgments and escalations enter the incident brief. Connect a REST API key to send each published update and its permalink back as a PagerDuty incident note.</p></div>
    <form className="alert-editor-form" onSubmit={save}>
      <label className="form-label">PagerDuty name<input maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="Production PagerDuty" /></label>
      <label className="form-label">PagerDuty subscription secret<input ref={signingSecretInput} aria-label="PagerDuty subscription secret" type="password" autoComplete="new-password" value={secret} onChange={event => setSecret(event.target.value)} aria-describedby="pagerduty-secret-help" /><small id="pagerduty-secret-help">{editingSource?.webhookConnected ? "Leave blank to keep the existing signing secret." : editing ? "Paste the secret generated by your PagerDuty v3 webhook subscription, then save this source. Inbound webhooks are refused until a secret is saved." : "Leave blank to create an endpoint first, or enter an existing subscription's secret. Inbound webhooks are refused until a secret is saved."}</small></label>
      <label className="form-label full-width">{reconnecting ? "Reconnect PagerDuty REST API key" : "PagerDuty REST API key (optional)"}<input ref={apiKeyInput} type="password" autoComplete="new-password" required={reconnecting} value={apiKey} onChange={event => setApiKey(event.target.value)} aria-describedby="pagerduty-api-help" /><small id="pagerduty-api-help">Stored encrypted and never displayed. {editing ? "Leave blank to keep the existing key. " : ""}Without a connected key, signed inbound webhooks still work; publications cannot send responder notes.</small></label>
      <label className="form-label full-width">PagerDuty user email (optional)<input type="email" autoComplete="off" maxLength={254} disabled={!apiKey.trim()} value={fromEmail} onChange={event => setFromEmail(event.target.value)} aria-describedby="pagerduty-email-help" /><small id="pagerduty-email-help">With a new API key, enter a valid PagerDuty user's email for note requests. Leave blank to use the Lamp owner's email. Stored encrypted with the key and never displayed; leaving the API key blank preserves both saved values.</small></label>
      <p className="full-width">Match <code>service_id</code>, <code>service_name</code>, or both. Values must match exactly; both fields in a row must match when supplied. Every matching row attaches its component. Unmapped events appear in Receipts.</p>
      {components.error && <div className="full-width"><FormError>{components.error}</FormError><Button type="button" variant="secondary" onClick={components.refresh}>Reload components</Button></div>}
      {rows.map((row, index) => <fieldset className="full-width grouped-mapping" key={index} disabled={saving}>
        <legend>PagerDuty service mapping {index + 1}</legend>
        <label className="form-label">Component {index + 1}<select required value={row.componentId} onChange={event => updateRow(index, "componentId", event.target.value)}><option value="">Choose a component</option>{components.data?.components.map(component => <option key={component.id} value={component.id}>{component.name}</option>)}</select></label>
        <label className="form-label">PagerDuty service ID {index + 1}<input maxLength={500} value={row.serviceId} onChange={event => updateRow(index, "serviceId", event.target.value)} placeholder="PABC123" /></label>
        <label className="form-label">PagerDuty service name {index + 1}<input maxLength={500} value={row.serviceName} onChange={event => updateRow(index, "serviceName", event.target.value)} placeholder="Production API" /></label>
        {rows.length > 1 && <Button type="button" variant="secondary" onClick={() => setRows(current => current.filter((_, i) => i !== index))}>Remove PagerDuty mapping {index + 1}</Button>}
      </fieldset>)}
      <div className="form-actions full-width"><Button type="button" variant="secondary" disabled={saving} onClick={() => setRows(current => [...current, emptyMapping()])}>Add service mapping</Button><Button disabled={saving || components.loading || Boolean(components.error)}>{saving ? "Saving…" : reconnecting ? "Save and reconnect PagerDuty" : editing ? "Save PagerDuty source" : "Create PagerDuty endpoint"}</Button>{editing && <Button type="button" variant="secondary" disabled={saving} onClick={reset}>New PagerDuty source</Button>}</div>
    </form>
    {error && <FormError>{error}</FormError>}
    {saved && <div className="preset-created" role="status"><p>{saved.webhookConnected ? "PagerDuty source saved. The signing secret and API key remain hidden." : "Endpoint ready. Create a PagerDuty v3 webhook subscription with this URL, then paste its generated signing secret above and save the source. Inbound alerts are refused until the signing secret is saved."}</p><label className="form-label">PagerDuty endpoint<input readOnly value={saved.endpointUrl} onFocus={event => event.target.select()} /></label></div>}
    <div className="preset-created"><p>First save your service mappings to create an endpoint. In PagerDuty, create a v3 webhook subscription using that endpoint. Subscribe to <code>incident.triggered</code>, <code>incident.acknowledged</code>, <code>incident.escalated</code>, and <code>incident.resolved</code>. Copy the subscription's generated signing secret into the field above and save the source. Keep signing enabled: Lamp verifies the <code>X-PagerDuty-Signature</code> header.</p><p>Triggered incidents stay private until you publish. Resolution closes an unpublished draft; published incidents still need an operator's resolution update.</p></div>
    {sources.map(source => <PagerDutySourceCard key={source.id} source={source} disabled={saving} onEdit={() => edit(source)} onReconnect={() => edit(source, true)} onErased={() => { if (editing === source.id) reset(); onSaved(); }} />)}
  </section>;
}
