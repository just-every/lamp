import type { PublicSnapshotModel } from "../renderer";
import type { PublicIncident } from "../record-markup";
import { publicComponentOrder } from "../../../shared/component-order";
import { COMPONENT_STATES } from "../../../shared/domain";
import { REPORTING_DAYS, dayKey, escapeHtml } from "../format";
import { uptimeMarkLabel } from "../uptime";
import { stateGlyph } from "./icons";
import { maintenanceEntry, openIncidentEntry, resolvedEntry } from "./history";
import { brand, componentNote, dayClass, feedLinks, quietLine, records, recordDays, situation, subscribeForm, tagline, updatedLine, uptimeValue, type Component, type TemplateParts } from "./parts";

/** Uptime-history-led: history is the hero. One 90-day heatmap of every component on a shared date axis, incident
 *  days called out, under a big overall uptime figure. */
const MAX_CALLOUTS = 4;
const MAX_REACH = 30;
const CALLOUT_COLUMN_PX = 7;

/** Grid columns for the axis and callouts, and each callout's reach down to its component's row. */
export function historyLedStyles() {
  const columns = Array.from({ length: REPORTING_DAYS }, (_, index) => `.hm-track .d${index + 1}{grid-column-start:${index + 1}}`).join("");
  const reach = Array.from({ length: MAX_REACH + 1 }, (_, index) => `.reach-${index}{--reach:${index}}`).join("");
  return `${columns}${reach}`;
}

function overallUptime(components: Component[]) {
  const tracked = components.filter((component) => component.uptime.percentage !== null && component.uptime.coverageMinutes > 0);
  const minutes = tracked.reduce((sum, component) => sum + component.uptime.coverageMinutes, 0);
  if (!minutes) return null;
  const mean = tracked.reduce((sum, component) => sum + Number.parseFloat(component.uptime.percentage!) * component.uptime.coverageMinutes, 0) / minutes;
  return `${(Math.floor(mean * 100) / 100).toFixed(2)}%`;
}

function incidentDays(incident: PublicIncident, timezone: string, generatedAt: string) {
  const start = Math.min(Date.parse(incident.openedAt), ...incident.updates.map((update) => Date.parse(update.publishedAt)));
  return { from: dayKey(start, timezone), to: dayKey(Date.parse(incident.resolvedAt ?? generatedAt), timezone) };
}

interface Callout { incident: PublicIncident; row: number; column: number; flip: boolean; range: [number, number] }

/** Lanes for the callouts: two rows of labels above the grid. Labels in one lane never touch, and a leader line
 *  from the upper lane never runs behind a label in the lower one. Recent incidents win a place first. */
function lanes(callouts: Callout[]) {
  let best: { lanes: Array<0 | 1 | null>; score: number } = { lanes: callouts.map(() => null), score: 0 };
  const visit = (index: number, chosen: Array<0 | 1 | null>) => {
    if (index === callouts.length) {
      const score = chosen.reduce<number>((sum, lane, rank) => sum + (lane === null ? 0 : 100 - rank * 10 - lane), 0);
      if (score > best.score) best = { lanes: [...chosen], score };
      return;
    }
    for (const lane of [0, 1, null] as const) {
      const callout = callouts[index]!;
      const clear = lane === null || chosen.every((other, at) => {
        if (other === null) return true;
        const placed = callouts[at]!;
        if (other === lane) return callout.range[1] < placed.range[0] - 1 || callout.range[0] > placed.range[1] + 1;
        const [upper, lower] = lane === 1 ? [callout, placed] : [placed, callout];
        return upper.column < lower.range[0] || upper.column > lower.range[1];
      });
      if (clear) visit(index + 1, [...chosen, lane]);
    }
  };
  visit(0, []);
  return best.lanes;
}

function callouts(model: PublicSnapshotModel, components: Component[], days: string[]) {
  const timezone = model.settings.timezone;
  const recent: Callout[] = model.incidents
    .map((incident) => ({ incident, row: components.findIndex((component) => incident.components.includes(component.name)), ...incidentDays(incident, timezone, model.generatedAt) }))
    .filter(({ row, from, to }) => row >= 0 && to >= days[0]! && from <= days.at(-1)!)
    .sort((left, right) => right.from.localeCompare(left.from))
    .slice(0, MAX_CALLOUTS)
    .map(({ incident, row, from }) => {
      const column = Math.max(0, days.indexOf(from));
      const span = Math.ceil((incident.title.length * 6.4 + 24) / CALLOUT_COLUMN_PX);
      const flip = column >= days.length / 2;
      return { incident, row, column, flip, range: flip ? [column - span, column] : [column, column + span] };
    });
  const placed = lanes(recent);
  return recent.map(({ incident, row, column, flip }, index) => {
    const lane = placed[index];
    if (lane === null || lane === undefined) return "";
    const open = incident.lifecycle !== "Resolved";
    return `<span class="hm-callout d${column + 1} lane-${lane} reach-${Math.min(row, MAX_REACH)}${flip ? " flip" : ""} ${open ? "is-open" : "is-done"}"><a href="/incidents/${encodeURIComponent(incident.reference)}">${escapeHtml(incident.title)}<span class="sr-only">, ${open ? "ongoing" : "resolved"}</span></a></span>`;
  }).join("");
}

