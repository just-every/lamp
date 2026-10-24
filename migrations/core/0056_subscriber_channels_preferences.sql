-- Keep every pre-0056 table and reference intact. Chat subscriptions use the
-- existing webhook transport plus an explicit kind; subscriber_directory is the
-- single logical read projection. Defaults require no restore-time data rewrite.
ALTER TABLE subscribers ADD COLUMN chat_kind TEXT CHECK(chat_kind IN ('slack','teams')) CHECK(chat_kind IS NULL OR channel = 'webhook');
ALTER TABLE subscribers ADD COLUMN event_kinds_json TEXT NOT NULL DEFAULT '["incidents","maintenance","components"]' CHECK(json_valid(event_kinds_json) AND json_type(event_kinds_json) = 'array');
ALTER TABLE subscribers ADD COLUMN minimum_impact TEXT CHECK(minimum_impact IS NULL OR minimum_impact = 'Partially unavailable');
ALTER TABLE subscribers ADD COLUMN preferences_set INTEGER NOT NULL DEFAULT 0 CHECK(preferences_set IN (0,1));

CREATE VIEW subscriber_directory AS SELECT id, COALESCE(chat_kind,channel) AS channel,
 destination,contact_email,state,selection_mode,token_hash,deactivation_reason,deactivated_at,
 created_at,updated_at,created_by_operator_id,webhook_format,
 CASE WHEN preferences_set=0 AND channel='email' THEN '["incidents","maintenance"]' ELSE event_kinds_json END AS event_kinds_json,
 minimum_impact FROM subscribers;

-- Self-serve destinations have subscriber authority, never an invented operator.
CREATE TABLE subscriber_chat_destinations (
 subscriber_id TEXT PRIMARY KEY NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('slack','teams')), sealed_url TEXT NOT NULL,
 slack_team_id TEXT, slack_channel_id TEXT, name TEXT NOT NULL, host TEXT NOT NULL,
 selection_mode TEXT NOT NULL DEFAULT 'all' CHECK(selection_mode IN ('all','selected')),
 removed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX subscriber_chat_team ON subscriber_chat_destinations(slack_team_id);
CREATE VIEW delivery_channel_destinations AS
 SELECT id,kind,name,sealed_url,host,selection_mode,created_by_operator_id,removed_at,created_at,updated_at FROM channel_destinations
 UNION ALL
 SELECT subscriber_id,kind,name,sealed_url,host,selection_mode,NULL,removed_at,created_at,updated_at FROM subscriber_chat_destinations;
CREATE TABLE subscriber_channel_posts (
 id TEXT PRIMARY KEY NOT NULL,
 incident_update_id TEXT NOT NULL REFERENCES incident_updates(id) ON DELETE RESTRICT,
 destination_id TEXT NOT NULL REFERENCES subscriber_chat_destinations(subscriber_id) ON DELETE CASCADE,
 queued_at TEXT NOT NULL,
 incident_impact TEXT CHECK(incident_impact IN ('none','minor','major','critical')),
 UNIQUE(incident_update_id,destination_id)
);
CREATE VIEW delivery_channel_posts AS
 SELECT id,incident_update_id,destination_id,queued_at,incident_impact FROM channel_posts
 UNION ALL SELECT id,incident_update_id,destination_id,queued_at,incident_impact FROM subscriber_channel_posts;
CREATE TRIGGER subscriber_channel_posts_capture_impact AFTER INSERT ON subscriber_channel_posts BEGIN
 UPDATE subscriber_channel_posts SET incident_impact = (
 SELECT COALESCE(i.impact_override, CASE i.peak_impact WHEN 'Major outage' THEN 'critical'
 WHEN 'Partially unavailable' THEN 'major' WHEN 'Degraded performance' THEN 'minor' ELSE 'none' END)
 FROM incidents i JOIN incident_updates u ON u.incident_id=i.id WHERE u.id=NEW.incident_update_id
 ) WHERE id=NEW.id AND incident_impact IS NULL;
END;

CREATE TABLE subscriber_oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  component_ids_json TEXT NOT NULL CHECK(json_valid(component_ids_json)),
  event_kinds_json TEXT NOT NULL CHECK(json_valid(event_kinds_json)),
  minimum_impact TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE component_notification_events (
  id TEXT PRIMARY KEY NOT NULL,
  component_id TEXT NOT NULL,
  component_name TEXT NOT NULL,
  component_created_at TEXT NOT NULL,
  previous_state TEXT NOT NULL,
  new_state TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  claimant_kind TEXT NOT NULL
);


CREATE TABLE subscriber_chat_reporting_daily (
 day TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('slack','teams')),
 joined INTEGER NOT NULL DEFAULT 0 CHECK(joined>=0), left_count INTEGER NOT NULL DEFAULT 0 CHECK(left_count>=0), PRIMARY KEY(day,channel)
);
CREATE VIEW subscriber_reporting_all_baseline AS SELECT channel,eligible FROM subscriber_reporting_baseline
 UNION ALL SELECT 'slack',0 UNION ALL SELECT 'teams',0;
CREATE VIEW subscriber_reporting_all_daily AS SELECT day,channel,joined,left_count FROM subscriber_reporting_daily
 UNION ALL SELECT day,channel,joined,left_count FROM subscriber_chat_reporting_daily;
