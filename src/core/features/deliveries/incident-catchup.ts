import { eventPreferenceSql, incidentThresholdSql } from "./subscriber-eligibility";
import { createUlid } from "../../shared/ids";

/** The preview and atomic attachment capture use the same recipient eligibility.
 * Preview supplies a prospective component; capture supplies committed claims. */
export function incidentCatchupRecipients(input: { incidentId: string } & ({ componentId: string } | { attachmentIds: string[] })) {
  const prospective = "componentId" in input;
  const attaching = prospective
    ? "SELECT '' AS id, ? AS component_id"
    : `SELECT id,component_id FROM incident_components WHERE incident_id = ? AND published_at IS NOT NULL AND id IN (${input.attachmentIds.map(() => "?").join(",")})`;
  return {
    bindings: prospective ? [input.componentId,input.incidentId] : [input.incidentId,...input.attachmentIds,input.incidentId],
    sql: `WITH attaching AS (${attaching})
      SELECT s.id AS subscriberId,s.channel,u.id AS updateId
      FROM subscribers s JOIN incidents i ON i.id = ?
      JOIN incident_updates u ON u.id = (SELECT latest.id FROM incident_updates latest WHERE latest.incident_id = i.id ORDER BY latest.published_at DESC,latest.created_at DESC,latest.id DESC LIMIT 1)
      JOIN notification_channel_selections channels ON channels.incident_update_id = u.id AND channels.channel = s.channel
      WHERE s.state = 'active' AND i.deleted_at IS NULL AND i.lifecycle <> 'Resolved'
        AND ${eventPreferenceSql('incidents')} AND ${incidentThresholdSql('i.id')}
        AND (EXISTS (SELECT 1 FROM incident_components published_claim JOIN components published_component ON published_component.id = published_claim.component_id
          WHERE published_claim.incident_id = i.id AND published_claim.id NOT IN (SELECT id FROM attaching) AND published_claim.published_at <= u.published_at AND published_component.internal = 0)
          OR EXISTS (SELECT 1 FROM component_claim_events public_claim JOIN components public_component ON public_component.id = public_claim.component_id
          WHERE public_claim.id NOT IN (SELECT id FROM attaching) AND public_claim.cause_type = 'incident' AND public_claim.cause_id = i.id AND public_claim.state IS NOT NULL AND public_claim.changed_at <= u.published_at AND public_component.internal = 0
            AND public_claim.id = (SELECT current_claim.id FROM component_claim_events current_claim WHERE current_claim.component_id = public_claim.component_id AND current_claim.cause_type = 'incident' AND current_claim.cause_id = i.id AND current_claim.changed_at <= u.published_at ORDER BY current_claim.changed_at DESC,current_claim.created_at DESC,current_claim.id DESC LIMIT 1)))
        AND NOT EXISTS (SELECT 1 FROM incident_updates historical WHERE historical.incident_id = i.id AND historical.is_retroactive = 1)
        AND EXISTS (SELECT 1 FROM attaching JOIN components c ON c.id = attaching.component_id
          WHERE c.internal = 0 AND (s.selection_mode = 'all' OR EXISTS (SELECT 1 FROM subscriber_components sc WHERE sc.subscriber_id = s.id AND sc.component_id = c.id)))
        AND NOT EXISTS (SELECT 1 FROM notification_deliveries previous LEFT JOIN incident_updates prior_update ON prior_update.id = previous.incident_update_id
          LEFT JOIN incident_reports prior_report ON prior_report.id = previous.incident_report_id
          WHERE previous.subscriber_id = s.id AND (prior_update.incident_id = i.id OR prior_report.incident_id = i.id))`,
  };
}

/** Capture catch-up recipients inside the same transaction that attaches claims.
 * The persisted delivery history is the incident-wide notification ledger. */
export function incidentCatchupStatements(binding: D1Database, input: { incidentId: string; attachmentIds: string[]; queuedAt: string }): D1PreparedStatement[] {
  if (!input.attachmentIds.length) return [];
  const recipients = incidentCatchupRecipients(input);
  const outboxId = createUlid();
  const eventId = `incident-attachment/${input.attachmentIds[0]}`;
  return [
    binding.prepare(`INSERT OR IGNORE INTO notification_deliveries
      (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type)
      SELECT upper(substr(hex(randomblob(16)),1,26)),subscriberId,updateId,channel,'queued',?,?,?,?, 'incident-update'
      FROM (${recipients.sql})`)
      .bind(input.queuedAt,input.queuedAt,input.queuedAt,eventId,...recipients.bindings),
    // A fresh outbox item is needed even if the update's original dispatch finished.
    binding.prepare(`INSERT INTO notification_outbox (id,kind,aggregate_id,payload_json,available_at,attempts,created_at,updated_at)
      SELECT ?,'delivery-dispatch',?,json_object('eventId',?,'eventType','incident-update'),?,0,?,?
      FROM incident_updates u WHERE u.incident_id = ? AND EXISTS
        (SELECT 1 FROM notification_deliveries d WHERE d.incident_update_id = u.id AND d.notification_event_id = ? AND d.outcome = 'queued')
      ORDER BY u.published_at DESC,u.created_at DESC,u.id DESC LIMIT 1`)
      .bind(outboxId,eventId,eventId,input.queuedAt,input.queuedAt,input.queuedAt,input.incidentId,eventId),
  ];
}
