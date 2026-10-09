import { COMPONENT_STATES, mostSevereState, type ComponentState, type IncidentLifecycle } from "../../shared/domain";
import type { LampServerSlots } from "../../api/extensions";

import type { PublicSnapshotSource } from "./repository";
import { publicPageScript, publicPageStyles } from "./assets";
import { coolAIcon } from "./cool-a-icons";
import { defaultPublicSnapshotPolicies, type PublicSnapshotPolicies } from "./policies";
import { renderBrandSvg } from "./branding";
import { cartographicMapSvg } from "./cartographic-art";
import { renderAtom, renderedUpdate, renderWidget, statusPayload, updateSummary } from "./feed-widget";
import { DAY, MINUTE, REPORTING_DAYS, durationText, escapeHtml, stateClass, timestamp } from "./format";
import { computeUptime, type Uptime, uptimeMarkup } from "./uptime";

export interface SnapshotArtifact {
  key: string;
  body: string;
  contentType: string;
}

export interface RenderedSnapshot {
  generatedAt: string;
  artifacts: SnapshotArtifact[];
}

interface PublicComponent {
  id: string;
  name: string;
  description: string;
  note: string;
  groupName: string;
  groupOrder: number;
  displayOrder: number;
  state: ComponentState;
  uptime: Uptime;
}

interface PublicIncident {
  id: string;
  reference: string;
  title: string;
  lifecycle: IncidentLifecycle;
  openedAt: string;
  resolvedAt: string | null;
  components: string[];
  updates: Array<{ id: string; lifecycle: string; affectedAudience: string; customerImpact: string; whatStillWorks: string; details: string; nextUpdateAt: string | null; publishedAt: string }>;
  report: { summary: string; timeline: string; cause: string; remediation: string; publishedAt: string } | null;
}

interface PublicMaintenance {
  reference: string;
  title: string;
  state: string;
  startsAt: string;
  endsAt: string;
  completedAt: string | null;
  components: string[];
  notices: Array<{ id: string; kind: string; body: string; publishedAt: string }>;
}


function toPublicModel(source: PublicSnapshotSource, generatedAt: string, policies: PublicSnapshotPolicies) {
  const claims = new Map<string, ComponentState[]>();
  for (const claim of source.claims) claims.set(claim.componentId, [...(claims.get(claim.componentId) ?? []), claim.state]);
  const now = new Date(generatedAt).getTime();
  const components: PublicComponent[] = source.components.map((component) => ({
    ...component,
    groupName: component.groupName ?? "Other services",
    groupOrder: component.groupOrder ?? Number.MAX_SAFE_INTEGER,
    // COMP-006 fixes individual component derivation. The rollup policy is
    // deliberately only for the single overall page status.
    state: mostSevereState(claims.get(component.id) ?? []),
    uptime: computeUptime(source, component.id, now, source.settings.timezone, policies),
  }));
  const attachedByIncident = new Map<string, string[]>();
  for (const component of source.incidentComponents) attachedByIncident.set(component.incidentId, [...(attachedByIncident.get(component.incidentId) ?? []), component.componentName]);
  const updatesByIncident = new Map<string, PublicIncident["updates"]>();
  for (const update of source.updates) updatesByIncident.set(update.incidentId, [...(updatesByIncident.get(update.incidentId) ?? []), update]);
  const reportsByIncident = new Map(source.reports.map((report) => [report.incidentId, report]));
  const incidents: PublicIncident[] = source.incidents.map((incident) => ({
    ...incident,
    components: attachedByIncident.get(incident.id) ?? [],
    updates: updatesByIncident.get(incident.id) ?? [],
    report: reportsByIncident.get(incident.id) ?? null,
  })).filter((incident) => incident.updates.length > 0 && incident.components.length > 0);
  const attachedByMaintenance = new Map<string, string[]>();
  for (const component of source.maintenanceComponents) attachedByMaintenance.set(component.maintenanceId, [...(attachedByMaintenance.get(component.maintenanceId) ?? []), component.componentName]);
  const noticesByMaintenance = new Map<string, PublicMaintenance["notices"]>();
  for (const notice of source.maintenanceNotices) noticesByMaintenance.set(notice.maintenanceId, [...(noticesByMaintenance.get(notice.maintenanceId) ?? []), notice]);
  const maintenance: PublicMaintenance[] = source.maintenance
    .map((item) => ({ ...item, components: attachedByMaintenance.get(item.id) ?? [], notices: noticesByMaintenance.get(item.id) ?? [] }))
    .filter((item) => item.components.length > 0);
  return { settings: source.settings, components, incidents, maintenance, generatedAt, policies, overall: policies.pageStatusRollup(components.map((component) => component.state)) };
}

