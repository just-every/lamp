import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type {
  ComponentState,
  DeliveryChannel,
  DeliveryOutcome,
  IncidentLifecycle,
  MaintenanceState,
  SubscriberState,
} from "./domain";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const operators = sqliteTable("operators", {
  id: text().primaryKey(),
  email: text().notNull().unique(),
  displayName: text("display_name").notNull(),
  isSetupOperator: integer("is_setup_operator", { mode: "boolean" }).notNull().default(false),
  deactivatedAt: text("deactivated_at"),
  ...timestamps,
});


export const pageSettings = sqliteTable("page_settings", {
  id: text().primaryKey(),
  pageName: text("page_name").notNull(),
  tagline: text().notNull(),
  accentColor: text("accent_color").notNull(),
  timezone: text().notNull(),
  hostname: text().notNull(),
  footerCreditEnabled: integer("footer_credit_enabled", { mode: "boolean" }).notNull().default(true),
  logoKey: text("logo_key"),
  logoContentType: text("logo_content_type"),
  widgetAllowedOrigins: text("widget_allowed_origins").notNull().default("[]"),
  mailFromAddress: text("mail_from_address").notNull().default(""),
  aiToneInstructions: text("ai_tone_instructions").notNull().default(""),
  wordingBlockedTerms: text("wording_blocked_terms").notNull().default("[]"),
  wordingFriendlyLength: integer("wording_friendly_length").notNull().default(160),
  feedId: text("feed_id").notNull().default(""),
  ...timestamps,
});

export const componentGroups = sqliteTable("component_groups", {
  id: text().primaryKey(),
  name: text().notNull(),
  displayOrder: integer("display_order").notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("component_groups_display_order_idx").on(table.displayOrder)]);

export const components = sqliteTable("components", {
  id: text().primaryKey(),
  groupId: text("group_id").references(() => componentGroups.id),
  name: text().notNull(),
  description: text().notNull().default(""),
  internal: integer({ mode: "boolean" }).notNull().default(false),
  onlyShowIfDegraded: integer("only_show_if_degraded", { mode: "boolean" }).notNull().default(false),
  uptimeStartDate: text("uptime_start_date"),
  displayOrder: integer("display_order").notNull(),
  note: text().notNull().default(""),
  ...timestamps,
}, (table) => [index("components_group_order_idx").on(table.groupId, table.displayOrder)]);

export const componentStandingClaims = sqliteTable("component_standing_claims", {
  id: text().primaryKey(),
  componentId: text("component_id").notNull().unique().references(() => components.id),
  state: text({ enum: ["Operational", "Degraded performance", "Partially unavailable", "Major outage", "Under maintenance"] }).$type<ComponentState>().notNull(),
  operatorId: text("operator_id").notNull().references(() => operators.id),
  ...timestamps,
});

export const componentClaimEvents = sqliteTable("component_claim_events", {
  id: text().primaryKey(),
  componentId: text("component_id").notNull().references(() => components.id),
  causeType: text("cause_type", { enum: ["standing-claim", "incident", "maintenance"] }).notNull(),
  causeId: text("cause_id"),
  state: text({ enum: ["Operational", "Degraded performance", "Partially unavailable", "Major outage", "Under maintenance"] }).$type<ComponentState>(),
  changedAt: text("changed_at").notNull(),
  ...timestamps,
}, (table) => [index("component_claim_events_component_changed_idx").on(table.componentId, table.changedAt)]);

export const componentStateHistory = sqliteTable("component_state_history", {
  id: text().primaryKey(),
  componentId: text("component_id").notNull().references(() => components.id),
  previousState: text("previous_state", { enum: ["Operational", "Degraded performance", "Partially unavailable", "Major outage", "Under maintenance"] }).$type<ComponentState>().notNull(),
  newState: text("new_state", { enum: ["Operational", "Degraded performance", "Partially unavailable", "Major outage", "Under maintenance"] }).$type<ComponentState>().notNull(),
  causeType: text("cause_type", { enum: ["standing-claim", "incident", "maintenance", "correction"] }).notNull(),
  causeId: text("cause_id"),
  operatorId: text("operator_id").references(() => operators.id),
  supersedesHistoryId: text("supersedes_history_id").references((): ReturnType<typeof text> => componentStateHistory.id),
  changedAt: text("changed_at").notNull(),
  ...timestamps,
}, (table) => [index("component_state_history_component_changed_idx").on(table.componentId, table.changedAt)]);

