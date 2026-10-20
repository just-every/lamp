import { briefReferences, type IncidentBrief } from "../brief/build";

export const REPORT_PROMPTS = {
  cause: "Write the cause supported by the incident evidence.",
  remediation: "Write the remediation and follow-up actions confirmed by the team.",
};

export class ReportInputError extends Error {}
export class ReportDraftError extends Error {
  constructor(message: string, public readonly status: 404 | 409) { super(message); }
}

export interface ReportReview {
  cause: { required: boolean; prompt: string };
  remediation: { required: boolean; prompt: string };
  evidenceRefs: string[];
  limitations: string[];
}

/** Flatten source text so an embedded newline cannot create an uncited timeline line. */
const line = (text: string) => text.replace(/\s+/g, " ").trim();

export function draftIncidentReport(brief: IncidentBrief) {
  const { alerts, updates } = brief.whatWeKnow;
  const resolution = updates.findLast((update) => update.lifecycle === "Resolved");
  if (!resolution) throw new ReportDraftError("A published resolution is required to draft a report.", 409);
  const references = briefReferences(brief);
  const events = [
    ...alerts.map((alert) => ({ at: alert.receivedAt, ref: alert.ref, text: `Alert received from ${line(alert.source)}: ${alert.state}${alert.title ? ` — ${line(alert.title)}` : ""}.${alert.evidenceSummary ? ` ${line(alert.evidenceSummary)}` : ""}` })),
    ...updates.map((update) => ({ at: update.publishedAt, ref: update.ref, text: `Published ${update.lifecycle}. ${[update.affectedAudience, update.customerImpact, update.whatStillWorks, update.details].filter(Boolean).map(line).join(" ")}` })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.ref.localeCompare(b.ref));
  // These are publication timestamps, not a monitor-measured outage interval.
  const summary = `${line(brief.incident.reference)}: ${line(brief.incident.title)}. Recorded incident window: ${brief.incident.openedAt} to published resolution ${resolution.publishedAt} [${resolution.ref}]. This window is not a measurement of customer downtime. Latest resolved update: ${line(resolution.customerImpact)} [${resolution.ref}]`;
  const timeline = events.map((event) => {
    if (!references.has(event.ref)) throw new ReportInputError("A report source reference is unavailable.");
    return `${event.at} — ${event.text} [${event.ref}]`;
  }).join("\n");
  if (summary.length > 10_000 || timeline.length > 10_000) throw new ReportInputError("The source record exceeds the report's 10,000-character field limit. Write and save a reviewed report manually.");
  return { summary, timeline, cause: "", remediation: "" };
}

export function reportReview(report: { cause: string; remediation: string }, evidenceRefs: string[] = []): ReportReview {
  return {
    cause: { required: !report.cause.trim() || report.cause.trim() === REPORT_PROMPTS.cause, prompt: REPORT_PROMPTS.cause },
    remediation: { required: !report.remediation.trim() || report.remediation.trim() === REPORT_PROMPTS.remediation, prompt: REPORT_PROMPTS.remediation },
    evidenceRefs,
    limitations: ["The recorded incident window is not monitor-measured customer downtime.", "External Oncall, Jira Service Management and Opsgenie timelines are not connected."],
  };
}
