import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { IncidentDraftInput } from "../../../shared/schemas";
import type { IncidentsService } from "../service";
import type { RenderedIncidentUpdate } from "../renderer";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { EmptyState, ErrorState, LoadingState, formatOperatorTime } from "../../../app/client/ui/states";
import { IncidentOperatorControls } from "./incident-operator-controls";

type IncidentResponse = { incident: Awaited<ReturnType<IncidentsService["get"]>> };
type PreviewResponse = { preview: RenderedIncidentUpdate };

const blankDraft: IncidentDraftInput = {
  lifecycle: "Investigating",
  affectedAudience: "",
  customerImpact: "",
  whatStillWorks: "",
  details: "",
  nextUpdateAt: null,
};

function normalizeResolvedDraft(draft: IncidentDraftInput): IncidentDraftInput {
  return draft.lifecycle === "Resolved" ? { ...draft, nextUpdateAt: null } : draft;
}

function draftFromIncident(incident: NonNullable<IncidentResponse["incident"]>): IncidentDraftInput {
  if (!incident.draft) return { ...blankDraft, lifecycle: incident.lifecycle };
  return normalizeResolvedDraft({
    lifecycle: incident.draft.lifecycle,
    affectedAudience: incident.draft.affectedAudience,
    customerImpact: incident.draft.customerImpact,
    whatStillWorks: incident.draft.whatStillWorks,
    details: incident.draft.details,
    nextUpdateAt: incident.draft.nextUpdateAt,
  });
}

function toLocalDateTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function IncidentDetailPage({ incidentId }: { incidentId: string }) {
  const { data, error, loading, refresh } = useAppData<IncidentResponse>(`/api/app/incidents/${incidentId}`);
  const navigate = useNavigate();
  // A same-incident refresh must not restart the draft deadline (UPDATE-005).
  const loadedIncidentId = data?.incident?.id;
  const [draft, setDraft] = useState<IncidentDraftInput>(blankDraft);
  const [draftRevision, setDraftRevision] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RenderedIncidentUpdate | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Array<"email" | "webhook">>(["email"]);
  const [scheduledPublishAt, setScheduledPublishAt] = useState<string | null>(null);
  const [historicalPublishedAt, setHistoricalPublishedAt] = useState<string | null>(null);
  const [publishState, setPublishState] = useState<"idle" | "publishing" | "scheduled" | "published" | "error">("idle");
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const timingDisclosure = useRef<HTMLDetailsElement>(null);
  const savedKey = useRef<string | null>("");
  const activeSave = useRef<object | null>(null);
  const pendingDraft = useRef<{ key: string; dueAt: number } | null>(null);
  const failedKey = useRef<string | null>(null);
  const hydratedIncident = useRef<string | null>(null);
  const hydratingDraft = useRef(false);
  const draftKey = useMemo(() => JSON.stringify(draft), [draft]);
  const latestDraftKey = useRef(draftKey);
  latestDraftKey.current = draftKey;
  // Eligibility follows the displayed bytes, including before effects run.
  const draftSaved = savedKey.current === draftKey && !activeSave.current && saveState !== "error";
  const visibleSaveState = draftSaved ? "saved" : saveState === "error" && failedKey.current === draftKey ? "error" : "saving";

  useEffect(() => {
    if (!data?.incident || hydratedIncident.current === data.incident.id) return;
    const initial = draftFromIncident(data.incident);
    hydratedIncident.current = data.incident.id;
    hydratingDraft.current = true;
    pendingDraft.current = null;
    savedKey.current = JSON.stringify(initial);
    setDraft(initial);
    setDraftRevision((current) => current + 1);
  }, [data]);

  useEffect(() => {
    if (!loadedIncidentId) return;
    if (hydratingDraft.current) {
      if (savedKey.current === draftKey) hydratingDraft.current = false;
      return;
    }
    // Count time behind an earlier write toward this edit's debounce. An
    // acknowledgement wakes the effect but must not start a new deadline.
    if (pendingDraft.current?.key !== draftKey) {
      pendingDraft.current = { key: draftKey, dueAt: performance.now() + 1200 };
    }
    // One native write at a time: an older request must never land after a newer
    // draft. Completion wakes this effect to save the latest displayed draft.
    if (activeSave.current) return;
    if (savedKey.current === draftKey) {
      pendingDraft.current = null;
      setSaveState("saved");
      setSaveError(null);
      return;
    }
    if (failedKey.current === draftKey) return;
    failedKey.current = null;
    setSaveState("saving");
    setSaveError(null);
    const timeout = window.setTimeout(() => {
      const request = {};
      const id = loadedIncidentId;
      activeSave.current = request;
      appApi<{ draft: unknown }>(`/api/app/incidents/${id}/draft`, { method: "PUT", body: draftKey })
        .then(() => {
          if (hydratedIncident.current !== id) return;
          savedKey.current = draftKey;
          setSaveState(latestDraftKey.current === draftKey ? "saved" : "saving");
        })
        .catch((cause: unknown) => {
          if (hydratedIncident.current !== id) return;
          // A lost response does not prove the server rejected the write.
          savedKey.current = null;
          failedKey.current = latestDraftKey.current === draftKey ? draftKey : null;
          setSaveState(failedKey.current ? "error" : "saving");
          setSaveError(failedKey.current ? (cause instanceof Error ? cause.message : "The draft could not be saved.") : null);
        })
        .finally(() => {
          if (activeSave.current === request) activeSave.current = null;
          setDraftRevision((current) => current + 1);
        });
    }, Math.max(0, pendingDraft.current.dueAt - performance.now()));
    return () => window.clearTimeout(timeout);
  }, [loadedIncidentId, draftKey, draftRevision]);

  useEffect(() => {
    if (!data?.incident) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      appApi<PreviewResponse>(`/api/app/incidents/${data.incident!.id}/draft/preview`, { method: "POST", body: JSON.stringify(draft), signal: controller.signal })
        .then((response) => { setPreview(response.preview); setPreviewError(null); })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setPreviewError(cause instanceof Error ? cause.message : "Preview is unavailable.");
        });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [data?.incident, draft, draftKey]);

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!data?.incident) return <section className="page-stack"><h1>Incident unavailable</h1><EmptyState>The incident record does not exist.</EmptyState><Link className="back-link" to="/app/incidents">Back to incidents</Link></section>;
  const incident = data.incident;

  const updateField = <K extends keyof IncidentDraftInput>(field: K, value: IncidentDraftInput[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const applyDraft = (next: IncidentDraftInput) => setDraft(normalizeResolvedDraft(next));
  const prepareResolution = () => {
    setDraft((current) => normalizeResolvedDraft({ ...current, lifecycle: "Resolved" }));
    setPublishState("idle");
    setPublishMessage(null);
  };
  const changeLifecycle = (lifecycle: IncidentDraftInput["lifecycle"]) => {
    setDraft((current) => normalizeResolvedDraft({
      ...current,
      lifecycle,
    }));
  };
  const toggleChannel = (channel: "email" | "webhook") => setChannels((current) => current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel]);
  const publish = async () => {
    if (!draftSaved) return;
    if (historicalPublishedAt && new Date(historicalPublishedAt).getTime() >= Date.now()) {
      setPublishState("error"); setPublishMessage("A historical publication timestamp must be in the past."); return;
    }
    setPublishState("publishing"); setPublishMessage(null);
    try { await appApi(`/api/app/incidents/${incident.id}/publish`, { method: "POST", body: JSON.stringify({ channels, ...(historicalPublishedAt ? { publishedAt: historicalPublishedAt } : {}) }) }); setPublishState("published"); setPublishMessage(historicalPublishedAt ? "Historical update published. It did not notify subscribers." : "Update published. The fixed recipient set is now queued for delivery."); refresh(); }
    catch (cause) { setPublishState("error"); setPublishMessage(cause instanceof Error ? cause.message : "The update could not be published."); }
  };
  const schedule = async () => {
    if (!draftSaved) return;
    if (historicalPublishedAt) { setPublishState("error"); setPublishMessage("A historical publication cannot also be scheduled."); return; }
    if (!scheduledPublishAt) { setPublishState("error"); setPublishMessage("Choose a future scheduled publication time before scheduling."); return; }
    setPublishState("publishing"); setPublishMessage(null);
    try { await appApi(`/api/app/incidents/${incident.id}/draft/schedule`, { method: "POST", body: JSON.stringify({ publishAt: scheduledPublishAt, channels }) }); setPublishState("scheduled"); setPublishMessage("Update scheduled. It remains private until its recorded publication time."); }
    catch (cause) { setPublishState("error"); setPublishMessage(cause instanceof Error ? cause.message : "The update could not be scheduled."); }
  };

  return <div className="incident-workspace">
    <header className="incident-workspace-heading incident-context">
      <Link className="back-link" to="/app/incidents">← Back to incidents</Link>
      <p className="eyebrow">{incident.reference}</p><h1>{incident.title}</h1>
      <div className="context-facts"><div><span>Lifecycle</span><strong>{incident.lifecycle}</strong></div><div><span>Opened</span><strong>{formatOperatorTime(incident.openedAt)}</strong></div><div><span>Impact</span><strong>{incident.impact ?? "No component impact"}</strong></div></div>
    </header>


    <section className="composer-panel" aria-labelledby="composer-title">
      <div className="composer-heading"><div><p className="eyebrow">Update draft</p><h2 id="composer-title">Compose public update</h2></div><p role="status" aria-live="polite" className={`autosave-status is-${visibleSaveState}`}>{visibleSaveState === "saving" ? "Saving draft…" : visibleSaveState === "saved" ? "Draft saved" : "Draft save failed"}</p></div>
      {saveError && <ErrorState>{saveError}</ErrorState>}
      {visibleSaveState === "error" && <Button type="button" variant="secondary" onClick={() => { failedKey.current = null; setSaveError(null); setSaveState("saving"); setDraftRevision((current) => current + 1); }}>Retry save</Button>}
      <AiSuggestionButton incidentId={incident.id} onSuggestion={applyDraft} />
      <form className="impact-form" onSubmit={(event) => event.preventDefault()}>
        <FieldNumber value="1" label="Who is affected" required count={draft.affectedAudience.length} max={250}><textarea required value={draft.affectedAudience} maxLength={250} onChange={(event) => updateField("affectedAudience", event.target.value)} /></FieldNumber>
        <FieldNumber value="2" label="What is the impact" required count={draft.customerImpact.length} max={250}><textarea required value={draft.customerImpact} maxLength={250} onChange={(event) => updateField("customerImpact", event.target.value)} /></FieldNumber>
        <FieldNumber value="3" label="What still works" count={draft.whatStillWorks.length} max={250}><textarea value={draft.whatStillWorks} maxLength={250} onChange={(event) => updateField("whatStillWorks", event.target.value)} /></FieldNumber>
        {draft.lifecycle === "Resolved" ? (
          <div className="impact-field resolution-note" role="status">
            <span className="field-label"><b>4</b>Resolution</span>
            <p>This update closes the incident without a future update commitment.</p>
          </div>
        ) : (
          <fieldset className="impact-field">
            <legend><span>4</span>Next update by <b aria-hidden="true">*</b></legend>
            <p>A communication commitment, not an estimate of service restoration.</p>
            <div className="date-row">
              <label className="form-label">
                <span className="sr-only">Next update commitment</span>
                <input required aria-label="Next update date and time" type="datetime-local" value={toLocalDateTime(draft.nextUpdateAt)} onChange={(event) => updateField("nextUpdateAt", event.target.value ? new Date(event.target.value).toISOString() : null)} />
              </label>
            </div>
          </fieldset>
        )}
        <FieldNumber value="5" label="Additional details" count={draft.details.length} max={500}><textarea value={draft.details} maxLength={500} onChange={(event) => updateField("details", event.target.value)} /></FieldNumber>
        <label className="lifecycle-control">Lifecycle<select value={draft.lifecycle} onChange={(event) => changeLifecycle(event.target.value as IncidentDraftInput["lifecycle"])}>{["Investigating", "Identified", "Monitoring", "Resolved"].map((state) => <option key={state}>{state}</option>)}</select></label>
        <ClientExtensionSlot id="incident.composer.fields.after.v1" context={{ incident: { id: incident.id, reference: incident.reference, lifecycle: incident.lifecycle } }} />
      </form>
      <details className="draft-tools"><summary>Update templates</summary><TemplateControls incident={incident} draft={draft} onApplied={applyDraft} /></details>
      <section className="publication-controls" aria-label="Publication controls"><div><strong>Delivery channels</strong><p>Public page, feed, and widget always update. Select subscriber channels for this immutable update.</p></div><div className="channel-checks"><label className="checkbox-label"><input type="checkbox" checked={channels.includes("email")} onChange={() => toggleChannel("email")} />Email</label><label className="checkbox-label"><input type="checkbox" checked={channels.includes("webhook")} onChange={() => toggleChannel("webhook")} />Webhook</label></div><details className="draft-tools publication-timing" ref={timingDisclosure} open={Boolean(scheduledPublishAt || historicalPublishedAt)}><summary>Schedule or backdate</summary><div className="publication-timing-fields"><label className="form-label scheduled-publication-control"><span>Scheduled publication</span><small>The update remains private until this future time.</small><input aria-label="Scheduled publication date and time" type="datetime-local" value={toLocalDateTime(scheduledPublishAt)} onChange={(event) => setScheduledPublishAt(event.target.value ? new Date(event.target.value).toISOString() : null)} /></label><label className="form-label historical-publication-control"><span>Historical publication timestamp</span><input aria-label="Historical publication date and time" type="datetime-local" value={toLocalDateTime(historicalPublishedAt)} onChange={(event) => setHistoricalPublishedAt(event.target.value ? new Date(event.target.value).toISOString() : null)} /><small>Use a past instant to add a retroactive public record without notifying subscribers.</small></label><div className="form-actions"><Button type="button" variant="secondary" onClick={() => { setScheduledPublishAt(null); setHistoricalPublishedAt(null); timingDisclosure.current?.querySelector("summary")?.focus(); }}>Use current time</Button><Button variant="secondary" type="button" disabled={publishState === "publishing" || !draftSaved} onClick={schedule}>Schedule update</Button></div></div></details></section>
      {publishMessage ? <p role="status" className={`publication-message is-${publishState}`}>{publishMessage}</p> : null}
      <div className="composer-actions">
        {draft.lifecycle !== "Resolved" && incident.lifecycle !== "Resolved" ? <Button type="button" variant="secondary" disabled={publishState === "publishing"} onClick={prepareResolution}>Resolve incident</Button> : null}
        <Button type="button" disabled={publishState === "publishing" || !draftSaved} onClick={publish}>{publishState === "publishing" ? "Publishing…" : historicalPublishedAt ? "Publish historical update" : "Publish update"}</Button>
      </div>
    </section>

    <aside className="preview-panel" aria-labelledby="preview-title"><div className="preview-heading"><div><p className="eyebrow">Customer communication</p><h2 id="preview-title">Live preview</h2></div></div>{previewError ? <ErrorState>{previewError}</ErrorState> : preview ? <><PreviewCard title="Public page" heading={preview.public.heading} lifecycle={preview.public.lifecycle} fields={preview.public.fields} /><details className="draft-tools email-preview"><summary>Email preview</summary><PreviewCard title="Notification email" heading={preview.email.subject} lifecycle={null} fields={preview.email.plainText.split("\n\n").slice(1).map((value, index) => ({ label: index === 0 ? "Status" : "Message", value }))} /></details></> : <LoadingState>Rendering this draft…</LoadingState>}</aside>
    <aside className="incident-context">
      <section className="context-section"><h2>Affected components</h2>{incident.components.length ? incident.components.map((component) => <div className="component-fact" key={component.id}><strong>{component.componentName}</strong><span>{component.relationship} · {component.state}</span></div>) : <p>No components are attached. This incident cannot be published.</p>}</section>
      <section className="context-section"><h2>Published timeline</h2>{incident.updates.length ? <ol className="timeline">{incident.updates.map((update) => <li key={update.id}><strong>{update.lifecycle}</strong><span>{formatOperatorTime(update.publishedAt)}</span><p>{update.customerImpact}</p></li>)}</ol> : <p>No public updates are recorded.</p>}</section>
      {incident.lifecycle === "Resolved" ? <ReportEditor incidentId={incident.id} /> : null}
      <IncidentOperatorControls incident={incident} onChanged={refresh} onDeleted={() => void navigate({ to: "/app/incidents" })} />
      <ClientExtensionSlot id="incident.sidebar.after.v1" context={{ incident: { id: incident.id, reference: incident.reference, lifecycle: incident.lifecycle } }} />
    </aside>
  </div>;
}

