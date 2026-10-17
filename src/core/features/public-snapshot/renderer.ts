import { publicUpdate } from "./public-update";
import { incidentImpact } from "../../shared/incident-impact";
import { reportMarkup } from "./report-markup";
import { historyMonths, renderHistoryContent } from "./history";
import { isPublicComponentShown } from "./component-visibility";
import { renderImportAliases } from "./import-aliases";
import { COMPONENT_STATES, mostSevereState, type ComponentState } from "../../shared/domain";
import type { LampServerSlots } from "../../api/extensions";
import { groupComponentsByHeading } from "../../shared/component-order";

import type { PublicSnapshotSource } from "./repository";
import { publicPageScript, publicPageStyles } from "./assets";
import { publicIcon } from "./icons";
import { defaultPublicSnapshotPolicies, type PublicSnapshotPolicies } from "./policies";
import { renderBrandSvg } from "./branding";
import { statusPayload, updateSummary } from "./feed-widget";
import { renderWidget } from "./widget";
import { renderFeeds } from "./feeds";
import { renderBadges } from "./badges";
import { renderPublicApi } from "./public-api";
import { publicComponentResources } from "./component-address";
import { incidentMarkup, maintenanceMarkup, resolvedMarkup, statePill, type PublicIncident, type PublicMaintenance } from "./record-markup";
import { DAY, REPORTING_DAYS, durationText, escapeHtml, stateClass, timestamp, timezoneLabel } from "./format";
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
  onlyShowIfDegraded?: boolean;
  uptimeStartDate?: string | null;
  note: string;
  groupName: string | null;
  groupOrder: number | null;
  displayOrder: number;
  state: ComponentState;
  uptime: Uptime;
}

function toPublicModel(source: PublicSnapshotSource, generatedAt: string, policies: PublicSnapshotPolicies) {
  const claims = new Map<string, ComponentState[]>();
  for (const claim of source.claims) claims.set(claim.componentId, [...(claims.get(claim.componentId) ?? []), claim.state]);
  const now = new Date(generatedAt).getTime();
  const components: PublicComponent[] = source.components.map((component) => ({
    ...component,
    // COMP-006 fixes individual component derivation. The rollup policy is
    // deliberately only for the single overall page status.
    state: mostSevereState(claims.get(component.id) ?? []),
    uptime: computeUptime(source, component.id, now, source.settings.timezone, policies, component.uptimeStartDate),
  }));
  const visibleComponents = components.filter(isPublicComponentShown);
  const hiddenIds = new Set(components.filter(component => !isPublicComponentShown(component)).map(component => component.id));
  const attachedIncidentIds = new Set(source.incidentComponents.map(component => component.incidentId));
  const attachedMaintenanceIds = new Set(source.maintenanceComponents.map(component => component.maintenanceId));
  const attachedByIncident = new Map<string, string[]>();
  for (const component of source.incidentComponents.filter(component => !component.componentId || !hiddenIds.has(component.componentId))) attachedByIncident.set(component.incidentId, [...(attachedByIncident.get(component.incidentId) ?? []), component.componentName]);
  const updatesByIncident = new Map<string, PublicIncident["updates"]>();
  for (const update of source.updates) updatesByIncident.set(update.incidentId, [...(updatesByIncident.get(update.incidentId) ?? []), publicUpdate(source, update)]);
  const reportsByIncident = new Map(source.reports.map((report) => [report.incidentId, report]));
  const incidents: PublicIncident[] = source.incidents.map((incident) => ({
    ...incident,
    ...incidentImpact(source.incidentImpacts?.[incident.id], incident.impactOverride, source.incidentComponents.filter(component => component.incidentId === incident.id).map(component => component.state)),
    components: attachedByIncident.get(incident.id) ?? [],
    updates: updatesByIncident.get(incident.id) ?? [],
    report: reportsByIncident.get(incident.id) ?? null,
  })).filter((incident) => incident.updates.length > 0 && attachedIncidentIds.has(incident.id));
  const attachedByMaintenance = new Map<string, string[]>();
  for (const component of source.maintenanceComponents.filter(component => !component.componentId || !hiddenIds.has(component.componentId))) attachedByMaintenance.set(component.maintenanceId, [...(attachedByMaintenance.get(component.maintenanceId) ?? []), component.componentName]);
  const noticesByMaintenance = new Map<string, PublicMaintenance["notices"]>();
  for (const notice of source.maintenanceNotices) noticesByMaintenance.set(notice.maintenanceId, [...(noticesByMaintenance.get(notice.maintenanceId) ?? []), notice]);
  const maintenance: PublicMaintenance[] = source.maintenance
    .map((item) => ({ ...item, components: attachedByMaintenance.get(item.id) ?? [], notices: noticesByMaintenance.get(item.id) ?? [], importedUpdates: (source.importedMaintenanceUpdates ?? []).filter(update => update.maintenanceId === item.id) }))
    .filter((item) => attachedMaintenanceIds.has(item.id));
  return { origin: source.publicOrigin ?? `https://${source.settings.hostname}`, settings: source.settings, components, visibleComponents, incidents, maintenance, generatedAt, policies, overall: policies.pageStatusRollup(components.map((component) => component.state)) };
}