function uptimeMethod(policies: PublicSnapshotPolicies) {
  return COMPONENT_STATES.map((state) => `${state} counts as ${policies.uptimeDowntimeWeight(state)} downtime minute${policies.uptimeDowntimeWeight(state) === 1 ? "" : "s"}`).join("; ");
}

function updateMarkup(incident: PublicIncident, update: PublicIncident["updates"][number], timezone: string) {
  const rendered = renderedUpdate(incident, update, timezone);
  const fields = rendered.public.fields.map((field) => `<div><dt>${escapeHtml(field.label)}</dt><dd>${field.instant ? timestamp(field.instant, timezone) : escapeHtml(field.value)}</dd></div>`).join("");
  return `<article class="update"><div class="update-head"><strong>${escapeHtml(rendered.public.lifecycle)}</strong>${timestamp(update.publishedAt, timezone)}</div><dl>${fields}</dl></article>`;
}

function incidentMarkup(incident: PublicIncident, timezone: string, maximumUpdates?: number, label = "Incident", heading: "h1" | "h3" = "h3") {
  const updates = maximumUpdates === undefined ? incident.updates : incident.updates.slice(0, maximumUpdates);
  return `<article class="incident"><div class="timeline-item-heading"><div><div class="section-kicker">${escapeHtml(label)}</div><${heading}>${escapeHtml(incident.title)}</${heading}><p class="timeline-reference">${escapeHtml(incident.reference)}</p></div><span class="lifecycle-pill">${escapeHtml(incident.lifecycle)}</span></div><p class="incident-meta">Affecting ${escapeHtml(incident.components.join(", ") || "published components")}</p>${updates.map((update) => updateMarkup(incident, update, timezone)).join("")}${maximumUpdates !== undefined ? `<a class="text-link" href="/incidents/${encodeURIComponent(incident.reference)}">View all ${incident.updates.length} updates</a>` : ""}</article>`;
}

function maintenanceMarkup(item: PublicMaintenance, timezone: string, generatedAt: string) {
  const overrun = item.state === "In progress" && new Date(item.endsAt).getTime() + 15 * MINUTE < new Date(generatedAt).getTime();
  const notices = item.notices.map((notice) => `<article class="maintenance-notice"><div><strong>${escapeHtml(notice.kind)}</strong>${timestamp(notice.publishedAt, timezone)}</div>${notice.body ? `<p>${escapeHtml(notice.body)}</p>` : ""}</article>`).join("");
  return `<article class="maintenance"><div class="timeline-item-heading"><div><div class="section-kicker">${escapeHtml(item.state === "Scheduled" ? "Planned maintenance" : "Maintenance")}</div><strong>${escapeHtml(item.title)}</strong><p class="timeline-reference">${escapeHtml(item.reference)}</p></div><span class="lifecycle-pill maintenance-pill">${escapeHtml(item.state)}</span></div><p>${timestamp(item.startsAt, timezone)} – ${timestamp(item.endsAt, timezone)}${overrun ? " · Running longer than planned" : ""}</p><p>Affects ${escapeHtml(item.components.join(", ") || "published components")}</p>${notices}</article>`;
}

type GeneralPublicSlot = Exclude<keyof LampServerSlots, "status-page.incident.after.v1">;

function slotContext(model: ReturnType<typeof toPublicModel>) {
  return { pageName: model.settings.pageName, hostname: model.settings.hostname, overall: model.overall };
}

function slotMarkup(slots: LampServerSlots, id: GeneralPublicSlot, model: ReturnType<typeof toPublicModel>) {
  const markup = slots[id]?.(slotContext(model));
  if (markup !== undefined && typeof markup !== "string") throw new Error(`Lamp public extension slot ${id} must return HTML text.`);
  return markup ?? "";
}

