import type { PublicSnapshotModel } from "./renderer";
import { mostSevereState } from "../../shared/domain";
import { escapeHtml, stateClass } from "./format";
import { templateComponent, templateAvailability } from "./template-component";

// Broad geography only. Unknown labels remain visible and filterable without invented locations.
function position(region: string): [number, number] | null {
  const name = region.toLowerCase().trim();
  if (/^(us|ca)(-|\b)|north america|united states|canada/.test(name)) return [185, 130];
  if (/^sa-|south america|brazil/.test(name)) return [290, 265];
  if (/^eu-|europe|london|frankfurt|ireland/.test(name)) return [470, 105];
  if (/^me-|middle east|bahrain|dubai/.test(name)) return [550, 170];
  if (/^af-|africa|cape town/.test(name)) return [480, 230];
  if (/^ap-|asia|pacific|australia|singapore|tokyo|sydney/.test(name)) return [720, 210];
  return null;
}

// Simplified continental silhouettes, rendered as dots rather than a remote map asset.
const continents = [
  [[70,75],[125,43],[200,45],[230,75],[290,78],[285,120],[240,153],[225,190],[190,180],[170,145],[130,140],[105,110]],
  [[245,205],[280,190],[323,218],[342,250],[320,288],[300,337],[277,310],[268,267]],
  [[310,28],[355,24],[363,60],[336,85],[310,65]],
  [[419,93],[458,65],[495,70],[515,110],[490,130],[454,125],[431,141],[412,119]],
  [[425,154],[475,138],[516,161],[540,210],[510,239],[490,286],[461,275],[450,236],[418,197]],
  [[507,72],[554,43],[634,45],[705,56],[777,85],[800,123],[775,157],[728,155],[712,194],[686,217],[670,183],[643,170],[612,210],[586,164],[548,142],[510,125]],
  [[698,274],[736,252],[785,263],[808,298],[775,320],[722,318]],
  [[823,312],[835,299],[843,316],[830,330]],
];
function inside(x: number, y: number, polygon: number[][]) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!; const [xj, yj] = polygon[j]!;
    if ((yi! > y) !== (yj! > y) && x < (xj! - xi!) * (y - yi!) / (yj! - yi!) + xi!) hit = !hit;
  }
  return hit;
}
function worldDots() {
  let dots = "";
  for (let y = 25; y < 340; y += 8) for (let x = 65; x < 850; x += 8) {
    if (continents.some(polygon => inside(x, y, polygon))) dots += `<circle cx="${x}" cy="${y}" r="1.6"/>`;
  }
  return dots;
}
const dots = worldDots();

export function regionsMarkup(model: PublicSnapshotModel) {
  const grouped = new Map<string, PublicSnapshotModel["visibleComponents"]>();
  for (const component of model.visibleComponents) {
    const region = component.region?.trim() || "No region assigned";
    grouped.set(region, [...(grouped.get(region) ?? []), component]);
  }
  const regions = [...grouped.entries()];
  const placed = regions.flatMap(([name, components], index) => {
    const point = name === "No region assigned" ? null : position(name);
    return point ? [{ name, components, index, point }] : [];
  });
  const hasRegions = regions.some(([name]) => name !== "No region assigned");
  const unmapped = regions.filter(([name]) => name !== "No region assigned" && !position(name)).map(([name]) => name);
  // Separate overlapping labels within a broad region; no implied finer location.
  const markers = placed.map(({ name, components, index, point: [x,y] }, order) => {
    const sameArea = placed.slice(0, order).filter(marker => marker.point[0] === x).length;
    const offset = sameArea * 24;
    const state = mostSevereState(components.map(component => component.state));
    return `<a href="#region-${index}" data-region-choice="${index}" class="map-marker ${stateClass(state)}" aria-label="${escapeHtml(`${name}: ${state}, ${components.length} components`)}"><title>${escapeHtml(`${name} · ${state}`)}</title><circle cx="${x}" cy="${y + offset}" r="12"/><circle class="map-marker-core" cx="${x}" cy="${y + offset}" r="5"/><text x="${x + 18}" y="${y + offset + 5}">${escapeHtml(name)}</text></a>`;
  }).join("");
  const map = hasRegions ? `<section class="regions-map" aria-labelledby="regions-map-title"><header class="section-heading"><h2 id="regions-map-title">Service around the world</h2><p>${regions.filter(([name]) => name !== "No region assigned").length} regions</p></header><svg viewBox="0 0 900 360" role="group" aria-label="World map. Choose a region to filter components."><g class="world-dots" aria-hidden="true">${dots}</g>${markers}</svg><p class="map-caption">Markers show broad regions, not exact server locations.${unmapped.length ? ` No map position for ${unmapped.map(escapeHtml).join(", ")}; use the region filters below.` : ""}</p></section>` : '<p class="template-empty" role="status">Regions map is unavailable because no visible component has a region. Components are listed below.</p>';
  const filters = hasRegions ? `<nav class="region-filters" aria-label="Filter components by region"><a href="#components-title" data-region-choice="all" aria-current="true">All regions</a>${regions.map(([name, values], index) => `<a href="#region-${index}" data-region-choice="${index}">${escapeHtml(name)} <span>${values.length}</span></a>`).join("")}</nav>` : "";
  const lists = regions.map(([name, components], index) => `<section id="region-${index}" class="region-section" data-region-section="${index}" aria-label="${escapeHtml(name)}"><p class="region-heading">${escapeHtml(name)}</p>${components.map(component => templateComponent(component, model)).join("")}</section>`).join("");
  return `${map}<section class="component-health region-health" aria-labelledby="components-title"><header class="section-heading"><h2 id="components-title">Components by region</h2><p data-region-count aria-live="polite">${model.visibleComponents.length} components across all regions</p></header>${filters}${lists || '<p>No public components yet.</p>'}${model.visibleComponents.length ? templateAvailability(model) : ""}</section>`;
}
