-- Additive SMS storage preserves every pre-existing subscriber and archive row.
ALTER TABLE subscribers ADD COLUMN sms_kind INTEGER NOT NULL DEFAULT 0 CHECK(sms_kind IN (0,1)) CHECK(sms_kind=0 OR (channel='webhook' AND chat_kind IS NULL));
CREATE TABLE sms_subscriptions (
 subscriber_id TEXT PRIMARY KEY NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
 page_name TEXT NOT NULL DEFAULT '', opt_in_wording TEXT NOT NULL DEFAULT '', pending_since TEXT NOT NULL DEFAULT ''
);
CREATE TABLE sms_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), countries_json TEXT NOT NULL DEFAULT '["US","CA"]' CHECK(json_valid(countries_json)), support_contact TEXT NOT NULL DEFAULT ''
);
INSERT INTO sms_settings(id) VALUES(1);
CREATE TABLE sms_consents (
 id TEXT PRIMARY KEY NOT NULL, subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
 number TEXT NOT NULL, page_name TEXT NOT NULL, wording TEXT NOT NULL, consented_at TEXT NOT NULL
);
CREATE TABLE sms_inbound_events (
 message_sid TEXT PRIMARY KEY NOT NULL, subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE, received_at TEXT NOT NULL
);
CREATE TABLE sms_deliveries (
 id TEXT PRIMARY KEY NOT NULL, subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
 event_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('incident-update','maintenance-notice','incident-report')),
 incident_update_id TEXT REFERENCES incident_updates(id), maintenance_id TEXT REFERENCES maintenance(id), incident_report_id TEXT REFERENCES incident_reports(id),
 outcome TEXT NOT NULL DEFAULT 'queued' CHECK(outcome IN ('queued','sending','sent','delivered','failed','undelivered','suppressed')),
 provider_message_id TEXT UNIQUE, queued_at TEXT NOT NULL, outcome_at TEXT,
 UNIQUE(subscriber_id,event_id)
);
CREATE INDEX sms_deliveries_pending ON sms_deliveries(outcome,queued_at);
CREATE TRIGGER sms_subscriber_erasure AFTER UPDATE OF destination ON subscribers
WHEN NEW.destination LIKE 'deleted:%' BEGIN
 DELETE FROM sms_subscriptions WHERE subscriber_id=NEW.id;
 DELETE FROM sms_consents WHERE subscriber_id=NEW.id;
 DELETE FROM sms_inbound_events WHERE subscriber_id=NEW.id;
 UPDATE sms_deliveries SET provider_message_id=NULL WHERE subscriber_id=NEW.id;
 UPDATE sms_deliveries SET outcome='suppressed' WHERE subscriber_id=NEW.id AND outcome IN ('queued','sending');
END;
DROP VIEW subscriber_directory;
CREATE VIEW subscriber_directory AS SELECT id, CASE WHEN sms_kind=1 THEN 'sms' ELSE COALESCE(chat_kind,channel) END AS channel,
 destination,contact_email,state,selection_mode,token_hash,deactivation_reason,deactivated_at,
 created_at,updated_at,created_by_operator_id,webhook_format,
 CASE WHEN preferences_set=0 AND channel='email' THEN '["incidents","maintenance"]' ELSE event_kinds_json END AS event_kinds_json,
 minimum_impact FROM subscribers;
DROP TRIGGER subscribers_capacity_insert;
DROP TRIGGER subscribers_capacity_update;
CREATE TRIGGER subscribers_capacity_insert BEFORE INSERT ON subscribers
WHEN NEW.state IN ('pending','active') AND (
  (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND destination<>NEW.destination)>=25000
  OR (NEW.channel='webhook' AND NEW.chat_kind IS NULL AND NEW.sms_kind=0 AND (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND channel='webhook' AND chat_kind IS NULL AND sms_kind=0 AND destination<>NEW.destination)>=2500)
  OR (NEW.chat_kind IN ('slack','teams') AND (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND chat_kind IN ('slack','teams') AND destination<>NEW.destination)>=1000)
)
BEGIN SELECT RAISE(ABORT,'over the subscriber limit'); END;
CREATE TRIGGER subscribers_capacity_update BEFORE UPDATE OF state,channel,chat_kind ON subscribers
WHEN NEW.state IN ('pending','active') AND (
  (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND id<>OLD.id)>=25000
  OR (NEW.channel='webhook' AND NEW.chat_kind IS NULL AND NEW.sms_kind=0 AND (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND channel='webhook' AND chat_kind IS NULL AND sms_kind=0 AND id<>OLD.id)>=2500)
  OR (NEW.chat_kind IN ('slack','teams') AND (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND chat_kind IN ('slack','teams') AND id<>OLD.id)>=1000)
)
BEGIN SELECT RAISE(ABORT,'over the subscriber limit'); END;

DROP TRIGGER subscriber_reporting_insert;

DROP TRIGGER subscriber_reporting_delete;

DROP TRIGGER subscriber_reporting_update;
CREATE TABLE sms_reporting_daily (
 day TEXT PRIMARY KEY NOT NULL, joined INTEGER NOT NULL DEFAULT 0 CHECK(joined>=0), left_count INTEGER NOT NULL DEFAULT 0 CHECK(left_count>=0)
);
DROP VIEW subscriber_reporting_all_baseline;
CREATE VIEW subscriber_reporting_all_baseline AS SELECT channel,eligible FROM subscriber_reporting_baseline
 UNION ALL SELECT 'slack',0 UNION ALL SELECT 'teams',0 UNION ALL SELECT 'sms',0;
