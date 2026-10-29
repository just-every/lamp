CREATE TABLE vendor_dependencies (
  id TEXT PRIMARY KEY NOT NULL,
  component_id TEXT NOT NULL UNIQUE REFERENCES components(id) ON DELETE CASCADE,
  catalog_id TEXT,
  name TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status_page_url TEXT NOT NULL,
  format TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '{}',
  mode TEXT NOT NULL DEFAULT 'show' CHECK(mode IN ('show','draft','rollup')),
  dependent_components_json TEXT NOT NULL DEFAULT '[]',
  template_id TEXT REFERENCES incident_templates(id) ON DELETE SET NULL,
  created_by_operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL,
  state TEXT,
  source_state TEXT,
  summary TEXT,
  incident_key TEXT,
  incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  unavailable_at TEXT,
  last_read_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE vendor_source_reads (source_url TEXT PRIMARY KEY NOT NULL,read_after INTEGER NOT NULL DEFAULT 0);
CREATE TABLE vendor_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  dependency_id TEXT REFERENCES vendor_dependencies(id) ON DELETE SET NULL,
  component_id TEXT REFERENCES components(id) ON DELETE SET NULL,
  incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  state TEXT NOT NULL,
  source_state TEXT NOT NULL,
  summary TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
ALTER TABLE component_state_history ADD COLUMN source_name TEXT;
ALTER TABLE component_state_history ADD COLUMN source_url TEXT;
CREATE TRIGGER vendor_dependency_snapshot_insert AFTER INSERT ON vendor_dependencies BEGIN
  UPDATE public_snapshot_work SET requested_revision=requested_revision+1 WHERE id='default';
END;
CREATE TRIGGER vendor_dependency_snapshot_update AFTER UPDATE ON vendor_dependencies BEGIN
  UPDATE public_snapshot_work SET requested_revision=requested_revision+1 WHERE id='default';
END;
CREATE TRIGGER vendor_dependency_snapshot_delete AFTER DELETE ON vendor_dependencies BEGIN
  UPDATE public_snapshot_work SET requested_revision=requested_revision+1 WHERE id='default';
END;