export type PublicSnapshotModel = ReturnType<typeof toPublicModel>;

function uptimeMethod(policies: PublicSnapshotPolicies) {
  return COMPONENT_STATES.map((state) => `${state} counts as ${policies.uptimeDowntimeWeight(state)} downtime minute${policies.uptimeDowntimeWeight(state) === 1 ? "" : "s"}`).join("; ");
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

/** The page's own links: the current page offers history, the feed and subscribing; every other page leads back. */
function pageNavigation(current: "root" | "history" | "other") {
  const signIn = `<a data-lamp-signin href="/signin">Sign in</a>`;
  return current === "root"
    ? `<nav class="status-utilities" aria-label="Status resources"><a href="/history">History</a><a href="/feed.atom">Atom feed</a><a class="subscribe-link" href="#subscribe">Subscribe</a>${signIn}</nav>`
    : `<nav class="status-utilities" aria-label="Status page"><a href="/">Current status</a><a href="/history"${current === "history" ? ' aria-current="page"' : ""}>History</a>${signIn}</nav>`;
}

function pageShell(title: string, body: string, model: ReturnType<typeof toPublicModel>, slots: LampServerSlots, current: "root" | "history" | "other") {
  const { settings, overall } = model;
  const publicOrigin = model.origin;
  const masthead = `<header class="masthead"><div class="masthead-brand"><a class="brand" href="/"><img class="brand-logo" src="/assets/favicon.svg" alt=""><span>${escapeHtml(settings.pageName)}</span></a><p class="tagline">${escapeHtml(settings.tagline)}</p></div>${pageNavigation(current)}</header>`;
  const meta = `<p class="page-meta"><span class="host">${escapeHtml(settings.hostname)}</span><span class="host" data-timezone-label data-timezone="${escapeHtml(settings.timezone)}">Times shown in ${escapeHtml(timezoneLabel(settings.timezone))}</span></p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="description" content="${escapeHtml(settings.tagline)}"><meta property="og:title" content="${escapeHtml(`${settings.pageName}: ${overall}`)}"><meta property="og:image" content="${escapeHtml(`${publicOrigin}/assets/og.svg`)}"><meta property="og:image:alt" content="${escapeHtml(`${settings.pageName}: ${overall}`)}"><title>${escapeHtml(title)}</title><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/status-page.css"></head><body><main class="page${current === "root" ? " root-page" : ""}">${masthead}${slotMarkup(slots, "status-page.header.after.v1", model)}${body}${meta}<footer>${slotMarkup(slots, "status-page.footer.before.v1", model)}${settings.footerCreditEnabled ? "Powered by Lamp" : ""}</footer></main><script src="/assets/status-page.js" defer></script></body></html>`;
}

function componentMarkup(component: PublicComponent, timezone: string, generatedAt: string) {
  const resources = publicComponentResources(component);
  return `<article class="component"><div class="component-name"><h4>${escapeHtml(component.name)}</h4>${statePill(component.state, "component-state")}${component.description ? `<details class="component-description"><summary>About ${escapeHtml(component.name)}</summary><p>${escapeHtml(component.description)}</p></details>` : ""}${component.note ? `<p class="component-note">${escapeHtml(component.note)}</p>` : ""}<details class="component-resources"><summary>Feeds and badges</summary><a href="${resources.atom}">Atom</a> · <a href="${resources.rss}">RSS</a> · <a href="${resources.badge}">Status badge</a> · <a href="${resources.uptime}">Uptime badge</a></details></div><div class="component-status">${uptimeMarkup(component, timezone, generatedAt)}</div></article>`;
}

function componentHealthMarkup(model: ReturnType<typeof toPublicModel>) {
  const { visibleComponents: components, settings, generatedAt } = model;
  // One section per group in the shared component order. Ungrouped components
  // take the shared heading only beside named groups; a page without groups
  // lists its components with no invented heading.
  const named = components.some((component) => component.groupName !== null);
  const charts = groupComponentsByHeading(components).map(([heading, values]) => {
    const rows = values.map((component) => componentMarkup(component, settings.timezone, generatedAt)).join("");
    return !named
      ? `<div class="component-group">${rows}</div>`
      : `<section class="component-group"><h3>${escapeHtml(heading)}</h3>${rows}</section>`;
  }).join("");
  // A page with no visible components has no components section at all.
  if (!charts) return "";
  const method = `<p>Availability days use ${escapeHtml(settings.timezone)}. Uptime uses a ${REPORTING_DAYS}-day window. ${escapeHtml(uptimeMethod(model.policies))}.</p>`;
  return `<section class="component-health" aria-labelledby="components-title"><header class="section-heading"><h2 id="components-title">Components</h2><p>Uptime over the last ${REPORTING_DAYS} days</p></header><div class="availability-charts">${charts}</div><div class="availability-foot"><aside class="availability-legend" aria-label="Availability legend"><span><i class="legend-good"></i>Available</span><span><i class="legend-downtime"></i>Weighted downtime</span><span><i class="legend-no-data"></i>No data</span></aside><details class="availability-method"><summary>How availability is calculated</summary>${method}</details></div></section>`;
}

// The optional component choice (SUB-004) is a native disclosure, so it works without script (PAGE-002).
function subscriptionMarkup(components: PublicComponent[]) {
  const choices = groupComponentsByHeading(components).flatMap(([, values]) => values).map((component) => `<label><input type="checkbox" name="componentId" value="${escapeHtml(component.id)}"> ${escapeHtml(component.name)}</label>`).join("");
  const picker = choices ? `<details class="subscribe-components"><summary>Choose components</summary><fieldset><legend>Send me updates only about</legend><p>Leave every box clear to follow every component, including ones added later.</p>${choices}</fieldset></details>` : "";
  return `<section id="subscribe" class="subscribe" aria-labelledby="subscribe-title"><div class="subscribe-copy"><h2 id="subscribe-title">Subscribe to status updates</h2><p>Confirm your email address to receive future incident and maintenance updates.</p></div><form method="post" action="/subscribe"><label for="email">Email address</label><div class="subscribe-row"><input id="email" name="email" type="email" autocomplete="email" required><button type="submit">Subscribe</button></div>${picker}</form></section>`;
}

function timelineEntry(kind: "incident" | "maintenance" | "resolved", body: string) {
  return `<div class="timeline-entry timeline-${kind}">${body}</div>`;
}

// What is open or in progress now sits directly under the status plate; planned and
// recently resolved records follow the components. With nothing active the page keeps
// one "Incidents and maintenance" section after the components. A section with no
// entries is left out entirely, heading included.
function timelineMarkup(model: ReturnType<typeof toPublicModel>, slots: LampServerSlots) {
  const { incidents, maintenance, settings, generatedAt } = model;
  const newestFirst = (left: string, right: string) => right.localeCompare(left);
  const activeMaintenance = maintenance.filter((item) => item.state === "In progress").sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const upcomingMaintenance = maintenance.filter((item) => item.state === "Scheduled" && new Date(item.startsAt).getTime() <= new Date(generatedAt).getTime() + 14 * DAY).sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const unresolved = incidents.filter((incident) => incident.lifecycle !== "Resolved").sort((left, right) => newestFirst(left.updates[0]?.publishedAt ?? left.openedAt, right.updates[0]?.publishedAt ?? right.openedAt));
  const recentResolved = incidents.filter((incident) => incident.lifecycle === "Resolved" && incident.resolvedAt).sort((left, right) => newestFirst(left.resolvedAt ?? "", right.resolvedAt ?? "")).slice(0, 6);
  const now = [
    ...unresolved.map((incident) => timelineEntry("incident", `${incidentMarkup(incident, settings.timezone, 5, "Current incident", "h4")}${incidentSlotMarkup(slots, incident, model)}`)),
    ...activeMaintenance.map((item) => timelineEntry("maintenance", maintenanceMarkup(item, settings.timezone, generatedAt))),
  ].join("");
  const upcoming = upcomingMaintenance.map((item) => timelineEntry("maintenance", maintenanceMarkup(item, settings.timezone, generatedAt))).join("");
  const resolved = recentResolved.map((incident) => timelineEntry("resolved", resolvedMarkup(incident, settings.timezone))).join("");
  const resolvedGroup = resolved ? `<div class="timeline-group"><h3>Recently resolved</h3><div class="resolved-list">${resolved}</div></div>` : "";
  if (now) {
    const active = `<section id="incidents" class="history-timeline" aria-labelledby="active-title"><header class="section-heading"><h2 id="active-title">Happening now</h2></header><div class="timeline-group">${now}</div></section>`;
    const rest = [upcoming ? `<div class="timeline-group"><h3>Upcoming</h3>${upcoming}</div>` : "", resolvedGroup].join("");
    return { active, rest: rest ? `<section id="earlier" class="history-timeline" aria-labelledby="timeline-title"><header class="section-heading"><h2 id="timeline-title">Incidents and maintenance</h2></header>${rest}</section>` : "" };
  }
  const groups = [
    upcoming ? `<div class="timeline-group"><h3>Now and upcoming</h3>${upcoming}</div>` : "",
    resolvedGroup,
  ].join("");
  if (!groups) return { active: "", rest: "" };
  return { active: "", rest: `<section id="incidents" class="history-timeline" aria-labelledby="timeline-title"><header class="section-heading"><h2 id="timeline-title">Incidents and maintenance</h2></header>${groups}</section>` };
}

function renderPage(model: ReturnType<typeof toPublicModel>, slots: LampServerSlots) {
  const { settings, incidents, overall, generatedAt } = model;
  const newest = incidents.filter((incident) => incident.lifecycle !== "Resolved").flatMap((incident) => incident.updates.map((update) => ({ incident, update }))).sort((left, right) => right.update.publishedAt.localeCompare(left.update.publishedAt))[0];
  const statusIcon = overall === "Operational" ? "check" : overall === "Under maintenance" ? "maintenance" : "alert";
  const status = `<section class="status-banner ${stateClass(overall)}" aria-labelledby="overall-status"><div id="status-live" role="status" aria-live="polite" aria-atomic="true"><div class="status-summary">${publicIcon(statusIcon, "overall-status-icon")}<div><p class="eyebrow">Current status</p><h1 id="overall-status" data-overall>${escapeHtml(overall)}</h1></div></div><p class="status-live-update" data-newest-update>${escapeHtml(newest ? updateSummary(newest.incident, newest.update) : "There are no open incidents.")}</p><p class="status-generated" data-generated-at>Snapshot generated ${timestamp(generatedAt, settings.timezone)}.</p></div></section>`;
  const pageTitle = /\bstatus\s*$/i.test(settings.pageName.trim()) ? settings.pageName : `${settings.pageName} status`;
  const timeline = timelineMarkup(model, slots);
  return pageShell(pageTitle, `${status}${timeline.active}${componentHealthMarkup(model)}<div class="component-extension">${slotMarkup(slots, "status-page.components.after.v1", model)}</div>${timeline.rest}${subscriptionMarkup(model.visibleComponents)}`, model, slots, "root");
}

function breadcrumb(here: string) {
  return `<nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Status</a><span aria-hidden="true">/</span><span>${escapeHtml(here)}</span></nav>`;
}

function renderIncidentPage(incident: PublicIncident, model: ReturnType<typeof toPublicModel>, slots: LampServerSlots) {
  const timezone = model.settings.timezone;
  const report = reportMarkup(incident.report);
  const resolutionUpdateCarriesTime = incident.updates.some((update) => update.lifecycle === "Resolved" && update.publishedAt === incident.resolvedAt);
  const resolved = incident.lifecycle === "Resolved" && incident.resolvedAt
    ? `<p class="incident-resolution">${resolutionUpdateCarriesTime ? "" : `Resolved at ${timestamp(incident.resolvedAt, timezone)}. `}Duration: ${escapeHtml(durationText(incident.openedAt, incident.resolvedAt))}</p>`
    : "";
  const content = `${breadcrumb(incident.reference)}<div class="incident-document"><div class="incident-document-main">${incidentMarkup(incident, timezone, undefined, "Incident", "h1")}<section class="about"><h2>About this incident</h2><p>Opened ${timestamp(incident.openedAt, timezone)}. ${incident.components.length ? `Affected components: ${escapeHtml(incident.components.join(", "))}.` : ""}</p>${resolved}</section>${report}</div><aside class="incident-summary" aria-label="Incident status"><p class="eyebrow">Incident status</p><h2 class="summary-state">${statePill(incident.lifecycle)}</h2><dl><div><dt>Reference</dt><dd>${escapeHtml(incident.reference)}</dd></div><div><dt>Opened</dt><dd>${timestamp(incident.openedAt, timezone)}</dd></div><div><dt>Updates</dt><dd>${incident.updates.length}</dd></div></dl><a class="text-link" href="/">Current status</a></aside></div>`;
  return pageShell(`${incident.reference} · ${model.settings.pageName}`, content, model, slots, "other");
}

function renderNotFoundPage(model: ReturnType<typeof toPublicModel>, slots: LampServerSlots) {
  const content = `<section class="history not-found" aria-labelledby="missing-incident-title"><p class="eyebrow">Incident record</p><h1 id="missing-incident-title">We couldn't find that incident</h1><p>This permalink does not match an incident in the public record.</p><nav class="not-found-links" aria-label="Status navigation"><a class="text-link" href="/">Current status</a><a class="text-link" href="/history">Resolved history</a></nav></section>`;
  return pageShell(`Incident not found · ${model.settings.pageName}`, content, model, slots, "other");
}

function renderHistory(model: ReturnType<typeof toPublicModel>, slots: LampServerSlots, month?: string) {
  return pageShell(`${month ?? "History"} · ${model.settings.pageName}`, `${breadcrumb("History")}${renderHistoryContent(model, month)}`, model, slots, "history");
}

export function renderPublicSnapshot(source: PublicSnapshotSource, generatedAt = new Date().toISOString(), policies: PublicSnapshotPolicies = defaultPublicSnapshotPolicies, branding: { logoDataUrl: string | null } = { logoDataUrl: null }, slots: LampServerSlots = {}): RenderedSnapshot {
  const model = toPublicModel(source, generatedAt, policies);
  const feeds = renderFeeds(model, source);
  const artifacts: SnapshotArtifact[] = [
    { key: "page.html", body: renderPage(model, slots), contentType: "text/html; charset=utf-8" },
    ...feeds,
    ...renderBadges(model),
    ...renderPublicApi(model, source),
    { key: "widget.js", body: renderWidget(statusPayload(model), model.settings), contentType: "application/javascript; charset=utf-8" },
    { key: "embed/script.js", body: renderWidget(statusPayload(model), model.settings, "floating"), contentType: "application/javascript; charset=utf-8" },
    { key: "status.json", body: JSON.stringify(statusPayload(model)), contentType: "application/json; charset=utf-8" },
    { key: "assets/status-page.js", body: publicPageScript, contentType: "application/javascript; charset=utf-8" },
    { key: "assets/status-page.css", body: publicPageStyles(model.settings.accentColor), contentType: "text/css; charset=utf-8" },
    { key: "assets/favicon.svg", body: renderBrandSvg({ settings: model.settings, overall: model.overall, logoDataUrl: branding.logoDataUrl }, "favicon"), contentType: "image/svg+xml; charset=utf-8" },
    { key: "assets/og.svg", body: renderBrandSvg({ settings: model.settings, overall: model.overall, logoDataUrl: branding.logoDataUrl }, "og"), contentType: "image/svg+xml; charset=utf-8" },
    { key: "not-found.html", body: renderNotFoundPage(model, slots), contentType: "text/html; charset=utf-8" },
    ...model.incidents.map((incident) => ({ key: `incidents/${encodeURIComponent(incident.reference)}.html`, body: renderIncidentPage(incident, model, slots), contentType: "text/html; charset=utf-8" })),
  ];
  artifacts.push(...model.maintenance.map((item) => ({ key: `maintenance/${encodeURIComponent(item.reference)}.html`, body: pageShell(`${item.reference} · ${model.settings.pageName}`, `${breadcrumb(item.reference)}${maintenanceMarkup(item, model.settings.timezone, generatedAt, true)}`, model, slots, "other"), contentType: "text/html; charset=utf-8" })));
  artifacts.push(...historyMonths(model).map(month => ({ key: `history/${month}.html`, body: renderHistory(model, slots, month), contentType: "text/html; charset=utf-8" })));
  artifacts.push(...renderImportAliases(source, model.incidents, model.maintenance, renderHistory(model, slots)));
  return { generatedAt, artifacts };
}