function incidentSlotMarkup(slots: LampServerSlots, incident: PublicIncident, model: ReturnType<typeof toPublicModel>) {
  const markup = slots["status-page.incident.after.v1"]?.({ ...slotContext(model), incident: { id: incident.id, reference: incident.reference, title: incident.title, lifecycle: incident.lifecycle } });
  if (markup !== undefined && typeof markup !== "string") throw new Error("Lamp public extension slot status-page.incident.after.v1 must return HTML text.");
  return markup ?? "";
}

function pageShell(title: string, body: string, model: ReturnType<typeof toPublicModel>, slots: LampServerSlots, root = false) {
  const { settings, overall } = model;
  const publicOrigin = `https://${settings.hostname}`;
  const masthead = `<header class="masthead"><div class="masthead-copy"><a class="page-kicker" href="/"><img class="brand-logo" src="/assets/favicon.svg" alt=""><span>Public status page</span></a><a class="brand" href="/"><span>${escapeHtml(settings.pageName)}</span></a><p class="tagline">${escapeHtml(settings.tagline)}</p><p class="host">${escapeHtml(settings.hostname)}</p><p class="host" data-timezone-label>Times: ${escapeHtml(settings.timezone)}</p></div><div class="masthead-art"><img class="cartographic-hero-art" src="/assets/cartographic-map.svg" alt="" aria-hidden="true"></div></header>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="description" content="${escapeHtml(settings.tagline)}"><meta property="og:title" content="${escapeHtml(`${settings.pageName}: ${overall}`)}"><meta property="og:image" content="${escapeHtml(`${publicOrigin}/assets/og.svg`)}"><meta property="og:image:alt" content="${escapeHtml(`${settings.pageName} status: ${overall}`)}"><title>${escapeHtml(title)}</title><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/status-page.css"></head><body><main class="page${root ? " root-page" : ""}">${masthead}${slotMarkup(slots, "status-page.header.after.v1", model)}${body}<footer>${slotMarkup(slots, "status-page.footer.before.v1", model)}${settings.footerCreditEnabled ? "Powered by Lamp · runeditrun.com" : ""}</footer></main><script src="/assets/status-page.js" defer></script></body></html>`;
}

function componentMarkup(component: PublicComponent, timezone: string, generatedAt: string) {
  return `<article class="component"><div class="component-name"><h4>${escapeHtml(component.name)}</h4><span class="component-state"><span class="state-dot ${stateClass(component.state)}"></span><strong>${escapeHtml(component.state)}</strong></span>${component.note ? `<p class="component-note">${escapeHtml(component.note)}</p>` : ""}</div><div class="component-status">${uptimeMarkup(component, timezone, generatedAt)}</div></article>`;
}

function orderedComponents(components: PublicComponent[]) {
  return [...components].sort((left, right) => left.groupOrder - right.groupOrder || left.displayOrder - right.displayOrder || left.name.localeCompare(right.name));
}

function componentHealthMarkup(model: ReturnType<typeof toPublicModel>) {
  const { components, settings, generatedAt } = model;
  const ordered = orderedComponents(components);
  const grouped = new Map<string, PublicComponent[]>();
  for (const component of ordered) grouped.set(component.groupName, [...(grouped.get(component.groupName) ?? []), component]);
  return `<section class="component-health" aria-labelledby="components-title"><header class="availability-header"><div class="availability-emblem" aria-hidden="true"><strong>${REPORTING_DAYS}</strong><span>days</span></div><div class="availability-summary"><span class="eyebrow">Component health</span><h2 id="components-title">${REPORTING_DAYS}-day availability</h2></div></header><div class="availability-charts">${[...grouped.entries()].map(([group, values]) => `<section class="component-group"><h3>${escapeHtml(group)}</h3>${values.map((component) => componentMarkup(component, settings.timezone, generatedAt)).join("")}</section>`).join("")}</div><aside class="availability-legend" aria-label="Availability legend"><span><i class="legend-good"></i>Available</span><span><i class="legend-downtime"></i>Weighted downtime</span><span><i class="legend-no-data"></i>No data</span></aside><p class="availability-method">Availability days use ${escapeHtml(settings.timezone)}. Uptime uses a ${REPORTING_DAYS}-day window. ${escapeHtml(uptimeMethod(model.policies))}.</p></section>`;
}

