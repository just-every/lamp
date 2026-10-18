import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { incidentUpdates, notificationDeliveries, subscribers } from "../../shared/schema";

export const subscriberTokens = sqliteTable("subscriber_tokens", {
  id: text().primaryKey(),
  subscriberId: text("subscriber_id").notNull().references(() => subscribers.id),
  scope: text({ enum: ["confirm", "manage", "unsubscribe"] }).$type<"confirm" | "manage" | "unsubscribe">().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at"),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("subscriber_tokens_lookup_idx").on(table.tokenHash, table.scope, table.expiresAt, table.revokedAt)]);

export const subscriberConfirmationAttempts = sqliteTable("subscriber_confirmation_attempts", {
  emailHash: text("email_hash").primaryKey(),
  lastSentAt: text("last_sent_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const notificationChannelSelections = sqliteTable("notification_channel_selections", {
  teamsSelected: integer("teams_selected", { mode: "boolean" }).notNull().default(false),
  webhookSelected: integer("webhook_selected", { mode: "boolean" }).notNull().default(true),
  incidentUpdateId: text("incident_update_id").notNull().references(() => incidentUpdates.id),
  channel: text({ enum: ["email", "webhook"] }).$type<"email" | "webhook">().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.incidentUpdateId, table.channel] })]);

export const notificationOutbox = sqliteTable("notification_outbox", {
  id: text().primaryKey(),
  kind: text({ enum: ["delivery-dispatch", "operator-alert"] }).$type<"delivery-dispatch" | "operator-alert">().notNull(),
  aggregateId: text("aggregate_id").notNull(),
  payloadJson: text("payload_json").notNull(),
  availableAt: text("available_at").notNull(),
  attempts: integer().notNull().default(0),
  lockedAt: text("locked_at"),
  completedAt: text("completed_at"),
  failedAt: text("failed_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("notification_outbox_ready_idx").on(table.completedAt, table.failedAt, table.availableAt)]);

export const notificationDeliveryAttempts = sqliteTable("notification_delivery_attempts", {
  id: text().primaryKey(),
  deliveryId: text("delivery_id").notNull().references(() => notificationDeliveries.id),
  attemptNumber: integer("attempt_number").notNull(),
  attemptedAt: text("attempted_at").notNull(),
  providerMessageId: text("provider_message_id"),
  error: text(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("notification_delivery_attempt_unique").on(table.deliveryId, table.attemptNumber),
  index("notification_delivery_attempts_delivery_idx").on(table.deliveryId, table.attemptedAt),
]);

export const mailProviderWebhookEvents = sqliteTable("mail_provider_webhook_events", {
  id: text().primaryKey(),
  providerEventId: text("provider_event_id").notNull().unique(),
  providerMessageId: text("provider_message_id"),
  eventType: text("event_type").notNull(),
  hardBounce: integer("hard_bounce", { mode: "boolean" }).notNull().default(false),
  receivedAt: text("received_at").notNull(),
  claimedAt: text("claimed_at"),
  appliedAt: text("applied_at"),
  deliveryId: text("delivery_id").references(() => notificationDeliveries.id),
  createdAt: text("created_at").notNull(),
}, (table) => [index("mail_provider_webhook_events_pending_idx").on(table.providerMessageId, table.appliedAt, table.claimedAt)]);
