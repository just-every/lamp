-- Component carriers are additive. Historical incident/maintenance deliveries
-- and every foreign key to them keep their original storage and identity.
CREATE TABLE component_notification_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE RESTRICT,
  incident_update_id TEXT REFERENCES incident_updates(id) ON DELETE RESTRICT,
  maintenance_id TEXT REFERENCES maintenance(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK(channel IN ('email','webhook')),
  outcome TEXT NOT NULL CHECK(outcome IN ('queued','delivered','bounced','complained','suppressed','failed')),
  queued_at TEXT NOT NULL,
  outcome_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notification_event_id TEXT,
  notification_event_type TEXT,
  incident_report_id TEXT REFERENCES incident_reports(id) ON DELETE RESTRICT,
  mail_payload_json TEXT,
  dispatch_locked_at TEXT,
  incident_impact TEXT CHECK(incident_impact IN ('none','minor','major','critical')),
  component_event_id TEXT NOT NULL REFERENCES component_notification_events(id) ON DELETE RESTRICT,
  CHECK(incident_update_id IS NULL AND maintenance_id IS NULL AND incident_report_id IS NULL),
  CHECK(notification_event_type = 'component-change' AND notification_event_id = component_event_id)
);
CREATE INDEX component_deliveries_subscriber_idx ON component_notification_deliveries(subscriber_id,queued_at DESC);
CREATE INDEX component_deliveries_dispatch_idx ON component_notification_deliveries(outcome,dispatch_locked_at);
CREATE UNIQUE INDEX component_deliveries_one_event ON component_notification_deliveries(subscriber_id,notification_event_id,channel);
CREATE TABLE component_delivery_attempts (
 id TEXT PRIMARY KEY NOT NULL,
 delivery_id TEXT NOT NULL REFERENCES component_notification_deliveries(id) ON DELETE CASCADE,
 attempt_number INTEGER NOT NULL, attempted_at TEXT NOT NULL, provider_message_id TEXT,
 error TEXT, created_at TEXT NOT NULL, local_capture_id TEXT,
 UNIQUE(delivery_id,attempt_number)
);
CREATE INDEX component_delivery_attempts_delivery_idx ON component_delivery_attempts(delivery_id,attempted_at);
ALTER TABLE mail_provider_webhook_events ADD COLUMN component_delivery_id TEXT REFERENCES component_notification_deliveries(id) ON DELETE SET NULL;
CREATE VIEW notification_delivery_records AS SELECT d.*,NULL AS component_event_id FROM notification_deliveries d
 UNION ALL SELECT * FROM component_notification_deliveries;
CREATE VIEW notification_attempt_records AS SELECT * FROM notification_delivery_attempts
 UNION ALL SELECT * FROM component_delivery_attempts;
