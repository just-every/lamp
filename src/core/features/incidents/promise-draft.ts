import type { IncidentBrief } from "../brief/build";
import { briefReferences } from "../brief/build";
import type { IncidentDraftInput } from "../../shared/schemas";

export interface AgentDraftPreparation {
  preparedBy: "Lamp";
  preparedAt: string;
  forOwnerId: string | null;
  commitmentAt: string;
  sourceUpdateRef: string;
  citations: string[];
  evidence: Array<{ ref: string; text: string }>;
  noEvidenceChange: boolean;
}

/** Deterministic preparation from the existing brief. No model or transport is
 * involved, and no private notes or raw provider payloads enter the text. */
export function preparePromiseDraft(brief: IncidentBrief, now: string, ownerId: string | null): { draft: IncidentDraftInput; preparation: AgentDraftPreparation } | null {
  const latest = brief.whatWeKnow.updates.at(-1);
  if (!latest?.nextUpdateAt || latest.lifecycle === "Resolved" || brief.incident.lifecycle === "Resolved") return null;
  const evidence = brief.whatWeKnow.alerts.filter(alert => Date.parse(alert.receivedAt) > Date.parse(latest.publishedAt)).map(alert => ({
    ref: alert.ref,
    text: `${alert.source}: ${alert.title || "accepted alert"}; ${alert.state}${alert.evidenceSummary ? `. ${alert.evidenceSummary}` : ""}`,
  }));
  const citations = [latest.ref, ...evidence.map(item => item.ref)];
  const allowed = briefReferences(brief);
  if (citations.some(ref => !allowed.has(ref))) throw new Error("An automatic draft citation is outside its brief.");
  const changeText = evidence.length ? `Evidence since the last update: ${evidence.map(item => `${item.text} [${item.ref}]`).join("; ")}.` : "Nothing has changed in the recorded evidence since the last update.";
  const explanation = `Still working on it. ${changeText} Last published impact [${latest.ref}].`;
  // Keep the ordinary composer limits. The complete cited evidence remains in
  // the private preparation panel, including when a large brief needs a summary.
  const details = explanation.length <= 500 ? explanation : `Still working on it. ${evidence.length} recorded evidence entries changed since the last update; the complete cited list is in this draft's private preparation panel. Last published impact [${latest.ref}].`;
  return {
    draft: { lifecycle: brief.incident.lifecycle, affectedAudience: latest.affectedAudience, customerImpact: latest.customerImpact, whatStillWorks: latest.whatStillWorks, details, nextUpdateAt: latest.nextUpdateAt, componentChanges: [] },
    preparation: { preparedBy: "Lamp", preparedAt: now, forOwnerId: ownerId, commitmentAt: latest.nextUpdateAt, sourceUpdateRef: latest.ref, citations, evidence, noEvidenceChange: !evidence.length },
  };
}
