import { useState, type FormEvent } from "react";

import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import type { LabelMatcher } from "../grouped-alerts";
import { ComponentOptions, CopyField, SaveNote, ToolHeading } from "./tool-parts";
import { toolDoes, type ComponentOption, type Source } from "./tools";
import { useSourceAutosave } from "./use-source-autosave";

type Row = { componentId: string; serviceName: string; serviceId: string };
const emptyRow = (): Row => ({ componentId: "", serviceName: "", serviceId: "" });
/** The rows as matchers, or null while a started row lacks its component or both service values. */
function matchersOf(rows: Row[]): LabelMatcher[] | null {
  const started = rows.filter(row => row.componentId || row.serviceName.trim() || row.serviceId.trim());
  if (!started.length || started.some(row => !row.componentId || (!row.serviceName.trim() && !row.serviceId.trim()))) return null;
  return started.map(row => ({ componentId: row.componentId, labels: { ...(row.serviceId.trim() ? { service_id: row.serviceId.trim() } : {}), ...(row.serviceName.trim() ? { service_name: row.serviceName.trim() } : {}) } }));
}
const body = (name: string, labelMatchers: LabelMatcher[]) => ({ name, preset: "pagerduty", credentialKind: "hmac-sha256", labelMatchers });

/** PagerDuty: map its services, then paste the signing secret PagerDuty makes for the subscription. Notes back are optional. */
export function PagerDutyForm({ source, components, onConnected, onSaved, onClose }: { source: Source | null; components: ComponentOption[]; onConnected: (source: Source) => void; onSaved: () => void; onClose: () => void }) {
  return source ? <EditPagerDuty source={source} components={components} onSaved={onSaved} onClose={onClose} /> : <ConnectPagerDuty components={components} onConnected={onConnected} onClose={onClose} />;
}

function ConnectPagerDuty({ components, onConnected, onClose }: { components: ComponentOption[]; onConnected: (source: Source) => void; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matchers = matchersOf(rows);
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matchers) return;
    setBusy(true); setError(null);
    try { onConnected((await appApi<{ source: Source }>("/api/app/intake/sources", { method: "POST", body: JSON.stringify(body("PagerDuty", matchers)) })).source); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "PagerDuty could not be connected."); setBusy(false); }
  }
  return <section className="data-card tool-form" aria-labelledby="tool-form-title">
    <ToolHeading title="Connect PagerDuty" does={toolDoes("pagerduty")} close={{ label: "Back", onClick: onClose }} />
    <form className="tool-fields" onSubmit={connect}>
      <ServiceRows rows={rows} components={components} onChange={setRows} />
      <div className="form-actions"><Button disabled={busy || !matchers}>{busy ? "Connecting…" : "Connect PagerDuty"}</Button></div>
    </form>
    {error && <FormError>{error}</FormError>}
  </section>;
}

function EditPagerDuty({ source, components, onSaved, onClose }: { source: Source; components: ComponentOption[]; onSaved: () => void; onClose: () => void }) {
  const autosave = useSourceAutosave(source.id, onSaved);
  const [rows, setRows] = useState<Row[]>(() => (source.labelMatchers ?? []).map(row => ({ componentId: row.componentId, serviceName: row.labels.service_name ?? "", serviceId: row.labels.service_id ?? "" })));
  const [saved, setSaved] = useState<LabelMatcher[]>(source.labelMatchers ?? []);
  const [replacing, setReplacing] = useState(false);
  function change(next: Row[], immediate: boolean) {
    setRows(next);
    const matchers = matchersOf(next);
    if (matchers && JSON.stringify(matchers) !== JSON.stringify(saved)) { setSaved(matchers); autosave.save(body(source.name, matchers), immediate); }
  }
  // Secrets and keys never autosave: each takes its one explicit Save.
  const write = (extra: Record<string, string>) => appApi(`/api/app/intake/sources/${source.id}`, { method: "PUT", body: JSON.stringify({ ...body(source.name, saved), ...extra }) }).then(() => { setReplacing(false); onSaved(); });
  return <section className="data-card tool-form" aria-labelledby="tool-form-title">
    <ToolHeading title={source.name} does={toolDoes("pagerduty")} close={{ label: "Close", onClick: onClose }} />
    {!source.webhookConnected || replacing ? <div className="tool-step">
      <p>In PagerDuty, add a v3 webhook subscription with this address for incident triggered, acknowledged, escalated and resolved. Then paste the signing secret PagerDuty shows.</p>
      <CopyField label="PagerDuty address" value={source.endpointUrl} copy="Copy address" />
      <SecretField label="PagerDuty signing secret" action="Save secret" save={value => write({ signingSecret: value })} />
    </div> : <p className="tool-note">Signing secret saved. <Button type="button" variant="secondary" className="table-action" onClick={() => setReplacing(true)}>Replace secret</Button></p>}
    <SaveNote phase={autosave.phase} error={autosave.error} retry={autosave.retry} />
    <div className="tool-fields"><ServiceRows rows={rows} components={components} onChange={change} /></div>
    <details className="tool-more" open={source.responderConnection === "reconnect" || undefined}>
      <summary>{source.responderConnection === "connected" ? "Updates go back to PagerDuty as notes" : source.responderConnection === "reconnect" ? "Notes back to PagerDuty need a new key" : "Send your updates back to PagerDuty"}</summary>
      <NotesKey connected={source.responderConnection === "connected"} save={(apiKey, fromEmail) => write({ pagerDutyApiKey: apiKey, ...(fromEmail ? { pagerDutyFromEmail: fromEmail } : {}) })} />
    </details>
  </section>;
}

