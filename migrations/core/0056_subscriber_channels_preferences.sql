-- Preserve subscription authority and all dependent records while widening the
-- original checked channel. D1 keeps foreign_keys enabled inside migrations.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE _subscriber_components_0056 AS SELECT * FROM subscriber_components;
CREATE TABLE _subscriber_tokens_0056 AS SELECT * FROM subscriber_tokens;
CREATE TABLE _subscriber_intake_0056 AS SELECT * FROM subscriber_intake;
CREATE TABLE subscribers_0056 (
  id TEXT PRIMARY KEY NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('email','webhook','slack','teams')),
  destination TEXT NOT NULL UNIQUE,
  contact_email TEXT,
  state TEXT NOT NULL CHECK(state IN ('pending','active','deactivated')),
  selection_mode TEXT NOT NULL DEFAULT 'all' CHECK(selection_mode IN ('all','selected')),
  token_hash TEXT NOT NULL UNIQUE,
  deactivation_reason TEXT,
  deactivated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL,
  webhook_format TEXT NOT NULL DEFAULT 'lamp' CHECK(webhook_format IN ('lamp','statuspage')),
  event_kinds_json TEXT NOT NULL DEFAULT '["incidents","maintenance"]' CHECK(json_valid(event_kinds_json) AND json_type(event_kinds_json) = 'array'),
  minimum_impact TEXT CHECK(minimum_impact IS NULL OR minimum_impact = 'Partially unavailable')
);
INSERT INTO subscribers_0056 SELECT id, channel, destination, contact_email, state, selection_mode, token_hash, deactivation_reason, deactivated_at, created_at, updated_at, created_by_operator_id, webhook_format,
 CASE WHEN channel = 'webhook' THEN '["incidents","maintenance","components"]' ELSE '["incidents","maintenance"]' END, NULL FROM subscribers;
DROP TABLE subscribers;
ALTER TABLE subscribers_0056 RENAME TO subscribers;
CREATE INDEX subscribers_state_idx ON subscribers(state);
INSERT INTO subscriber_components SELECT * FROM _subscriber_components_0056;
INSERT INTO subscriber_tokens SELECT * FROM _subscriber_tokens_0056;
INSERT INTO subscriber_intake SELECT * FROM _subscriber_intake_0056;
DROP TABLE _subscriber_components_0056;
DROP TABLE _subscriber_tokens_0056;
DROP TABLE _subscriber_intake_0056;
PRAGMA defer_foreign_keys = OFF;
-- Self-serve channels have no operator author. Preserve existing channel posts.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE _channel_components_0056 AS SELECT * FROM channel_destination_components;
CREATE TABLE _channel_posts_0056 AS SELECT * FROM channel_posts;
CREATE TABLE channel_destinations_0056 (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('slack','teams')),
  name TEXT NOT NULL,
  sealed_url TEXT NOT NULL,
  host TEXT NOT NULL,
  selection_mode TEXT NOT NULL DEFAULT 'all' CHECK(selection_mode IN ('all','selected')),
  created_by_operator_id TEXT REFERENCES operators(id) ON DELETE RESTRICT,
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO channel_destinations_0056 SELECT * FROM channel_destinations;
DROP TABLE channel_destinations;
ALTER TABLE channel_destinations_0056 RENAME TO channel_destinations;
INSERT INTO channel_destination_components SELECT * FROM _channel_components_0056;
INSERT INTO channel_posts SELECT * FROM _channel_posts_0056;
DROP TABLE _channel_components_0056;
DROP TABLE _channel_posts_0056;
PRAGMA defer_foreign_keys = OFF;
-- Reporting keeps its existing counts while including the two new channels.
CREATE TABLE subscriber_reporting_baseline_0056 (
  channel TEXT PRIMARY KEY CHECK(channel IN ('email','webhook','slack','teams')),
  eligible INTEGER NOT NULL CHECK(eligible>=0)
);
INSERT INTO subscriber_reporting_baseline_0056 SELECT * FROM subscriber_reporting_baseline;
INSERT INTO subscriber_reporting_baseline_0056 VALUES('slack',0),('teams',0);
DROP TABLE subscriber_reporting_baseline;
ALTER TABLE subscriber_reporting_baseline_0056 RENAME TO subscriber_reporting_baseline;
CREATE TABLE subscriber_reporting_daily_0056 (
  day TEXT NOT NULL,channel TEXT NOT NULL CHECK(channel IN ('email','webhook','slack','teams')),
  joined INTEGER NOT NULL DEFAULT 0 CHECK(joined>=0),left_count INTEGER NOT NULL DEFAULT 0 CHECK(left_count>=0),
  PRIMARY KEY(day,channel)
);
INSERT INTO subscriber_reporting_daily_0056 SELECT * FROM subscriber_reporting_daily;
DROP TABLE subscriber_reporting_daily;
ALTER TABLE subscriber_reporting_daily_0056 RENAME TO subscriber_reporting_daily;

