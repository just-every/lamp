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
