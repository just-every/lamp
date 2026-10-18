-- Keep the released preset CHECK unchanged; grouped sources have a separate discriminator.
ALTER TABLE alert_sources ADD COLUMN grouped_preset TEXT CHECK (grouped_preset IN ('alertmanager','grafana'));
ALTER TABLE alert_sources ADD COLUMN label_matchers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(label_matchers_json));
CREATE TABLE alert_group_members (
  source_id TEXT NOT NULL REFERENCES alert_sources(id) ON DELETE CASCADE,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  group_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('firing','resolved')),
  received_at TEXT NOT NULL,
  recovered_at TEXT,
  PRIMARY KEY (source_id, incident_id, group_key, fingerprint)
);
