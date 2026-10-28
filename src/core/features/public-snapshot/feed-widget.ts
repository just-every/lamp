import { impactLabel, type IncidentImpact } from "../../shared/incident-impact";
import type { PublishedIncidentComponentChange } from "../../shared/incident-component-changes";
import { renderIncidentUpdate } from "../incidents/renderer";

import { formatTime } from "./format";

export interface PublicFeedUpdate {
  agentAction?: import("../incidents/agent-action").PublicAgentAction | null;
  componentChanges?: PublishedIncidentComponentChange[];
  id: string;
  lifecycle: string;
  affectedAudience: string;
  customerImpact: string;
  whatStillWorks: string;
  details: string;
  nextUpdateAt: string | null;
  publishedAt: string;
}

export interface PublicFeedIncident {
  id: string;
  reference: string;
  title: string;
  lifecycle: string;
  updates: PublicFeedUpdate[];
}

export function renderedUpdate(incident: PublicFeedIncident, update: PublicFeedUpdate, timezone: string) {
  return renderIncidentUpdate({
    agentAction: update.agentAction,
    incidentReference: incident.reference,
    incidentTitle: incident.title,
    lifecycle: update.lifecycle as "Investigating" | "Identified" | "Monitoring" | "Resolved",
    affectedAudience: update.affectedAudience,
    customerImpact: update.customerImpact,
    whatStillWorks: update.whatStillWorks,
    details: update.details,
    componentChanges: update.componentChanges,
    nextUpdateAt: update.nextUpdateAt || null,
    nextUpdateDisplay: update.nextUpdateAt ? formatTime(update.nextUpdateAt, timezone) : null,
  });
}

export function updateText(incident: PublicFeedIncident, update: PublicFeedUpdate, timezone: string) {
  return renderedUpdate(incident, update, timezone).email.plainText;
}

export function updateSummary(incident: PublicFeedIncident, update: PublicFeedUpdate) {
  const impact = update.customerImpact.trim().replace(/\s+/g, " ");
  const compactImpact = impact.length > 160 ? `${impact.slice(0, 157)}…` : impact;
  return [update.lifecycle, compactImpact || incident.title].filter(Boolean).join(" · ");
}

export function statusPayload(input: { incidents: Array<PublicFeedIncident & { effectiveImpact: IncidentImpact }>; maintenance: Array<{reference: string; title: string; state: string}>; generatedAt: string; overall: string; settings: { timezone: string } }) {
  const newest = input.incidents.filter((incident) => incident.lifecycle !== "Resolved").flatMap((incident) => incident.updates.map((update) => ({ incident, update }))).sort((left, right) => right.update.publishedAt.localeCompare(left.update.publishedAt))[0];
  return {
    version: 1,
    generatedAt: input.generatedAt,
    overall: input.overall,
    maintenance: input.maintenance.filter(item => item.state === "In progress").map(item => ({ reference: item.reference, title: item.title, state: item.state }))[0] ?? null,
    incident: newest ? {
      reference: newest.incident.reference,
      title: newest.incident.title,
      lifecycle: newest.incident.lifecycle,
      impact: newest.incident.effectiveImpact,
      publishedAt: newest.update.publishedAt,
      summary: updateSummary(newest.incident, newest.update),
      message: `Incident impact: ${impactLabel(newest.incident.effectiveImpact)}\n\n${updateText(newest.incident, newest.update, input.settings.timezone)}`,
    } : null,
  };
}