export const componentStateCorrections = sqliteTable("component_state_corrections", {
  id: text().primaryKey(),
  componentId: text("component_id").notNull().references(() => components.id),
  historyId: text("history_id").notNull().references(() => componentStateHistory.id),
  state: text({ enum: ["Operational", "Degraded performance", "Partially unavailable", "Major outage", "Under maintenance"] }).$type<ComponentState>().notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  reason: text().notNull(),
  operatorId: text("operator_id").notNull().references(() => operators.id),
  ...timestamps,
}, (table) => [index("component_state_corrections_component_interval_idx").on(table.componentId, table.startsAt, table.endsAt)]);

export const snapshotBuilds = sqliteTable("snapshot_builds", {
  id: text().primaryKey(),
  status: text({ enum: ["building", "published", "failed"] }).notNull(),
  version: text(),
  error: text(),
  attempts: integer().notNull().default(0),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  ...timestamps,
}, (table) => [index("snapshot_builds_status_started_idx").on(table.status, table.startedAt)]);

export const incidents = sqliteTable("incidents", {
  id: text().primaryKey(),
  reference: text().notNull().unique(),
  title: text().notNull(),
  lifecycle: text({ enum: ["Investigating", "Identified", "Monitoring", "Resolved"] }).$type<IncidentLifecycle>().notNull(),
  openedAt: text("opened_at").notNull(),
  resolvedAt: text("resolved_at"),
  createdByOperatorId: text("created_by_operator_id").notNull().references(() => operators.id),
  deletedAt: text("deleted_at"),
  deletionReason: text("deletion_reason"),
  ...timestamps,
}, (table) => [index("incidents_lifecycle_opened_idx").on(table.lifecycle, table.openedAt)]);

export const incidentComponents = sqliteTable("incident_components", {
  id: text().primaryKey(),
  incidentId: text("incident_id").notNull().references(() => incidents.id),
  componentId: text("component_id").references(() => components.id),
  componentName: text("component_name").notNull(),
  state: text({ enum: ["Operational", "Degraded performance", "Partially unavailable", "Major outage", "Under maintenance"] }).$type<ComponentState>().notNull(),
  relationship: text({ enum: ["Primary", "Dependent"] }).notNull().default("Primary"),
  publishedAt: text("published_at"),
  ...timestamps,
}, (table) => [index("incident_components_incident_id_idx").on(table.incidentId), index("incident_components_component_id_idx").on(table.componentId)]);

export const incidentUpdates = sqliteTable("incident_updates", {
  id: text().primaryKey(),
  incidentId: text("incident_id").notNull().references(() => incidents.id),
  lifecycle: text({ enum: ["Investigating", "Identified", "Monitoring", "Resolved"] }).$type<IncidentLifecycle>().notNull(),
  affectedAudience: text("affected_audience").notNull(),
  customerImpact: text("customer_impact").notNull(),
  whatStillWorks: text("what_still_works").notNull().default(""),
  details: text().notNull().default(""),
  nextUpdateAt: text("next_update_at"),
  publishedAt: text("published_at").notNull(),
  isRetroactive: integer("is_retroactive", { mode: "boolean" }).notNull().default(false),
  authorOperatorId: text("author_operator_id").notNull().references(() => operators.id),
  correctsUpdateId: text("corrects_update_id").references((): ReturnType<typeof text> => incidentUpdates.id),
  componentChanges: text("component_changes_json", { mode: "json" }).$type<import("./incident-component-changes").PublishedIncidentComponentChange[]>().notNull().default([]),
  componentSnapshot: text("component_snapshot_json", { mode: "json" }).$type<import("./incident-component-changes").PublishedIncidentComponentChange[]>().notNull().default([]),
  ...timestamps,
}, (table) => [index("incident_updates_incident_published_idx").on(table.incidentId, table.publishedAt)]);

export const incidentDrafts = sqliteTable("incident_drafts", {
  id: text().primaryKey(),
  incidentId: text("incident_id").notNull().references(() => incidents.id),
  lifecycle: text({ enum: ["Investigating", "Identified", "Monitoring", "Resolved"] }).$type<IncidentLifecycle>().notNull(),
  affectedAudience: text("affected_audience").notNull().default(""),
  customerImpact: text("customer_impact").notNull().default(""),
  whatStillWorks: text("what_still_works").notNull().default(""),
  details: text().notNull().default(""),
  nextUpdateAt: text("next_update_at"),
  componentChanges: text("component_changes_json", { mode: "json" }).$type<import("./incident-component-changes").StagedIncidentComponent[]>().notNull().default([]),
  authorOperatorId: text("author_operator_id").notNull().references(() => operators.id),
  ...timestamps,
}, (table) => [uniqueIndex("incident_drafts_incident_id_unique").on(table.incidentId)]);

