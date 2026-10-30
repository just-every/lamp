import { themeChrome } from "../theme-rendering";
import type { PublicSnapshotModel } from "../renderer";
import type { PublicIncident, PublicMaintenance } from "../record-markup";
import { mostSevereState, type ComponentState } from "../../../shared/domain";
import { renderUpdateHtml } from "../../../shared/update-links";
import { DAY, REPORTING_DAYS, dayKey, escapeHtml, formatTime, timezoneLabel } from "../format";
import { uptimeMarkLabel, type Uptime } from "../uptime";
import { lampMark, lineIcon } from "./icons";

export type TemplateName = "calm" | "uptime" | "regions";
export type Component = PublicSnapshotModel["visibleComponents"][number];

/** What the renderer lends a template: the owner's extension slots and the footer's feed and badge links. */
export interface TemplateParts {
  slot(id: "status-page.header.after.v1" | "status-page.components.after.v1" | "status-page.footer.before.v1"): string;
  incidentSlot(incident: PublicIncident): string;
  footerResources: string;
}

export function templateShell(template: TemplateName, model: PublicSnapshotModel, parts: TemplateParts, body: string) {
  const { settings, overall } = model;
  const title = /\bstatus\s*$/i.test(settings.pageName.trim()) ? settings.pageName : `${settings.pageName} status`;
  const website = model.websiteUrl ? new URL(model.websiteUrl) : null;
  const meta = `<p class="tpl-foot-meta">${website ? `<a href="${escapeHtml(website.href)}">${escapeHtml(website.hostname)}</a>` : ""}<span class="host" data-timezone-label data-timezone="${escapeHtml(settings.timezone)}">Times shown in ${escapeHtml(timezoneLabel(settings.timezone))}</span><a data-lamp-signin href="/signin">Sign in</a></p>`;
  const credit = settings.footerCreditEnabled ? `<p class="tpl-credit">${template === "calm" ? "" : lampMark()}<span>Powered by <span class="tpl-credit-name">Lamp</span></span></p>` : "";
  const footer = `<footer class="tpl-foot"><div class="wrap">${themeChrome(model.theme, "footer")}${parts.slot("status-page.footer.before.v1")}<div class="tpl-foot-row">${credit}${meta}</div>${parts.footerResources}</div></footer>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="description" content="${escapeHtml(settings.tagline)}"><meta property="og:title" content="${escapeHtml(`${settings.pageName}: ${overall}`)}"><meta property="og:image" content="${escapeHtml(`${model.origin}/assets/og.svg`)}"><meta property="og:image:alt" content="${escapeHtml(`${settings.pageName}: ${overall}`)}"><title>${escapeHtml(title)}</title><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/template.css"></head><body class="lamp-public" data-template="${template}"><main class="tpl tpl-${template}">${themeChrome(model.theme, "header")}${body}${footer}</main><script src="/assets/template.js" defer></script></body></html>`;
}

export function brand(model: PublicSnapshotModel) {
  return `<a class="tpl-brand" href="/"><img class="tpl-mark" src="/assets/mark.svg" alt=""><span>${escapeHtml(model.settings.pageName)}</span></a>`;
}

export function tagline(model: PublicSnapshotModel) {
  return model.settings.tagline.trim() ? `<p class="tpl-tagline">${escapeHtml(model.settings.tagline)}</p>` : "";
}

/** The subscribe form of SUB-001: a plain POST that works without script. Components are chosen later, on the
 *  management page every confirmation links to (SUB-004). */
export function subscribeForm(id: string, className = "", placeholder = "Your email address") {
  return `<form class="tpl-subscribe${className ? ` ${className}` : ""}" method="post" action="/subscribe"><label class="sr-only" for="${id}">Email address</label><input id="${id}" name="email" type="email" autocomplete="email" required placeholder="${placeholder}"><button type="submit">Subscribe</button></form>`;
}

export function feedLinks(className = "", label = "Status feeds") {
  return `<nav class="tpl-feeds${className ? ` ${className}` : ""}" aria-label="${label}"><a href="/feed.rss">${lineIcon("rss")}RSS</a><a href="/feed.atom">${lineIcon("atom")}Atom</a></nav>`;
}

/** A timestamp in the page's zone with its UTC offset (PAGE-009); the date is left out on the day given. */
export function when(value: string, timezone: string, sameDayAs?: string) {
  const full = formatTime(value, timezone);
  const shown = sameDayAs && dayKey(Date.parse(value), timezone) === dayKey(Date.parse(sameDayAs), timezone) ? full.replace(/^[A-Z][a-z]{2} \d{1,2}, \d{4}, /, "") : full;
  return `<time datetime="${escapeHtml(value)}" data-local-time>${escapeHtml(shown)}</time>`;
}

