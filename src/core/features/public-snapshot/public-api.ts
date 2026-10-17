import { mostSevereState, type ComponentState } from "../../shared/domain";
import type { PublicSnapshotSource } from "./repository";
import type { PublicSnapshotModel, SnapshotArtifact } from "./renderer";
import { componentSlug } from "./component-address";
import { updateText } from "./feed-widget";
import { nativeCollectionArtifacts } from "./native-api";

export const statuspageStates: Record<ComponentState, string> = {
  Operational: "operational", "Degraded performance": "degraded_performance", "Partially unavailable": "partial_outage", "Major outage": "major_outage", "Under maintenance": "under_maintenance",
};
const impacts: Record<ComponentState, string> = { Operational: "none", "Degraded performance": "minor", "Partially unavailable": "major", "Major outage": "critical", "Under maintenance": "maintenance" };
const maintenanceStatuses: Record<string, string> = { Scheduled: "scheduled", "In progress": "in_progress", Verifying: "verifying", Completed: "completed", Cancelled: "completed" };
const noticeStatuses: Record<string, string> = { scheduled: "scheduled", rescheduled: "scheduled", reminder: "scheduled", started: "in_progress", verifying: "verifying", completed: "completed", cancelled: "completed" };

// This is a public identifier, not a credential. A fixed 62-bit namespace keeps
// native IDs stable in Statuspage's twelve-character lowercase vocabulary.
function nativePublicId(value: string) {
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(value)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return (hash % (36n ** 12n)).toString(36).padStart(12, "0");
}

export function renderPublicApi(model: PublicSnapshotModel, source: PublicSnapshotSource): SnapshotArtifact[] {
  const id = (native: string) => source.publicApiIds?.[native] ?? nativePublicId(`lamp-public:${native}`);
  const page = { id: id(model.settings.feedId), name: model.settings.pageName, url: model.origin, time_zone: model.settings.timezone, updated_at: model.generatedAt };
  const status = { indicator: impacts[model.overall], description: model.overall === "Operational" ? "All Systems Operational" : model.overall };
  const components = model.visibleComponents.map(component => {
    const stored = source.components.find(row => row.id === component.id)!;
    return { id: id(component.id), name: component.name, description: component.description || null, status: statuspageStates[component.state], position: component.displayOrder, group_id: stored.groupId ? id(stored.groupId) : null, group: false, only_show_if_degraded: stored.onlyShowIfDegraded, page_id: page.id, created_at: stored.createdAt, updated_at: stored.updatedAt };
  });
  const groups = [...new Set(source.components.map(component => component.groupId).filter((group): group is string => group !== null))].map(groupId => {
    const members = model.visibleComponents.filter(component => source.components.find(row => row.id === component.id)?.groupId === groupId);
    const stored = source.components.find(row => row.groupId === groupId)!;
    return { id: id(groupId), name: stored.groupName, description: null, status: statuspageStates[mostSevereState(members.map(component => component.state))], position: stored.groupOrder, group_id: null, group: true, components: members.map(component => id(component.id)), only_show_if_degraded: false, page_id: page.id, created_at: stored.groupCreatedAt, updated_at: stored.groupUpdatedAt };
  }).filter(group => group.components.length > 0);
  const publicComponents = [...components, ...groups].sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  const componentIds = new Set(model.visibleComponents.map(component => component.id));
  const incidentComponents = (incidentId: string) => source.incidentComponents.filter(row => row.incidentId === incidentId && row.componentId && componentIds.has(row.componentId)).flatMap(row => {
    const component = components.find(component => component.id === id(row.componentId!));
    return component ? [component] : [];
  });
  const incidents = model.incidents.map(incident => {
    const stored = source.incidents.find(row => row.id === incident.id)!;
    return { id: id(incident.id), page_id: page.id, name: incident.title, status: incident.lifecycle.toLowerCase(), impact: incident.effectiveImpact, postmortem_body: incident.report ? [incident.report.summary, incident.report.timeline, incident.report.cause, incident.report.remediation].filter(Boolean).join("\n\n") : null, postmortem_published_at: incident.report?.publishedAt ?? null, shortlink: `${page.url}/incidents/${incident.reference}`, created_at: incident.openedAt, updated_at: incident.updates[0]?.publishedAt ?? stored.updatedAt, started_at: incident.openedAt, resolved_at: incident.resolvedAt, reminder_intervals: null, monitoring_at: incident.updates.find(update => update.lifecycle === "Monitoring")?.publishedAt ?? null, components: incidentComponents(incident.id), incident_updates: incident.updates.map(update => ({ id: id(update.id), incident_id: id(incident.id), body: updateText(incident, update, model.settings.timezone), status: update.lifecycle.toLowerCase(), created_at: update.publishedAt, updated_at: update.publishedAt, display_at: update.publishedAt, deliver_notifications: null, custom_tweet: null, tweet_id: null, affected_components: (update.componentChanges ?? []).filter(change => change.componentId && componentIds.has(change.componentId)).map(change => ({ code: id(change.componentId!), name: change.name, old_status: statuspageStates[change.previousState], new_status: statuspageStates[change.newState] })) })) };
  });
  const maintenance = model.maintenance.map(item => ({
    id: id(item.id), page_id: page.id, name: item.title, status: maintenanceStatuses[item.state], impact: "maintenance", shortlink: `${page.url}/maintenance/${item.reference}`, created_at: source.maintenance.find(row => row.id === item.id)!.createdAt, updated_at: item.notices[0]?.publishedAt ?? source.maintenance.find(row => row.id === item.id)!.updatedAt, resolved_at: item.completedAt, monitoring_at: null, started_at: item.startsAt, scheduled_for: item.startsAt, scheduled_until: item.endsAt, scheduled_auto_in_progress: item.autoStart ?? true, scheduled_auto_completed: item.autoComplete ?? true,
    components: source.maintenanceComponents.filter(row => row.maintenanceId === item.id && row.componentId && componentIds.has(row.componentId)).flatMap(row => components.filter(component => component.id === id(row.componentId!))),
    incident_updates: [...item.notices.map(notice => ({ id: id(notice.id), incident_id: id(item.id), body: notice.body, status: notice.snapshotJson ? maintenanceStatuses[(JSON.parse(notice.snapshotJson) as {state:string}).state] : noticeStatuses[notice.kind], created_at: notice.publishedAt, updated_at: notice.publishedAt, display_at: notice.publishedAt, corrects_update_id:notice.correctsNoticeId ? id(notice.correctsNoticeId) : null, affected_components: [], deliver_notifications: null, custom_tweet: null, tweet_id: null })), ...(item.importedUpdates ?? []).map(update=>({id:id(update.id),incident_id:id(item.id),body:update.body,status:update.sourceStatus ?? null,created_at:update.publishedAt,updated_at:update.publishedAt,display_at:update.publishedAt,affected_components:[],deliver_notifications:null,custom_tweet:null,tweet_id:null}))].sort((a, b) => b.created_at.localeCompare(a.created_at)),
  }));
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
    ...nativeCollectionArtifacts("maintenance", model.maintenance.map(item => ({ id: item.id, reference: item.reference, title: item.title, state: item.state, startsAt: item.startsAt, endsAt: item.endsAt, completedAt: item.completedAt, affectedAudience:item.affectedAudience,customerImpact:item.customerImpact,whatStillWorks:item.whatStillWorks,details:item.details,autoStart:item.autoStart,autoComplete:item.autoComplete,calendarSequence:item.calendarSequence,components: item.components, notices: item.notices, importedUpdates: item.importedUpdates })), model.generatedAt),
  ];
  return artifacts;
}
