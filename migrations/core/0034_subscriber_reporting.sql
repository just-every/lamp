-- Counts retain no subscriber identifiers or destinations. The baseline is an
-- inventory at installation time, never a reconstruction from created_at.
CREATE TABLE subscriber_reporting_tracking (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at TEXT NOT NULL
);
-- Deterministic migration seed: native restore compares an empty installation
-- with its migration seeds. Observation starts at the first change or report.
INSERT INTO subscriber_reporting_tracking VALUES (1, '');

CREATE TABLE subscriber_reporting_baseline (
  channel TEXT PRIMARY KEY CHECK (channel IN ('email', 'webhook')),
  eligible INTEGER NOT NULL CHECK (eligible >= 0)
);
INSERT INTO subscriber_reporting_baseline
SELECT channels.channel, COUNT(s.id)
FROM (SELECT 'email' AS channel UNION ALL SELECT 'webhook') channels
LEFT JOIN subscribers s ON s.channel = channels.channel
  AND s.state IN ('pending', 'active') AND s.destination NOT LIKE 'deleted:%'
GROUP BY channels.channel;

CREATE TABLE subscriber_reporting_daily (
  day TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook')),
  joined INTEGER NOT NULL DEFAULT 0 CHECK (joined >= 0),
  left_count INTEGER NOT NULL DEFAULT 0 CHECK (left_count >= 0),
  PRIMARY KEY (day, channel)
);

-- Database observation time includes imports/undo without backdating them.
-- Pending -> active changes no inventory; channel moves leave one and join
-- the other. Erasure leaves once, and a later tombstone delete leaves nothing.
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