export function toneOf(state: ComponentState) {
  return state === "Operational" ? "ok" : state === "Under maintenance" ? "maint" : state === "Major outage" ? "major" : state === "Partially unavailable" ? "partial" : "degraded";
}

function clean(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function sentence(text: string) {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

function newestOpenUpdate(model: PublicSnapshotModel) {
  return model.incidents.filter((incident) => incident.lifecycle !== "Resolved").flatMap((incident) => incident.updates.map((update) => ({ incident, update }))).sort((left, right) => right.update.publishedAt.localeCompare(left.update.publishedAt))[0];
}

function names(components: Component[]) {
  return components.length === 1 ? components[0]!.name : components.length === 2 ? `${components[0]!.name} and ${components[1]!.name}` : `${components.length} services`;
}

const how: Record<ComponentState, string> = {
  "Operational": "working",
  "Degraded performance": "slower than usual",
  "Partially unavailable": "partly unavailable",
  "Major outage": "unavailable",
  "Under maintenance": "under maintenance",
};

/** One plain situational sentence: what customers notice and what still works, from the newest published update;
 *  otherwise what is in maintenance or affected right now; otherwise that everything works. */
export function situation(model: PublicSnapshotModel) {
  const open = model.incidents.filter((incident) => incident.lifecycle !== "Resolved");
  const newest = newestOpenUpdate(model);
  if (newest) {
    const parts = [clean(newest.update.customerImpact), clean(newest.update.whatStillWorks)].filter(Boolean).map(sentence);
    const others = open.length - 1;
    return `${parts.join(" ") || sentence(newest.incident.title)}${others > 0 ? ` We are also working on ${others} other incident${others === 1 ? "" : "s"}.` : ""}`;
  }
  const maintenance = model.maintenance.filter((item) => item.state === "In progress");
  if (maintenance.length) return maintenance.length === 1 ? `Planned maintenance is in progress: ${sentence(clean(maintenance[0]!.title))}` : `${maintenance.length} planned maintenance windows are in progress.`;
  const affected = model.visibleComponents.filter((component) => component.state !== "Operational");
  if (!affected.length) return "Everything is working normally.";
  const worst = mostSevereState(affected.map((component) => component.state));
  const lead = affected.filter((component) => component.state === worst);
  const rest = affected.length - lead.length;
  return `${names(lead)} ${lead.length === 1 ? "is" : "are"} ${how[worst]}.${rest ? ` ${rest} other service${rest === 1 ? " is" : "s are"} affected.` : ""}${affected.length < model.visibleComponents.length ? " Everything else is working." : ""}`;
}

export function sentenceSize(text: string) {
  return text.length <= 80 ? "size-l" : text.length <= 150 ? "size-m" : "size-s";
}

/** The overall state as one labelled state (PAGE-004) and the instant the content was generated (PAGE-014). */
export function updatedLine(model: PublicSnapshotModel, className = "tpl-updated") {
  return `<p class="${className}"><span class="tpl-state tone-${toneOf(model.overall)}" data-live="overall">${escapeHtml(model.overall)}</span><span class="tpl-sep" aria-hidden="true">·</span><span data-generated-at data-live="generation">Updated ${when(model.generatedAt, model.settings.timezone)}</span></p>`;
}

export function uptimeCaption(uptime: Uptime) {
  const days = Math.min(REPORTING_DAYS, uptime.marks.length);
  if (uptime.percentage === null || uptime.coverageDays >= days) return `${days}-day uptime`;
  return uptime.coverageDays >= 1 ? `Uptime, ${uptime.coverageDays} day${uptime.coverageDays === 1 ? "" : "s"}` : "Uptime today";
}

export function uptimeValue(uptime: Uptime) {
  return uptime.percentage ?? "No data";
}

export function dayClass(mark: Uptime["marks"][number]) {
  if (mark.downtimeMinutes === null) return "none";
  if (mark.downtimeMinutes === 0) return "ok";
  return mark.worstDowntimeState === "Major outage" ? "major" : mark.worstDowntimeState === "Partially unavailable" ? "partial" : "degraded";
}

/** The reporting window's daily record (PAGE-001), oldest day first. */
export function recordDays(component: Component) {
  // An elapsed reporting window can touch an extra partial calendar day.
  // Keep that day's evidence, just as the public API and default page do.
  return component.uptime.marks;
}

/** A component's daily record as a bar of labelled days. Unlabelled, it only repeats days a reader already has as
 *  labelled cells elsewhere on the page, and stays hidden from assistive technology. */
export function dayBar(component: Component, className: string, labelled = true) {
  if (component.hideUptime) return "";
  if (!labelled) return `<span class="${className}" aria-hidden="true">${recordDays(component).map((mark) => `<span class="day ${dayClass(mark)}"></span>`).join("")}</span>`;
  const days = recordDays(component).map((mark) => {
    const label = escapeHtml(uptimeMarkLabel(mark));
    return `<span class="day ${dayClass(mark)}" role="listitem" aria-label="${label}" title="${label}"></span>`;
  }).join("");
  return `<span class="${className}" role="list" aria-label="${Math.min(REPORTING_DAYS, component.uptime.marks.length)}-day uptime record for ${escapeHtml(component.name)}">${days}</span>`;
}

export function componentNote(component: Component) {
  return `${component.note ? `<p class="tpl-note">${escapeHtml(component.note)}</p>` : ""}${component.description ? `<details class="tpl-about"><summary>About ${escapeHtml(component.name)}</summary><p>${escapeHtml(component.description)}</p></details>` : ""}`;
}

/** What the history of a template lists: everything PAGE-001 requires, then the latest resolved incidents. */
export function records(model: PublicSnapshotModel) {
  const now = Date.parse(model.generatedAt);
  const open = model.incidents.filter((incident) => incident.lifecycle !== "Resolved").sort((left, right) => (right.updates[0]?.publishedAt ?? right.openedAt).localeCompare(left.updates[0]?.publishedAt ?? left.openedAt));
  const active = model.maintenance.filter((item) => item.state === "In progress").sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const upcoming = model.maintenance.filter((item) => item.state === "Scheduled" && Date.parse(item.startsAt) <= now + 14 * DAY).sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const resolved = model.incidents.filter((incident) => incident.lifecycle === "Resolved" && incident.resolvedAt && Date.parse(incident.resolvedAt) >= now - model.theme.historyDays * DAY).sort((left, right) => (right.resolvedAt ?? "").localeCompare(left.resolvedAt ?? ""));
  return { historyDays: model.theme.historyDays, open, maintenance: [...active, ...upcoming], resolved: resolved.slice(0, 3), more: Math.max(0, resolved.length - 3) };
}

export function quietLine(history: ReturnType<typeof records>, className: string) {
  const text = history.more
    ? `${history.more} more incident${history.more === 1 ? "" : "s"} in the last ${history.historyDays} days.`
    : history.resolved.length || history.open.length ? `No other incidents in the last ${history.historyDays} days.` : `No incidents in the last ${history.historyDays} days.`;
  return `<p class="${className}">${text} <a href="/history">Full history</a></p>`;
}

export function incidentLink(incident: PublicIncident) {
  return `<a href="/incidents/${encodeURIComponent(incident.reference)}">${escapeHtml(incident.title)}</a>`;
}

/** What an update tells customers: the impact and what still works, then any detail. */
export function updateText(update: PublicIncident["updates"][number]) {
  const said = [update.customerImpact, update.whatStillWorks].map(clean).filter(Boolean).map(sentence).join(" ");
  return `${said ? `<p class="tpl-said">${renderUpdateHtml(said)}</p>` : ""}${clean(update.details) ? `<p class="tpl-detail">${renderUpdateHtml(clean(update.details))}</p>` : ""}`;
}

export function earlierText(update: PublicIncident["updates"][number]) {
  const said = clean(update.customerImpact) || clean(update.details);
  return said ? `<p class="tpl-said">${renderUpdateHtml(sentence(said))}</p>` : "";
}

export function resolvedSpan(incident: PublicIncident, timezone: string) {
  if (!incident.resolvedAt) return "";
  const minutes = Math.max(0, Math.round((Date.parse(incident.resolvedAt) - Date.parse(incident.openedAt)) / 60_000));
  const length = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
  return `${when(incident.openedAt, timezone)} – ${when(incident.resolvedAt, timezone, incident.openedAt)} (${length})`;
}

/** A maintenance window's times in the markup the public routes use to flag an overrun as it happens. */
export function maintenanceWindow(item: PublicMaintenance, timezone: string) {
  return `<p class="maintenance-window" data-maintenance-state="${escapeHtml(item.state)}" data-maintenance-ends-at="${escapeHtml(item.endsAt)}">${item.state === "Scheduled" ? "Planned" : "In progress"} · ${when(item.startsAt, timezone)} – ${when(item.endsAt, timezone, item.startsAt)}</p>`;
}

export function maintenanceNotices(item: PublicMaintenance, timezone: string) {
  // The window's own times already say it is planned or under way; later notices say what changed.
  const notices = [...item.notices.filter((notice) => !["scheduled", "reminder", "started"].includes(notice.kind.toLowerCase())), ...(item.importedUpdates ?? []).map((update) => ({ ...update, kind: "Update" }))].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)).slice(0, 3);
  return notices.map((notice) => `<li><p class="tpl-meta">${escapeHtml(notice.kind.charAt(0).toUpperCase() + notice.kind.slice(1))} · ${when(notice.publishedAt, timezone)}</p>${notice.body ? `<p class="tpl-said">${renderUpdateHtml(notice.body)}</p>` : ""}</li>`).join("");
}
