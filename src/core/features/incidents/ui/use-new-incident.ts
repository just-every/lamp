import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { INCIDENT_CLAIM_STATES, type IncidentClaimState } from "../../../shared/incident-component-changes";
import type { IncidentFirstUpdateInput } from "../../../shared/schemas";
import type { RenderedIncidentUpdate } from "../renderer";
import type { IncidentsService } from "../service";
import type { IncidentTemplate } from "../template-repository";
import { appApi, useAppData } from "../../../app/client/ui/api";
import type { Channel, PublishTiming } from "./publish-options";

declare module "@tanstack/react-router" {
  interface HistoryState { incidentNotice?: { text: string; error: boolean } }
}

export type NewClaimState = Exclude<IncidentClaimState, "Operational">;
export const NEW_CLAIM_STATES = INCIDENT_CLAIM_STATES.filter((state): state is NewClaimState => state !== "Operational");
export type NewClaim = { componentId: string; state: NewClaimState; relationship: "Primary" | "Dependent" };
export interface NewIncident { title: string; claims: NewClaim[]; update: IncidentFirstUpdateInput; openedAt: string | null; channels: Channel[]; timing: PublishTiming }
type Created = Awaited<ReturnType<IncidentsService["create"]>>;

const STORAGE_KEY = "lamp.new-incident";
const blank: NewIncident = { title: "", claims: [], update: { lifecycle: "Investigating", affectedAudience: "", customerImpact: "", whatStillWorks: "", details: "", nextUpdateAt: null }, openedAt: null, channels: ["email"], timing: { mode: "now", at: null } };

// Nothing exists on the server until Publish, so the tab keeps what was typed across a reload.
function restore(): NewIncident | null {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null") as Partial<NewIncident> | null;
    return saved && typeof saved.title === "string" && Array.isArray(saved.claims) ? { ...blank, ...saved, update: { ...blank.update, ...saved.update } } : null;
  } catch { return null; }
}
function remember(form: NewIncident | null) {
  try { if (form) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(form)); else window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable; the form still works for this visit. */ }
}

