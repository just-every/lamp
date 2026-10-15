import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createUlid } from "../../../shared/ids";
import type { IncidentDraftInput } from "../../../shared/schemas";
import type { IncidentsService } from "../service";
import type { RenderedIncidentUpdate } from "../renderer";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { ApiError, appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { LoadingState, useOperatorTime, FormError } from "../../../app/client/ui/states";
import { EmptyState, ErrorState } from "../../../app/client/ui/lit-states";
import { usePageTimezone, toPageDateTime, fromPageDateTime } from "../../../app/client/ui/timezone";
import { FieldNumber, PreviewCard, AiSuggestionButton, TemplateControls, ReportEditor } from "./incident-composer-tools";
import { IncidentComponents } from "./incident-components";
import { IncidentOperatorControls } from "./incident-operator-controls";
import { IncidentBriefPanel } from "../../brief/ui/incident-brief";
import { SuggestionSources, type AppliedSuggestion, type SuggestedFieldName } from "./suggestion-sources";
import type { CheckedSuggestion } from "../../ai/service";
import { useIncidentVisit } from "./use-incident-visit";

type IncidentResponse = { incident: Awaited<ReturnType<IncidentsService["get"]>>; hasChatChannels: boolean };
type PreviewResponse = { preview: RenderedIncidentUpdate };

const blankDraft: IncidentDraftInput = {
  lifecycle: "Investigating",
  affectedAudience: "",
  customerImpact: "",
  whatStillWorks: "",
  details: "",
  nextUpdateAt: null,
};

// The state chip's colour class for a lifecycle or impact, as .state-pill uses it.
function stateClass(state: string) {
  return `state-${state.toLowerCase().replaceAll(" ", "-")}`;
}

function normalizeResolvedDraft(draft: IncidentDraftInput): IncidentDraftInput {
  return draft.lifecycle === "Resolved" ? { ...draft, nextUpdateAt: null } : draft;
}

function draftFromIncident(incident: NonNullable<IncidentResponse["incident"]>): IncidentDraftInput {
  if (!incident.draft) return { ...blankDraft, lifecycle: ({ Investigating: "Identified", Identified: "Monitoring", Monitoring: "Resolved", Resolved: "Resolved" } as const)[incident.lifecycle] };
  return normalizeResolvedDraft({
    lifecycle: incident.draft.lifecycle,
    affectedAudience: incident.draft.affectedAudience,
    customerImpact: incident.draft.customerImpact,
    whatStillWorks: incident.draft.whatStillWorks,
    details: incident.draft.details,
    nextUpdateAt: incident.draft.nextUpdateAt,
  });
}

export function IncidentDetailPage({ incidentId }: { incidentId: string }) {
  // Every editing visit owns its data loader, draft queue and child controls.
  // Returning A → B → A creates a new A, even if the old A still has a request.
  return <IncidentVisit key={incidentId} incidentId={incidentId} />;
}

function IncidentVisit({ incidentId }: { incidentId: string }) {
  const captureVisit = useIncidentVisit();
  const updateGeneration = useRef(0);
  const captureUpdate = useCallback(() => {
    const generation = updateGeneration.current;
    const isVisitCurrent = captureVisit();
    return () => isVisitCurrent() && updateGeneration.current === generation;
  }, [captureVisit]);
  const formatOperatorTime = useOperatorTime();
  const timezone = usePageTimezone();
  const toLocalDateTime = (iso: string | null) => toPageDateTime(iso, timezone);
  const { data, error, loading, refresh } = useAppData<IncidentResponse>(`/api/app/incidents/${incidentId}`);
  const navigate = useNavigate();
  // A same-incident refresh must not restart the draft deadline (UPDATE-005).
  const loadedIncidentId = data?.incident?.id === incidentId ? incidentId : undefined;
  const [publishedIncident, setPublishedIncident] = useState<IncidentResponse["incident"]>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [timeErrors, setTimeErrors] = useState<Record<"nextUpdate" | "scheduled" | "historical", string | null>>({ nextUpdate: null, scheduled: null, historical: null });
  const hasTimeError = Object.values(timeErrors).some(Boolean);
  const version = useRef("-:0");
  const [draft, setDraft] = useState<IncidentDraftInput>(blankDraft);
  const [draftRevision, setDraftRevision] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RenderedIncidentUpdate | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Array<"email" | "webhook" | "chat">>(["email"]);
  const [scheduledPublishAt, setScheduledPublishAt] = useState<string | null>(null);
  const [historicalPublishedAt, setHistoricalPublishedAt] = useState<string | null>(null);
  const [publishState, setPublishState] = useState<"idle" | "publishing" | "scheduled" | "published" | "error">("idle");
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [appliedSuggestion, setAppliedSuggestion] = useState<AppliedSuggestion | null>(null);
  const timingDisclosure = useRef<HTMLDetailsElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const previewScroll = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(previewScroll.current), []);
  const savedKey = useRef<string | null>(null);
  const pristineKey = useRef<string | null>(null);
  const untouchedDraft = useRef(false);
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
  const draftEmpty = untouchedDraft.current && pristineKey.current === draftKey;
  const publishable = Boolean(draft.affectedAudience.trim() && draft.customerImpact.trim() && (draft.lifecycle === "Resolved" || (draft.nextUpdateAt && Number.isFinite(Date.parse(draft.nextUpdateAt)))) && data?.incident?.components.some(component => component.componentId));
  const visibleSaveState = draftEmpty ? "empty" : draftSaved ? "saved" : saveState === "error" && failedKey.current === draftKey ? "error" : "saving";

  useEffect(() => {
    if (!data?.incident || !loadedIncidentId || hydratedIncident.current === loadedIncidentId) return;
    const initial = draftFromIncident(data.incident);
    hydratedIncident.current = data.incident.id;
    if (data.hasChatChannels) setChannels(["email", "chat"]);
    version.current = `${data.incident.draft?.id ?? "-"}:${data.incident.updates.length}`;
    hydratingDraft.current = true;
    pendingDraft.current = null;
    pristineKey.current = JSON.stringify(initial);
    savedKey.current = data.incident.draft ? pristineKey.current : null;
    untouchedDraft.current = !data.incident.draft;
    setDraft(initial);
    setDraftRevision((current) => current + 1);
  }, [data, loadedIncidentId]);

  useEffect(() => {
    if (!loadedIncidentId) return;
    const isCurrent = captureUpdate();
    if (hydratingDraft.current) {
      if (pristineKey.current === draftKey) hydratingDraft.current = false;
      return;
    }
    if (draftEmpty) { pendingDraft.current = null; return; }
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
      if (!isCurrent()) return;
      const request = {};
      const attemptedId = createUlid();
      const id = loadedIncidentId;
      // Once a write starts, even a lost response may have changed the server.
      // Returning to the initial bytes must then repair the draft, not skip it.
      untouchedDraft.current = false;
      activeSave.current = request;
      appApi<{ draft: { id: string } }>(`/api/app/incidents/${id}/draft`, { method: "PUT", body: draftKey, headers: { "If-Match": version.current, "X-Draft-Id": attemptedId } })
        .then((response) => {
          if (!isCurrent()) return;
          version.current = `${response.draft.id}:${version.current.split(":")[1]}`;
          savedKey.current = draftKey;
          setSaveState(latestDraftKey.current === draftKey ? "saved" : "saving");
        })
        .catch(async (cause: unknown) => {
          if (!isCurrent()) return;
          if (!(cause instanceof ApiError)) {
            // Reconcile only our exact attempted bytes after a lost response.
            // A different tab's write must never authorize a retry over it.
            const current = await appApi<IncidentResponse>(`/api/app/incidents/${id}`).catch(() => null);
            if (!isCurrent()) return;
            if (current?.incident?.draft?.id === attemptedId && !current.incident.draft.scheduledPublishAt && !current.incident.draft.reviewedAt && !current.incident.draft.correctsUpdateId && JSON.stringify(draftFromIncident(current.incident)) === draftKey) version.current = `${current.incident.draft.id}:${current.incident.updates.length}`;
          }
          if (!isCurrent()) return;
          // A lost response does not prove the server rejected the write.
          savedKey.current = null;
          failedKey.current = latestDraftKey.current === draftKey ? draftKey : null;
          setSaveState(failedKey.current ? "error" : "saving");
          setSaveError(failedKey.current ? (cause instanceof Error ? cause.message : "The draft could not be saved.") : null);
        })
        .finally(() => {
          if (!isCurrent()) return;
          if (activeSave.current === request) activeSave.current = null;
          setDraftRevision((current) => current + 1);
        });
    }, Math.max(0, pendingDraft.current.dueAt - performance.now()));
    return () => window.clearTimeout(timeout);
  }, [loadedIncidentId, draftKey, draftRevision, draftEmpty, captureUpdate]);

  useEffect(() => {
    if (!loadedIncidentId) return;
    const isCurrent = captureUpdate();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      if (!isCurrent()) return;
      appApi<PreviewResponse>(`/api/app/incidents/${loadedIncidentId}/draft/preview`, { method: "POST", body: JSON.stringify(draft), signal: controller.signal })
        .then((response) => { if (!isCurrent() || controller.signal.aborted) return; setPreview(response.preview); setPreviewError(null); })
        .catch((cause: unknown) => {
          if (!isCurrent() || controller.signal.aborted) return;
          setPreviewError(cause instanceof Error ? cause.message : "Preview is unavailable.");
        });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [loadedIncidentId, data?.incident, draft, draftKey, timezone, captureUpdate]);

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!data?.incident) return <section className="page-stack"><h1>Incident unavailable</h1><EmptyState>The incident record does not exist.</EmptyState><Link className="back-link" to="/app/incidents">Back to incidents</Link></section>;
  if (!loadedIncidentId) return <LoadingState />;
  const incident = publishedIncident?.id === data.incident.id && publishedIncident.updates.length > data.incident.updates.length ? publishedIncident : data.incident;

  const updateField = <K extends keyof IncidentDraftInput>(field: K, value: IncidentDraftInput[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    // Once the operator edits a suggested field, the text is theirs.
    setAppliedSuggestion((current) => current && field in current.fields ? { ...current, fields: Object.fromEntries(Object.entries(current.fields).filter(([name]) => name !== field)) } : current);
  };
  // A suggestion fills the text fields only; lifecycle and next-update time stay the operator's.
  const applySuggestion = ({ suggestion, brief }: CheckedSuggestion) => {
    // An empty suggested field means the brief does not establish it; whatever the operator typed there stays.
    const names = (["affectedAudience", "customerImpact", "whatStillWorks", "details"] as SuggestedFieldName[]).filter((name) => suggestion[name].text);
    setDraft((current) => ({ ...current, ...Object.fromEntries(names.map((name) => [name, suggestion[name].text])) }));
    setAppliedSuggestion({ brief, fields: Object.fromEntries(names.map((name) => [name, suggestion[name].sources])) });
  };
  const applyDraft = (next: IncidentDraftInput, storedId?: string) => {
    if (storedId) { version.current = `${storedId}:${incident.updates.length}`; savedKey.current = JSON.stringify(normalizeResolvedDraft(next)); untouchedDraft.current = false; }
    setDraft(normalizeResolvedDraft(next));
  };
  const prepareResolution = () => {
    setTimeErrors(current => ({ ...current, nextUpdate: null }));
    setDraft((current) => normalizeResolvedDraft({ ...current, lifecycle: "Resolved" }));
    setPublishState("idle");
    setPublishMessage(null);
  };
  const changeLifecycle = (lifecycle: IncidentDraftInput["lifecycle"]) => {
    if (lifecycle === "Resolved") setTimeErrors(current => ({ ...current, nextUpdate: null }));
    setDraft((current) => normalizeResolvedDraft({
      ...current,
      lifecycle,
    }));
  };
  const toggleChannel = (channel: "email" | "webhook" | "chat") => setChannels((current) => current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel]);
  const publish = async () => {
    if (!draftSaved || !publishable || hasTimeError) return;
    if (historicalPublishedAt && new Date(historicalPublishedAt).getTime() >= Date.now()) {
      setPublishState("error"); setPublishMessage("A historical publication timestamp must be in the past."); return;
    }
    let isCurrent = captureUpdate();
    setPublishState("publishing"); setPublishMessage(null);
    try { await appApi(`/api/app/incidents/${incident.id}/publish`, { method: "POST", headers: { "If-Match": version.current }, body: JSON.stringify({ channels, ...(historicalPublishedAt ? { publishedAt: historicalPublishedAt } : {}) }) });
      if (!isCurrent()) return;
      // Publication consumes one update's authority, even without navigation.
      // Suggestions, templates, previews or saves started for that update must
      // never populate or acknowledge the next draft. Ordinary edits do not
      // advance this generation.
      updateGeneration.current += 1;
      activeSave.current = null;
      pendingDraft.current = null;
      failedKey.current = null;
      isCurrent = captureUpdate();
      const response = await appApi<IncidentResponse>(`/api/app/incidents/${incident.id}`);
      if (!isCurrent()) return;
      if (!response.incident) throw new Error("The published incident could not be refreshed.");
      setPublishedIncident(response.incident); setAppliedSuggestion(null);
      const next = draftFromIncident(response.incident);
      version.current = `${response.incident.draft?.id ?? "-"}:${response.incident.updates.length}`;
      pristineKey.current = JSON.stringify(next);
      savedKey.current = response.incident.draft ? pristineKey.current : null;
      untouchedDraft.current = !response.incident.draft;
      pendingDraft.current = null; failedKey.current = null;
      hydratingDraft.current = true;
      setDraft(next); setSaveState("saved"); setSaveError(null);
      setPreview(null); setPreviewError(null);
      setScheduledPublishAt(null); setHistoricalPublishedAt(null);
      setPublishState("published"); setPublishMessage(historicalPublishedAt ? "Historical update published. It did not notify subscribers." : "Update published. The fixed recipient set is now queued for delivery."); refresh(); }
    catch (cause) { if (!isCurrent()) return; setPublishState("error"); setPublishMessage(cause instanceof Error ? cause.message : "The update could not be published."); }
  };
  const schedule = async () => {
    if (!draftSaved || !publishable || hasTimeError) return;
    if (historicalPublishedAt) { setPublishState("error"); setPublishMessage("A historical publication cannot also be scheduled."); return; }
    if (!scheduledPublishAt) { setPublishState("error"); setPublishMessage("Choose a future scheduled publication time before scheduling."); return; }
    const isCurrent = captureUpdate();
    setPublishState("publishing"); setPublishMessage(null);
    try { const response = await appApi<{ draft: { id: string } }>(`/api/app/incidents/${incident.id}/draft/schedule`, { method: "POST", headers: { "If-Match": version.current }, body: JSON.stringify({ publishAt: scheduledPublishAt, channels }) }); if (!isCurrent()) return; version.current = `${response.draft.id}:${incident.updates.length}`; setPublishState("scheduled"); setPublishMessage("Update scheduled. It remains private until its recorded publication time."); }
    catch (cause) { if (!isCurrent()) return; setPublishState("error"); setPublishMessage(cause instanceof Error ? cause.message : "The update could not be scheduled."); }
  };

  return <div className="incident-workspace">
    <header className="incident-workspace-heading incident-context">
      <Link className="back-link" to="/app/incidents">← Back to incidents</Link>
      <p className="eyebrow">{incident.reference}</p><h1>{incident.title}</h1>
      <div className="context-facts"><div><span>Lifecycle</span><strong className={`fact-dot ${stateClass(incident.lifecycle)}`}>{incident.lifecycle}</strong></div><div><span>Opened</span><strong>{formatOperatorTime(incident.openedAt)}</strong></div><div><span>{incident.lifecycle === "Resolved" ? "Peak impact" : "Impact"}</span><strong className={`fact-dot ${stateClass(incident.impact ?? "")}`}>{incident.impact ?? "No component impact"}</strong></div></div>
    </header>


    <section className="composer-panel" aria-labelledby="composer-title" inert={publishState === "publishing"}>
      <div className="composer-heading"><div><p className="eyebrow">Update draft</p><h2 id="composer-title">Compose public update</h2>{publishMessage ? <p role="status" className={`publication-message is-${publishState}`}>{publishMessage}</p> : null}</div><p role="status" aria-live="polite" className={`autosave-status is-${visibleSaveState}`}>{visibleSaveState === "empty" ? "New draft — not saved yet" : visibleSaveState === "saving" ? "Saving draft…" : visibleSaveState === "saved" ? "Draft saved" : "Draft save failed"}</p></div>
      {saveError && <FormError>{saveError}</FormError>}
      {visibleSaveState === "error" && <Button type="button" variant="secondary" onClick={() => { failedKey.current = null; setSaveError(null); setSaveState("saving"); setDraftRevision((current) => current + 1); }}>Retry save</Button>}
      <IncidentBriefPanel incidentId={incident.id} revision={draftSaved ? `${incident.updates.length}:${draftKey}` : null} />
      <AiSuggestionButton key={updateGeneration.current} incidentId={incident.id} onSuggestion={applySuggestion} captureUpdate={captureUpdate} />
      <form inert={publishState === "publishing"} className="impact-form" onSubmit={(event) => event.preventDefault()}>
        <FieldNumber value="1" label="Who is affected" required count={draft.affectedAudience.length} max={250}><textarea required placeholder={`Who is affected during ${draft.lifecycle.toLowerCase()}?`} value={draft.affectedAudience} maxLength={250} onChange={(event) => updateField("affectedAudience", event.target.value)} /></FieldNumber>
        <SuggestionSources field="affectedAudience" applied={appliedSuggestion} />
        <FieldNumber value="2" label="What is the impact" required count={draft.customerImpact.length} max={250}><textarea required placeholder={`Describe the current impact during ${draft.lifecycle.toLowerCase()}.`} value={draft.customerImpact} maxLength={250} onChange={(event) => updateField("customerImpact", event.target.value)} /></FieldNumber>
        <SuggestionSources field="customerImpact" applied={appliedSuggestion} />
        <FieldNumber value="3" label="What still works" count={draft.whatStillWorks.length} max={250}><textarea value={draft.whatStillWorks} maxLength={250} onChange={(event) => updateField("whatStillWorks", event.target.value)} /></FieldNumber>
        <SuggestionSources field="whatStillWorks" applied={appliedSuggestion} />
        {draft.lifecycle === "Resolved" ? (
          <div className="impact-field resolution-note" role="status">
            <span className="field-label"><b>4</b>Resolution</span>
            <p>This update closes the incident without a future update commitment.</p>
          </div>
        ) : (
          <fieldset className="impact-field">
            <legend><span>4</span>Next update by <b aria-hidden="true">*</b></legend>
            <p>A communication commitment, not an estimate of service restoration. Times in {timezone}.</p>{appliedSuggestion ? <p role="status" className="next-update-prompt">When will you update next? The assistant proposes no time: this is your commitment.</p> : null}{draft.nextUpdateAt && Date.parse(draft.nextUpdateAt) > Date.now() + 86400000 ? <p role="status" className="time-warning">The next update is more than 24 hours away.</p> : null}{timeErrors.nextUpdate ? <FormError>{timeErrors.nextUpdate}</FormError> : null}
            <div className="date-row">
              <label className="form-label">
                <span className="sr-only">Next update commitment</span>
                <input required aria-label="Next update date and time" type="datetime-local" value={toLocalDateTime(draft.nextUpdateAt)} onChange={(event) => { try { updateField("nextUpdateAt", fromPageDateTime(event.target.value, timezone)); setTimeErrors(current => ({ ...current, nextUpdate: null })); } catch (cause) { updateField("nextUpdateAt", null); setTimeErrors(current => ({ ...current, nextUpdate: (cause as Error).message })); } }} />
              </label>
            </div>
          </fieldset>
        )}
        <FieldNumber value="5" label="Additional details" count={draft.details.length} max={500}><textarea value={draft.details} maxLength={500} onChange={(event) => updateField("details", event.target.value)} /></FieldNumber>
        <SuggestionSources field="details" applied={appliedSuggestion} />
        <label className="lifecycle-control">Lifecycle<select value={draft.lifecycle} onChange={(event) => changeLifecycle(event.target.value as IncidentDraftInput["lifecycle"])}>{["Investigating", "Identified", "Monitoring", "Resolved"].map((state) => <option key={state}>{state}</option>)}</select></label>
        <ClientExtensionSlot id="incident.composer.fields.after.v1" context={{ incident: { id: incident.id, reference: incident.reference, lifecycle: incident.lifecycle } }} />
      </form>
      <details className="draft-tools"><summary>Update templates</summary><TemplateControls key={updateGeneration.current} incident={incident} draft={draft} onApplied={applyDraft} version={version.current} captureUpdate={captureUpdate} /></details>
      <section className="publication-controls" aria-label="Publication controls"><div><strong>Delivery channels</strong><p>Public page, feed, and widget always update. Select subscriber channels for this immutable update.</p></div><div className="channel-checks"><label className="checkbox-label"><input type="checkbox" checked={channels.includes("email")} onChange={() => toggleChannel("email")} />Email</label><label className="checkbox-label"><input type="checkbox" checked={channels.includes("webhook")} onChange={() => toggleChannel("webhook")} />Webhook</label><label className="checkbox-label"><input type="checkbox" checked={channels.includes("chat")} onChange={() => toggleChannel("chat")} />Slack and Teams</label></div><details className="draft-tools publication-timing" ref={timingDisclosure} open={Boolean(scheduledPublishAt || historicalPublishedAt || timeErrors.scheduled || timeErrors.historical)}><summary>Schedule or backdate</summary><div className="publication-timing-fields"><p>Times in {timezone}.</p>{timeErrors.scheduled ? <FormError>{timeErrors.scheduled}</FormError> : null}{timeErrors.historical ? <FormError>{timeErrors.historical}</FormError> : null}<label className="form-label scheduled-publication-control"><span>Scheduled publication</span><small>The update remains private until this future time.</small><input aria-label="Scheduled publication date and time" type="datetime-local" value={toLocalDateTime(scheduledPublishAt)} onChange={(event) => { try { setScheduledPublishAt(fromPageDateTime(event.target.value, timezone)); setTimeErrors(current => ({ ...current, scheduled: null })); } catch (cause) { setScheduledPublishAt(null); setTimeErrors(current => ({ ...current, scheduled: (cause as Error).message })); } }} /></label><label className="form-label historical-publication-control"><span>Historical publication timestamp</span><input aria-label="Historical publication date and time" type="datetime-local" value={toLocalDateTime(historicalPublishedAt)} onChange={(event) => { try { setHistoricalPublishedAt(fromPageDateTime(event.target.value, timezone)); setTimeErrors(current => ({ ...current, historical: null })); } catch (cause) { setHistoricalPublishedAt(null); setTimeErrors(current => ({ ...current, historical: (cause as Error).message })); } }} /><small>Use a past instant to add a retroactive public record without notifying subscribers.</small></label><div className="form-actions"><Button type="button" variant="secondary" onClick={() => { setScheduledPublishAt(null); setHistoricalPublishedAt(null); setTimeErrors(current => ({ ...current, scheduled: null, historical: null })); timingDisclosure.current?.querySelector("summary")?.focus(); }}>Use current time</Button><Button variant="secondary" type="button" disabled={publishState === "publishing" || !draftSaved || !publishable || hasTimeError} onClick={schedule}>Schedule update</Button></div></div></details></section>
      <div className="composer-actions">
        <Button type="button" variant="secondary" onClick={() => { const isCurrent = captureUpdate(); setPreviewOpen(true); window.clearTimeout(previewScroll.current); previewScroll.current = window.setTimeout(() => { if (isCurrent()) previewHeading.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, 0); }}>Preview</Button>
      </div>
    </section>

    <aside className={`preview-panel${previewOpen ? " is-open" : ""}`} aria-labelledby="preview-title"><div className="preview-heading"><div><p className="eyebrow">Customer communication</p><h2 id="preview-title" ref={previewHeading}>Live preview</h2></div></div>{previewError ? <FormError>{previewError}</FormError> : preview ? <><PreviewCard title="Public page" heading={preview.public.heading} lifecycle={preview.public.lifecycle} fields={preview.public.fields} /><details className="draft-tools email-preview"><summary>Email preview</summary><PreviewCard title="Notification email" heading={preview.email.subject} lifecycle={null} fields={preview.email.plainText.split("\n\n").slice(1).map((value, index) => ({ label: index === 0 ? "Status" : "Message", value }))} /></details></> : <LoadingState>Rendering this draft…</LoadingState>}</aside>
    <section className="composer-submit composer-actions" aria-label="Publish this update">
        {draft.lifecycle !== "Resolved" && incident.lifecycle !== "Resolved" ? <Button type="button" variant="secondary" disabled={publishState === "publishing"} onClick={prepareResolution}>Resolve incident</Button> : null}
        <Button type="button" disabled={publishState === "publishing" || !draftSaved || !publishable || hasTimeError} onClick={publish}>{publishState === "publishing" ? "Publishing…" : historicalPublishedAt ? "Publish historical update" : "Publish update"}</Button>
    </section>
    <aside className="incident-context">
      <IncidentComponents key={incident.id} incident={incident} onChanged={refresh} captureVisit={captureVisit} />
      <section className="context-section"><h2>Published timeline</h2>{incident.updates.length ? <ol className="timeline">{incident.updates.map((update) => <li key={update.id}><strong>{update.lifecycle}</strong><span>{formatOperatorTime(update.publishedAt)}</span><p>{update.customerImpact}</p></li>)}</ol> : <p>No public updates are recorded.</p>}</section>
      {incident.lifecycle === "Resolved" ? <ReportEditor incidentId={incident.id} /> : null}
      <IncidentOperatorControls incident={incident} captureVisit={captureVisit} captureUpdate={captureUpdate} getDraftVersion={() => version.current} onChanged={refresh} onDeleted={() => void navigate({ to: "/app/incidents" })} />
      <ClientExtensionSlot id="incident.sidebar.after.v1" context={{ incident: { id: incident.id, reference: incident.reference, lifecycle: incident.lifecycle } }} />
    </aside>
  </div>;
}
