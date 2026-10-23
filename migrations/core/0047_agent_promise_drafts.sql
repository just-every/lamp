-- Retain a preparation receipt after its draft publishes or is replaced, so a
-- repeated tick can never create a second draft for the same committed time.
CREATE TABLE incident_agent_draft_preparations (
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  commitment_at TEXT NOT NULL,
  update_id TEXT NOT NULL REFERENCES incident_updates(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL,
  preparation_json TEXT NOT NULL,
  prepared_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  PRIMARY KEY (incident_id, commitment_at)
);
CREATE UNIQUE INDEX incident_agent_draft_preparation_draft ON incident_agent_draft_preparations(draft_id);