/** The new-incident screen: one form that creates the incident with its first update and publishes it in one action. */
export function useNewIncident() {
  const navigate = useNavigate();
  const { data: channelData } = useAppData<{ channels: unknown[] }>("/api/app/channels");
  const [form, setForm] = useState<NewIncident>(blank);
  const [restored, setRestored] = useState(false);
  const touchedChannels = useRef(false);
  const [preview, setPreview] = useState<RenderedIncidentUpdate | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [timeErrors, setTimeErrors] = useState<{ nextUpdate: string | null; timing: string | null }>({ nextUpdate: null, timing: null });
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasChat = Boolean(channelData?.channels.length);

  useEffect(() => { const saved = restore(); if (saved) { touchedChannels.current = true; setForm(saved); } setRestored(true); }, []);
  useEffect(() => { if (restored && !publishing) remember(form); }, [form, restored, publishing]);
  // Slack and Teams join the default selection once a chat channel exists, as on the incident composer.
  useEffect(() => { if (hasChat && !touchedChannels.current) setForm(current => current.channels.includes("chat") ? current : { ...current, channels: [...current.channels, "chat"] }); }, [hasChat]);

  const previewBody = JSON.stringify({ title: form.title.trim(), components: form.claims.map(({ componentId, state }) => ({ componentId, state })), update: form.update });
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      appApi<{ preview: RenderedIncidentUpdate }>("/api/app/incidents/preview", { method: "POST", body: previewBody, signal: controller.signal })
        .then((response) => { if (!controller.signal.aborted) { setPreview(response.preview); setPreviewError(null); } })
        .catch((cause: unknown) => { if (!controller.signal.aborted) setPreviewError(cause instanceof Error ? cause.message : "Preview is unavailable."); });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [previewBody]);

  const setUpdate = <K extends keyof IncidentFirstUpdateInput>(field: K, value: IncidentFirstUpdateInput[K]) => setForm(current => ({ ...current, update: { ...current.update, [field]: value, ...(field === "lifecycle" && value === "Resolved" ? { nextUpdateAt: null } : {}) } }));
  const setChannels = (channels: Channel[]) => { touchedChannels.current = true; setForm(current => ({ ...current, channels })); };
  const { update } = form;
  const resolved = update.lifecycle === "Resolved";
  const publishable = Boolean(form.title.trim() && form.claims.length && update.affectedAudience.trim() && update.customerImpact.trim() && (resolved || update.nextUpdateAt) && (form.timing.mode === "now" || form.timing.at)) && !timeErrors.nextUpdate && !timeErrors.timing;

  // UPDATE-009: a template fills the form and attaches its components with their states; nothing publishes.
  const applyTemplate = (template: IncidentTemplate) => {
    const claims = template.components.flatMap(component => component.componentId && (NEW_CLAIM_STATES as readonly string[]).includes(component.state) ? [{ componentId: component.componentId, state: component.state as NewClaimState, relationship: component.relationship }] : []);
    if (template.shouldSendNotifications !== null) touchedChannels.current = true;
    setForm(current => ({
      ...current,
      title: current.title.trim() || template.title,
      claims: [...current.claims.filter(claim => !claims.some(next => next.componentId === claim.componentId)), ...claims],
      update: { lifecycle: template.lifecycle, affectedAudience: template.affectedAudience, customerImpact: template.customerImpact, whatStillWorks: template.whatStillWorks, details: template.details, nextUpdateAt: template.lifecycle === "Resolved" || template.nextUpdateOffsetMinutes === null ? null : new Date(Date.now() + template.nextUpdateOffsetMinutes * 60_000).toISOString() },
      channels: template.shouldSendNotifications === null ? current.channels : template.shouldSendNotifications ? ["email", "webhook", ...(hasChat ? ["chat" as const] : [])] : [],
    }));
    const skipped = template.components.filter(component => !claims.some(claim => claim.componentId === component.componentId)).map(component => component.componentName);
    return skipped.length ? `Template applied. Not attached: ${skipped.join(", ")}.` : template.nextUpdateOffsetMinutes === null && template.lifecycle !== "Resolved" ? "Template applied. Choose the next update time." : "Template applied.";
  };

  // Creates the incident with this update as its saved draft (UPDATE-005), or reports why not.
  const create = async () => {
    setPublishing(true); setError(null);
    try {
      const { incident } = await appApi<{ incident: Created }>("/api/app/incidents", { method: "POST", body: JSON.stringify({ title: form.title.trim(), ...(form.openedAt ? { openedAt: form.openedAt } : {}), components: form.claims, update }) });
      remember(null);
      return incident;
    } catch (cause) { setPublishing(false); setError(cause instanceof Error ? cause.message : "The incident could not be created."); return null; }
  };
  const savable = Boolean(form.title.trim() && form.claims.length) && !publishing;
  // Keeps the private-draft path: the incident exists, unpublished, for review or for later.
  const saveDraft = async () => {
    if (!savable) return;
    const incident = await create();
    if (incident) await navigate({ to: "/app/incidents/$incidentId", params: { incidentId: incident.id }, state: (current) => ({ ...current, incidentNotice: { text: "Saved as a private draft.", error: false } }) });
  };

  const publish = async () => {
    if (!publishable || publishing) return;
    const { timing } = form;
    if (timing.mode === "backdate" && timing.at && Date.parse(timing.at) >= Date.now()) { setError("A historical publication timestamp must be in the past."); return; }
    const incident = await create();
    if (!incident) return;
    // A refused publication leaves the update as the incident's saved draft, to fix there.
    const version = `${incident.draft?.id ?? "-"}:0`;
    let notice: { text: string; error: boolean };
    try {
      if (timing.mode === "schedule") {
        await appApi(`/api/app/incidents/${incident.id}/draft/schedule`, { method: "POST", headers: { "If-Match": version }, body: JSON.stringify({ publishAt: timing.at, channels: form.channels }) });
        notice = { text: "Update scheduled. It stays private until then.", error: false };
      } else {
        await appApi(`/api/app/incidents/${incident.id}/publish`, { method: "POST", headers: { "If-Match": version }, body: JSON.stringify({ channels: form.channels, ...(timing.mode === "backdate" ? { publishedAt: timing.at } : {}) }) });
        notice = { text: timing.mode === "backdate" ? "Historical update published. It did not notify subscribers." : "Update published.", error: false };
      }
    } catch (cause) { notice = { text: `Not published: ${cause instanceof Error ? cause.message : "the update could not be published."}`, error: true }; }
    await navigate({ to: "/app/incidents/$incidentId", params: { incidentId: incident.id }, state: (current) => ({ ...current, incidentNotice: notice }) });
  };

  return { form, setForm, setUpdate, setChannels, preview, previewError, timeErrors, setTimeErrors, publishable, publishing, error, publish, savable, saveDraft, applyTemplate };
}