function componentOverviewMarkup(model: ReturnType<typeof toPublicModel>) {
  const components = orderedComponents(model.components).slice(0, 2);
  if (!components.length) return "";
  return `<div class="status-overview-details" aria-label="Published component states">${components.map((component) => `<article class="status-overview-service">${coolAIcon(component.state === "Operational" ? "check" : "alert", "overview-icon")}<div><span>${escapeHtml(component.name)}</span><strong>${escapeHtml(component.state)}</strong>${component.note ? `<p>${escapeHtml(component.note)}</p>` : ""}</div></article>`).join("")}</div>`;
}

function statusUtilitiesMarkup() {
  return `<nav class="status-utilities" aria-label="Status resources"><a href="/history">Resolved history</a><a href="#subscribe">Subscribe</a><a href="/feed.atom">Atom feed</a></nav>`;
}

function subscriptionMarkup() {
  return `<section id="subscribe" class="subscribe" aria-labelledby="subscribe-title"><div><span class="eyebrow">Stay informed</span><h2 id="subscribe-title">Subscribe to status updates</h2><p>Confirm your email address to receive future incident and maintenance updates.</p></div><form method="post" action="/subscribe"><label for="email">Email address</label><div class="subscribe-row"><input id="email" name="email" type="email" autocomplete="email" required><button type="submit">Subscribe</button></div></form></section>`;
}

function timelineEntry(instant: string, kind: "incident" | "maintenance" | "resolved", body: string, timezone: string) {
  const icon = kind === "maintenance" ? "maintenance" : kind === "incident" ? "alert" : "timeline";
  return `<div class="timeline-entry timeline-${kind}"><div class="timeline-timestamp">${timestamp(instant, timezone)}</div><div class="timeline-rail" aria-hidden="true">${coolAIcon(icon, "timeline-icon")}</div><div class="timeline-content">${body}</div></div>`;
}

function timelineMarkup(model: ReturnType<typeof toPublicModel>, slots: LampServerSlots) {
  const { incidents, maintenance, settings, generatedAt } = model;
  const activeMaintenance = maintenance.filter((item) => item.state === "In progress");
  const upcomingMaintenance = maintenance.filter((item) => item.state === "Scheduled" && new Date(item.startsAt).getTime() <= new Date(generatedAt).getTime() + 14 * DAY);
  const unresolved = incidents.filter((incident) => incident.lifecycle !== "Resolved");
  const recentResolved = incidents.filter((incident) => incident.lifecycle === "Resolved" && incident.resolvedAt).sort((left, right) => (right.resolvedAt ?? "").localeCompare(left.resolvedAt ?? "")).slice(0, 6);
  const entries = [
    ...unresolved.map((incident) => ({ instant: incident.updates[0]?.publishedAt ?? incident.openedAt, kind: "incident" as const, body: `${incidentMarkup(incident, settings.timezone, 5, "Current incident")}${incidentSlotMarkup(slots, incident, model)}` })),
    ...[...activeMaintenance, ...upcomingMaintenance].map((item) => ({ instant: item.notices[0]?.publishedAt ?? item.startsAt, kind: "maintenance" as const, body: maintenanceMarkup(item, settings.timezone, generatedAt) })),
    ...recentResolved.map((incident) => ({ instant: incident.resolvedAt ?? incident.openedAt, kind: "resolved" as const, body: incidentMarkup(incident, settings.timezone, 1, "Resolved incident") })),
  ].sort((left, right) => right.instant.localeCompare(left.instant));
  const timeline = entries.map((entry) => timelineEntry(entry.instant, entry.kind, entry.body, settings.timezone)).join("") || "<p class=\"empty-state\">No incidents or maintenance notices have been published yet.</p>";
  return `<section class="history-timeline" aria-labelledby="timeline-title"><div class="section-heading timeline-heading"><div><span class="eyebrow">Public record</span><h2 id="timeline-title">Incidents and maintenance</h2></div></div>${timeline}</section>`;
}