function FieldNumber({ value, label, required, count, max, children }: { value: string; label: string; required?: boolean; count: number; max: number; children: ReactNode }) {
  return <label className="impact-field"><span className="field-label"><b>{value}</b>{label}{required && <em aria-hidden="true">*</em>}</span>{children}<span className="character-count">{count}/{max}</span></label>;
}

function PreviewCard({ title, heading, lifecycle, fields }: { title: string; heading: string; lifecycle: string | null; fields: Array<{ label: string; value: string }> }) {
  return <section className="preview-card"><p className="preview-type">{title}</p>{lifecycle && <span className={`state-pill state-${lifecycle.toLowerCase()}`}>{lifecycle}</span>}<h3>{heading}</h3><dl>{fields.map((field, index) => <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></section>;
}

function AiSuggestionButton({ incidentId, onSuggestion }: { incidentId: string; onSuggestion: (suggestion: IncidentDraftInput) => void }) {
  const { data } = useAppData<{ configured: boolean }>("/api/app/ai/status");
  const [message, setMessage] = useState<string | null>(null);
  if (!data?.configured) return null;
  const suggest = async () => { setMessage("Drafting suggestion…"); try { const response = await appApi<{ suggestion: IncidentDraftInput }>(`/api/app/incidents/${incidentId}/ai-suggestion`, { method: "POST" }); onSuggestion(response.suggestion); setMessage("Suggestion filled the editable draft."); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Suggestion failed."); } };
  return <div className="ai-suggestion"><Button type="button" variant="secondary" onClick={suggest}>Suggest update</Button>{message ? <span role="status">{message}</span> : null}</div>;
}

type IncidentTemplate = { id: string; name: string; lifecycle: IncidentDraftInput["lifecycle"]; affectedAudience: string; customerImpact: string; whatStillWorks: string; details: string; nextUpdateOffsetMinutes: number; components: Array<{ componentId: string | null; state: string; relationship: string }> };
function TemplateControls({ incident, draft, onApplied }: { incident: NonNullable<IncidentResponse["incident"]>; draft: IncidentDraftInput; onApplied: (draft: IncidentDraftInput) => void }) {
  const { data, refresh } = useAppData<{ templates: IncidentTemplate[] }>("/api/app/incident-templates");
  const [name, setName] = useState(""); const [offset, setOffset] = useState("60"); const [selected, setSelected] = useState(""); const [message, setMessage] = useState<string | null>(null);
  const save = async () => {
    const nextUpdateOffsetMinutes = Number(offset);
    try {
      await appApi("/api/app/incident-templates", { method: "POST", body: JSON.stringify({ name, lifecycle: draft.lifecycle, affectedAudience: draft.affectedAudience, customerImpact: draft.customerImpact, whatStillWorks: draft.whatStillWorks, details: draft.details, nextUpdateOffsetMinutes, components: incident.components.flatMap((component) => component.componentId ? [{ componentId: component.componentId, state: component.state, relationship: component.relationship }] : []) }) });
      setMessage("Template saved."); setName(""); refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Template could not be saved."); }
  };
  const apply = async () => {
    if (!selected) return;
    try {
      const response = await appApi<{ draft: IncidentDraftInput }>(`/api/app/incidents/${incident.id}/templates/${selected}/apply`, { method: "POST" });
      // The template endpoint returns a stored record; only editable fields
      // belong in the subsequent autosave input.
      const { lifecycle, affectedAudience, customerImpact, whatStillWorks, details, nextUpdateAt } = response.draft;
      onApplied({ lifecycle, affectedAudience, customerImpact, whatStillWorks, details, nextUpdateAt }); setMessage("Template filled the private draft.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Template could not be applied."); }
  };
  return <section className="template-controls" aria-label="Update templates"><div><strong>Update templates</strong><p>Save this private draft and its component claims, or apply a saved template without publishing.</p></div><div className="template-form"><label className="form-label">Template name<input aria-label="Template name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Template name" /></label><label className="form-label">Next update offset (minutes)<input aria-label="Next update offset in minutes" type="number" min="1" max="10080" value={offset} onChange={(event) => setOffset(event.target.value)} /></label><Button type="button" variant="secondary" disabled={!name.trim()} onClick={save}>Save template</Button></div>{data?.templates.length ? <div className="template-form"><label className="form-label">Saved update template<select aria-label="Saved update template" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Choose a saved template</option>{data.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><Button type="button" variant="secondary" disabled={!selected} onClick={apply}>Apply template</Button></div> : null}{message ? <p role="status">{message}</p> : null}</section>;
}

type Report = { summary: string; timeline: string; cause: string; remediation: string; publishedAt: string | null };
function ReportEditor({ incidentId }: { incidentId: string }) {
  const { data, refresh } = useAppData<{ report: Report | null }>(`/api/app/incidents/${incidentId}/report`);
  const [report, setReport] = useState<Report>({ summary: "", timeline: "", cause: "", remediation: "", publishedAt: null });
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (data?.report) setReport(data.report); }, [data]);
  if (report.publishedAt) return <section className="context-section"><h2>Post-incident report</h2><p>Published {formatOperatorTime(report.publishedAt)}.</p></section>;
  const update = (field: keyof Omit<Report, "publishedAt">, value: string) => setReport((current) => ({ ...current, [field]: value }));
  const save = async () => { try { await appApi(`/api/app/incidents/${incidentId}/report`, { method: "PUT", body: JSON.stringify(report) }); setMessage("Report saved."); refresh(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Report could not be saved."); } };
  const publish = async () => { try { await appApi(`/api/app/incidents/${incidentId}/report/publish`, { method: "POST", body: JSON.stringify({ channels: ["email"] }) }); setMessage("Report published."); refresh(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Report could not be published."); } };
  return <section className="context-section report-editor"><h2>Post-incident report</h2><p>Publish one factual report when this incident is complete.</p>{(["summary", "timeline", "cause", "remediation"] as const).map((field) => <label className="form-label" key={field}>{field[0].toUpperCase() + field.slice(1)}<textarea value={report[field]} maxLength={10_000} onChange={(event) => update(field, event.target.value)} /></label>)}{message ? <p role="status">{message}</p> : null}<div className="form-actions"><Button type="button" variant="secondary" onClick={save}>Save report</Button><Button type="button" onClick={publish}>Publish report</Button></div></section>;
}
