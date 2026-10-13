-- Base integrations core delivery store (Base d6080a2, modules/integrations/core/schema.sql), used by Slack and Teams channels.
CREATE TABLE IF NOT EXISTS integration_deliveries (
 namespace TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, destination_hash TEXT NOT NULL,
 envelope TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('queued','sending','accepted','rejected','uncertain')),
 attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, next_at INTEGER NOT NULL,
 claim TEXT, claim_until INTEGER, max_attempts INTEGER NOT NULL, retry_delays TEXT NOT NULL,
 PRIMARY KEY(namespace,id)
);
CREATE INDEX IF NOT EXISTS integration_deliveries_due ON integration_deliveries(namespace,state,next_at);
CREATE TABLE IF NOT EXISTS integration_attempts (
 namespace TEXT NOT NULL, id TEXT NOT NULL, delivery_id TEXT NOT NULL, number INTEGER NOT NULL,
 started_at INTEGER NOT NULL, finished_at INTEGER, outcome TEXT,
 PRIMARY KEY(namespace,id), UNIQUE(namespace,delivery_id,number)
);
CREATE TABLE IF NOT EXISTS integration_resolutions (
 namespace TEXT NOT NULL, id TEXT NOT NULL, delivery_id TEXT NOT NULL, at INTEGER NOT NULL, outcome TEXT NOT NULL,
 PRIMARY KEY(namespace,id)
);
CREATE TABLE IF NOT EXISTS integration_replays (
 namespace TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, envelope TEXT NOT NULL, received_at INTEGER NOT NULL,
 PRIMARY KEY(namespace,id)
);
CREATE TABLE IF NOT EXISTS integration_tokens (
 namespace TEXT NOT NULL, id TEXT NOT NULL, token_hash TEXT NOT NULL, name TEXT NOT NULL, scopes TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER, revoked_at INTEGER,
 PRIMARY KEY(namespace,id), UNIQUE(namespace,token_hash)
);
CREATE TABLE IF NOT EXISTS integration_token_usage (
 namespace TEXT NOT NULL, id TEXT NOT NULL, token_id TEXT, at INTEGER NOT NULL, required_scopes TEXT NOT NULL, allowed INTEGER NOT NULL,
 request_id TEXT, resource TEXT,
 PRIMARY KEY(namespace,id)
);
CREATE TABLE IF NOT EXISTS integration_token_events (
 namespace TEXT NOT NULL, id TEXT NOT NULL, token_id TEXT NOT NULL, at INTEGER NOT NULL,
 action TEXT NOT NULL, feature TEXT NOT NULL,
 PRIMARY KEY(namespace,id)
);

-- Slack and Teams channels a page posts incident updates to. The webhook URL is
-- a secret: only its AES-GCM ciphertext (sealed_url) and host are kept.
CREATE TABLE channel_destinations (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('slack', 'teams')),
  name TEXT NOT NULL,
  sealed_url TEXT NOT NULL,
  host TEXT NOT NULL,
  selection_mode TEXT NOT NULL DEFAULT 'all' CHECK (selection_mode IN ('all', 'selected')),
  created_by_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE channel_destination_components (
  destination_id TEXT NOT NULL REFERENCES channel_destinations(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  PRIMARY KEY (destination_id, component_id)
);

-- One post per published update and channel, committed with the update.
CREATE TABLE channel_posts (
  id TEXT PRIMARY KEY NOT NULL,
  incident_update_id TEXT NOT NULL REFERENCES incident_updates(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES channel_destinations(id) ON DELETE CASCADE,
  queued_at TEXT NOT NULL,
  UNIQUE (incident_update_id, destination_id)
);

-- Monitor presets: the tool whose own alert shape a source reads, and the component its drafts attach.
ALTER TABLE alert_sources ADD COLUMN preset TEXT CHECK (preset IS NULL OR preset IN ('datadog', 'uptimerobot', 'betterstack', 'pingdom'));
ALTER TABLE alert_sources ADD COLUMN component_id TEXT REFERENCES components(id) ON DELETE SET NULL;