function renderPage(model: ReturnType<typeof toPublicModel>, slots: LampServerSlots) {
  const { settings, incidents, overall, generatedAt } = model;
  const newest = incidents.filter((incident) => incident.lifecycle !== "Resolved").flatMap((incident) => incident.updates.map((update) => ({ incident, update }))).sort((left, right) => right.update.publishedAt.localeCompare(left.update.publishedAt))[0];
  const statusIcon = overall === "Operational" ? "check" : "alert";
  const status = `<section class="status-banner ${stateClass(overall)}" aria-labelledby="overall-status"><div id="status-live" role="status" aria-live="polite" aria-atomic="true"><div class="status-summary">${coolAIcon(statusIcon, "overall-status-icon")}<div><span class="eyebrow">Overall status</span><h1 id="overall-status" data-overall>${escapeHtml(overall)}</h1></div></div><p class="status-live-update" data-newest-update>${escapeHtml(newest ? updateSummary(newest.incident, newest.update) : "No current incident update.")}</p><p class="status-generated" data-generated-at>Snapshot generated ${timestamp(generatedAt, settings.timezone)}.</p></div>${componentOverviewMarkup(model)}</section>`;
  return pageShell(`${settings.pageName} status`, `${status}<div class="public-record-grid">${statusUtilitiesMarkup()}${componentHealthMarkup(model)}<div class="component-extension">${slotMarkup(slots, "status-page.components.after.v1", model)}</div>${timelineMarkup(model, slots)}${subscriptionMarkup()}</div>`, model, slots, true);
}

function renderIncidentPage(incident: PublicIncident, model: ReturnType<typeof toPublicModel>, slots: LampServerSlots) {
  const report = incident.report ? `<section class="report"><span class="eyebrow">Post-incident report</span><h2>What happened and what we changed</h2><dl><div><dt>Summary</dt><dd>${escapeHtml(incident.report.summary)}</dd></div><div><dt>Timeline</dt><dd>${escapeHtml(incident.report.timeline)}</dd></div><div><dt>Cause</dt><dd>${escapeHtml(incident.report.cause)}</dd></div><div><dt>Remediation</dt><dd>${escapeHtml(incident.report.remediation)}</dd></div></dl></section>` : "";
  const content = `<nav aria-label="Breadcrumb"><a class="text-link" href="/">Status</a> / ${escapeHtml(incident.reference)}</nav><div class="incident-document"><div class="incident-document-main">${incidentMarkup(incident, model.settings.timezone, undefined, "Incident", "h1")}<section class="about"><h2>About this incident</h2><p>Opened ${timestamp(incident.openedAt, model.settings.timezone)}. Affected components: ${escapeHtml(incident.components.join(", ") || "not published")}.</p></section>${report}</div><aside class="incident-summary" aria-label="Incident status"><span class="eyebrow">Incident status</span><h2>${escapeHtml(incident.lifecycle)}</h2><p>${escapeHtml(incident.reference)}</p><p>Opened ${timestamp(incident.openedAt, model.settings.timezone)}</p><a class="text-link" href="/">Current status</a></aside></div>`;
  return pageShell(`${incident.reference} · ${model.settings.pageName}`, content, model, slots);
}

function renderNotFoundPage(model: ReturnType<typeof toPublicModel>, slots: LampServerSlots) {
  const content = `<section class="history" aria-labelledby="missing-incident-title"><span class="eyebrow">Incident record</span><h1 id="missing-incident-title">We couldn't find that incident</h1><p>This permalink does not match an incident in the public record.</p><nav class="status-utilities" aria-label="Status navigation"><a href="/">Current status</a><a href="/history">Resolved history</a></nav></section>`;
  return pageShell(`Incident not found · ${model.settings.pageName}`, content, model, slots);
}

