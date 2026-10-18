-- Reports are notification events too. The original table's CHECK predates
-- incident_report_id and silently rejects report-only INSERT OR IGNORE rows.
-- D1 keeps foreign keys enabled: replacing this parent cascades attempts and
-- clears provider-event delivery links, so retain and restore both explicitly.
CREATE TABLE notification_delivery_attempts_report_migration AS
SELECT * FROM notification_delivery_attempts;
CREATE TABLE notification_provider_links_report_migration AS
SELECT id, delivery_id FROM mail_provider_webhook_events WHERE delivery_id IS NOT NULL;

CREATE TABLE notification_deliveries_with_reports (
  id TEXT PRIMARY KEY NOT NULL,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE RESTRICT,
  incident_update_id TEXT REFERENCES incident_updates(id) ON DELETE RESTRICT,
  maintenance_id TEXT REFERENCES maintenance(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook')),
  outcome TEXT NOT NULL CHECK (outcome IN ('queued', 'delivered', 'bounced', 'complained', 'suppressed', 'failed')),
  queued_at TEXT NOT NULL,
  outcome_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notification_event_id TEXT,
  notification_event_type TEXT,
  incident_report_id TEXT REFERENCES incident_reports(id) ON DELETE RESTRICT,
  mail_payload_json TEXT,
  dispatch_locked_at TEXT,
  incident_impact TEXT CHECK (incident_impact IN ('none', 'minor', 'major', 'critical')),
  CHECK (incident_update_id IS NOT NULL OR maintenance_id IS NOT NULL OR incident_report_id IS NOT NULL)
);
INSERT INTO notification_deliveries_with_reports (
  id, subscriber_id, incident_update_id, maintenance_id, channel, outcome,
  queued_at, outcome_at, created_at, updated_at, notification_event_id,
  notification_event_type, incident_report_id, mail_payload_json,
  dispatch_locked_at, incident_impact
)
SELECT id, subscriber_id, incident_update_id, maintenance_id, channel, outcome,
  queued_at, outcome_at, created_at, updated_at, notification_event_id,
  notification_event_type, incident_report_id, mail_payload_json,
  dispatch_locked_at, incident_impact
FROM notification_deliveries;
DROP TABLE notification_deliveries;
ALTER TABLE notification_deliveries_with_reports RENAME TO notification_deliveries;

CREATE INDEX notification_deliveries_subscriber_idx ON notification_deliveries(subscriber_id, queued_at DESC);
CREATE INDEX notification_deliveries_update_idx ON notification_deliveries(incident_update_id, queued_at DESC);
CREATE INDEX notification_deliveries_dispatch_claim_idx ON notification_deliveries(outcome, dispatch_locked_at);
CREATE UNIQUE INDEX notification_deliveries_one_event_channel
  ON notification_deliveries(subscriber_id, notification_event_id, channel)
  WHERE notification_event_id IS NOT NULL;

-- Recreate the trigger after copying so historical frozen impact is unchanged.
CREATE TRIGGER notification_deliveries_capture_impact AFTER INSERT ON notification_deliveries
WHEN NEW.incident_update_id IS NOT NULL OR NEW.incident_report_id IS NOT NULL BEGIN
  UPDATE notification_deliveries SET incident_impact = (
    SELECT COALESCE(i.impact_override, CASE i.peak_impact WHEN 'Major outage' THEN 'critical'
      WHEN 'Partially unavailable' THEN 'major' WHEN 'Degraded performance' THEN 'minor' ELSE 'none' END)
    FROM incidents i WHERE i.id = COALESCE(
      (SELECT incident_id FROM incident_updates WHERE id = NEW.incident_update_id),
      (SELECT incident_id FROM incident_reports WHERE id = NEW.incident_report_id))
  ) WHERE id = NEW.id AND incident_impact IS NULL;
END;

INSERT INTO notification_delivery_attempts (
  id, delivery_id, attempt_number, attempted_at, provider_message_id, error,
  created_at, local_capture_id
)
SELECT id, delivery_id, attempt_number, attempted_at, provider_message_id, error,
  created_at, local_capture_id
FROM notification_delivery_attempts_report_migration;
UPDATE mail_provider_webhook_events SET delivery_id = (
  SELECT preserved.delivery_id FROM notification_provider_links_report_migration preserved
  WHERE preserved.id = mail_provider_webhook_events.id
)
WHERE id IN (SELECT id FROM notification_provider_links_report_migration);
DROP TABLE notification_delivery_attempts_report_migration;
DROP TABLE notification_provider_links_report_migration;
