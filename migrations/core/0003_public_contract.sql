-- Public-page configuration, corrected uptime intervals, and observable
-- snapshot builds. Existing snapshots stay valid while a new build fails.

ALTER TABLE page_settings ADD COLUMN logo_key TEXT;
ALTER TABLE page_settings ADD COLUMN logo_content_type TEXT;
ALTER TABLE page_settings ADD COLUMN widget_allowed_origins TEXT NOT NULL DEFAULT '[]';
ALTER TABLE page_settings ADD COLUMN mail_from_address TEXT NOT NULL DEFAULT '';

CREATE TABLE component_state_corrections (
  id TEXT PRIMARY KEY NOT NULL,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  history_id TEXT NOT NULL REFERENCES component_state_history(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('Operational', 'Degraded performance', 'Partially unavailable', 'Major outage', 'Under maintenance')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX component_state_corrections_component_interval_idx
  ON component_state_corrections(component_id, starts_at, ends_at);

CREATE TABLE snapshot_builds (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('building', 'published', 'failed')),
  version TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX snapshot_builds_status_started_idx ON snapshot_builds(status, started_at);
