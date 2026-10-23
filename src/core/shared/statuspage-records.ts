import { mostSevereState } from "./domain";
import { statuspageStates, statuspageImpacts, statuspageMaintenanceStatuses, statuspageNoticeStatuses, statuspagePublicId } from "./statuspage-mapping";
import type { PublicSnapshotModel } from "../features/public-snapshot/renderer";
import type { PublicSnapshotSource } from "../features/public-snapshot/repository";
import { updateText } from "../features/public-snapshot/feed-widget";

type Component = Pick<PublicSnapshotModel["visibleComponents"][number],"id"|"name"|"description"|"state"|"displayOrder">;
export type StatuspageProjectionModel=Pick<PublicSnapshotModel,"settings"|"origin"|"generatedAt"|"overall"|"incidents"|"maintenance"> & {visibleComponents:Component[]};

/** PAGE-016 and subscriber webhooks project the very same public records. */
export function projectStatuspageRecords(model:StatuspageProjectionModel,source:PublicSnapshotSource) {
  const id = (native: string) => statuspagePublicId(native,source.publicApiIds);
  const page = { id: id(model.settings.feedId), name: model.settings.pageName, url: model.origin, time_zone: model.settings.timezone, updated_at: model.generatedAt };
  const status = { indicator: statuspageImpacts[model.overall], description: model.overall === "Operational" ? "All Systems Operational" : model.overall };
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
    id: id(item.id), page_id: page.id, name: item.title, status: statuspageMaintenanceStatuses[item.state], impact: "maintenance", shortlink: `${page.url}/maintenance/${item.reference}`, created_at: source.maintenance.find(row => row.id === item.id)!.createdAt, updated_at: item.notices[0]?.publishedAt ?? source.maintenance.find(row => row.id === item.id)!.updatedAt, resolved_at: item.completedAt, monitoring_at: null, started_at: item.startsAt, scheduled_for: item.startsAt, scheduled_until: item.endsAt, scheduled_auto_in_progress: true, scheduled_auto_completed: true,
    components: source.maintenanceComponents.filter(row => row.maintenanceId === item.id && row.componentId && componentIds.has(row.componentId)).flatMap(row => components.filter(component => component.id === id(row.componentId!))),
    incident_updates: [...item.notices.map(notice => ({ id: id(notice.id), incident_id: id(item.id), body: notice.body, status: statuspageNoticeStatuses[notice.kind], created_at: notice.publishedAt, updated_at: notice.publishedAt, display_at: notice.publishedAt, affected_components: [], deliver_notifications: null, custom_tweet: null, tweet_id: null }))].sort((a, b) => b.created_at.localeCompare(a.created_at)),
  }));
  return {page,status,components:publicComponents,incidents,maintenance};
}
