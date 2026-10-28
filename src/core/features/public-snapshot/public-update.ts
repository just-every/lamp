import type { PublicSnapshotSource } from "./repository";
import type { PublicIncident } from "./record-markup";

/** Project the immutable update into public fields before any surface renders it. */
export function publicUpdate(source: PublicSnapshotSource, update: PublicSnapshotSource["updates"][number]): PublicIncident["updates"][number] {
  const attachments = source.incidentComponents.filter(row => row.incidentId === update.incidentId);
  const componentChanges = (update.componentChanges ?? []).filter(change => !change.internal && attachments.some(row =>
    row.componentId === change.componentId || (row.componentId === null && row.componentName === change.name)));
  return {
    ...(update.automationAttribution ? { automationAttribution: update.automationAttribution } : {}),
    id: update.id, lifecycle: update.lifecycle, affectedAudience: update.affectedAudience,
    customerImpact: update.customerImpact, whatStillWorks: update.whatStillWorks, details: update.details,
    nextUpdateAt: update.nextUpdateAt, publishedAt: update.publishedAt, componentChanges,
  };
}
