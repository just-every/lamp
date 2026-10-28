-- A separate lifetime shares native subscriber authority without changing any
-- applied table or destination uniqueness. Only the read projection exposes the
-- address held by an incident subscription.
CREATE TABLE incident_follow_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 include_report INTEGER NOT NULL DEFAULT 1 CHECK(include_report IN (0,1))
);
INSERT INTO incident_follow_settings(id) VALUES(1);
CREATE TABLE incident_subscriptions (
 subscriber_id TEXT PRIMARY KEY NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
 incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
 destination TEXT NOT NULL,
 include_report INTEGER NOT NULL DEFAULT 1 CHECK(include_report IN (0,1)),
 resolution_delivered_at TEXT,
 ended_at TEXT,
 final_event_id TEXT,
 created_at TEXT NOT NULL
);
CREATE INDEX incident_subscriptions_incident ON incident_subscriptions(incident_id,ended_at);
CREATE INDEX incident_subscriptions_ending ON incident_subscriptions(ended_at,resolution_delivered_at);
DROP VIEW subscriber_directory;
CREATE VIEW subscriber_directory AS SELECT s.id, CASE WHEN s.sms_kind=1 THEN 'sms' ELSE COALESCE(s.chat_kind,s.channel) END AS channel,
 CASE WHEN s.destination LIKE 'deleted:%' THEN s.destination ELSE COALESCE(f.destination,s.destination) END AS destination,
 s.contact_email,s.state,s.selection_mode,s.token_hash,s.deactivation_reason,s.deactivated_at,
 s.created_at,s.updated_at,s.created_by_operator_id,s.webhook_format,
 CASE WHEN s.preferences_set=0 AND s.channel='email' THEN '["incidents","maintenance"]' ELSE s.event_kinds_json END AS event_kinds_json,
 s.minimum_impact FROM subscribers s LEFT JOIN incident_subscriptions f ON f.subscriber_id=s.id;
CREATE TRIGGER incident_subscriber_erasure AFTER UPDATE OF destination ON subscribers
WHEN NEW.destination LIKE 'deleted:%' BEGIN
 DELETE FROM incident_subscriptions WHERE subscriber_id=NEW.id;
END;