/** One row per component, matched by PagerDuty service name, ID, or both (both must match when both are given). */
function ServiceRows({ rows, components, onChange }: { rows: Row[]; components: ComponentOption[]; onChange: (rows: Row[], immediate: boolean) => void }) {
  const update = (index: number, field: keyof Row, value: string) => onChange(rows.map((row, i) => i === index ? { ...row, [field]: value } : row), field === "componentId");
  return <>
    <ul className="label-rows">{rows.map((row, index) => <li key={index} className="label-row service-row">
      <label className="form-label">Component<select aria-label={`Component ${index + 1}`} value={row.componentId} onChange={event => update(index, "componentId", event.target.value)}><ComponentOptions components={components} empty="Choose a component" /></select></label>
      <label className="form-label">Service name<input aria-label={`Service name ${index + 1}`} maxLength={500} value={row.serviceName} placeholder="Production API" onChange={event => update(index, "serviceName", event.target.value)} /></label>
      <label className="form-label">or service ID<input aria-label={`Service ID ${index + 1}`} maxLength={500} value={row.serviceId} placeholder="PABC123" onChange={event => update(index, "serviceId", event.target.value)} /></label>
      {rows.length > 1 && <Button type="button" variant="secondary" className="table-action" aria-label={`Remove row ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index), true)}>Remove</Button>}
    </li>)}</ul>
    <div className="form-actions label-rows-actions"><Button type="button" variant="secondary" onClick={() => onChange([...rows, emptyRow()], true)}>Add a service</Button></div>
  </>;
}

/** A pasted secret saves only on its own Save. */
function SecretField({ label, action, save }: { label: string; action: string; save: (value: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try { await save(value.trim()); setValue(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "It could not be saved."); }
    finally { setBusy(false); }
  }
  return <form className="tool-secret" onSubmit={submit}>
    <label className="form-label">{label}<input type="password" autoComplete="new-password" required value={value} onChange={event => setValue(event.target.value)} /></label>
    <div className="form-actions"><Button disabled={busy || !value.trim()}>{busy ? "Saving…" : action}</Button></div>
    {error && <FormError>{error}</FormError>}
  </form>;
}

function NotesKey({ connected, save }: { connected: boolean; save: (apiKey: string, fromEmail: string) => Promise<void> }) {
  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try { await save(apiKey.trim(), fromEmail.trim()); setApiKey(""); setFromEmail(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The key could not be saved."); }
    finally { setBusy(false); }
  }
  return <form className="tool-secret" onSubmit={submit}>
    <p className="tool-note">{connected ? "Each published update is added to the PagerDuty incident with its link. A new key replaces the saved one." : "Each published update is added to the PagerDuty incident with its link. The key needs permission to add notes."}</p>
    <label className="form-label">PagerDuty REST API key<input type="password" autoComplete="new-password" required value={apiKey} onChange={event => setApiKey(event.target.value)} /></label>
    <label className="form-label">PagerDuty user email<input type="email" autoComplete="off" maxLength={254} value={fromEmail} placeholder="Your Lamp email" onChange={event => setFromEmail(event.target.value)} /></label>
    <div className="form-actions"><Button disabled={busy || !apiKey.trim()}>{busy ? "Saving…" : "Save key"}</Button></div>
    {error && <FormError>{error}</FormError>}
  </form>;
}
