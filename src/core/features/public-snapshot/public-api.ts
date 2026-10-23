import type { PublicSnapshotSource } from "./repository";
import type { PublicSnapshotModel, SnapshotArtifact } from "./renderer";
import { componentSlug } from "./component-address";
import { nativeCollectionArtifacts } from "./native-api";
import { projectStatuspageRecords } from "../../shared/statuspage-records";
export { statuspageStates } from "../../shared/statuspage-mapping";

export function renderPublicApi(model: PublicSnapshotModel, source: PublicSnapshotSource): SnapshotArtifact[] {
  const {page,status,components:publicComponents,incidents,maintenance}=projectStatuspageRecords(model,source);
  const active = maintenance.filter(item => item.status === "in_progress" || item.status === "verifying");
  const upcoming = maintenance.filter(item => item.status === "scheduled");
  const unresolved = incidents.filter(item => item.status !== "resolved");
  const json = (key: string, body: unknown): SnapshotArtifact => ({ key, body: JSON.stringify(body), contentType: "application/json; charset=utf-8" });
  const artifacts = [
    json("api/v2/summary.json", { page, status, components: publicComponents, incidents: unresolved, scheduled_maintenances: [...active, ...upcoming] }),
    json("api/v2/status.json", { page, status }), json("api/v2/components.json", { page, components: publicComponents }),
    json("api/v2/incidents.json", { page, incidents }), json("api/v2/incidents/unresolved.json", { page, incidents: unresolved }),
    json("api/v2/incidents/resolved.json", { page, incidents: incidents.filter(item => item.status === "resolved") }),
    json("api/v2/scheduled-maintenances.json", { page, scheduled_maintenances: maintenance }),
    json("api/v2/scheduled-maintenances/upcoming.json", { page, scheduled_maintenances: upcoming }),
    json("api/v2/scheduled-maintenances/active.json", { page, scheduled_maintenances: active }),
    json("api/public/v1/summary.json", { generatedAt: model.generatedAt, page: { name: page.name, hostname: model.settings.hostname, timezone: model.settings.timezone }, overall: model.overall, collections: ["components", "incidents", "maintenance"].map(name => `/api/public/v1/${name}`) }),
    ...nativeCollectionArtifacts("components", model.visibleComponents.map(component => ({ id: component.id, slug: componentSlug(component), name: component.name, description: component.description, onlyShowIfDegraded: component.onlyShowIfDegraded, uptimeStartDate: component.uptimeStartDate, note: component.note, state: component.state, uptime: component.uptime })), model.generatedAt),
    ...nativeCollectionArtifacts("incidents", model.incidents.map(incident => ({ id: incident.id, reference: incident.reference, title: incident.title, lifecycle: incident.lifecycle, impact: incident.effectiveImpact, derivedImpact: incident.derivedImpact, impactOverride: incident.impactOverride, effectiveImpact: incident.effectiveImpact, openedAt: incident.openedAt, resolvedAt: incident.resolvedAt, components: incident.components, updates: incident.updates.map(update => ({ id: update.id, lifecycle: update.lifecycle, affectedAudience: update.affectedAudience, customerImpact: update.customerImpact, whatStillWorks: update.whatStillWorks, details: update.details, nextUpdateAt: update.lifecycle === "Resolved" ? null : update.nextUpdateAt, publishedAt: update.publishedAt, componentChanges: (update.componentChanges ?? []).map(({ componentId, name, previousState, newState }) => ({ componentId, name, previousState, newState })) })), report: incident.report })), model.generatedAt),
    ...nativeCollectionArtifacts("maintenance", model.maintenance.map(item => ({ id: item.id, reference: item.reference, title: item.title, state: item.state, startsAt: item.startsAt, endsAt: item.endsAt, completedAt: item.completedAt, components: item.components, notices: item.notices, importedUpdates: item.importedUpdates })), model.generatedAt),
  ];
  return artifacts;
}
