import { eventPreferenceSql, incidentThresholdSql, ordinarySubscriptionSql, incidentFollowRecipientSql } from "./subscriber-eligibility";
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
  followChannels?: readonly DeliveryChannel[];
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
  const followChannels: readonly DeliveryChannel[] = input.followChannels ?? [];
  const channels = [...new Set(input.eventType === "maintenance-notice" ? input.channels : [...input.channels, ...followChannels])];
  if (!channels.length) return [];
  const requiresPublishedNotice = input.eventType === "maintenance-notice";
  const componentPlaceholders = input.componentIds.length ? input.componentIds.map(() => "?").join(", ") : "NULL";
  const statements: D1PreparedStatement[] = [];
  if (input.incidentUpdateId) {
    for (const channel of input.channels) {
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
    const eventPreference = eventPreferenceSql(input.eventType === "maintenance-notice" ? "maintenance" : "incidents");
    const threshold = input.eventType === "maintenance-notice" ? "1" : incidentThresholdSql("(SELECT incident_id FROM follow_event)");
    const follow = input.eventType === "maintenance-notice" || !followChannels.includes(channel) ? "0" : incidentFollowRecipientSql("(SELECT incident_id FROM follow_event)", "(SELECT event_at FROM follow_event)", input.eventType === "incident-report");
    const chosenChannel = input.channels.includes(channel) ? "1" : "0";
    const source = usePrevious
      ? `notification_deliveries previous JOIN subscriber_directory s ON s.id = previous.subscriber_id WHERE previous.notification_event_id IN (${previousPlaceholders}) AND previous.channel = ? AND s.state = 'active'`
      : `subscriber_directory s WHERE s.state = 'active' AND s.channel = ?`;
    const query = `
      WITH follow_event AS (SELECT ${input.eventType === "maintenance-notice" ? "NULL" : `(SELECT incident_id FROM ${input.eventType === "incident-update" ? "incident_updates" : "incident_reports"} WHERE id=?)`} AS incident_id, ? AS event_at${input.eventType === "incident-update" ? `, EXISTS(SELECT 1 FROM incident_updates live_update WHERE live_update.id=? AND live_update.is_retroactive=0) AS live` : ""})
      INSERT INTO ${input.eventType === "incident-report" ? "report_notification_deliveries" : "notification_deliveries"}
        (id, subscriber_id, incident_update_id, incident_report_id, maintenance_id, channel, outcome, queued_at, outcome_at, created_at, updated_at, notification_event_id, notification_event_type)
      SELECT upper(substr(hex(randomblob(16)), 1, 26)), s.id, ?, ?, ?, ?, 'queued', ?, NULL, ?, ?, ?, ?
      FROM ${source} AND ((${ordinarySubscriptionSql()} AND ${chosenChannel} AND ${usePrevious ? "1" : `(${selection})`} AND ${eventPreference} AND ${threshold}) OR (${follow}${input.eventType === "incident-update" ? " AND (SELECT live FROM follow_event)" : ""}))${requiresPublishedNotice ? " AND EXISTS (SELECT 1 FROM maintenance_notices published_notice WHERE published_notice.id = ?)" : ""}
      ON CONFLICT DO NOTHING
    `;
    statements.push(binding.prepare(query).bind(
      ...(input.eventType === "maintenance-notice" ? [] : [input.incidentUpdateId ?? input.incidentReportId ?? null]),
      input.queuedAt,
      ...(input.eventType === "incident-update" ? [input.incidentUpdateId ?? null] : []),
      input.incidentUpdateId ?? null,
      input.incidentReportId ?? null,
      input.maintenanceId ?? null,
      channel,
      input.queuedAt,
      input.queuedAt,
      input.queuedAt,
      input.eventId,
      input.eventType,
      ...(usePrevious ? [...(input.previousEventIds ?? []), channel] : [channel, ...input.componentIds, ...input.componentIds]),
      ...(requiresPublishedNotice ? [input.eventId] : []),
    ));
  }
  if(input.eventType === "incident-update") statements.push(binding.prepare(`UPDATE incident_subscriptions
    SET resolution_at=COALESCE(resolution_at,(SELECT published_at FROM incident_updates WHERE id=?))
    WHERE ended_at IS NULL AND incident_id=(SELECT incident_id FROM incident_updates WHERE id=? AND lifecycle='Resolved' AND is_retroactive=0)`)
    .bind(input.incidentUpdateId??null,input.incidentUpdateId??null));
  const outbox = requiresPublishedNotice
    ? binding.prepare("INSERT OR IGNORE INTO notification_outbox (id, kind, aggregate_id, payload_json, available_at, attempts, locked_at, completed_at, failed_at, last_error, created_at, updated_at) SELECT ?, 'delivery-dispatch', ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM maintenance_notices published_notice WHERE published_notice.id = ?)")
      .bind(createUlid(), input.eventId, JSON.stringify({ eventId: input.eventId, eventType: input.eventType }), input.queuedAt, input.queuedAt, input.queuedAt, input.eventId)
    : binding.prepare("INSERT OR IGNORE INTO notification_outbox (id, kind, aggregate_id, payload_json, available_at, attempts, locked_at, completed_at, failed_at, last_error, created_at, updated_at) VALUES (?, 'delivery-dispatch', ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?, ?)")
      .bind(createUlid(), input.eventId, JSON.stringify({ eventId: input.eventId, eventType: input.eventType }), input.queuedAt, input.queuedAt, input.queuedAt);
  statements.push(outbox);
  return statements;
}
