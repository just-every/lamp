import { themeGroup } from "../theme";
import type { PublicSnapshotModel } from "../renderer";
import { groupComponentsByHeading } from "../../../shared/component-order";
import { escapeHtml } from "../format";
import { componentIcon, stateGlyph } from "./icons";
import { maintenanceEntry, openIncidentEntry, resolvedEntry } from "./history";
import { brand, componentNote, dayBar, feedLinks, quietLine, records, sentenceSize, situation, subscribeForm, tagline, toneOf, updatedLine, uptimeCaption, uptimeValue, type Component, type TemplateParts } from "./parts";

/** Calm headline: one quiet sentence answers the question; components and history sit underneath as type and
 *  hairlines, with no cards or boxes. */
function componentRow(component: Component, heading: "h3" | "h4") {
  return `<li class="calm-row"${component.historyDays !== undefined ? ` data-component-id="${escapeHtml(component.id)}"` : ""}>${componentIcon(component.name)}<div class="calm-name"><${heading}>${escapeHtml(component.name)}</${heading}>${componentNote(component)}</div><p class="calm-state tone-${toneOf(component.state)}">${stateGlyph(component.state)}<span>${escapeHtml(component.state)}</span></p><div class="calm-uptime"><p><span class="calm-caption">${escapeHtml(uptimeCaption(component.uptime))}</span><span class="calm-value">${escapeHtml(uptimeValue(component.uptime))}</span></p>${dayBar(component, "calm-bar")}</div></li>`;
}

function components(model: PublicSnapshotModel, parts: TemplateParts) {
  if (!model.visibleComponents.length) return "";
  const named = model.visibleComponents.some((component) => component.groupName !== null);
  const groups = groupComponentsByHeading(model.visibleComponents).map(([heading, list]) => {
    const rows = `<ul class="calm-list">${list.map((component) => componentRow(component, named ? "h4" : "h3")).join("")}</ul>`;
    return named ? themeGroup(model.theme, heading, rows, `<h3 class="calm-group">${escapeHtml(heading)}</h3>${rows}`) : rows;
  }).join("");
  return `<section class="calm-components" aria-labelledby="components-title" data-live="components"><h2 id="components-title" class="tpl-kicker">Components</h2>${groups}<div class="component-extension">${parts.slot("status-page.components.after.v1")}</div></section>`;
}

function history(model: PublicSnapshotModel, parts: TemplateParts) {
  const shown = records(model);
  const entries = [
    ...shown.open.map((incident) => openIncidentEntry(incident, model, parts)),
    ...shown.maintenance.map((item) => maintenanceEntry(item, model)),
    ...shown.resolved.map((incident) => resolvedEntry(incident, model, true)),
  ].join("");
  return `<section class="calm-history" aria-labelledby="history-title" data-live="history"><h2 id="history-title" class="tpl-kicker">History</h2>${entries ? `<ol class="tl-list">${entries}</ol>` : ""}${quietLine(shown, "tpl-quiet")}</section>`;
}

export function calmPage(model: PublicSnapshotModel, parts: TemplateParts) {
  const text = situation(model);
  const head = `<header class="calm-head wrap"><div class="calm-brand">${brand(model)}${tagline(model)}</div><div class="calm-actions">${subscribeForm("subscribe-email", "", "Your email")}${feedLinks()}</div></header>`;
  const status = `<section class="calm-status wrap" aria-labelledby="overall-status"><div class="tpl-live" id="status-live" role="status" aria-live="polite" aria-atomic="true" data-live="status"><h1 id="overall-status" class="calm-sentence ${sentenceSize(text)}">${escapeHtml(text)}</h1><span class="sr-only">${escapeHtml(model.overall)}</span></div>${updatedLine(model)}</section>`;
  return `${head}${parts.slot("status-page.header.after.v1")}${status}<div class="calm-body wrap">${components(model, parts)}${history(model, parts)}</div>`;
}
