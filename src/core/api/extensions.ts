import type { AiProvider } from "../platform/ai";
import type { MailSender } from "../platform/mail";
export { MailPreparationError } from "../platform/mail/sender";
import type { ReactNode } from "react";
import type { ComponentStatusChangedEvent } from "../features/components";
import type { NotificationEventsPolicy } from "../features/deliveries";
import type { UpdateDuePolicy, UpdateReviewPolicy } from "../features/incidents";
import type { AlertIntakePolicy } from "../features/intake";
import type { MaintenanceRemindersPolicy } from "../features/maintenance";
import type { PostmortemDuePolicy } from "../features/reports";
import type { SubscriberConfirmationPolicy } from "../features/subscribers";
import type { PageStatusRollupPolicy, SnapshotPublishedEvent, UptimeDowntimeWeightPolicy } from "../features/public-snapshot";
import type { ComponentState, IncidentLifecycle, MaintenanceState } from "../shared/domain";

/** The named policy replacements listed in seed.json. */
export interface LampPolicies {
  "page.status-rollup.v1"?: PageStatusRollupPolicy;
  "uptime.downtime-states.v1"?: UptimeDowntimeWeightPolicy;
  "update.review.v1"?: UpdateReviewPolicy;
  "incident.update-due.v1"?: UpdateDuePolicy;
  "maintenance.reminders.v1"?: MaintenanceRemindersPolicy;
  "subscriber.confirmation.v1"?: SubscriberConfirmationPolicy;
  "notification.events.v1"?: NotificationEventsPolicy;
  "alert.intake.v1"?: AlertIntakePolicy;
  "postmortem.due.v1"?: PostmortemDuePolicy;
}

export interface IncidentOpenedEvent {
  incidentId: string;
  reference: string;
  openedAt: string;
}

export interface IncidentUpdatePublishedEvent {
  incidentId: string;
  updateId: string;
  lifecycle: IncidentLifecycle;
  publishedAt: string;
}

export interface IncidentResolvedEvent {
  incidentId: string;
  updateId: string;
  resolvedAt: string;
}

export interface MaintenanceLifecycleEvent {
  maintenanceId: string;
  reference: string;
  state: MaintenanceState;
  occurredAt: string;
}

export interface SubscriberLifecycleEvent {
  subscriberId: string;
  channel: "email" | "webhook";
  occurredAt: string;
  reason?: string;
}

export interface NotificationFailedEvent {
  deliveryId: string;
  subscriberId: string;
  notificationEventId: string;
  failedAt: string;
}

export interface AlertAcceptedEvent {
  sourceId: string;
  receiptId: string;
  incidentId: string | null;
  acceptedAt: string;
}

export interface LampEventMap {
  "incident.opened.v1": IncidentOpenedEvent;
  "incident.update.published.v1": IncidentUpdatePublishedEvent;
  "incident.resolved.v1": IncidentResolvedEvent;
  "component.status.changed.v1": ComponentStatusChangedEvent;
  "maintenance.scheduled.v1": MaintenanceLifecycleEvent;
  "maintenance.started.v1": MaintenanceLifecycleEvent;
  "maintenance.completed.v1": MaintenanceLifecycleEvent;
  "subscriber.confirmed.v1": SubscriberLifecycleEvent;
  "subscriber.deactivated.v1": SubscriberLifecycleEvent;
  "notification.failed.v1": NotificationFailedEvent;
  "alert.accepted.v1": AlertAcceptedEvent;
  "snapshot.published.v1": SnapshotPublishedEvent;
}

export type LampEventListener<Name extends keyof LampEventMap> = (event: Readonly<LampEventMap[Name]>) => void | Promise<void>;

/** Event listeners observe committed facts and can never affect a mutation result. */
export type LampEventListeners = {
  [Name in keyof LampEventMap]?: readonly LampEventListener<Name>[];
};

export interface LampEventDispatcher {
  incidentOpened(event: IncidentOpenedEvent): Promise<void>;
  incidentUpdatePublished(event: IncidentUpdatePublishedEvent): Promise<void>;
  incidentResolved(event: IncidentResolvedEvent): Promise<void>;
  componentStatusChanged(event: ComponentStatusChangedEvent): Promise<void>;
  maintenanceScheduled(event: MaintenanceLifecycleEvent): Promise<void>;
  maintenanceStarted(event: MaintenanceLifecycleEvent): Promise<void>;
  maintenanceCompleted(event: MaintenanceLifecycleEvent): Promise<void>;
  subscriberConfirmed(event: SubscriberLifecycleEvent): Promise<void>;
  subscriberDeactivated(event: SubscriberLifecycleEvent): Promise<void>;
  notificationFailed(event: NotificationFailedEvent): Promise<void>;
  alertAccepted(event: AlertAcceptedEvent): Promise<void>;
  snapshotPublished(event: SnapshotPublishedEvent): Promise<void>;
}

export interface PublicStatusSlotContext {
  pageName: string;
  hostname: string;
  overall: ComponentState;
}

export interface PublicIncidentSlotContext extends PublicStatusSlotContext {
  incident: Readonly<{ id: string; reference: string; title: string; lifecycle: IncidentLifecycle }>;
}

export interface OperatorSlotContext {
  operatorId: string;
}

export interface IncidentSidebarSlotContext extends OperatorSlotContext {
  incident: Readonly<{ id: string; reference: string; lifecycle: IncidentLifecycle }>;
}

export interface IncidentComposerSlotContext extends OperatorSlotContext {
  incident: Readonly<{ id: string; reference: string; lifecycle: IncidentLifecycle }>;
}

export interface ComponentRowSlotContext extends OperatorSlotContext {
  component: Readonly<{ id: string; name: string; publicState: ComponentState; groupName: string | null }>;
}

export interface SubscriberDetailSlotContext extends OperatorSlotContext {
  subscriber: Readonly<{ id: string; channel: "email" | "webhook"; state: string; destination: string }>;
}

export interface LampClientSlotContexts {
  "overview.dashboard.after.v1": OperatorSlotContext;
  "incident.sidebar.after.v1": IncidentSidebarSlotContext;
  "incident.composer.fields.after.v1": IncidentComposerSlotContext;
  "component.row.actions.v1": ComponentRowSlotContext;
  "subscriber.detail.after.v1": SubscriberDetailSlotContext;
  "settings.sections.v1": OperatorSlotContext;
}

/** Server-rendered public slots. Return escaped HTML owned by the buyer. */
export interface LampServerSlots {
  "status-page.header.after.v1"?: (context: Readonly<PublicStatusSlotContext>) => string;
  "status-page.components.after.v1"?: (context: Readonly<PublicStatusSlotContext>) => string;
  "status-page.incident.after.v1"?: (context: Readonly<PublicIncidentSlotContext>) => string;
  "status-page.footer.before.v1"?: (context: Readonly<PublicStatusSlotContext>) => string;
}

export interface LampServerAdapters {
  "mail.sender.v1"?: MailSender;
  "ai.provider.v1"?: AiProvider;
}

export interface LampServerExtensions {
  policies?: LampPolicies;
  events?: LampEventListeners;
  slots?: LampServerSlots;
  adapters?: LampServerAdapters;
}

/** Client slot contracts stay separate so server code never imports client code. */
export type LampClientSlots = {
  [Name in keyof LampClientSlotContexts]?: (context: Readonly<LampClientSlotContexts[Name]>) => ReactNode;
};
