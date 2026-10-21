import type { PublicSnapshotModel } from "../renderer";
import { mostSevereState, type ComponentState } from "../../../shared/domain";
import { publicComponentOrder } from "../../../shared/component-order";
import { regionKey } from "../../../shared/regions";
import { escapeHtml } from "../format";
import { componentIcon, lineIcon, pinIcon, stateGlyph } from "./icons";
import { maintenanceEntry, openIncidentEntry, resolvedEntry } from "./history";
import { MAP_TIERS, layoutTier, type MapMarker } from "./map-layout";
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

/** The marker anchors for every width tier, as stylesheet rules: public pages allow no inline styles (PAGE-013). */
export function regionsMapStyles(model: PublicSnapshotModel) {
  const markers = mapMarkers(regionGroups(model.visibleComponents));
  return MAP_TIERS.map((tier) => {
    const placed = layoutTier(markers, tier);
    const rules = placed.anchors.map((anchor, index) => `.rg-map .m${index}{left:${anchor.x.toFixed(2)}%;top:${anchor.y.toFixed(2)}%}`).join("");
    return tier.name === "large" ? rules : `@media (max-width:${tier.name === "medium" ? 1099 : 640}px){${rules}}`;
  }).join("");
}

function regionsMap(groups: RegionGroup[]) {
  const markers = mapMarkers(groups);
  const tiers = MAP_TIERS.map((tier) => layoutTier(markers, tier));
  const keyed = tiers.filter((tier) => tier.keyed).map((tier) => ` keyed-${tier.tier.name}`).join("");
  const pins = markers.map((marker, index) => `<span class="rg-pin m${index} tone-${toneOf(marker.state as ComponentState)}" aria-hidden="true">${pinIcon()}<b>${index + 1}</b></span>`).join("");
  const label = (marker: (typeof markers)[number], className: string, number = "") => `<a class="${className}" href="#components-title" data-region-choice="${marker.group.key}">${number}<strong>${escapeHtml(marker.name)}</strong> <span class="rg-card-state tone-${toneOf(marker.state as ComponentState)}">${escapeHtml(marker.state)}</span><span class="sr-only">, ${plural(marker.group.components.length, "component")}</span></a>`;
  const cards = markers.map((marker, index) => label(marker, `rg-card m${index} ${tiers.map((tier) => `p${tier.tier.name[0]}-${tier.placements[index]}`).join(" ")}`)).join("");
  const key = keyed ? `<ol class="rg-key">${markers.map((marker, index) => `<li>${label(marker, "rg-key-item", `<b aria-hidden="true">${index + 1}</b>`)}</li>`).join("")}</ol>` : "";
  const unmapped = groups.filter((group) => !group.place);
  const elsewhere = unmapped.length ? `<p class="rg-elsewhere">Not on the map: ${unmapped.map((group) => `<span>${escapeHtml(group.name)} <span class="rg-card-state tone-${toneOf(group.state)}">${escapeHtml(group.state)}</span></span>`).join("")}</p>` : "";
  const signature = markers.map((marker) => `${marker.group.key}:${tiers.map((tier) => tier.placements[markers.indexOf(marker)]).join("")}`).join("|");
  const world = (view: "wide" | "narrow") => `<svg class="rg-world rg-world-${view}" viewBox="0 0 ${MAP_WIDTH} ${mapHeight(view).toFixed(2)}" aria-hidden="true" focusable="false"><path d="${worldDots(view)}"/></svg>`;
  return `<div class="rg-map${keyed}" data-map="${escapeHtml(signature)}">${world("wide")}${world("narrow")}${pins}${cards}</div>${key}${elsewhere}`;
}

function filters(groups: RegionGroup[]) {
  return `<nav class="rg-filters" aria-label="Filter components by region"><a href="#components-title" data-region-choice="all" aria-current="true">All regions</a>${groups.map((group) => `<a href="#components-title" data-region-choice="${group.key}">${escapeHtml(group.name)}</a>`).join("")}</nav>`;
}

function componentRow(component: Component, groups: RegionGroup[]) {
  const key = regionKey(component.region);
  const region = groups.find((group) => group.key === key);
  const tone = toneOf(component.state);
  return `<details class="rg-row" data-region="${key}"><summary>${componentIcon(component.name)}<span class="rg-name"><span class="rg-name-text">${escapeHtml(component.name)}</span>${region ? "" : '<span class="rg-everywhere">All regions</span>'}</span><span class="rg-status tone-${tone}">${stateGlyph(component.state)}<span>${escapeHtml(component.state)}</span></span><span class="rg-uptime">${escapeHtml(uptimeValue(component.uptime))}</span>${lineIcon("chevron", "rg-chevron")}</summary><div class="rg-detail">${region ? `<p class="tpl-meta">Region: ${escapeHtml(region.name)}</p>` : ""}<p class="tpl-meta">${escapeHtml(uptimeCaption(component.uptime))}: ${escapeHtml(uptimeValue(component.uptime))}</p>${dayBar(component, "rg-bar")}${componentNote(component)}</div></details>`;
}

export function regionsPage(model: PublicSnapshotModel, parts: TemplateParts) {
  const groups = regionGroups(model.visibleComponents);
  const history = records(model);
  const text = situation(model);
  const components = publicComponentOrder(model.visibleComponents);
  const head = `<header class="rg-head wrap"><div class="rg-head-row"><div class="rg-brand">${brand(model)}${tagline(model)}</div><div class="rg-actions">${subscribeForm("subscribe-email")}${feedLinks()}</div></div></header>`;
  const status = `<section class="rg-status-line wrap" aria-labelledby="overall-status"><div class="tpl-live tone-${toneOf(model.overall)}" id="status-live" role="status" aria-live="polite" aria-atomic="true" data-live="status"><span class="rg-status-icon">${stateGlyph(model.overall)}</span><div><h1 id="overall-status">${escapeHtml(text)}</h1>${updatedLine(model)}</div></div></section>`;
  const map = `<section class="rg-regions wrap" aria-labelledby="regions-title"><h2 id="regions-title" class="sr-only">Regions</h2>${regionsMap(groups)}${filters(groups)}</section>`;
  const current = [...history.open.map((incident) => openIncidentEntry(incident, model, parts)), ...history.maintenance.map((item) => maintenanceEntry(item, model))].join("");
  const past = history.resolved.map((incident) => resolvedEntry(incident, model)).join("");
  const table = `<section class="rg-components" aria-labelledby="components-title" data-live="components"><h2 id="components-title">Components</h2><p class="sr-only" data-region-count aria-live="polite">Showing all ${plural(components.length, "component")}</p><div class="rg-thead" aria-hidden="true"><span>Component</span><span>Status</span><span>90-day uptime</span></div><div class="rg-rows">${components.map((component) => componentRow(component, groups)).join("")}</div><div class="component-extension">${parts.slot("status-page.components.after.v1")}</div></section>`;
  const lower = `<div class="rg-lower wrap"><section class="rg-current" aria-labelledby="history-title" data-live="current"><h2 id="history-title">History</h2>${current ? `<ol class="tl-list">${current}</ol>` : ""}</section>${table}<section class="rg-past" aria-labelledby="past-title" data-live="past"><h2 id="past-title" class="sr-only">Resolved incidents</h2>${past ? `<ol class="tl-list">${past}</ol>` : ""}${quietLine(history, "tpl-quiet")}</section></div>`;
  return `${head}${parts.slot("status-page.header.after.v1")}${status}${map}${lower}`;
}
