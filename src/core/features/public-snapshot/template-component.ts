import type { PublicSnapshotModel } from "./renderer";
import { escapeHtml, REPORTING_DAYS, timestamp } from "./format";
import { COMPONENT_STATES } from "../../shared/domain";
import { statePill } from "./record-markup";
import { uptimeMarkup } from "./uptime";
type Component = PublicSnapshotModel["visibleComponents"][number];

export function templateComponent(component: Component, model: PublicSnapshotModel, history = true) {
  return `<article class="component"><div class="component-name"><h3>${escapeHtml(component.name)}</h3>${statePill(component.state, "component-state")}${component.description ? `<details class="component-description"><summary>About ${escapeHtml(component.name)}</summary><p>${escapeHtml(component.description)}</p></details>` : ""}${component.note ? `<p class="component-note">${escapeHtml(component.note)}</p>` : ""}</div>${history ? `<div class="component-status">${uptimeMarkup(component, model.settings.timezone, model.generatedAt)}</div>` : ""}</article>`;
}

export function templateAvailability(model: PublicSnapshotModel) {
  const starts = model.visibleComponents.flatMap(component => component.uptime.trackingSince ? [component.uptime.trackingSince] : []).sort();
  return `${starts[0] ? `<p class="availability-since">History since ${timestamp(starts[0], model.settings.timezone)}.</p>` : ""}<div class="availability-foot"><aside class="availability-legend" aria-label="Availability legend"><span><i class="legend-good"></i>Available</span><span><i class="legend-degraded"></i>Degraded</span><span><i class="legend-downtime"></i>Downtime</span><span><i class="legend-no-data"></i>No data</span></aside><details class="availability-method"><summary>How availability is calculated</summary><p>Availability days use ${escapeHtml(model.settings.timezone)}. Uptime uses a ${REPORTING_DAYS}-day window. ${COMPONENT_STATES.map(state => `${state} counts as ${model.policies.uptimeDowntimeWeight(state)} downtime minutes per minute`).join("; ")}.</p></details></div>`;
}