function renderHistory(model: ReturnType<typeof toPublicModel>, slots: LampServerSlots) {
  const cutoff = new Date(model.generatedAt).getTime() - 365 * DAY;
  const resolved = model.incidents.filter((incident) => incident.lifecycle === "Resolved" && incident.resolvedAt && new Date(incident.resolvedAt).getTime() >= cutoff);
  const completed = model.maintenance.filter((item) => (item.state === "Completed" || item.state === "Cancelled") && new Date(item.endsAt).getTime() >= cutoff);
  const records = [
    ...resolved.map((incident) => ({ timestamp: incident.resolvedAt!, html: `<article class="history-item"><h3><a href="/incidents/${encodeURIComponent(incident.reference)}">${escapeHtml(incident.reference)} · ${escapeHtml(incident.title)}</a></h3><p>Resolved ${timestamp(incident.resolvedAt!, model.settings.timezone)} · ${escapeHtml(durationText(incident.openedAt, incident.resolvedAt!))} · affected ${escapeHtml(incident.components.join(", ") || "published components")}</p>${incident.updates.map((update) => updateMarkup(incident, update, model.settings.timezone)).join("")}</article>` })),
    ...completed.map((item) => ({ timestamp: item.completedAt ?? item.endsAt, html: `<article class="history-item"><h3>${escapeHtml(item.reference)} · ${escapeHtml(item.title)}</h3><p>${escapeHtml(item.state)} · ${timestamp(item.startsAt, model.settings.timezone)} – ${timestamp(item.endsAt, model.settings.timezone)} · ${escapeHtml(durationText(item.startsAt, item.endsAt))} · affected ${escapeHtml(item.components.join(", ") || "published components")}</p>${item.notices.map((notice) => `<p><strong>${escapeHtml(notice.kind)}</strong> · ${timestamp(notice.publishedAt, model.settings.timezone)}${notice.body ? ` · ${escapeHtml(notice.body)}` : ""}</p>`).join("")}</article>` })),
  ].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  const monthFormatter = new Intl.DateTimeFormat("en-US", { timeZone: model.settings.timezone, month: "long", year: "numeric" });
  const groups = new Map<string, string[]>();
  for (const record of records) {
    const month = monthFormatter.format(new Date(record.timestamp));
    groups.set(month, [...(groups.get(month) ?? []), record.html]);
  }
  const content = `<nav aria-label="Breadcrumb"><a class="text-link" href="/">Status</a> / History</nav><section class="history"><span class="eyebrow">Public record</span><h1>Resolved history</h1><p>Resolved incidents and completed or cancelled maintenance from the last 12 months. For active incidents and upcoming maintenance, return to current status.</p>${[...groups.entries()].map(([month, entries]) => `<section class="history-month"><h2>${escapeHtml(month)}</h2>${entries.join("")}</section>`).join("") || "<p class=\"empty-state\">No resolved incidents or completed maintenance have been published in the last 12 months. Cancelled maintenance also appears here when recorded.</p>"}</section>`;
  return pageShell(`History · ${model.settings.pageName}`, content, model, slots);
}

export function renderPublicSnapshot(source: PublicSnapshotSource, generatedAt = new Date().toISOString(), policies: PublicSnapshotPolicies = defaultPublicSnapshotPolicies, branding: { logoDataUrl: string | null } = { logoDataUrl: null }, slots: LampServerSlots = {}): RenderedSnapshot {
  const model = toPublicModel(source, generatedAt, policies);
  const artifacts: SnapshotArtifact[] = [
    { key: "page.html", body: renderPage(model, slots), contentType: "text/html; charset=utf-8" },
    { key: "history.html", body: renderHistory(model, slots), contentType: "text/html; charset=utf-8" },
    { key: "feed.atom", body: renderAtom(model), contentType: "application/atom+xml; charset=utf-8" },
    { key: "widget.js", body: renderWidget(statusPayload(model), model.settings), contentType: "application/javascript; charset=utf-8" },
    { key: "status.json", body: JSON.stringify(statusPayload(model)), contentType: "application/json; charset=utf-8" },
    { key: "assets/status-page.js", body: publicPageScript, contentType: "application/javascript; charset=utf-8" },
    { key: "assets/status-page.css", body: publicPageStyles(model.settings.accentColor), contentType: "text/css; charset=utf-8" },
    { key: "assets/cartographic-map.svg", body: cartographicMapSvg(), contentType: "image/svg+xml; charset=utf-8" },
    { key: "assets/favicon.svg", body: renderBrandSvg({ settings: model.settings, overall: model.overall, logoDataUrl: branding.logoDataUrl }, "favicon"), contentType: "image/svg+xml; charset=utf-8" },
    { key: "assets/og.svg", body: renderBrandSvg({ settings: model.settings, overall: model.overall, logoDataUrl: branding.logoDataUrl }, "og"), contentType: "image/svg+xml; charset=utf-8" },
    { key: "not-found.html", body: renderNotFoundPage(model, slots), contentType: "text/html; charset=utf-8" },
    ...model.incidents.map((incident) => ({ key: `incidents/${encodeURIComponent(incident.reference)}.html`, body: renderIncidentPage(incident, model, slots), contentType: "text/html; charset=utf-8" })),
  ];
  return { generatedAt, artifacts };
}