CREATE TRIGGER subscriber_reporting_insert AFTER INSERT ON subscribers
WHEN NEW.state IN ('pending', 'active') AND NEW.destination NOT LIKE 'deleted:%'
BEGIN
  UPDATE subscriber_reporting_tracking SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND started_at = '';
  INSERT INTO subscriber_reporting_daily (day, channel, joined, left_count)
  VALUES (strftime('%Y-%m-%d', 'now'), NEW.channel, 1, 0)
  ON CONFLICT(day, channel) DO UPDATE SET joined = joined + 1;
END;

CREATE TRIGGER subscriber_reporting_delete AFTER DELETE ON subscribers
WHEN OLD.state IN ('pending', 'active') AND OLD.destination NOT LIKE 'deleted:%'
BEGIN
  UPDATE subscriber_reporting_tracking SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND started_at = '';
  INSERT INTO subscriber_reporting_daily (day, channel, joined, left_count)
  VALUES (strftime('%Y-%m-%d', 'now'), OLD.channel, 0, 1)
  ON CONFLICT(day, channel) DO UPDATE SET left_count = left_count + 1;
END;

CREATE TRIGGER subscriber_reporting_update AFTER UPDATE OF state, channel, destination ON subscribers
BEGIN
  UPDATE subscriber_reporting_tracking SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND started_at = '';
  INSERT INTO subscriber_reporting_daily (day, channel, joined, left_count)
  SELECT strftime('%Y-%m-%d', 'now'), OLD.channel, 0, 1
  WHERE OLD.state IN ('pending', 'active') AND OLD.destination NOT LIKE 'deleted:%'
    AND (NEW.state NOT IN ('pending', 'active') OR NEW.destination LIKE 'deleted:%' OR NEW.channel <> OLD.channel)
  ON CONFLICT(day, channel) DO UPDATE SET left_count = left_count + 1;
  INSERT INTO subscriber_reporting_daily (day, channel, joined, left_count)
  SELECT strftime('%Y-%m-%d', 'now'), NEW.channel, 1, 0
  WHERE NEW.state IN ('pending', 'active') AND NEW.destination NOT LIKE 'deleted:%'
    AND (OLD.state NOT IN ('pending', 'active') OR OLD.destination LIKE 'deleted:%' OR NEW.channel <> OLD.channel)
  ON CONFLICT(day, channel) DO UPDATE SET joined = joined + 1;
END;

CREATE TABLE subscriber_chat_destinations (
  subscriber_id TEXT PRIMARY KEY NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('slack','teams')),
  sealed_url TEXT NOT NULL,
  slack_team_id TEXT,
  slack_channel_id TEXT
);
CREATE INDEX subscriber_chat_team ON subscriber_chat_destinations(slack_team_id);
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

CREATE TRIGGER subscribers_capacity_insert BEFORE INSERT ON subscribers
WHEN NEW.state IN ('pending','active') AND (
  (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND destination<>NEW.destination)>=25000
  OR (NEW.channel='webhook' AND (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND channel='webhook' AND destination<>NEW.destination)>=2500)
  OR (NEW.channel IN ('slack','teams') AND (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND channel IN ('slack','teams') AND destination<>NEW.destination)>=1000)
)
BEGIN SELECT RAISE(ABORT,'over the subscriber limit'); END;
CREATE TRIGGER subscribers_capacity_update BEFORE UPDATE OF state,channel ON subscribers
WHEN NEW.state IN ('pending','active') AND (
  (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND id<>OLD.id)>=25000
  OR (NEW.channel='webhook' AND (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND channel='webhook' AND id<>OLD.id)>=2500)
  OR (NEW.channel IN ('slack','teams') AND (SELECT COUNT(*) FROM subscribers WHERE state IN ('pending','active') AND channel IN ('slack','teams') AND id<>OLD.id)>=1000)
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