DROP VIEW subscriber_reporting_all_daily;
CREATE VIEW subscriber_reporting_all_daily AS SELECT day,channel,joined,left_count FROM subscriber_reporting_daily
 UNION ALL SELECT day,channel,joined,left_count FROM subscriber_chat_reporting_daily
 UNION ALL SELECT day,'sms',joined,left_count FROM sms_reporting_daily;
CREATE TRIGGER subscriber_reporting_insert AFTER INSERT ON subscribers BEGIN
 UPDATE subscriber_reporting_tracking SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND started_at = '';
 INSERT INTO subscriber_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(NEW.chat_kind,NEW.channel),1,0 WHERE NEW.state IN ('pending','active') AND NEW.destination NOT LIKE 'deleted:%' AND NEW.chat_kind IS NULL AND NEW.sms_kind=0 ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
 INSERT INTO subscriber_chat_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(NEW.chat_kind,NEW.channel),1,0 WHERE NEW.state IN ('pending','active') AND NEW.destination NOT LIKE 'deleted:%' AND NEW.chat_kind IS NOT NULL ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
END;
CREATE TRIGGER subscriber_reporting_delete AFTER DELETE ON subscribers BEGIN
 UPDATE subscriber_reporting_tracking SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND started_at = '';
 INSERT INTO subscriber_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(OLD.chat_kind,OLD.channel),0,1 WHERE OLD.state IN ('pending','active') AND OLD.destination NOT LIKE 'deleted:%' AND OLD.chat_kind IS NULL AND OLD.sms_kind=0 ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
 INSERT INTO subscriber_chat_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(OLD.chat_kind,OLD.channel),0,1 WHERE OLD.state IN ('pending','active') AND OLD.destination NOT LIKE 'deleted:%' AND OLD.chat_kind IS NOT NULL ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
END;
CREATE TRIGGER subscriber_reporting_update AFTER UPDATE OF state,channel,chat_kind,sms_kind,destination ON subscribers BEGIN
 UPDATE subscriber_reporting_tracking SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND started_at = '';
 INSERT INTO subscriber_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(OLD.chat_kind,OLD.channel),0,1 WHERE OLD.state IN ('pending','active') AND OLD.destination NOT LIKE 'deleted:%' AND OLD.chat_kind IS NULL AND OLD.sms_kind=0 AND (NEW.state NOT IN ('pending','active') OR NEW.destination LIKE 'deleted:%' OR COALESCE(NEW.chat_kind,NEW.channel) <> COALESCE(OLD.chat_kind,OLD.channel)) ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
 INSERT INTO subscriber_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(NEW.chat_kind,NEW.channel),1,0 WHERE NEW.state IN ('pending','active') AND NEW.destination NOT LIKE 'deleted:%' AND NEW.chat_kind IS NULL AND NEW.sms_kind=0 AND (OLD.state NOT IN ('pending','active') OR OLD.destination LIKE 'deleted:%' OR COALESCE(OLD.chat_kind,OLD.channel) <> COALESCE(NEW.chat_kind,NEW.channel)) ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
 INSERT INTO subscriber_chat_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(OLD.chat_kind,OLD.channel),0,1 WHERE OLD.state IN ('pending','active') AND OLD.destination NOT LIKE 'deleted:%' AND OLD.chat_kind IS NOT NULL AND (NEW.state NOT IN ('pending','active') OR NEW.destination LIKE 'deleted:%' OR COALESCE(NEW.chat_kind,NEW.channel) <> COALESCE(OLD.chat_kind,OLD.channel)) ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
 INSERT INTO subscriber_chat_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(NEW.chat_kind,NEW.channel),1,0 WHERE NEW.state IN ('pending','active') AND NEW.destination NOT LIKE 'deleted:%' AND NEW.chat_kind IS NOT NULL AND (OLD.state NOT IN ('pending','active') OR OLD.destination LIKE 'deleted:%' OR COALESCE(OLD.chat_kind,OLD.channel) <> COALESCE(NEW.chat_kind,NEW.channel)) ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
END;

CREATE TRIGGER sms_reporting_insert AFTER INSERT ON subscribers WHEN NEW.sms_kind=1 AND NEW.state IN ('pending','active') AND NEW.destination NOT LIKE 'deleted:%' BEGIN
 INSERT INTO sms_reporting_daily(day,joined,left_count) VALUES(strftime('%Y-%m-%d','now'),1,0) ON CONFLICT(day) DO UPDATE SET joined=joined+1;
END;
CREATE TRIGGER sms_reporting_delete AFTER DELETE ON subscribers WHEN OLD.sms_kind=1 AND OLD.state IN ('pending','active') AND OLD.destination NOT LIKE 'deleted:%' BEGIN
 INSERT INTO sms_reporting_daily(day,joined,left_count) VALUES(strftime('%Y-%m-%d','now'),0,1) ON CONFLICT(day) DO UPDATE SET left_count=left_count+1;
END;
CREATE TRIGGER sms_reporting_update AFTER UPDATE OF state,destination ON subscribers WHEN NEW.sms_kind=1 BEGIN
 INSERT INTO sms_reporting_daily(day,joined,left_count) SELECT strftime('%Y-%m-%d','now'),1,0
 WHERE NEW.state IN ('pending','active') AND NEW.destination NOT LIKE 'deleted:%' AND (OLD.state NOT IN ('pending','active') OR OLD.destination LIKE 'deleted:%') ON CONFLICT(day) DO UPDATE SET joined=joined+1;
 INSERT INTO sms_reporting_daily(day,joined,left_count) SELECT strftime('%Y-%m-%d','now'),0,1
 WHERE OLD.state IN ('pending','active') AND OLD.destination NOT LIKE 'deleted:%' AND (NEW.state NOT IN ('pending','active') OR NEW.destination LIKE 'deleted:%') ON CONFLICT(day) DO UPDATE SET left_count=left_count+1;
END;
