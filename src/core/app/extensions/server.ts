// This is one of the two core-to-extension mounts. It deliberately names each
// declared seam instead of using a runtime plugin registry.
import { lampServerExtensions } from "../../../ext/index.server";
import type { LampEventDispatcher, LampEventListener, LampEventMap, LampServerExtensions } from "../../api/extensions";
import { defaultComponentEvents, type ComponentStatusChangedEvent } from "../../features/components";
import { defaultNotificationEventsPolicy } from "../../features/deliveries";
import { defaultUpdateDuePolicy, defaultUpdateReviewPolicy, defaultIncidentEscalationPolicy } from "../../features/incidents";
import { defaultAlertIntakePolicy } from "../../features/intake";
import { defaultMaintenanceRemindersPolicy } from "../../features/maintenance";
import { defaultPublicSnapshotEvents, defaultPublicSnapshotPolicies, type SnapshotPublishedEvent } from "../../features/public-snapshot";
import { defaultPostmortemDuePolicy } from "../../features/reports";
import { defaultSubscriberConfirmationPolicy } from "../../features/subscribers";

async function dispatch<Name extends keyof LampEventMap>(listeners: readonly LampEventListener<Name>[] | undefined, name: Name, event: LampEventMap[Name]) {
  const results = await Promise.allSettled((listeners ?? []).map(async (listener) => listener(event)));
  for (const result of results) {
    if (result.status === "rejected") console.error(`Lamp extension listener ${name} failed after its fact was committed.`, result.reason);
  }
}

export function createServerExtensionMount(config: LampServerExtensions = lampServerExtensions) {
  const policies = config.policies ?? {};
  const events = config.events ?? {};
  const emit: LampEventDispatcher = {
    incidentOpened: (event) => dispatch(events["incident.opened.v1"], "incident.opened.v1", event),
    incidentUpdatePublished: (event) => dispatch(events["incident.update.published.v1"], "incident.update.published.v1", event),
    incidentResolved: (event) => dispatch(events["incident.resolved.v1"], "incident.resolved.v1", event),
    componentStatusChanged: (event) => dispatch(events["component.status.changed.v1"], "component.status.changed.v1", event),
    maintenanceScheduled: (event) => dispatch(events["maintenance.scheduled.v1"], "maintenance.scheduled.v1", event),
    maintenanceStarted: (event) => dispatch(events["maintenance.started.v1"], "maintenance.started.v1", event),
    maintenanceCompleted: (event) => dispatch(events["maintenance.completed.v1"], "maintenance.completed.v1", event),
    subscriberConfirmed: (event) => dispatch(events["subscriber.confirmed.v1"], "subscriber.confirmed.v1", event),
    subscriberDeactivated: (event) => dispatch(events["subscriber.deactivated.v1"], "subscriber.deactivated.v1", event),
    notificationFailed: (event) => dispatch(events["notification.failed.v1"], "notification.failed.v1", event),
    alertAccepted: (event) => dispatch(events["alert.accepted.v1"], "alert.accepted.v1", event),
    snapshotPublished: (event) => dispatch(events["snapshot.published.v1"], "snapshot.published.v1", event),
  };

  return {
    publicSnapshotPolicies: {
      pageStatusRollup: policies["page.status-rollup.v1"] ?? defaultPublicSnapshotPolicies.pageStatusRollup,
      uptimeDowntimeWeight: policies["uptime.downtime-states.v1"] ?? defaultPublicSnapshotPolicies.uptimeDowntimeWeight,
    },
    updateReviewPolicy: policies["update.review.v1"] ?? defaultUpdateReviewPolicy,
    updateDuePolicy: policies["incident.update-due.v1"] ?? defaultUpdateDuePolicy,
    incidentEscalationPolicy: policies["incident.escalation.v1"] ?? defaultIncidentEscalationPolicy,
    maintenanceRemindersPolicy: policies["maintenance.reminders.v1"] ?? defaultMaintenanceRemindersPolicy,
    subscriberConfirmationPolicy: policies["subscriber.confirmation.v1"] ?? defaultSubscriberConfirmationPolicy,
    notificationEventsPolicy: policies["notification.events.v1"] ?? defaultNotificationEventsPolicy,
    alertIntakePolicy: policies["alert.intake.v1"] ?? defaultAlertIntakePolicy,
    postmortemDuePolicy: policies["postmortem.due.v1"] ?? defaultPostmortemDuePolicy,
    componentEvents: { ...defaultComponentEvents, componentStatusChanged: async (event: ComponentStatusChangedEvent) => { await emit.componentStatusChanged(event); } },
    publicSnapshotEvents: { ...defaultPublicSnapshotEvents, snapshotPublished: async (event: SnapshotPublishedEvent) => { await emit.snapshotPublished(event); } },
    events: emit,
    slots: config.slots ?? {},
    adapters: config.adapters ?? {},
  };
}
