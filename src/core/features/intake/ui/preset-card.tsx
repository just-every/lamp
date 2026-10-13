import { useState, type FormEvent } from "react";

import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { ALERT_PRESETS, datadogPayloadTemplate, presetLabels, type AlertPreset } from "../presets";

type Created = { source: { id: string; name: string; endpointUrl: string; token?: string; preset: AlertPreset } };
const setup: Record<AlertPreset, string> = {
  datadog: "In Datadog, add a webhook with this URL, a custom header {\"Authorization\": \"Bearer <token>\"} and this payload, then mention @webhook-<name> in the monitor.",
  uptimerobot: "In UptimeRobot, add a webhook integration with this URL, Send as JSON, and a custom header Authorization: Bearer <token>.",
  betterstack: "In Better Stack, add an Incident webhook (Integrations → Exporting data) with the URL that ends in your token.",
  pingdom: "In My Pingdom, add a webhook integration with the URL that ends in your token and attach it to the check.",
};

/** A source for one monitoring tool: Lamp reads that tool's own alert shape and drafts incidents on one component. */
export function PresetCard({ onCreated }: { onCreated: () => void }) {
  const components = useAppData<{ components: Array<{ id: string; name: string }> }>("/api/app/components");
  const [preset, setPreset] = useState<AlertPreset>("datadog");
  const [name, setName] = useState("");
  const [componentId, setComponentId] = useState("");
  const [created, setCreated] = useState<Created["source"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const result = await appApi<Created>("/api/app/intake/sources", { method: "POST", body: JSON.stringify({ name: name || `${presetLabels[preset]} alerts`, preset, componentId, credentialKind: "bearer-token" }) });
      setCreated(result.source); setName("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The preset could not be saved."); }
    finally { setSaving(false); }
  }

  return <section className="data-card preset-card" aria-labelledby="preset-title"><div><p className="card-kicker">Monitor presets</p><h2 id="preset-title">Connect a monitoring tool</h2><p>Alerts become draft incidents on one component; nothing is published until you publish it. A recovery closes a draft that was never published.</p></div>
    <form className="preset-form" onSubmit={save}>
      <label className="form-label">Tool<select value={preset} onChange={(event) => setPreset(event.target.value as AlertPreset)}>{ALERT_PRESETS.map((value) => <option key={value} value={value}>{presetLabels[value]}</option>)}</select></label>
      <label className="form-label">Component<select required value={componentId} onChange={(event) => setComponentId(event.target.value)}><option value="">Choose a component</option>{components.data?.components.map((component) => <option key={component.id} value={component.id}>{component.name}</option>)}</select></label>
      <label className="form-label">Name<input maxLength={120} placeholder={`${presetLabels[preset]} alerts`} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <Button disabled={saving || !componentId}>{saving ? "Saving…" : "Create preset"}</Button>
    </form>
    {error && <FormError>{error}</FormError>}
    {created?.token && <div className="preset-created" role="status"><p><strong>Copy these now: the token is not shown again.</strong> {setup[created.preset]}</p>
      <label className="form-label">Endpoint<input readOnly value={created.endpointUrl} onFocus={(event) => event.target.select()} /></label>
      <label className="form-label">Endpoint with token<input readOnly value={`${created.endpointUrl}/${created.token}`} onFocus={(event) => event.target.select()} /></label>
      <label className="form-label">Token<input readOnly value={created.token} onFocus={(event) => event.target.select()} /></label>
      {created.preset === "datadog" && <label className="form-label">Datadog payload<textarea readOnly rows={9} value={datadogPayloadTemplate} /></label>}
      <Button type="button" variant="secondary" onClick={() => { setCreated(null); onCreated(); }}>I copied the token</Button>
    </div>}
  </section>;
}