export const incidentInternalNotes = sqliteTable("incident_internal_notes", {
  id: text().primaryKey(),
  incidentId: text("incident_id").notNull().references(() => incidents.id),
  body: text().notNull(),
  authorOperatorId: text("author_operator_id").notNull().references(() => operators.id),
  ...timestamps,
}, (table) => [index("incident_internal_notes_incident_created_idx").on(table.incidentId, table.createdAt)]);

export const incidentAttachments = sqliteTable("incident_attachments", {
  id: text().primaryKey(),
  incidentId: text("incident_id").notNull().references(() => incidents.id),
  incidentUpdateId: text("incident_update_id").references(() => incidentUpdates.id),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  storageKey: text("storage_key").notNull(),
  uploadedByOperatorId: text("uploaded_by_operator_id").notNull().references(() => operators.id),
  ...timestamps,
}, (table) => [index("incident_attachments_incident_id_idx").on(table.incidentId)]);

export const maintenance = sqliteTable("maintenance", {
  id: text().primaryKey(),
  reference: text().notNull().unique(),
  title: text().notNull(),
  state: text({ enum: ["Scheduled", "In progress", "Completed", "Cancelled"] }).$type<MaintenanceState>().notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  completedAt: text("completed_at"),
  createdByOperatorId: text("created_by_operator_id").notNull().references(() => operators.id),
  ...timestamps,
}, (table) => [index("maintenance_state_start_idx").on(table.state, table.startsAt)]);

export const maintenanceComponents = sqliteTable("maintenance_components", {
  id: text().primaryKey(),
  maintenanceId: text("maintenance_id").notNull().references(() => maintenance.id),
  componentId: text("component_id").references(() => components.id),
  componentName: text("component_name").notNull(),
  state: text({ enum: ["Under maintenance"] }).$type<"Under maintenance">().notNull().default("Under maintenance"),
  ...timestamps,
}, (table) => [index("maintenance_components_maintenance_id_idx").on(table.maintenanceId)]);

export const subscribers = sqliteTable("subscribers", {
  id: text().primaryKey(),
  channel: text({ enum: ["email", "webhook"] }).$type<DeliveryChannel>().notNull(),
  destination: text().notNull().unique(),
  contactEmail: text("contact_email"),
  state: text({ enum: ["pending", "active", "deactivated"] }).$type<SubscriberState>().notNull(),
  selectionMode: text("selection_mode", { enum: ["all", "selected"] }).notNull().default("all"),
  tokenHash: text("token_hash").notNull().unique(),
  deactivationReason: text("deactivation_reason"),
  deactivatedAt: text("deactivated_at"),
  ...timestamps,
}, (table) => [index("subscribers_state_idx").on(table.state)]);

export const subscriberComponents = sqliteTable("subscriber_components", {
  id: text().primaryKey(),
  subscriberId: text("subscriber_id").notNull().references(() => subscribers.id),
  componentId: text("component_id").notNull().references(() => components.id),
  ...timestamps,
}, (table) => [uniqueIndex("subscriber_components_subscriber_component_idx").on(table.subscriberId, table.componentId)]);

export const notificationDeliveries = sqliteTable("notification_deliveries", {
  id: text().primaryKey(),
  subscriberId: text("subscriber_id").notNull().references(() => subscribers.id),
  incidentUpdateId: text("incident_update_id").references(() => incidentUpdates.id),
  maintenanceId: text("maintenance_id").references(() => maintenance.id),
  channel: text({ enum: ["email", "webhook"] }).$type<DeliveryChannel>().notNull(),
  outcome: text({ enum: ["queued", "delivered", "bounced", "complained", "suppressed", "failed"] }).$type<DeliveryOutcome>().notNull(),
  queuedAt: text("queued_at").notNull(),
  outcomeAt: text("outcome_at"),
  ...timestamps,
}, (table) => [
  index("notification_deliveries_subscriber_idx").on(table.subscriberId, table.queuedAt),
  index("notification_deliveries_update_idx").on(table.incidentUpdateId, table.queuedAt),
]);
