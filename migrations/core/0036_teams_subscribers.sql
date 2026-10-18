-- Teams shares the durable webhook transport, with encrypted bearer URLs.
ALTER TABLE subscribers ADD COLUMN delivery_kind TEXT NOT NULL DEFAULT 'standard' CHECK (delivery_kind IN ('standard', 'teams'));
ALTER TABLE subscribers ADD COLUMN destination_key TEXT;
CREATE UNIQUE INDEX subscribers_destination_key_idx ON subscribers(destination_key) WHERE destination_key IS NOT NULL;

ALTER TABLE notification_channel_selections ADD COLUMN teams_selected INTEGER NOT NULL DEFAULT 0 CHECK (teams_selected IN (0, 1));

ALTER TABLE notification_channel_selections ADD COLUMN webhook_selected INTEGER NOT NULL DEFAULT 1 CHECK (webhook_selected IN (0, 1));

-- Aggregate facts hold no destinations. Preserve every existing observation.
DROP TRIGGER subscriber_reporting_insert;
DROP TRIGGER subscriber_reporting_delete;
DROP TRIGGER subscriber_reporting_update;
CREATE TABLE subscriber_reporting_baseline_teams (
  channel TEXT PRIMARY KEY CHECK (channel IN ('email', 'webhook', 'teams')),
  eligible INTEGER NOT NULL CHECK (eligible >= 0)
);
INSERT INTO subscriber_reporting_baseline_teams SELECT * FROM subscriber_reporting_baseline;
INSERT INTO subscriber_reporting_baseline_teams VALUES ('teams', 0);
DROP TABLE subscriber_reporting_baseline;
ALTER TABLE subscriber_reporting_baseline_teams RENAME TO subscriber_reporting_baseline;
CREATE TABLE subscriber_reporting_daily_teams (
  day TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook', 'teams')),
  joined INTEGER NOT NULL DEFAULT 0 CHECK (joined >= 0),
  left_count INTEGER NOT NULL DEFAULT 0 CHECK (left_count >= 0),
  PRIMARY KEY (day, channel)
);
INSERT INTO subscriber_reporting_daily_teams SELECT * FROM subscriber_reporting_daily;
DROP TABLE subscriber_reporting_daily;
ALTER TABLE subscriber_reporting_daily_teams RENAME TO subscriber_reporting_daily;

CREATE TRIGGER subscriber_reporting_insert AFTER INSERT ON subscribers
WHEN NEW.state IN ('pending', 'active') AND NEW.destination NOT LIKE 'deleted:%'
BEGIN
  UPDATE subscriber_reporting_tracking SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND started_at = '';
  INSERT INTO subscriber_reporting_daily (day, channel, joined, left_count)
  VALUES (strftime('%Y-%m-%d', 'now'), (CASE WHEN NEW.delivery_kind = 'teams' THEN 'teams' ELSE NEW.channel END), 1, 0)
  ON CONFLICT(day, channel) DO UPDATE SET joined = joined + 1;
END;

CREATE TRIGGER subscriber_reporting_delete AFTER DELETE ON subscribers
WHEN OLD.state IN ('pending', 'active') AND OLD.destination NOT LIKE 'deleted:%'
BEGIN
  UPDATE subscriber_reporting_tracking SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND started_at = '';
  INSERT INTO subscriber_reporting_daily (day, channel, joined, left_count)
  VALUES (strftime('%Y-%m-%d', 'now'), (CASE WHEN OLD.delivery_kind = 'teams' THEN 'teams' ELSE OLD.channel END), 0, 1)
  ON CONFLICT(day, channel) DO UPDATE SET left_count = left_count + 1;
END;

CREATE TRIGGER subscriber_reporting_update AFTER UPDATE OF state, channel, destination, delivery_kind ON subscribers
BEGIN
  UPDATE subscriber_reporting_tracking SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND started_at = '';
  INSERT INTO subscriber_reporting_daily (day, channel, joined, left_count)
  SELECT strftime('%Y-%m-%d', 'now'), (CASE WHEN OLD.delivery_kind = 'teams' THEN 'teams' ELSE OLD.channel END), 0, 1
  WHERE OLD.state IN ('pending', 'active') AND OLD.destination NOT LIKE 'deleted:%'
    AND (NEW.state NOT IN ('pending', 'active') OR NEW.destination LIKE 'deleted:%' OR (CASE WHEN NEW.delivery_kind = 'teams' THEN 'teams' ELSE NEW.channel END) <> (CASE WHEN OLD.delivery_kind = 'teams' THEN 'teams' ELSE OLD.channel END))
  ON CONFLICT(day, channel) DO UPDATE SET left_count = left_count + 1;
  INSERT INTO subscriber_reporting_daily (day, channel, joined, left_count)
  SELECT strftime('%Y-%m-%d', 'now'), (CASE WHEN NEW.delivery_kind = 'teams' THEN 'teams' ELSE NEW.channel END), 1, 0
  WHERE NEW.state IN ('pending', 'active') AND NEW.destination NOT LIKE 'deleted:%'
    AND (OLD.state NOT IN ('pending', 'active') OR OLD.destination LIKE 'deleted:%' OR (CASE WHEN NEW.delivery_kind = 'teams' THEN 'teams' ELSE NEW.channel END) <> (CASE WHEN OLD.delivery_kind = 'teams' THEN 'teams' ELSE OLD.channel END))
  ON CONFLICT(day, channel) DO UPDATE SET joined = joined + 1;
END;
