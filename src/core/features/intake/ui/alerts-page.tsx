import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import type { AlertSourceEndpointView, IntakeService } from "../service";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { LoadingState, useOperatorTime } from "../../../app/client/ui/states";
import { EmptyState, ErrorState } from "../../../app/client/ui/lit-states";
import { GroupedPresetCard } from "./grouped-preset-card";
import { isGroupedPreset } from "../grouped-alerts";
import { PresetCard } from "./preset-card";
import { presetLabels } from "../presets";

type SourcesResponse = { sources: Source[] };
type ReceiptsResponse = { receipts: Awaited<ReturnType<IntakeService["listReceipts"]>> };
type Source = AlertSourceEndpointView;
type SourceForm = {
  name: string;
  credentialKind: "hmac-sha256" | "bearer-token";
  credential: string;
  timestampHeader: string;
  signatureHeader: string;
  deduplicationPath: string;
  titlePath: string;
  statePath: string;
  recoveredValue: string;
};

const EMPTY_SOURCE: SourceForm = {
  name: "",
  credentialKind: "hmac-sha256",
  credential: "",
  timestampHeader: "x-lamp-timestamp",
  signatureHeader: "x-lamp-signature",
  deduplicationPath: "$.alert.id",
  titlePath: "$.alert.title",
  statePath: "$.alert.state",
  recoveredValue: "recovered",
};

function sourceForm(source: Source): SourceForm {
  return {
    name: source.name,
    credentialKind: source.credentialKind,
    credential: "",
    timestampHeader: source.timestampHeader,
    signatureHeader: source.signatureHeader,
    deduplicationPath: source.deduplicationPath,
    titlePath: source.titlePath,
    statePath: source.statePath,
    recoveredValue: source.recoveredValue,
  };
}

function receiptLabel(state: ReceiptsResponse["receipts"][number]["state"]) {
  return state === "firing" ? "Accepted" : state === "recovered" ? "Recovered" : "Rejected";
}

function receiptClass(state: ReceiptsResponse["receipts"][number]["state"]) {
  return state === "firing" ? "state-active" : state === "recovered" ? "state-monitoring" : "state-failed";
}

