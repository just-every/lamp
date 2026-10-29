import { RecoveryCheckPanel } from "./recovery-check";
import { IncidentImpactCard } from "../../incident-impact/ui";
import { TemplateControls } from "./template-controls";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { createUlid } from "../../../shared/ids";
import type { UpdateChannel } from "../../../shared/domain";
import type { IncidentDraftInput } from "../../../shared/schemas";
import type { IncidentsService } from "../service";
import type { RenderedIncidentUpdate } from "../renderer";
import type { AppliedIncidentTemplate } from "../template-service";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { ApiError, appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { LoadingState, FormError } from "../../../app/client/ui/states";
import { EmptyState, ErrorState } from "../../../app/client/ui/lit-states";
import { usePageTimezone } from "../../../app/client/ui/timezone";
import { AiSuggestionButton } from "./incident-composer-tools";
import { WordingFindings } from "./wording-findings";
import { checkUpdateWording } from "../wording-checks";
import { IncidentOperatorControls } from "./incident-operator-controls";
import { SuggestionSources, type AppliedSuggestion, type SuggestedFieldName } from "./suggestion-sources";
import type { CheckedSuggestion } from "../../ai/service";
import { useIncidentVisit } from "./use-incident-visit";
import { blankDraft, draftFromIncident, normalizeResolvedDraft } from "../draft";
import { IncidentHeader } from "./incident-header";
import { PreparedDraft } from "./prepared-draft";
import { CommunicationOwnerControl } from "./communication-owner";
import { IncidentExtras, IncidentTimeline } from "./incident-record";
import { IncidentPreview } from "./incident-preview";
import { StatusChoice } from "./status-choice";
import { NextUpdateField } from "./next-update-field";
import { ComponentRelationships, DraftComponentChips, useDraftRelationships } from "./affected-components";
import { IncidentActions, MoreOptions, OptionalText } from "./incident-more-options";
import { PublicationControls, publishHint, type Channel, type PublishTiming } from "./publish-options";

type IncidentResponse = { wordingChecks?: { blockedTerms: string[]; friendlyLength: number }; incident: Awaited<ReturnType<IncidentsService["get"]>>; hasChatChannels: boolean; previewError?: string | null; preview?: RenderedIncidentUpdate | null };
type PreviewResponse = { preview: RenderedIncidentUpdate };
// A draft write clears the stored schedule on the server, so the page stops saying the update is scheduled.
const SCHEDULE_CLEARED = "Your edit cancelled the schedule.";

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
  const timezone = usePageTimezone();
  const impactId = useId();
  const initialPreviewTimezone = useRef(timezone);
  const { data, error, loading, refresh } = useAppData<IncidentResponse>(`/api/app/incidents/${incidentId}`);
  const { data: socialData } = useAppData<{ postByDefault: boolean }>("/api/app/social");
  const navigate = useNavigate();
  // What the new-incident screen reports after it created this incident and published (or failed to). It belongs to
  // this visit: read once here, then dropped from the history entry, so a reload or a return never replays it.
  const notice = useRouterState({ select: state => state.location.state.incidentNotice });
  const arrival = useRef(notice).current;
  useEffect(() => {
    const { incidentNotice, ...entry } = window.history.state ?? {};
    // The native replace: the router's patched one counts as a navigation and reloads the page's data.
    if (incidentNotice) History.prototype.replaceState.call(window.history, entry, "");
  }, []);
  // A same-incident refresh must not restart the draft deadline (UPDATE-005).
  const loadedIncidentId = data?.incident?.id === incidentId ? incidentId : undefined;
  const [publishedIncident, setPublishedIncident] = useState<IncidentResponse["incident"]>(null);
  const [timeErrors, setTimeErrors] = useState<Record<"nextUpdate" | "timing", string | null>>({ nextUpdate: null, timing: null });
  const hasTimeError = Object.values(timeErrors).some(Boolean);
  const version = useRef("-:0");
  const [draft, setDraft] = useState<IncidentDraftInput>(() => data?.incident ? draftFromIncident(data.incident) : blankDraft);
  const [draftRevision, setDraftRevision] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RenderedIncidentUpdate | null>(data?.preview ?? null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // A refused or private-saved update arrives with the notification and timing choices the operator made.
  const touchedSocialSelection = useRef(Boolean(arrival?.publication));
  const socialDefaultApplied = useRef(false);
  const [channels, setChannels] = useState<Channel[]>(arrival?.publication?.channels ?? ["email"]);
  const [timing, setTiming] = useState<PublishTiming>(arrival?.publication?.timing ?? { mode: "now", at: null });
  const [publishState, setPublishState] = useState<"idle" | "publishing" | "scheduled" | "published" | "error">(arrival ? (arrival.error ? "error" : "published") : "idle");
  const [publishMessage, setPublishMessage] = useState<string | null>(arrival?.text ?? null);
  const [overrideReason, setOverrideReason] = useState("");
  const [recoveryRevision, setRecoveryRevision] = useState(0);
  useEffect(() => { if (draft.lifecycle !== "Resolved") setOverrideReason(""); }, [draft.lifecycle]);
  const [appliedSuggestion, setAppliedSuggestion] = useState<AppliedSuggestion | null>(null);
  const savedKey = useRef<string | null>(null);
  const pristineKey = useRef<string | null>(null);
  const untouchedDraft = useRef(false);
  const activeSave = useRef<object | null>(null);
  const pendingDraft = useRef<{ key: string; dueAt: number } | null>(null);
  const failedKey = useRef<string | null>(null);
  const hydratedIncident = useRef<string | null>(null);
  const hydratingDraft = useRef(false);
  // Whether the server holds a schedule for the acknowledged draft. Every draft write clears it.
  const heldSchedule = useRef(false);
  const wordingFindings = useMemo(() => data?.wordingChecks ? checkUpdateWording({ affectedAudience: draft.affectedAudience, customerImpact: draft.customerImpact, whatStillWorks: draft.whatStillWorks, details: draft.details }, data.wordingChecks) : [], [draft.affectedAudience, draft.customerImpact, draft.whatStillWorks, draft.details, data?.wordingChecks]);
  const draftKey = useMemo(() => JSON.stringify(draft), [draft]);
  const latestDraftKey = useRef(draftKey);
  latestDraftKey.current = draftKey;
  // Eligibility follows the displayed bytes, including before effects run.
  const draftSaved = savedKey.current === draftKey && !activeSave.current && saveState !== "error";
  const draftEmpty = untouchedDraft.current && pristineKey.current === draftKey;
  const publishable = Boolean(draft.affectedAudience.trim() && draft.customerImpact.trim() && (draft.lifecycle === "Resolved" || (draft.nextUpdateAt && Number.isFinite(Date.parse(draft.nextUpdateAt)))) && (data?.incident?.components.some(component => component.componentId) || draft.componentChanges?.length) && (timing.mode === "now" || timing.at));
  const visibleSaveState = draftEmpty ? "empty" : draftSaved ? "saved" : saveState === "error" && failedKey.current === draftKey ? "error" : "saving";
  const updateField = <K extends keyof IncidentDraftInput>(field: K, value: IncidentDraftInput[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    // Once the operator edits a suggested field, the text is theirs.
    setAppliedSuggestion((current) => current && field in current.fields ? { ...current, fields: Object.fromEntries(Object.entries(current.fields).filter(([name]) => name !== field)) } : current);
  };
  const relationships = useDraftRelationships(data?.incident ?? null, draft, changes => updateField("componentChanges", changes));

  // Establish the saved draft authority before controls can accept input.
  useLayoutEffect(() => {
    if (!data?.incident || !loadedIncidentId || hydratedIncident.current === loadedIncidentId) return;
    const initial = draftFromIncident(data.incident);
    hydratedIncident.current = data.incident.id;
    // A scheduled draft opens as the server holds it: its time and its channels (UPDATE-006, NOTIFY-007).
    const scheduled = data.incident.draft?.scheduledPublishAt ? data.incident.draft : null;
    heldSchedule.current = Boolean(scheduled);
    if (scheduled) { touchedSocialSelection.current = true; setChannels(scheduled.scheduledChannels); setTiming({ mode: "schedule", at: scheduled.scheduledPublishAt }); }
    else if (data.hasChatChannels && !arrival?.publication) setChannels(["email", "chat"]);
    version.current = `${data.incident.draft?.id ?? "-"}:${data.incident.updates.length}`;
    hydratingDraft.current = true;
    pendingDraft.current = null;
    pristineKey.current = JSON.stringify(initial);
    savedKey.current = data.incident.draft ? pristineKey.current : null;
    untouchedDraft.current = !data.incident.draft;
    setDraft(initial);
    setDraftRevision((current) => current + 1);
  }, [data, loadedIncidentId]);

  // Apply the owner’s default once for this update; an explicit choice or held schedule wins.
  useEffect(() => {
    if (!loadedIncidentId || !socialData || socialDefaultApplied.current) return;
    socialDefaultApplied.current = true;
    if (!touchedSocialSelection.current && !data?.incident?.draft?.scheduledPublishAt && socialData.postByDefault) setChannels(current => current.includes("social") ? current : [...current, "social"]);
  }, [loadedIncidentId, socialData, data?.incident?.draft?.scheduledPublishAt]);

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
      // Leave most of the two-second deadline for the native write and acknowledgement.
      pendingDraft.current = { key: draftKey, dueAt: performance.now() + 500 };
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
          if (heldSchedule.current) { heldSchedule.current = false; setPublishState("idle"); setPublishMessage(SCHEDULE_CLEARED); }
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
    if (data?.preview && data.incident && initialPreviewTimezone.current === timezone && draftKey === JSON.stringify(draftFromIncident(data.incident))) {
      setPreview(data.preview);
      setPreviewError(null);
      return;
    }
    if (data?.previewError && data.incident && draftKey === JSON.stringify(draftFromIncident(data.incident))) {
      setPreviewError(data.previewError);
      return;
    }
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

  // A suggestion fills the text fields only; lifecycle and next-update time stay the operator's.
  const applySuggestion = ({ suggestion, brief }: CheckedSuggestion) => {
    // An empty suggested field means the brief does not establish it; whatever the operator typed there stays.
    const names = (["affectedAudience", "customerImpact", "whatStillWorks", "details"] as SuggestedFieldName[]).filter((name) => suggestion[name].text);
    setDraft((current) => ({ ...current, ...Object.fromEntries(names.map((name) => [name, suggestion[name].text])) }));
    setAppliedSuggestion({ brief, fields: Object.fromEntries(names.map((name) => [name, suggestion[name].sources])) });
  };
  const applyDraft = (next: IncidentDraftInput, storedId?: string) => {
    if (storedId) { version.current = `${storedId}:${incident.updates.length}`; savedKey.current = JSON.stringify(normalizeResolvedDraft(next)); untouchedDraft.current = false; }
    if (storedId && heldSchedule.current) { heldSchedule.current = false; setPublishState("idle"); setPublishMessage(SCHEDULE_CLEARED); }
    setDraft(normalizeResolvedDraft(next));
  };
  // UPDATE-009 on the server: the template replaces the saved draft under its acknowledged version.
  const applyTemplate = async (template: { id: string }, isCurrent: () => boolean) => {
    const response = await appApi<AppliedIncidentTemplate & { channels?: UpdateChannel[] }>(`/api/app/incidents/${incident.id}/templates/${template.id}/apply`, { method: "POST", headers: { "If-Match": version.current } });
    if (!isCurrent()) return null;
    const { lifecycle, affectedAudience, customerImpact, whatStillWorks, details, nextUpdateAt } = response.draft;
    const componentChanges = response.draft.componentChanges.map(({ componentId, state, relationship }) => ({ componentId, state, relationship }));
    applyDraft({ lifecycle, affectedAudience, customerImpact, whatStillWorks, details, nextUpdateAt, componentChanges }, response.draft.id);
    if (response.channels !== undefined) {
      // Notification templates choose subscriber channels. An existing social
      // choice stays with this update; explicitly notifying nobody clears it.
      const selected = response.channels;
      if (!selected.length) touchedSocialSelection.current = true;
      setChannels(current => selected.length ? [...selected.filter(channel => channel !== "social"), ...(current.includes("social") ? ["social" as const] : [])] : []);
    }
    return nextUpdateAt === null && lifecycle !== "Resolved" ? "Template filled the private draft. Choose the next update time before publishing." : "Template filled the private draft.";
  };
  const changeLifecycle = (lifecycle: IncidentDraftInput["lifecycle"]) => {
    if (lifecycle === "Resolved") setTimeErrors(current => ({ ...current, nextUpdate: null }));
    setDraft((current) => normalizeResolvedDraft({ ...current, lifecycle }));
    setPublishState("idle");
    setPublishMessage(null);
  };
  const publish = async () => {
    if (!draftSaved || !publishable || hasTimeError) return;
    const historicalPublishedAt = timing.mode === "backdate" ? timing.at : null;
    if (historicalPublishedAt && new Date(historicalPublishedAt).getTime() >= Date.now()) {
      setPublishState("error"); setPublishMessage("A historical publication timestamp must be in the past."); return;
    }
    let isCurrent = captureUpdate();
    setPublishState("publishing"); setPublishMessage(null);
    try { await appApi(`/api/app/incidents/${incident.id}/publish`, { method: "POST", headers: { "If-Match": version.current }, body: JSON.stringify({ channels, ...(draft.lifecycle === "Resolved" && overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}), ...(historicalPublishedAt ? { publishedAt: historicalPublishedAt } : {}) }) });
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
      setPublishedIncident(response.incident); setAppliedSuggestion(null); setOverrideReason("");
      const next = draftFromIncident(response.incident);
      version.current = `${response.incident.draft?.id ?? "-"}:${response.incident.updates.length}`;
      pristineKey.current = JSON.stringify(next);
      savedKey.current = response.incident.draft ? pristineKey.current : null;
      untouchedDraft.current = !response.incident.draft;
      pendingDraft.current = null; failedKey.current = null; heldSchedule.current = false;
      hydratingDraft.current = true;
      setDraft(next); setSaveState("saved"); setSaveError(null);
      setPreview(null); setPreviewError(null);
      touchedSocialSelection.current = false;
      setChannels(current => [...current.filter(channel => channel !== "social"), ...(socialData?.postByDefault ? ["social" as const] : [])]);
      setTiming({ mode: "now", at: null });
      setPublishState("published"); setPublishMessage(historicalPublishedAt ? "Historical update published. It did not notify subscribers." : "Update published."); refresh(); }
    catch (cause) { if (!isCurrent()) return; setPublishState("error"); setRecoveryRevision(current => current + 1); setPublishMessage(cause instanceof Error ? cause.message : "The update could not be published."); }
  };
  const schedule = async () => {
    if (!draftSaved || !publishable || hasTimeError || !timing.at) return;
    const isCurrent = captureUpdate();
    setPublishState("publishing"); setPublishMessage(null);
    try { const response = await appApi<{ draft: { id: string } }>(`/api/app/incidents/${incident.id}/draft/schedule`, { method: "POST", headers: { "If-Match": version.current }, body: JSON.stringify({ publishAt: timing.at, channels }) }); if (!isCurrent()) return; version.current = `${response.draft.id}:${incident.updates.length}`; heldSchedule.current = true; setPublishState("scheduled"); setPublishMessage("Update scheduled. It stays private until then."); }
    catch (cause) { if (!isCurrent()) return; setPublishState("error"); setPublishMessage(cause instanceof Error ? cause.message : "The update could not be scheduled."); }
  };
  const findings = (field: SuggestedFieldName) => <><WordingFindings findings={wordingFindings.filter(finding => finding.field === field)} /><SuggestionSources field={field} applied={appliedSuggestion} /></>;
  const slotContext = { incident: { id: incident.id, reference: incident.reference, lifecycle: incident.lifecycle } };
  const saveLabel = visibleSaveState === "empty" ? "Not saved yet" : visibleSaveState === "saving" ? "Saving draft…" : visibleSaveState === "saved" ? "Draft saved" : "Draft save failed";
  const disabled = publishState === "publishing" || !draftSaved || !publishable || hasTimeError;

  return <div className="incident-page">
    <IncidentHeader incident={incident} />
    <CommunicationOwnerControl key={incident.id} incidentId={incident.id} lifecycle={incident.lifecycle} owner={incident.owner} unowned={incident.unowned} captureVisit={captureVisit} onChanged={refresh} />
    <div className="incident-compose">
      <section className="composer-panel" aria-labelledby="composer-title" inert={publishState === "publishing"}>
        <div className="composer-heading"><h2 id="composer-title" className="eyebrow">{incident.updates.length ? "Update draft" : "First update"}</h2><p role="status" aria-live="polite" className={`autosave-status is-${visibleSaveState}`}>{saveLabel}</p></div>
        <PreparedDraft preparation={incident.draft?.agentPreparation ?? null} />
        {publishMessage ? <p role="status" className={`publication-message is-${publishState}`}>{publishMessage}</p> : null}
        {saveError && <FormError>{saveError}</FormError>}
        {visibleSaveState === "error" && <Button type="button" variant="secondary" onClick={() => { failedKey.current = null; setSaveError(null); setSaveState("saving"); setDraftRevision((current) => current + 1); }}>Retry save</Button>}
        <AiSuggestionButton key={`suggest-${updateGeneration.current}`} incidentId={incident.id} onSuggestion={applySuggestion} captureUpdate={captureUpdate} />
        <form inert={publishState === "publishing"} className="impact-form" onSubmit={(event) => event.preventDefault()}>
          <StatusChoice value={draft.lifecycle} onChange={changeLifecycle} />
          {/* A separate label keeps the field's name to its question; a wrapping label would also read the text. */}
          <div className="impact-field"><label className="field-label" htmlFor={impactId}>What’s happening?</label><textarea id={impactId} required rows={2} placeholder="What customers see now" value={draft.customerImpact} maxLength={250} onChange={(event) => updateField("customerImpact", event.target.value)} /></div>
          {findings("customerImpact")}
          <fieldset className="impact-field">
            <legend>Who’s affected?</legend>
            <DraftComponentChips incident={incident} draft={draft} onChange={changes => updateField("componentChanges", changes)} />
            <input aria-label="Who is affected" required placeholder="Which customers" value={draft.affectedAudience} maxLength={250} onChange={(event) => updateField("affectedAudience", event.target.value)} />
          </fieldset>
          {findings("affectedAudience")}
          {draft.lifecycle === "Resolved" ? <p className="resolution-note" role="status">Resolving closes the incident. No next update.</p> : <NextUpdateField value={draft.nextUpdateAt} timezone={timezone} onChange={(value) => updateField("nextUpdateAt", value)} onError={(message) => setTimeErrors(current => ({ ...current, nextUpdate: message }))} />}
          <ClientExtensionSlot id="incident.composer.fields.after.v1" context={slotContext} />
        </form>
        {draft.lifecycle === "Resolved" && <RecoveryCheckPanel key={`recovery-${recoveryRevision}`} incidentId={incident.id} overrideReason={overrideReason} onOverrideReason={setOverrideReason} />}
      </section>
      <div className="incident-side">
        <IncidentPreview preview={preview} error={previewError} />
        <IncidentTimeline incident={incident} />
      </div>
      <div className="composer-publish" inert={publishState === "publishing"}>
        <MoreOptions footer={<><span className="publish-hint">{publishHint(channels, timing)}</span><Button type="button" disabled={disabled} onClick={timing.mode === "schedule" ? schedule : publish}>{publishState === "publishing" ? "Publishing…" : timing.mode === "schedule" ? "Schedule update" : timing.mode === "backdate" ? "Publish historical update" : "Publish update"}</Button></>}>
          <OptionalText label="What still works" value={draft.whatStillWorks} max={250} onChange={(value) => updateField("whatStillWorks", value)}>{findings("whatStillWorks")}</OptionalText>
          <OptionalText label="Details" value={draft.details} max={500} onChange={(value) => updateField("details", value)}>{findings("details")}</OptionalText>
          <PublicationControls channels={channels} onChannels={next => { touchedSocialSelection.current = true; setChannels(next); }} timing={timing} timezone={timezone} error={timeErrors.timing} onTiming={setTiming} onError={(message) => setTimeErrors(current => ({ ...current, timing: message }))} />
          <ComponentRelationships rows={relationships.rows} onChange={relationships.change} />
          <TemplateControls key={updateGeneration.current} draft={draft} components={[...incident.components.flatMap(component => component.componentId ? [{ componentId: component.componentId, state: draft.componentChanges?.find(change => change.componentId === component.componentId)?.state ?? component.state, relationship: component.relationship }] : []), ...(draft.componentChanges ?? []).filter(change => !incident.components.some(component => component.componentId === change.componentId)).map(change => ({ ...change, relationship: change.relationship ?? "Primary" as const }))]} onApply={applyTemplate} captureUpdate={captureUpdate} />
        </MoreOptions>
      </div>
    </div>
    <IncidentExtras incident={incident} briefRevision={draftSaved ? `${incident.updates.length}:${draftKey}` : null}>
      <IncidentActions>
        <IncidentOperatorControls incident={incident} captureVisit={captureVisit} captureUpdate={captureUpdate} getDraftVersion={() => version.current} onChanged={refresh} onDeleted={() => void navigate({ to: "/app/incidents" })} />
        <IncidentImpactCard incidentId={incident.id} />
      </IncidentActions>
    </IncidentExtras>
  </div>;
}
