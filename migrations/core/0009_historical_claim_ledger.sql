-- A component-state history row records the derived aggregate, not an
-- individual claim. Preserve each source claim or release so a retroactive
-- incident can be reconstructed without treating a later aggregate as a
-- past source state.
CREATE TABLE component_claim_events (
  id TEXT PRIMARY KEY NOT NULL,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  cause_type TEXT NOT NULL CHECK (cause_type IN ('standing-claim', 'incident', 'maintenance')),
  cause_id TEXT,
  state TEXT CHECK (state IN ('Operational', 'Degraded performance', 'Partially unavailable', 'Major outage', 'Under maintenance')),
  changed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX component_claim_events_component_changed_idx ON component_claim_events(component_id, changed_at);

-- Maintenance attachments are immutable after scheduling, so these triggers
-- record the exact attached claim in the same transaction as its state change.
CREATE TRIGGER component_claim_events_maintenance_started
AFTER UPDATE OF state ON maintenance
WHEN OLD.state = 'Scheduled' AND NEW.state = 'In progress'
BEGIN
  INSERT INTO component_claim_events (id, component_id, cause_type, cause_id, state, changed_at, created_at, updated_at)
  SELECT substr(NEW.id, 1, 10) || upper(substr(hex(randomblob(16)), 1, 16)), component_id, 'maintenance', NEW.id, 'Under maintenance', NEW.updated_at, NEW.updated_at, NEW.updated_at
  FROM maintenance_components
  WHERE maintenance_id = NEW.id AND component_id IS NOT NULL;
END;

CREATE TRIGGER component_claim_events_maintenance_completed
AFTER UPDATE OF state ON maintenance
WHEN OLD.state = 'In progress' AND NEW.state = 'Completed'
BEGIN
  INSERT INTO component_claim_events (id, component_id, cause_type, cause_id, state, changed_at, created_at, updated_at)
  SELECT substr(NEW.id, 1, 10) || upper(substr(hex(randomblob(16)), 1, 16)), component_id, 'maintenance', NEW.id, NULL, NEW.updated_at, NEW.updated_at, NEW.updated_at
  FROM maintenance_components
  WHERE maintenance_id = NEW.id AND component_id IS NOT NULL;
END;

-- An explicit intent survives deferred publication completion and separates a
-- manual retroactive update from a scheduled update that happened to run late.
ALTER TABLE incident_updates ADD COLUMN is_retroactive INTEGER NOT NULL DEFAULT 0 CHECK (is_retroactive IN (0, 1));

-- Existing aggregate history is deliberately not backfilled. Its rows do not
-- identify every source claim that produced the aggregate, and current
-- component attachments cannot prove what an earlier update claimed.
