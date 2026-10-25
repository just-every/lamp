import type { PublicSnapshotModel } from "../renderer";
import { mostSevereState, type ComponentState } from "../../../shared/domain";
import { publicComponentOrder } from "../../../shared/component-order";
import { regionKey } from "../../../shared/regions";
import { escapeHtml } from "../format";
import { componentIcon, lineIcon, pinIcon, stateGlyph } from "./icons";
import { maintenanceEntry, openIncidentEntry, resolvedEntry } from "./history";
import { mapPlan, planStyles, type MapMarker } from "./map-layout";
import { regionPlace } from "./places";
import { MAP_WIDTH, mapHeight, worldDots } from "./world";
import { brand, componentNote, dayBar, feedLinks, quietLine, records, situation, subscribeForm, tagline, toneOf, updatedLine, uptimeCaption, uptimeValue, type Component, type TemplateParts } from "./parts";

export interface RegionGroup { key: string; name: string; components: Component[]; state: ComponentState; place: readonly [number, number] | null }

/** Visible components by region, in the page's component order; components without a region belong to none. */
export function regionGroups(components: Component[]): RegionGroup[] {
  const groups = new Map<string, { name: string; components: Component[] }>();
  for (const component of publicComponentOrder(components)) {
    const key = regionKey(component.region);
    if (!key) continue;
    const group = groups.get(key) ?? { name: component.region!.trim(), components: [] };
    group.components.push(component);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group, state: mostSevereState(group.components.map((component) => component.state)), place: regionPlace(group.name) }));
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function mapMarkers(groups: RegionGroup[]): Array<MapMarker & { group: RegionGroup }> {
  return groups.flatMap((group) => group.place ? [{ group, name: group.name, state: group.state, place: group.place }] : []).sort((left, right) => left.place[1] - right.place[1]);
}

// FNV-1a: a short fingerprint of the map, so an open page knows when a newer snapshot moved or relabelled it.
function fingerprint(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(36);
}

const maps = new WeakMap<PublicSnapshotModel, ReturnType<typeof regionsMapOf>>();

function regionsMapOf(model: PublicSnapshotModel) {
  const groups = regionGroups(model.visibleComponents);
  const markers = mapMarkers(groups);
  const bands = mapPlan(markers);
  const styles = planStyles(markers, bands);
  // Every region with its state and size, mapped or not, and the layout: the map section is not refreshed in place.
  const regions = groups.map((group) => `${group.key}:${group.state}:${group.components.length}`).join("|");
  return { groups, markers, keyed: bands.some((band) => band.keyed), styles, signature: fingerprint(`${regions}#${styles}`) };
}

/** One layout of the map per snapshot, shared by the page and its stylesheet. */
function regionsMapFor(model: PublicSnapshotModel) {
  let found = maps.get(model);
  if (!found) maps.set(model, found = regionsMapOf(model));
  return found;
}

/** The map's pin and card positions for every width of its section, as stylesheet rules: public pages allow no
 *  inline styles (PAGE-013). */
export function regionsMapStyles(model: PublicSnapshotModel) {
  return regionsMapFor(model).styles;
}

function regionsMap(model: PublicSnapshotModel) {
  const { groups, markers, keyed, signature } = regionsMapFor(model);
  const pins = markers.map((marker, index) => `<span class="rg-pin m${index} tone-${toneOf(marker.group.state)}" aria-hidden="true">${pinIcon()}<b>${index + 1}</b></span>`).join("");
  const label = (marker: (typeof markers)[number], className: string, number = "") => `<a class="${className}" href="#components-title" data-region-choice="${marker.group.key}">${number}<strong>${escapeHtml(marker.name)}</strong> <span class="rg-card-state tone-${toneOf(marker.group.state)}">${escapeHtml(marker.state)}</span><span class="sr-only">, ${plural(marker.group.components.length, "component")}</span></a>`;
  const cards = markers.map((marker, index) => label(marker, `rg-card m${index}`)).join("");
  const key = keyed ? `<ol class="rg-key">${markers.map((marker, index) => `<li>${label(marker, `rg-key-item tone-${toneOf(marker.group.state)}`, `<b aria-hidden="true">${index + 1}</b>`)}</li>`).join("")}</ol>` : "";
  const unmapped = groups.filter((group) => !group.place);
  const elsewhere = unmapped.length ? `<p class="rg-elsewhere">Not on the map: ${unmapped.map((group) => `<span>${escapeHtml(group.name)} <span class="rg-card-state tone-${toneOf(group.state)}">${escapeHtml(group.state)}</span></span>`).join("")}</p>` : "";
  const world = (view: "wide" | "narrow") => `<svg class="rg-world rg-world-${view}" viewBox="0 0 ${MAP_WIDTH} ${mapHeight(view).toFixed(2)}" aria-hidden="true" focusable="false"><path d="${worldDots(view)}"/></svg>`;
  return `<div class="rg-map" data-map="${signature}">${world("wide")}${world("narrow")}${pins}${cards}</div>${key}${elsewhere}`;
}