export function AlertsPage() {
  const formatOperatorTime = useOperatorTime();
  const sources = useAppData<SourcesResponse>("/api/app/intake/sources");
  const receipts = useAppData<ReceiptsResponse>("/api/app/intake/receipts?limit=100");
  const [editing, setEditing] = useState<Source | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<SourceForm>(EMPTY_SOURCE);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sourceData = sources.data?.sources ?? [];
  const receiptData = receipts.data?.receipts ?? [];
  // A refresh keeps the page (and a just-created preset's one-time token) on screen.
  const loading = (sources.loading && !sources.data) || (receipts.loading && !receipts.data);
  const error = sources.error ?? receipts.error;

  function openCreate() {
    setCreating(true);
    setEditing(null);
    setForm(EMPTY_SOURCE);
    setMessage(null);
  }

  function openEdit(source: Source) {
    setCreating(false);
    setEditing(source);
    setForm(sourceForm(source));
    setMessage(null);
  }

  function closeEditor() {
    setCreating(false);
    setEditing(null);
    setForm(EMPTY_SOURCE);
  }

  function update<K extends keyof SourceForm>(field: K, value: SourceForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const body = {
      name: form.name,
      credentialKind: form.credentialKind,
      ...(form.credential.trim() ? form.credentialKind === "hmac-sha256" ? { signingSecret: form.credential } : { bearerToken: form.credential } : {}),
      timestampHeader: form.timestampHeader,
      signatureHeader: form.signatureHeader,
      deduplicationPath: form.deduplicationPath,
      titlePath: form.titlePath,
      statePath: form.statePath,
      recoveredValue: form.recoveredValue,
    };
    try {
      const result = editing
        ? await appApi<{ source: Source }>(`/api/app/intake/sources/${editing.id}`, { method: "PUT", body: JSON.stringify(body) })
        : await appApi<{ source: Source }>("/api/app/intake/sources", { method: "POST", body: JSON.stringify(body) });
      setEditing(result.source);
      setCreating(false);
      setForm(sourceForm(result.source));
      setMessage(editing ? "Alert source updated. Existing secrets remain hidden." : "Alert source created. Send alerts to the endpoint below.");
      sources.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The alert source could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState>Loading alert sources and receipts…</LoadingState>;
  if (error) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;

  return <div className="page-stack alerts-page">
    <section className="page-title-row"><div><p className="eyebrow">Inbound alert intake</p><h1>Alerts</h1><p>Configure authenticated alert sources. Accepted, recovered, and rejected receipt records never expose inbound payloads or source credentials.</p></div><Button type="button" onClick={openCreate}><Icon name="plus" width={18} height={18} />Add alert source</Button></section>
    <section className="capability-note"><Icon name="warning" width={18} height={18} /><div><strong>Source secrets are write-only.</strong><p>Editing a source leaves its existing secret in place until you provide a replacement. The endpoint accepts only the configured authentication method.</p></div></section>
    <PresetCard onCreated={sources.refresh} />
    <GroupedPresetCard sources={sourceData.filter(source => isGroupedPreset(source.preset))} onSaved={sources.refresh} />
    {(creating || editing) && <SourceEditor source={editing} form={form} saving={saving} message={message} onChange={update} onSubmit={save} onClose={closeEditor} />}
    {message && !(creating || editing) && <p className="save-message" role="status">{message}</p>}
    <section className="alert-source-grid" aria-label="Configured alert sources">
      {sourceData.length ? sourceData.map((source) => <AlertSourceCard key={source.id} source={source} onEdit={source.preset ? undefined : () => openEdit(source)} />) : <EmptyState>No alert sources are configured. Add a source to receive authenticated alert payloads.</EmptyState>}
    </section>
    <section className="data-card receipt-card"><div className="card-heading"><div><p className="card-kicker">Receipt visibility</p><h2>Accepted and rejected alerts</h2><p className="card-support">The most recent 100 receipt records. Payload bodies and request hashes are intentionally omitted.</p></div><span className="count-label">{receiptData.length} recorded</span></div><div className="table-scroll" tabIndex={0} role="region" aria-label="Alert receipt records"><table><thead><tr><th scope="col">Received</th><th scope="col">Source</th><th scope="col">Result</th><th scope="col">Incident</th><th scope="col">Reason</th></tr></thead><tbody>{receiptData.map((receipt) => <tr key={receipt.id}><td data-label="Received">{formatOperatorTime(receipt.receivedAt)}</td><td data-label="Source"><strong>{receipt.sourceName}</strong></td><td data-label="Result"><span className={`state-pill ${receiptClass(receipt.state)}`}>{receiptLabel(receipt.state)}</span></td><td data-label="Incident">{receipt.incidentId ? <Link className="text-link" to="/app/incidents/$incidentId" params={{ incidentId: receipt.incidentId }}>Open draft</Link> : "—"}</td><td data-label="Reason">{receipt.error ?? "Recorded without exposing the payload."}</td></tr>)}{receiptData.length === 0 && <tr><td colSpan={5} className="receipt-empty"><p>No alerts have been received from configured sources.</p></td></tr>}</tbody></table></div></section>
  </div>;
}

function AlertSourceCard({ source, onEdit }: { source: Source; onEdit?: () => void }) {
  const endpoint = source.endpointUrl;
  return <article className="data-card alert-source-card"><div className="card-heading"><div><p className="card-kicker">{source.preset ? `${presetLabels[source.preset]} preset` : "Authenticated source"}</p><h2>{source.name}</h2></div><span className="state-pill state-active">Configured</span></div><dl className="alert-source-facts"><div><dt>Authentication</dt><dd>{source.credentialKind === "hmac-sha256" ? "HMAC-SHA256 signed request" : "Bearer token"}</dd></div><div><dt>Endpoint</dt><dd><code>{endpoint}</code></dd></div>{isGroupedPreset(source.preset) ? <div><dt>Component mappings</dt><dd>{source.labelMatchers?.length ?? 0} exact label rules. Edit mappings in Grouped monitoring alerts above.</dd></div> : <><div><dt>Deduplication path</dt><dd><code>{source.deduplicationPath}</code></dd></div><div><dt>Title path</dt><dd><code>{source.titlePath}</code></dd></div><div><dt>State path</dt><dd><code>{source.statePath}</code></dd></div></>}</dl><div className="form-actions">{onEdit ? <Button type="button" variant="secondary" onClick={onEdit}>Edit source</Button> : null}</div></article>;
}

function SourceEditor({ source, form, saving, message, onChange, onSubmit, onClose }: { source: Source | null; form: SourceForm; saving: boolean; message: string | null; onChange: <K extends keyof SourceForm>(field: K, value: SourceForm[K]) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>; onClose: () => void }) {
  const isHmac = form.credentialKind === "hmac-sha256";
  const credentialLabel = isHmac ? "Signing secret" : "Bearer token";
  const credentialHelp = source && source.credentialKind === form.credentialKind
    ? `Leave blank to retain the existing ${credentialLabel.toLowerCase()}.`
    : `A ${credentialLabel.toLowerCase()} is required for this authentication method.`;
  return <section className="data-card alert-editor"><div className="card-heading"><div><p className="card-kicker">{source ? "Edit source" : "New source"}</p><h2>{source ? source.name : "Configure alert source"}</h2><p className="card-support">Set the source endpoint, authentication, and JSON paths that turn a verified payload into a draft incident.</p></div><Button type="button" variant="secondary" className="table-action" onClick={onClose}>Close</Button></div><form className="alert-editor-form" onSubmit={onSubmit}><label className="form-label">Source name<input required maxLength={120} value={form.name} onChange={(event) => onChange("name", event.target.value)} /></label><label className="form-label">Authentication<select value={form.credentialKind} onChange={(event) => onChange("credentialKind", event.target.value as SourceForm["credentialKind"])}><option value="hmac-sha256">HMAC-SHA256 signature</option><option value="bearer-token">Bearer token</option></select></label><label className="form-label">{credentialLabel}<input type="password" autoComplete="new-password" value={form.credential} placeholder={source ? "Leave unchanged" : "Required"} onChange={(event) => onChange("credential", event.target.value)} /><small>{credentialHelp}</small></label>{isHmac && <><label className="form-label">Timestamp header<input required maxLength={120} value={form.timestampHeader} onChange={(event) => onChange("timestampHeader", event.target.value)} /></label><label className="form-label">Signature header<input required maxLength={120} value={form.signatureHeader} onChange={(event) => onChange("signatureHeader", event.target.value)} /></label></>}<label className="form-label">Deduplication JSON path<input required maxLength={250} value={form.deduplicationPath} onChange={(event) => onChange("deduplicationPath", event.target.value)} /></label><label className="form-label">Title JSON path<input required maxLength={250} value={form.titlePath} onChange={(event) => onChange("titlePath", event.target.value)} /></label><label className="form-label">State JSON path<input required maxLength={250} value={form.statePath} onChange={(event) => onChange("statePath", event.target.value)} /></label><label className="form-label">Recovery value<input required maxLength={100} value={form.recoveredValue} onChange={(event) => onChange("recoveredValue", event.target.value)} /></label>{message && <p className="save-message full-width" role="status">{message}</p>}<div className="form-actions full-width"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={saving}>{saving ? "Saving…" : source ? "Save source" : "Create source"}</Button></div></form></section>;
}
