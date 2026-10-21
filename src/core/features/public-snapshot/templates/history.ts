import type { PublicSnapshotModel } from "../renderer";
import type { PublicIncident, PublicMaintenance } from "../record-markup";
import { mostSevereState, type ComponentState } from "../../../shared/domain";
import { escapeHtml } from "../format";
import { stateGlyph } from "./icons";
import { earlierText, incidentLink, maintenanceNotices, maintenanceWindow, resolvedSpan, toneOf, updateText, when, type TemplateParts } from "./parts";

/** Incident and maintenance entries shared by every template. Each carries both a state glyph and a short kicker;
 *  a template's stylesheet decides which of the two it shows. */
const MAX_OPEN_UPDATES = 5;
const MAX_RESOLVED_UPDATES = 3;

function incidentState(incident: PublicIncident, model: PublicSnapshotModel): ComponentState {
  const claimed = model.visibleComponents.filter((component) => incident.components.includes(component.name)).map((component) => component.state).filter((state) => state !== "Operational");
  if (claimed.length) return mostSevereState(claimed);
  return incident.effectiveImpact === "critical" ? "Major outage" : incident.effectiveImpact === "major" ? "Partially unavailable" : "Degraded performance";
}

function allUpdatesLink(incident: PublicIncident, shown: number) {
  return incident.updates.length > shown ? `<p class="tl-more"><a href="/incidents/${encodeURIComponent(incident.reference)}">View all ${incident.updates.length} updates</a></p>` : "";
}

export function openIncidentEntry(incident: PublicIncident, model: PublicSnapshotModel, parts: TemplateParts) {
  const timezone = model.settings.timezone;
  const [newest, ...earlier] = incident.updates.slice(0, MAX_OPEN_UPDATES);
  if (!newest) return "";
  const state = incidentState(incident, model);
  const next = newest.nextUpdateAt ? `<p class="tl-next">Next update by ${when(newest.nextUpdateAt, timezone, newest.publishedAt)}</p>` : "";
  const before = earlier.map((update) => `<li><p class="tpl-meta"><span class="tl-earlier-word">Earlier: </span>${escapeHtml(update.lifecycle)} · ${when(update.publishedAt, timezone, newest.publishedAt)}</p>${earlierText(update)}</li>`).join("");
  return `<li class="tl tl-open tone-${toneOf(state)}"><span class="tl-mark">${stateGlyph(state)}</span><article class="tl-body" data-incident-impact="${incident.effectiveImpact}"><p class="tl-kicker">Ongoing</p><h3 class="tl-title">${incidentLink(incident)}</h3><p class="tpl-meta">${escapeHtml(newest.lifecycle)} · ${when(newest.publishedAt, timezone)}</p>${updateText(newest)}${next || before ? `<div class="tl-thread">${next}${before ? `<ol class="tl-earlier">${before}</ol>` : ""}</div>` : ""}${allUpdatesLink(incident, MAX_OPEN_UPDATES)}${parts.incidentSlot(incident)}</article></li>`;
}

export function maintenanceEntry(item: PublicMaintenance, model: PublicSnapshotModel) {
  const timezone = model.settings.timezone;
  const notices = maintenanceNotices(item, timezone);
  return `<li class="tl tl-maint tone-maint"><span class="tl-mark">${stateGlyph("Under maintenance")}</span><article class="tl-body"><p class="tl-kicker">${item.state === "Scheduled" ? "Planned maintenance" : "Maintenance in progress"}</p><h3 class="tl-title"><a href="/maintenance/${encodeURIComponent(item.reference)}">${escapeHtml(item.title)}</a></h3>${maintenanceWindow(item, timezone)}${item.components.length ? `<p class="tpl-said">Affects ${escapeHtml(item.components.join(", "))}</p>` : ""}${notices ? `<ol class="tl-earlier">${notices}</ol>` : ""}</article></li>`;
}

export function resolvedEntry(incident: PublicIncident, model: PublicSnapshotModel) {
  const timezone = model.settings.timezone;
  const updates = incident.updates.slice(0, MAX_RESOLVED_UPDATES).map((update) => `<li><p class="tpl-meta">${escapeHtml(update.lifecycle)} · ${when(update.publishedAt, timezone, incident.openedAt)}</p>${earlierText(update)}</li>`).join("");
  return `<li class="tl tl-resolved tone-ok"><span class="tl-mark">${stateGlyph("Operational")}</span><article class="tl-body" data-incident-impact="${incident.effectiveImpact}"><p class="tl-kicker">Resolved</p><h3 class="tl-title">${incidentLink(incident)}</h3><p class="tpl-meta">${resolvedSpan(incident, timezone)}</p>${updates ? `<ol class="tl-earlier">${updates}</ol>` : ""}${allUpdatesLink(incident, MAX_RESOLVED_UPDATES)}</article></li>`;
}