DROP TRIGGER subscriber_reporting_insert;
DROP TRIGGER subscriber_reporting_delete;
DROP TRIGGER subscriber_reporting_update;
CREATE TRIGGER subscriber_reporting_insert AFTER INSERT ON subscribers BEGIN
 UPDATE subscriber_reporting_tracking SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND started_at = '';
 INSERT INTO subscriber_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(NEW.chat_kind,NEW.channel),1,0 WHERE NEW.state IN ('pending','active') AND NEW.destination NOT LIKE 'deleted:%' AND NEW.chat_kind IS NULL ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
 INSERT INTO subscriber_chat_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(NEW.chat_kind,NEW.channel),1,0 WHERE NEW.state IN ('pending','active') AND NEW.destination NOT LIKE 'deleted:%' AND NEW.chat_kind IS NOT NULL ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
END;
CREATE TRIGGER subscriber_reporting_delete AFTER DELETE ON subscribers BEGIN
 UPDATE subscriber_reporting_tracking SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND started_at = '';
 INSERT INTO subscriber_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(OLD.chat_kind,OLD.channel),0,1 WHERE OLD.state IN ('pending','active') AND OLD.destination NOT LIKE 'deleted:%' AND OLD.chat_kind IS NULL ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
 INSERT INTO subscriber_chat_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(OLD.chat_kind,OLD.channel),0,1 WHERE OLD.state IN ('pending','active') AND OLD.destination NOT LIKE 'deleted:%' AND OLD.chat_kind IS NOT NULL ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
END;
CREATE TRIGGER subscriber_reporting_update AFTER UPDATE OF state,channel,chat_kind,destination ON subscribers BEGIN
 UPDATE subscriber_reporting_tracking SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND started_at = '';
 INSERT INTO subscriber_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(OLD.chat_kind,OLD.channel),0,1 WHERE OLD.state IN ('pending','active') AND OLD.destination NOT LIKE 'deleted:%' AND OLD.chat_kind IS NULL AND (NEW.state NOT IN ('pending','active') OR NEW.destination LIKE 'deleted:%' OR COALESCE(NEW.chat_kind,NEW.channel) <> COALESCE(OLD.chat_kind,OLD.channel)) ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
 INSERT INTO subscriber_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(NEW.chat_kind,NEW.channel),1,0 WHERE NEW.state IN ('pending','active') AND NEW.destination NOT LIKE 'deleted:%' AND NEW.chat_kind IS NULL AND (OLD.state NOT IN ('pending','active') OR OLD.destination LIKE 'deleted:%' OR COALESCE(OLD.chat_kind,OLD.channel) <> COALESCE(NEW.chat_kind,NEW.channel)) ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
 INSERT INTO subscriber_chat_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(OLD.chat_kind,OLD.channel),0,1 WHERE OLD.state IN ('pending','active') AND OLD.destination NOT LIKE 'deleted:%' AND OLD.chat_kind IS NOT NULL AND (NEW.state NOT IN ('pending','active') OR NEW.destination LIKE 'deleted:%' OR COALESCE(NEW.chat_kind,NEW.channel) <> COALESCE(OLD.chat_kind,OLD.channel)) ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
 INSERT INTO subscriber_chat_reporting_daily(day,channel,joined,left_count) SELECT strftime('%Y-%m-%d','now'),COALESCE(NEW.chat_kind,NEW.channel),1,0 WHERE NEW.state IN ('pending','active') AND NEW.destination NOT LIKE 'deleted:%' AND NEW.chat_kind IS NOT NULL AND (OLD.state NOT IN ('pending','active') OR OLD.destination LIKE 'deleted:%' OR COALESCE(OLD.chat_kind,OLD.channel) <> COALESCE(NEW.chat_kind,NEW.channel)) ON CONFLICT(day,channel) DO UPDATE SET joined=joined+excluded.joined,left_count=left_count+excluded.left_count;
END;
CREATE TRIGGER subscribers_capacity_insert BEFORE INSERT ON subscribers
WHEN NEW.state IN ('pending','active') AND (
  (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND destination<>NEW.destination)>=25000
  OR (NEW.channel='webhook' AND NEW.chat_kind IS NULL AND (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND channel='webhook' AND chat_kind IS NULL AND destination<>NEW.destination)>=2500)
  OR (NEW.chat_kind IN ('slack','teams') AND (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND chat_kind IN ('slack','teams') AND destination<>NEW.destination)>=1000)
)
BEGIN SELECT RAISE(ABORT,'over the subscriber limit'); END;
CREATE TRIGGER subscribers_capacity_update BEFORE UPDATE OF state,channel,chat_kind ON subscribers
WHEN NEW.state IN ('pending','active') AND (
  (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND id<>OLD.id)>=25000
  OR (NEW.channel='webhook' AND NEW.chat_kind IS NULL AND (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND channel='webhook' AND chat_kind IS NULL AND id<>OLD.id)>=2500)
  OR (NEW.chat_kind IN ('slack','teams') AND (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND chat_kind IN ('slack','teams') AND id<>OLD.id)>=1000)
)
BEGIN SELECT RAISE(ABORT,'over the subscriber limit'); END;
CREATE INDEX subscribers_capacity_idx ON subscribers(state,channel);
CREATE TABLE channel_subscriber_events (
  id TEXT PRIMARY KEY NOT NULL,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('maintenance','component')),
  queued_at TEXT NOT NULL,
  UNIQUE(subscriber_id,event_id,kind)
);
