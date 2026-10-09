import type { DeliveryChannel } from "../../shared/domain";
import { createUlid } from "../../shared/ids";

export type NotificationEventType = "incident-update" | "maintenance-notice" | "incident-report";

export interface NotificationPublicationInput {
  eventId: string;
  eventType: NotificationEventType;
  incidentUpdateId?: string | null;
  incidentReportId?: string | null;
  maintenanceId?: string | null;
  componentIds: readonly string[];
  channels: readonly DeliveryChannel[];
  queuedAt: string;
  recipientScope?: "eligible" | "previous";
  previousEventIds?: readonly string[];
}

/**
 * Statements meant to be placed after the event insert in the publisher's
 * D1Database.batch. The recipient INSERT reads active subscriptions in that
 * same all-or-nothing batch; the unique event index makes retries idempotent.
 */
export function notificationPublicationStatements(binding: D1Database, input: NotificationPublicationInput): D1PreparedStatement[] {
  const channels = [...new Set(input.channels)];
  if (!channels.length) return [];
  const requiresPublishedNotice = input.eventType === "maintenance-notice";
  const componentPlaceholders = input.componentIds.length ? input.componentIds.map(() => "?").join(", ") : "NULL";
  const statements: D1PreparedStatement[] = [];
  if (input.incidentUpdateId) {
    for (const channel of channels) {
      statements.push(binding.prepare("INSERT OR IGNORE INTO notification_channel_selections (incident_update_id, channel, created_at) VALUES (?, ?, ?)")
        .bind(input.incidentUpdateId, channel, input.queuedAt));
    }
  }
  for (const channel of channels) {
    const selection = input.componentIds.length
      ? `(s.selection_mode = 'all' AND EXISTS (SELECT 1 FROM components public_component WHERE public_component.id IN (${componentPlaceholders}) AND public_component.internal = 0))
          OR (s.selection_mode = 'selected' AND EXISTS (
            SELECT 1
            FROM subscriber_components sc
            JOIN components selected_component ON selected_component.id = sc.component_id
            WHERE sc.subscriber_id = s.id
              AND sc.component_id IN (${componentPlaceholders})
              AND selected_component.internal = 0
          ))`
      : "0";
    const usePrevious = input.recipientScope === "previous";
    const previousPlaceholders = input.previousEventIds?.length ? input.previousEventIds.map(() => "?").join(", ") : "NULL";
    const source = usePrevious
      ? `notification_deliveries previous JOIN subscribers s ON s.id = previous.subscriber_id WHERE previous.notification_event_id IN (${previousPlaceholders}) AND previous.channel = ? AND s.state = 'active'`
      : `subscribers s WHERE s.state = 'active' AND s.channel = ? AND (${selection})`;
    const query = `
      INSERT OR IGNORE INTO notification_deliveries
        (id, subscriber_id, incident_update_id, incident_report_id, maintenance_id, channel, outcome, queued_at, outcome_at, created_at, updated_at, notification_event_id, notification_event_type)
      SELECT upper(substr(hex(randomblob(16)), 1, 26)), s.id, ?, ?, ?, ?, 'queued', ?, NULL, ?, ?, ?, ?
      FROM ${source}${requiresPublishedNotice ? " AND EXISTS (SELECT 1 FROM maintenance_notices published_notice WHERE published_notice.id = ?)" : ""}
    `;
    statements.push(binding.prepare(query).bind(
      input.incidentUpdateId ?? null,
      input.incidentReportId ?? null,
      input.maintenanceId ?? null,
      channel,
      input.queuedAt,
      input.queuedAt,
      input.queuedAt,
      input.eventId,
      input.eventType,
      channel,
      ...(usePrevious ? (input.previousEventIds ?? []) : [...input.componentIds, ...input.componentIds]),
      ...(requiresPublishedNotice ? [input.eventId] : []),
    ));
  }
  const outbox = requiresPublishedNotice
    ? binding.prepare("INSERT OR IGNORE INTO notification_outbox (id, kind, aggregate_id, payload_json, available_at, attempts, locked_at, completed_at, failed_at, last_error, created_at, updated_at) SELECT ?, 'delivery-dispatch', ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM maintenance_notices published_notice WHERE published_notice.id = ?)")
      .bind(createUlid(), input.eventId, JSON.stringify({ eventId: input.eventId, eventType: input.eventType }), input.queuedAt, input.queuedAt, input.queuedAt, input.eventId)
    : binding.prepare("INSERT OR IGNORE INTO notification_outbox (id, kind, aggregate_id, payload_json, available_at, attempts, locked_at, completed_at, failed_at, last_error, created_at, updated_at) VALUES (?, 'delivery-dispatch', ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?, ?)")
      .bind(createUlid(), input.eventId, JSON.stringify({ eventId: input.eventId, eventType: input.eventType }), input.queuedAt, input.queuedAt, input.queuedAt);
  statements.push(outbox);
  return statements;
}