function filters(groups: RegionGroup[]) {
  return `<nav class="rg-filters" aria-label="Filter components by region"><a href="#components-title" data-region-choice="all" aria-current="true">All regions</a>${groups.map((group) => `<a href="#components-title" data-region-choice="${group.key}">${escapeHtml(group.name)}</a>`).join("")}</nav>`;
}

function componentRow(component: Component, groups: RegionGroup[]) {
  const key = regionKey(component.region);
  const region = groups.find((group) => group.key === key);
  const tone = toneOf(component.state);
  return `<details class="rg-row" data-region="${key}"><summary>${componentIcon(component.name)}<span class="rg-name"><span class="rg-name-text">${escapeHtml(component.name)}</span>${region ? "" : '<span class="rg-everywhere">All regions</span>'}</span><span class="rg-status tone-${tone}">${stateGlyph(component.state)}<span>${escapeHtml(component.state)}</span></span><span class="rg-uptime"><span>${escapeHtml(uptimeValue(component.uptime))}</span><span class="rg-uptime-caption">${escapeHtml(uptimeCaption(component.uptime))}</span></span>${lineIcon("chevron", "rg-chevron")}</summary><div class="rg-detail">${region ? `<p class="tpl-meta">Region: ${escapeHtml(region.name)}</p>` : ""}<p class="tpl-meta">${escapeHtml(uptimeCaption(component.uptime))}: ${escapeHtml(uptimeValue(component.uptime))}</p>${dayBar(component, "rg-bar")}${componentNote(component)}</div></details>`;
}

export function regionsPage(model: PublicSnapshotModel, parts: TemplateParts) {
  const groups = regionGroups(model.visibleComponents);
  const history = records(model);
  const text = situation(model);
  const components = publicComponentOrder(model.visibleComponents);
  const head = `<header class="rg-head wrap"><div class="rg-head-row"><div class="rg-brand">${brand(model)}${tagline(model)}</div><div class="rg-actions">${subscribeForm("subscribe-email")}${feedLinks()}</div></div></header>`;
  const status = `<section class="rg-status-line wrap" aria-labelledby="overall-status"><div class="tpl-live"><span class="rg-status-icon tone-${toneOf(model.overall)}" data-live="status-icon">${stateGlyph(model.overall)}</span><div><div id="status-live" role="status" aria-live="polite" aria-atomic="true" data-live="status"><h1 id="overall-status">${escapeHtml(text)}</h1><span class="sr-only">${escapeHtml(model.overall)}</span></div>${updatedLine(model)}</div></div></section>`;
  const map = `<section class="rg-regions wrap" aria-labelledby="regions-title"><h2 id="regions-title" class="sr-only">Regions</h2>${regionsMap(model)}${filters(groups)}</section>`;
  const current = [...history.open.map((incident) => openIncidentEntry(incident, model, parts)), ...history.maintenance.map((item) => maintenanceEntry(item, model))].join("");
  const past = history.resolved.map((incident) => resolvedEntry(incident, model)).join("");
  const table = `<section class="rg-components" aria-labelledby="components-title" data-live="components"><h2 id="components-title">Components</h2><p class="sr-only" data-region-count aria-live="polite">Showing all ${plural(components.length, "component")}</p><div class="rg-thead" aria-hidden="true"><span>Component</span><span>Status</span><span>90-day uptime</span></div><div class="rg-rows">${components.map((component) => componentRow(component, groups)).join("")}</div><div class="component-extension">${parts.slot("status-page.components.after.v1")}</div></section>`;
  const lower = `<div class="rg-lower wrap"><section class="rg-current" aria-labelledby="history-title" data-live="current"><h2 id="history-title">History</h2>${current ? `<ol class="tl-list">${current}</ol>` : ""}</section>${table}<section class="rg-past" aria-labelledby="past-title" data-live="past"><h2 id="past-title" class="sr-only">Resolved incidents</h2>${past ? `<ol class="tl-list">${past}</ol>` : ""}${quietLine(history, "tpl-quiet")}</section></div>`;
  return `${head}${parts.slot("status-page.header.after.v1")}${status}${map}${lower}`;
}