function axis(days: string[]) {
  const labels: string[] = [];
  for (let index = days.length - 1; index >= 0; index -= 7) {
    const shown = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${days[index]}T12:00:00Z`));
    labels.unshift(`<span class="d${index + 1}${index === days.length - 1 ? " last" : index === days.length - 8 ? " near-last" : ""}">${shown}</span>`);
  }
  return `<div class="hm-axis" aria-hidden="true">${labels.join("")}</div>`;
}

function heatmap(model: PublicSnapshotModel, parts: TemplateParts) {
  const components = publicComponentOrder(model.visibleComponents);
  if (!components.length) return "";
  const days = recordDays(components[0]!).map((mark) => mark.day);
  const timezone = model.settings.timezone;
  const spans = model.incidents.map((incident) => ({ incident, ...incidentDays(incident, timezone, model.generatedAt) }));
  const seen = new Set<string>();
  const labels = components.map((component) => `<li class="hm-label">${stateGlyph(component.state)}<span class="hm-name">${escapeHtml(component.name)}</span><span class="hm-state">${escapeHtml(component.state)}</span><span class="hm-pct">${escapeHtml(uptimeValue(component.uptime))}</span></li>`).join("");
  const rows = components.map((component) => {
    const cells = recordDays(component).map((mark) => {
      const kind = dayClass(mark);
      seen.add(kind);
      const incident = spans.find((span) => span.incident.components.includes(component.name) && span.from <= mark.day && span.to >= mark.day)?.incident;
      const label = escapeHtml(`${uptimeMarkLabel(mark)}${incident ? `; incident: ${incident.title}` : ""}`);
      return `<span class="cell ${kind}${incident ? " inc" : ""}" role="listitem" aria-label="${label}" title="${label}"></span>`;
    }).join("");
    return `<div class="hm-cells" role="list" aria-label="${REPORTING_DAYS}-day uptime record for ${escapeHtml(component.name)}">${cells}</div>`;
  }).join("");
  const legendStates = [["ok", COMPONENT_STATES[0]], ["degraded", "Degraded performance"], ["partial", "Partially unavailable"], ["major", "Major outage"], ["none", "No data"]].filter(([kind]) => kind === "ok" || seen.has(kind!));
  const legend = `<ul class="hm-legend" aria-label="Legend">${legendStates.map(([kind, name]) => `<li><i class="cell ${kind}"></i>${name}</li>`).join("")}</ul>`;
  const notes = components.filter((component) => component.note || component.description).map((component) => `<li><strong>${escapeHtml(component.name)}</strong>${componentNote(component)}</li>`).join("");
  return `<section class="up-heatmap wrap" aria-labelledby="heatmap-title" data-live="heatmap"><div class="hm-frame"><div class="hm-head"><h2 id="heatmap-title">Components</h2>${legend}</div><div class="hm-body"><ul class="hm-labels">${labels}</ul><div class="hm-scroll" tabindex="0" role="group" aria-label="Daily history, last ${REPORTING_DAYS} days"><div class="hm-track"><div class="hm-callouts">${callouts(model, components, days)}</div>${rows}${axis(days)}</div></div></div>${notes ? `<ul class="hm-notes">${notes}</ul>` : ""}<details class="hm-method"><summary>How these figures are calculated</summary><p>Each square is one calendar day in ${escapeHtml(timezone)}. A component's percentage covers the last ${REPORTING_DAYS} days of observed time; the overall figure averages the components, weighted by observed time. Degraded performance counts as ${model.policies.uptimeDowntimeWeight("Degraded performance")} downtime minutes per minute, a partial outage as ${model.policies.uptimeDowntimeWeight("Partially unavailable")} and a major outage as ${model.policies.uptimeDowntimeWeight("Major outage")}.</p></details><div class="component-extension">${parts.slot("status-page.components.after.v1")}</div></div></section>`;
}

export function historyLedPage(model: PublicSnapshotModel, parts: TemplateParts) {
  const shown = records(model);
  const text = situation(model);
  const figure = overallUptime(model.visibleComponents);
  const band = `<header class="up-band"><div class="wrap up-band-row"><div class="up-brand">${brand(model)}${tagline(model)}</div><div class="up-actions">${subscribeForm("subscribe-email", "on-dark")}<a class="up-band-subscribe" href="#subscribe">Subscribe</a>${feedLinks("on-dark")}</div></div></header>`;
  const hero = `<section class="up-hero wrap" aria-labelledby="overall-status"><div class="up-figure" data-live="figure"><p class="tpl-kicker">Overall uptime (last ${REPORTING_DAYS} days)</p><p class="up-number">${figure ?? "No data yet"}</p></div><div class="tpl-live up-situation" id="status-live" role="status" aria-live="polite" aria-atomic="true" data-live="status"><h1 id="overall-status">${escapeHtml(text)}</h1>${updatedLine(model)}</div></section>`;
  const entries = [
    ...shown.open.map((incident) => openIncidentEntry(incident, model, parts)),
    ...shown.maintenance.map((item) => maintenanceEntry(item, model)),
    ...shown.resolved.map((incident) => resolvedEntry(incident, model)),
  ].join("");
  const incidents = `<section class="up-incidents" aria-labelledby="incidents-title" data-live="history"><h2 id="incidents-title">${shown.maintenance.length ? "Incidents and maintenance" : "Incidents"}</h2>${entries ? `<ol class="tl-list">${entries}</ol>` : ""}${quietLine(shown, "tpl-quiet")}</section>`;
  const subscribe = `<section id="subscribe" class="up-subscribe" aria-labelledby="subscribe-title"><h2 id="subscribe-title">Subscribe</h2><p>Get notified about incidents and updates from ${escapeHtml(model.settings.pageName)}.</p>${subscribeForm("subscribe-email-card")}${feedLinks()}</section>`;
  return `${band}${parts.slot("status-page.header.after.v1")}${hero}${heatmap(model, parts)}<div class="up-lower wrap">${incidents}${subscribe}</div>`;
}
