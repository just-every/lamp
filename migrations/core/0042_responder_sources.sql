-- Additive: existing source credentials, mappings and every receipt remain unchanged.
ALTER TABLE alert_sources ADD COLUMN responder_preset TEXT CHECK (responder_preset IN ('pagerduty'));
ALTER TABLE alert_sources ADD COLUMN responder_sealed_credentials TEXT;
-- Retained on export while ciphertext is removed, so restored connections say reconnect.
ALTER TABLE alert_sources ADD COLUMN responder_connected INTEGER NOT NULL DEFAULT 0;
CREATE TABLE alert_responder_posts (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES alert_sources(id) ON DELETE CASCADE,
  incident_update_id TEXT NOT NULL REFERENCES incident_updates(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','sending','sent','failed')),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, incident_update_id, external_id)
);
