import type { PublicSnapshotModel } from "./renderer";
import { escapeHtml, stateClass, timestamp } from "./format";
import { templateComponent, templateAvailability } from "./template-component";
import { regionsMarkup } from "./template-regions";
import { uptimeHeatmap } from "./template-uptime";

export function templateStatus(model: PublicSnapshotModel, newest: string | null) {
  const { overall, settings, generatedAt } = model;
  const sentence = overall === "Operational" ? "All systems operational." : overall === "Major outage" ? "Some systems are unavailable." : overall === "Under maintenance" ? "Maintenance is in progress." : "Some systems are experiencing issues.";
  return `<section class="status-banner ${stateClass(overall)}" aria-labelledby="overall-status"><div id="status-live" role="status" aria-live="polite" aria-atomic="true"><p class="template-status-label"><span class="template-status-dot" aria-hidden="true"></span><span data-state-label>${escapeHtml(overall)}</span></p><h1 id="overall-status" data-overall data-headline>${sentence}</h1>${newest ? `<p class="status-live-update" data-newest-update>${escapeHtml(newest)}</p>` : '<p class="status-live-update" data-newest-update>There are no open incidents.</p>'}<p class="status-generated" data-generated-at>Updated ${timestamp(generatedAt, settings.timezone)}.</p></div></section>`;
}

export function templateComponents(model: PublicSnapshotModel) {
  if (model.settings.template === "uptime") return uptimeHeatmap(model);
  if (model.settings.template === "regions") return regionsMarkup(model);
  if (!model.visibleComponents.length) return "";
  return `<section class="component-health" aria-labelledby="components-title"><header class="section-heading"><h2 id="components-title">Components</h2><p>Uptime over the last 90 days</p></header><div class="template-component-list">${model.visibleComponents.map(component => templateComponent(component, model)).join("")}</div>${templateAvailability(model)}<p class="template-history-link"><a href="/history">Explore incident history →</a></p></section>`;
}
