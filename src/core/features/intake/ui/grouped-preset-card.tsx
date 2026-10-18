import { useState, type FormEvent } from "react";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { parseLabelExpression, type LabelMatcher, type GroupedPreset } from "../grouped-alerts";
import type { AlertSourceEndpointView } from "../service";

export function GroupedPresetCard({ sources, onSaved }: { sources: AlertSourceEndpointView[]; onSaved: () => void }) {
  const components = useAppData<{ components: Array<{ id: string; name: string }> }>("/api/app/components");
  const [editing, setEditing] = useState<string | null>(null);
  const [preset, setPreset] = useState<GroupedPreset>("alertmanager");
  const [name, setName] = useState("");
  const [rows, setRows] = useState([{ componentId: "", expression: "" }]);
  const [created, setCreated] = useState<AlertSourceEndpointView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  function edit(source: AlertSourceEndpointView) {
    setEditing(source.id); setPreset(source.preset as GroupedPreset); setName(source.name); setCreated(null); setError(null); setSaved(false);
    setRows((source.labelMatchers ?? []).map(row => ({ componentId: row.componentId, expression: Object.entries(row.labels).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ") })));
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null); setSaved(false);
    try {
      const labelMatchers: LabelMatcher[] = rows.map(row => ({ componentId: row.componentId, labels: parseLabelExpression(row.expression) }));
      const result = await appApi<{ source: AlertSourceEndpointView }>(editing ? `/api/app/intake/sources/${editing}` : "/api/app/intake/sources", { method: editing ? "PUT" : "POST", body: JSON.stringify({ name: name || `${preset === "alertmanager" ? "Alertmanager" : "Grafana"} alerts`, preset, credentialKind: "bearer-token", labelMatchers }) });
      setCreated(result.source); setSaved(true); onSaved();
      if (!editing) setEditing(result.source.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The grouped source could not be saved."); }
    finally { setSaving(false); }
  }
  return <section className="data-card preset-card grouped-source-card" aria-labelledby="grouped-title">
    <div><p className="card-kicker">Grouped monitoring alerts</p><h2 id="grouped-title">Connect Alertmanager or Grafana</h2><p>Match each alert's labels to components. One group creates one private incident, even when several components are affected. Recovery closes an unpublished draft only after every alert has recovered.</p></div>
    <form className="alert-editor-form" onSubmit={save}>
      <label className="form-label">Grouped tool<select value={preset} onChange={event => setPreset(event.target.value as GroupedPreset)}><option value="alertmanager">Prometheus Alertmanager</option><option value="grafana">Grafana Alerting</option></select></label>
      <label className="form-label">Connection name<input maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="Production alerts" /></label>
      <div className="full-width"><p>All labels in a row must match exactly; any matching row attaches its component. For example: <code>service="api", region="us-east"</code>. Unmapped alerts are listed in Receipts.</p></div>
      {rows.map((row, index) => <fieldset className="full-width grouped-mapping" key={index}><legend>Component mapping {index + 1}</legend>
        <label className="form-label">Mapped component {index + 1}<select required value={row.componentId} onChange={event => setRows(current => current.map((item, i) => i === index ? { ...item, componentId: event.target.value } : item))}><option value="">Choose a component</option>{components.data?.components.map(component => <option key={component.id} value={component.id}>{component.name}</option>)}</select></label>
        <label className="form-label">Label matchers {index + 1}<input required maxLength={2000} value={row.expression} onChange={event => setRows(current => current.map((item, i) => i === index ? { ...item, expression: event.target.value } : item))} placeholder={'service="api"'} /></label>
        {rows.length > 1 && <Button type="button" variant="secondary" onClick={() => setRows(current => current.filter((_, i) => i !== index))}>Remove mapping {index + 1}</Button>}
      </fieldset>)}
      <div className="form-actions full-width"><Button type="button" variant="secondary" onClick={() => setRows(current => [...current, { componentId: "", expression: "" }])}>Add component mapping</Button><Button disabled={saving}>{saving ? "Saving…" : editing ? "Save grouped source" : "Create grouped source"}</Button>{editing && <Button type="button" variant="secondary" onClick={() => { setEditing(null); setName(""); setRows([{ componentId: "", expression: "" }]); setCreated(null); setSaved(false); }}>New grouped source</Button>}</div>
    </form>
    {error && <FormError>{error}</FormError>}{saved && <p role="status">Grouped source saved. Alerts remain private until publication.</p>}
    {created?.token && <div className="preset-created"><p><strong>Copy the token now; it is shown only once.</strong> Send the default webhook payload. Set Authorization to Bearer followed by this token, enable resolved notifications, and leave maximum alerts at 0 (unlimited).</p><p><a className="text-link" href={preset === "grafana" ? "https://grafana.com/docs/grafana/latest/alerting/configure-notifications/manage-contact-points/integrations/webhook-notifier/" : "https://prometheus.io/docs/alerting/latest/configuration/#webhook_config"} target="_blank" rel="noopener noreferrer">Open {preset === "grafana" ? "Grafana" : "Alertmanager"} webhook setup guide</a></p><label className="form-label">Grouped endpoint<input readOnly value={created.endpointUrl} /></label><label className="form-label">Grouped token<input readOnly value={created.token} /></label><p>{preset === "grafana" ? "In Grafana, create a Webhook contact point with this URL and Authorization Header: Scheme Bearer, Credentials set to the token. Use the default payload and test the contact point." : "In Alertmanager, add this URL under webhook_configs, with send_resolved: true and http_config.authorization.credentials set to the token."}</p></div>}
    {sources.length > 0 && <div className="form-actions">{sources.map(source => <Button key={source.id} type="button" variant="secondary" onClick={() => edit(source)}>Edit mappings for {source.name}</Button>)}</div>}
  </section>;
}
