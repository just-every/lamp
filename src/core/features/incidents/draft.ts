import type { IncidentDraftInput } from "../../shared/schemas";
import type { IncidentView } from "./service";

export const blankDraft: IncidentDraftInput = {
  lifecycle: "Investigating",
  affectedAudience: "",
  customerImpact: "",
  whatStillWorks: "",
  details: "",
  nextUpdateAt: null,
  componentChanges: [],
};

export function normalizeResolvedDraft(draft: IncidentDraftInput): IncidentDraftInput {
  return draft.lifecycle === "Resolved" ? { ...draft, nextUpdateAt: null } : draft;
}

export function draftFromIncident(incident: Pick<IncidentView, "draft" | "lifecycle">): IncidentDraftInput {
  if (!incident.draft) return { ...blankDraft, lifecycle: ({ Investigating: "Identified", Identified: "Monitoring", Monitoring: "Resolved", Resolved: "Resolved" } as const)[incident.lifecycle] };
  return normalizeResolvedDraft({
    lifecycle: incident.draft.lifecycle,
    affectedAudience: incident.draft.affectedAudience,
    customerImpact: incident.draft.customerImpact,
    whatStillWorks: incident.draft.whatStillWorks,
    details: incident.draft.details,
    nextUpdateAt: incident.draft.nextUpdateAt,
    componentChanges: incident.draft.componentChanges.map(({ componentId, state, relationship }) => ({ componentId, state, relationship })),
  });
}

