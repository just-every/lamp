import type { PublishedIncidentComponentChange } from "../../shared/incident-component-changes";
import type { IncidentLifecycle } from "../../shared/domain";
import { type IncidentImpact } from "../../shared/incident-impact";
import { renderUpdateHtml } from "../../shared/update-links";

import { renderedUpdate } from "./feed-widget";
import { MINUTE, durationText, escapeHtml, stateClass, timestamp } from "./format";

/** The public record's shared pieces: state chips, incident and maintenance entries and their updates, used by the
 *  current page, history and each incident's permanent page alike. */
export interface PublicIncident {
  id: string;
  reference: string;
  title: string;
  lifecycle: IncidentLifecycle;
  derivedImpact: IncidentImpact;
  impactOverride: IncidentImpact | null;
  effectiveImpact: IncidentImpact;
  openedAt: string;
  resolvedAt: string | null;
  components: string[];
  updates: Array<{ componentChanges?: PublishedIncidentComponentChange[]; id: string; lifecycle: string; affectedAudience: string; customerImpact: string; whatStillWorks: string; details: string; nextUpdateAt: string | null; publishedAt: string }>;
  report: { summary: string; timeline: string; cause: string; remediation: string; publishedAt: string } | null;
}

export interface PublicMaintenance {
  id: string;
  reference: string;
  title: string;
  state: string;
  startsAt: string;
  endsAt: string;
  completedAt: string | null;
  components: string[];
  importedUpdates?: Array<{ id: string; body: string; publishedAt: string }>;
  notices: Array<{ id: string; kind: string; body: string; publishedAt: string }>;
}

export type TitleHeading = "h1" | "h3" | "h4";

/** A quiet pill with a coloured dot, as the operator app draws states. */
export function statePill(state: string, className = "") {
  return `<span class="${className ? `${className} ` : ""}state-pill state-${stateClass(state)}"><strong>${escapeHtml(state)}</strong></span>`;
}

export function recordHead(kicker: string, title: string, heading: TitleHeading, state: string | null) {
  return `<header class="record-head"><div class="record-title"><p class="section-kicker">${escapeHtml(kicker)}</p><${heading}>${title}</${heading}></div>${state ? statePill(state, "lifecycle-pill") : ""}</header>`;
}

export function updateMarkup(incident: PublicIncident, update: PublicIncident["updates"][number], timezone: string) {
  const rendered = renderedUpdate(incident, update, timezone);
  const fields = rendered.public.fields.map((field) => `<div><dt>${escapeHtml(field.label)}</dt><dd>${field.instant ? timestamp(field.instant, timezone) : renderUpdateHtml(field.value)}</dd></div>`).join("");
  const isResolutionTime = incident.lifecycle === "Resolved" && update.lifecycle === "Resolved" && update.publishedAt === incident.resolvedAt;
  const published = isResolutionTime ? `Resolved at ${timestamp(update.publishedAt, timezone)}` : timestamp(update.publishedAt, timezone);
  return `<article class="update"><div class="update-head"><strong>${escapeHtml(rendered.public.lifecycle)}</strong><span>${published}</span></div><dl>${fields}</dl></article>`;
}

export function incidentMarkup(incident: PublicIncident, timezone: string, maximumUpdates?: number, label = "Incident", heading: TitleHeading = "h3") {
  const updates = maximumUpdates === undefined ? incident.updates : incident.updates.slice(0, maximumUpdates);
  const more = maximumUpdates !== undefined ? `<a class="text-link" href="/incidents/${encodeURIComponent(incident.reference)}">${incident.updates.length > updates.length ? `View all ${incident.updates.length} updates` : "View incident"}</a>` : "";
  return `<article class="incident" data-incident-impact="${incident.effectiveImpact}">${recordHead(label, escapeHtml(incident.title), heading, heading === "h1" ? null : incident.lifecycle)}${incident.components.length ? `<p class="incident-meta">Affecting ${escapeHtml(incident.components.join(", "))}</p>` : ""}<div class="updates">${updates.map((update) => updateMarkup(incident, update, timezone)).join("")}</div>${more}</article>`;
}

/** A recently resolved incident on the current page: what it was, when it ended and what customers were told last. */
export function resolvedMarkup(incident: PublicIncident, timezone: string) {
  const title = `<a href="/incidents/${encodeURIComponent(incident.reference)}">${escapeHtml(incident.title)}</a>`;
  const impact = incident.updates[0]?.customerImpact.trim();
  const ended = incident.resolvedAt ? `Resolved ${timestamp(incident.resolvedAt, timezone)} · lasted ${escapeHtml(durationText(incident.openedAt, incident.resolvedAt))} · ` : "";
  return `<article class="incident resolved-incident" data-incident-impact="${incident.effectiveImpact}">${recordHead("Resolved incident", title, "h4", incident.lifecycle)}<p class="incident-meta">${ended}Affected ${escapeHtml(incident.components.join(", "))}</p>${impact ? `<p class="resolved-summary">${renderUpdateHtml(impact)}</p>` : ""}</article>`;
}

export function noticeMarkup(notice: PublicMaintenance["notices"][number], timezone: string) {
  return `<article class="update maintenance-notice"><div class="update-head"><strong>${escapeHtml(notice.kind)}</strong><span>${timestamp(notice.publishedAt, timezone)}</span></div>${notice.body ? `<p>${renderUpdateHtml(notice.body)}</p>` : ""}</article>`;
}

export function maintenanceMarkup(item: PublicMaintenance, timezone: string, generatedAt: string, permalink = false) {
  const overrun = item.state === "In progress" && new Date(item.endsAt).getTime() + 15 * MINUTE <= new Date(generatedAt).getTime();
  const notices = [...item.notices, ...(item.importedUpdates ?? []).map(update => ({ ...update, kind: "Imported update" }))].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map((notice) => noticeMarkup(notice, timezone)).join("");
  return `<article class="maintenance">${recordHead(item.state === "Scheduled" ? "Planned maintenance" : "Maintenance", permalink ? escapeHtml(item.title) : `<a href="/maintenance/${encodeURIComponent(item.reference)}">${escapeHtml(item.title)}</a>`, permalink ? "h1" : "h4", item.state)}<p class="maintenance-window" data-maintenance-state="${escapeHtml(item.state)}" data-maintenance-ends-at="${escapeHtml(item.endsAt)}">${timestamp(item.startsAt, timezone)} – ${timestamp(item.endsAt, timezone)}${overrun ? ` <span class="overrun">Running longer than planned</span>` : ""}</p>${item.components.length ? `<p class="incident-meta">Affects ${escapeHtml(item.components.join(", "))}</p>` : ""}${notices ? `<div class="updates">${notices}</div>` : ""}</article>`;
}
