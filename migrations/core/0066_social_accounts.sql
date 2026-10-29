-- INTEG-002: credentials stay sealed; publication facts join the update's batch.
CREATE TABLE social_accounts (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL CHECK(network IN ('x','bluesky','mastodon')),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  host TEXT NOT NULL,
  identifier TEXT NOT NULL DEFAULT '',
  sealed_credential TEXT NOT NULL,
  created_by_operator_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  removed_at TEXT
);
CREATE TABLE social_settings (
  id TEXT PRIMARY KEY CHECK(id='default'),
  post_by_default INTEGER NOT NULL DEFAULT 0 CHECK(post_by_default IN (0,1))
);
CREATE TABLE social_posts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES social_accounts(id),
  incident_id TEXT REFERENCES incidents(id),
  maintenance_id TEXT REFERENCES maintenance(id),
  reference TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  customer_impact TEXT NOT NULL,
  prefix TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  body TEXT,
  text TEXT,
  post_id TEXT,
  post_cid TEXT,
  delivered_at TEXT,
  UNIQUE(event_id,account_id),
  CHECK((incident_id IS NULL) <> (maintenance_id IS NULL))
);
CREATE INDEX social_posts_thread ON social_posts(account_id,incident_id,queued_at,id);
