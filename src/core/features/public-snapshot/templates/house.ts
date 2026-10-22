import type { HouseStyleMade } from "../../house-style/repository.ts";
import type { PublicSnapshotModel } from "../renderer";
import { groupComponentsByHeading } from "../../../shared/component-order";
import { REPORTING_DAYS, escapeHtml } from "../format";
import { componentIcon, stateGlyph } from "./icons";
import { maintenanceEntry, openIncidentEntry, resolvedEntry } from "./history";
import { brand, componentNote, dayBar, feedLinks, quietLine, records, sentenceSize, situation, subscribeForm, toneOf, updatedLine, uptimeCaption, uptimeValue, type Component, type TemplateParts } from "./parts";

/** House style (owner L18, study 12): the business's own object, lit, over one calm sentence of status, in the
 *  account's palette; components with their 90 days on the same stone, then history and subscribing on the paper.
 *  The picture is made once per brand and stored; the page only links it. */
function componentRow(component: Component, heading: "h3" | "h4") {
  // A full 90 days goes unsaid, as study 12 draws it; a shorter record says what it covers (UPTIME-003).
  const caption = uptimeCaption(component.uptime);
  const covered = caption === `${REPORTING_DAYS}-day uptime` ? `<span class="sr-only">${escapeHtml(caption)} </span>` : `<span class="house-caption">${escapeHtml(caption)}</span>`;
  return `<li class="house-row">${componentIcon(component.name)}<div class="house-name"><${heading}>${escapeHtml(component.name)}</${heading}>${componentNote(component)}</div><p class="house-state tone-${toneOf(component.state)}">${stateGlyph(component.state)}<span>${escapeHtml(component.state)}</span></p><p class="house-uptime">${covered}<span class="house-value">${escapeHtml(uptimeValue(component.uptime))}</span></p>${dayBar(component, "house-bar")}</li>`;
}

function components(model: PublicSnapshotModel, parts: TemplateParts) {
  if (!model.visibleComponents.length) return "";
  const named = model.visibleComponents.some((component) => component.groupName !== null);
  const groups = groupComponentsByHeading(model.visibleComponents).map(([heading, list]) => `${named ? `<h3 class="house-group">${escapeHtml(heading)}</h3>` : ""}<ul class="house-list">${list.map((component) => componentRow(component, named ? "h4" : "h3")).join("")}</ul>`).join("");
  return `<section class="house-section house-components" aria-labelledby="components-title"><h2 id="components-title">Components</h2><div class="house-rows" data-live="components">${groups}<div class="component-extension">${parts.slot("status-page.components.after.v1")}</div></div></section>`;
}

function history(model: PublicSnapshotModel, parts: TemplateParts) {
  const shown = records(model);
  const entries = [
    ...shown.open.map((incident) => openIncidentEntry(incident, model, parts)),
    ...shown.maintenance.map((item) => maintenanceEntry(item, model)),
    ...shown.resolved.map((incident) => resolvedEntry(incident, model)),
  ].join("");
  return `<section class="house-section house-history" aria-labelledby="history-title"><h2 id="history-title">History</h2><div class="house-timeline" data-live="history">${entries ? `<ol class="tl-list">${entries}</ol>` : ""}${quietLine(shown, "tpl-quiet")}</div></section>`;
}

function subscribe() {
  return `<section class="house-section house-subscribe" id="subscribe" aria-labelledby="subscribe-title"><h2 id="subscribe-title">Subscribe</h2><div class="house-subscribe-row">${subscribeForm("subscribe-email", "house-form")}${feedLinks()}</div></section>`;
}

/** The object, multiplied onto the stone so its white ground disappears; a hanging one meets the page's own cord. */
function moment(made: HouseStyleMade) {
  const cord = made.subject.placement === "hanging" && made.picture.cordX !== null ? '<span class="house-cord"></span>' : "";
  return `<figure class="house-figure" aria-hidden="true">${cord}<img class="house-picture" src="/assets/moment" alt="" width="${made.picture.width}" height="${made.picture.height}"></figure>`;
}

export function housePage(model: PublicSnapshotModel, parts: TemplateParts) {
  const made = model.house.record?.made;
  if (!made) throw new Error("House style shows only once one is stored.");
  const text = situation(model);
  const head = `<header class="house-head"><div class="house-brand">${brand(model)}</div><nav class="house-nav" aria-label="Status page"><a href="/history">History</a><a class="house-subscribe-link" href="#subscribe">Subscribe</a></nav></header>`;
  const status = `<section class="house-status" aria-labelledby="overall-status"><div class="tpl-live" id="status-live" role="status" aria-live="polite" aria-atomic="true" data-live="status"><h1 id="overall-status" class="house-sentence ${sentenceSize(text)}">${escapeHtml(text)}</h1>${updatedLine(model)}</div></section>`;
  // The light warms to amber whenever the page is not all clear; the page script refreshes it in place.
  const light = `<div class="house-light tone-${toneOf(model.overall)}" data-live="light" aria-hidden="true"></div>`;
  return `${head}${parts.slot("status-page.header.after.v1")}<div class="house-band house-moment" data-moment="${escapeHtml(made.picture.key)}">${light}${moment(made)}${status}${components(model, parts)}</div><div class="house-band house-paper">${history(model, parts)}${subscribe()}</div>`;
}
