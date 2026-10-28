-- Report-only notifications cannot inhabit the original incident/maintenance
-- table's CHECK. Keep that applied table and every old foreign key intact, and
-- add the same carrier/attempt partition used for component notifications.
CREATE TABLE report_notification_deliveries (
 id TEXT PRIMARY KEY NOT NULL,
 subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE RESTRICT,
 incident_update_id TEXT REFERENCES incident_updates(id) ON DELETE RESTRICT,
 maintenance_id TEXT REFERENCES maintenance(id) ON DELETE RESTRICT,
 channel TEXT NOT NULL CHECK(channel IN ('email','webhook')),
 outcome TEXT NOT NULL CHECK(outcome IN ('queued','delivered','bounced','complained','suppressed','failed')),
 queued_at TEXT NOT NULL, outcome_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 notification_event_id TEXT NOT NULL,
 notification_event_type TEXT NOT NULL CHECK(notification_event_type='incident-report'),
 incident_report_id TEXT NOT NULL REFERENCES incident_reports(id) ON DELETE RESTRICT,
 mail_payload_json TEXT, dispatch_locked_at TEXT,
 incident_impact TEXT CHECK(incident_impact IN ('none','minor','major','critical')),
 component_event_id TEXT,
 CHECK(incident_update_id IS NULL AND maintenance_id IS NULL AND component_event_id IS NULL),
 CHECK(notification_event_id=incident_report_id)
);
CREATE INDEX report_deliveries_subscriber ON report_notification_deliveries(subscriber_id,queued_at DESC);
CREATE INDEX report_deliveries_dispatch ON report_notification_deliveries(outcome,dispatch_locked_at);
CREATE UNIQUE INDEX report_deliveries_one_event ON report_notification_deliveries(subscriber_id,notification_event_id,channel);
CREATE TABLE report_delivery_attempts (
 id TEXT PRIMARY KEY NOT NULL,
 delivery_id TEXT NOT NULL REFERENCES report_notification_deliveries(id) ON DELETE CASCADE,
 attempt_number INTEGER NOT NULL, attempted_at TEXT NOT NULL, provider_message_id TEXT,
 error TEXT, created_at TEXT NOT NULL, local_capture_id TEXT
 CHECK(local_capture_id IS NULL OR (length(local_capture_id)>0 AND provider_message_id IS NULL AND error IS NULL)),
 UNIQUE(delivery_id,attempt_number)
);
CREATE INDEX report_delivery_attempts_delivery ON report_delivery_attempts(delivery_id,attempted_at);
ALTER TABLE mail_provider_webhook_events ADD COLUMN report_delivery_id TEXT REFERENCES report_notification_deliveries(id) ON DELETE SET NULL;
CREATE TRIGGER report_deliveries_capture_impact AFTER INSERT ON report_notification_deliveries BEGIN
 UPDATE report_notification_deliveries SET incident_impact=(
  SELECT COALESCE(i.impact_override,CASE i.peak_impact WHEN 'Major outage' THEN 'critical'
   WHEN 'Partially unavailable' THEN 'major' WHEN 'Degraded performance' THEN 'minor' ELSE 'none' END)
  FROM incidents i JOIN incident_reports r ON r.incident_id=i.id WHERE r.id=NEW.incident_report_id
 ) WHERE id=NEW.id AND incident_impact IS NULL;
END;

DROP VIEW notification_delivery_records;
DROP VIEW notification_attempt_records;
CREATE VIEW notification_delivery_records AS SELECT d.*,NULL AS component_event_id FROM notification_deliveries d
 UNION ALL SELECT * FROM component_notification_deliveries
 UNION ALL SELECT * FROM report_notification_deliveries;
CREATE VIEW notification_attempt_records AS SELECT * FROM notification_delivery_attempts
 UNION ALL SELECT * FROM component_delivery_attempts
 UNION ALL SELECT * FROM report_delivery_attempts;
CREATE TRIGGER notification_delivery_records_freeze
INSTEAD OF UPDATE OF mail_payload_json ON notification_delivery_records
WHEN OLD.mail_payload_json IS NULL BEGIN
 UPDATE notification_deliveries SET mail_payload_json=NEW.mail_payload_json WHERE id=OLD.id AND mail_payload_json IS NULL;
 UPDATE component_notification_deliveries SET mail_payload_json=NEW.mail_payload_json WHERE id=OLD.id AND mail_payload_json IS NULL;
 UPDATE report_notification_deliveries SET mail_payload_json=NEW.mail_payload_json WHERE id=OLD.id AND mail_payload_json IS NULL;
END;
CREATE TRIGGER notification_attempt_records_insert
INSTEAD OF INSERT ON notification_attempt_records BEGIN
 SELECT RAISE(ABORT,'Unknown delivery.') WHERE NOT EXISTS(SELECT 1 FROM notification_delivery_records WHERE id=NEW.delivery_id);
 INSERT INTO notification_delivery_attempts(id,delivery_id,attempt_number,attempted_at,provider_message_id,error,created_at,local_capture_id)
 SELECT NEW.id,NEW.delivery_id,NEW.attempt_number,NEW.attempted_at,NEW.provider_message_id,NEW.error,NEW.created_at,NEW.local_capture_id
 WHERE EXISTS(SELECT 1 FROM notification_deliveries WHERE id=NEW.delivery_id) ON CONFLICT DO NOTHING;
 INSERT INTO component_delivery_attempts(id,delivery_id,attempt_number,attempted_at,provider_message_id,error,created_at,local_capture_id)
 SELECT NEW.id,NEW.delivery_id,NEW.attempt_number,NEW.attempted_at,NEW.provider_message_id,NEW.error,NEW.created_at,NEW.local_capture_id
 WHERE EXISTS(SELECT 1 FROM component_notification_deliveries WHERE id=NEW.delivery_id) ON CONFLICT DO NOTHING;
 INSERT INTO report_delivery_attempts(id,delivery_id,attempt_number,attempted_at,provider_message_id,error,created_at,local_capture_id)
 SELECT NEW.id,NEW.delivery_id,NEW.attempt_number,NEW.attempted_at,NEW.provider_message_id,NEW.error,NEW.created_at,NEW.local_capture_id
 WHERE EXISTS(SELECT 1 FROM report_notification_deliveries WHERE id=NEW.delivery_id) ON CONFLICT DO NOTHING;
END;
