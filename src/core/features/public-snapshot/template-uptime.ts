import type { PublicSnapshotModel } from "./renderer";
import { escapeHtml, dayKey, REPORTING_DAYS } from "./format";
import { statePill } from "./record-markup";

export function uptimeHero(model: PublicSnapshotModel) {
  const tracked = model.visibleComponents.filter(component => component.uptime.percentage !== null);
  const minutes = tracked.reduce((sum, component) => sum + component.uptime.coverageMinutes, 0);
  const mean = minutes ? tracked.reduce((sum, component) => sum + Number.parseFloat(component.uptime.percentage!) * component.uptime.coverageMinutes, 0) / minutes : null;
  return `<section class="uptime-hero" aria-labelledby="uptime-hero-title"><p class="eyebrow" id="uptime-hero-title">Overall uptime · last ${REPORTING_DAYS} days</p><p class="uptime-hero-number">${mean === null ? "No data yet" : `${(Math.floor(mean * 100) / 100).toFixed(2)}<span>%</span>`}</p><p>Average component uptime, weighted by observed minutes.${tracked.length < model.visibleComponents.length ? " Components without data are excluded." : ""} <a href="#uptime-method">About this figure</a></p></section>`;
}

export function uptimeHeatmap(model: PublicSnapshotModel) {
  const components = model.visibleComponents;
  if (!components.length) return '<p class="template-empty">Component history will appear when public components are added.</p>';
  const rows = components.map(component => {
    const marks = component.uptime.marks.slice(-REPORTING_DAYS).map(mark => {
      const incident = model.incidents.find(item => item.components.includes(component.name) && dayKey(Math.min(Date.parse(item.openedAt), ...item.updates.map(update => Date.parse(update.publishedAt))), model.settings.timezone) <= mark.day && dayKey(Date.parse(item.resolvedAt ?? model.generatedAt), model.settings.timezone) >= mark.day);
      const state = mark.downtimeMinutes === null ? "No data" : mark.downtimeMinutes > 0 ? `${mark.worstDowntimeState ?? "Downtime"}; ${mark.downtimeMinutes.toFixed(1)} weighted downtime minutes` : "Available";
      const label = `${component.name}, ${mark.day}: ${state}${incident ? `; ${incident.title}` : ""}`;
      const cls = mark.downtimeMinutes === null ? "no-data" : mark.downtimeMinutes > 0 ? `downtime${mark.worstDowntimeState === "Major outage" ? " major-outage" : ""}` : "good";
      const attr = `class="uptime-mark ${cls}${incident ? " incident-day" : ""}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"`;
      return `<span role="listitem">${incident ? `<a ${attr} href="/incidents/${encodeURIComponent(incident.reference)}"></a>` : `<span role="img" ${attr}></span>`}</span>`;
    }).join("");
    const coverage = component.uptime.percentage === null ? "No data" : `${component.uptime.percentage} · ${component.uptime.coverageDays < 1 ? "less than a day" : `${component.uptime.coverageDays} days`} observed`;
    return `<article class="heatmap-row"><div class="component-name"><h3>${escapeHtml(component.name)}</h3>${statePill(component.state)}<span class="heatmap-percentage">${coverage}</span></div>${component.description ? `<details class="component-description"><summary>About ${escapeHtml(component.name)}</summary><p>${escapeHtml(component.description)}</p></details>` : ""}${component.note ? `<p class="component-note">${escapeHtml(component.note)}</p>` : ""}<div class="uptime-marks" role="list" aria-label="90-day history for ${escapeHtml(component.name)}">${marks}</div></article>`;
  }).join("");
  const starts = components.flatMap(component => component.uptime.trackingSince ? [component.uptime.trackingSince] : []).sort();
  return `<section class="component-health heatmap" aria-labelledby="components-title"><header class="section-heading"><h2 id="components-title">90 days of service</h2><a href="/history">Incident history →</a></header><div class="heatmap-dates"><span>${escapeHtml(components[0]!.uptime.marks.slice(-REPORTING_DAYS)[0]?.day ?? "")}</span><span>Today</span></div>${rows}<aside class="availability-legend" aria-label="Availability legend"><span><i class="legend-good"></i>Available</span><span><i class="legend-degraded"></i>Degraded</span><span><i class="legend-downtime"></i>Outage</span><span><i class="legend-no-data"></i>No data</span></aside><p class="heatmap-help">Underlined days link to the incident record.${starts[0] ? ` History since ${escapeHtml(starts[0].slice(0, 10))}.` : ""}</p><details class="availability-method" id="uptime-method"><summary>How availability is calculated</summary><p>Each column is a calendar day in ${escapeHtml(model.settings.timezone)}. Percentages use the existing rolling 90-day window and observed time only. Overall uptime averages component percentages weighted by observed minutes. ${Object.entries({ Operational: 0, "Degraded performance": model.policies.uptimeDowntimeWeight("Degraded performance"), "Partially unavailable": model.policies.uptimeDowntimeWeight("Partially unavailable"), "Major outage": model.policies.uptimeDowntimeWeight("Major outage"), "Under maintenance": model.policies.uptimeDowntimeWeight("Under maintenance") }).map(([state, weight]) => `${state} counts as ${weight} downtime minutes per minute`).join("; ")}.</p></details></section>`;
}
