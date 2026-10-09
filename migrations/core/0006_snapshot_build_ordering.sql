-- A durable generation orders public snapshot pointer writes across Worker
-- isolates. Snapshot artifacts remain immutable in R2; only the pointer moves.

CREATE TABLE snapshot_build_control (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'default'),
  next_generation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO snapshot_build_control (id, next_generation, created_at, updated_at)
VALUES ('default', 0, '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z');

-- A mutation records work in the same D1 batch as its public data. A Worker
-- crash or a failed R2 write therefore cannot erase the need to rebuild.
CREATE TABLE public_snapshot_work (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'default'),
  requested_revision INTEGER NOT NULL DEFAULT 0,
  completed_revision INTEGER NOT NULL DEFAULT 0,
  retry_lease_id TEXT,
  retry_lease_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO public_snapshot_work (id, requested_revision, completed_revision, retry_lease_id, retry_lease_until, created_at, updated_at)
VALUES ('default', 0, 0, NULL, NULL, '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z');

-- Attachments become public only with a published update. This keeps an
-- operator's draft and template changes off the public component roll-up.
ALTER TABLE incident_components ADD COLUMN published_at TEXT;
CREATE INDEX incident_components_publication_idx ON incident_components(incident_id, published_at);

ALTER TABLE incidents ADD COLUMN peak_impact TEXT;

-- Public-source mutations enqueue snapshot work inside their own transaction.
-- Draft tables deliberately have no trigger: saving an unpublished draft must
-- leave every public artifact byte-for-byte unchanged.
CREATE TRIGGER page_settings_snapshot_dirty_insert AFTER INSERT ON page_settings BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER page_settings_snapshot_dirty_update AFTER UPDATE ON page_settings BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER components_snapshot_dirty_insert AFTER INSERT ON components BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER components_snapshot_dirty_update AFTER UPDATE ON components BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER components_snapshot_dirty_delete AFTER DELETE ON components BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_groups_snapshot_dirty_insert AFTER INSERT ON component_groups BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_groups_snapshot_dirty_update AFTER UPDATE ON component_groups BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_groups_snapshot_dirty_delete AFTER DELETE ON component_groups BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_claims_snapshot_dirty_insert AFTER INSERT ON component_standing_claims BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_claims_snapshot_dirty_update AFTER UPDATE ON component_standing_claims BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_claims_snapshot_dirty_delete AFTER DELETE ON component_standing_claims BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_history_snapshot_dirty_insert AFTER INSERT ON component_state_history BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_corrections_snapshot_dirty_insert AFTER INSERT ON component_state_corrections BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER incident_components_snapshot_dirty_published AFTER UPDATE OF published_at ON incident_components WHEN NEW.published_at IS NOT OLD.published_at BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER incident_updates_snapshot_dirty_insert AFTER INSERT ON incident_updates BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER incident_updates_snapshot_dirty_delete AFTER DELETE ON incident_updates BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER incidents_snapshot_dirty_deleted AFTER UPDATE OF deleted_at ON incidents WHEN NEW.deleted_at IS NOT OLD.deleted_at BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_snapshot_dirty_insert AFTER INSERT ON maintenance BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_snapshot_dirty_update AFTER UPDATE ON maintenance BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_snapshot_dirty_delete AFTER DELETE ON maintenance BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_components_snapshot_dirty_insert AFTER INSERT ON maintenance_components BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_components_snapshot_dirty_update AFTER UPDATE ON maintenance_components BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_components_snapshot_dirty_delete AFTER DELETE ON maintenance_components BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_notices_snapshot_dirty_insert AFTER INSERT ON maintenance_notices BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_notices_snapshot_dirty_update AFTER UPDATE ON maintenance_notices BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_notices_snapshot_dirty_delete AFTER DELETE ON maintenance_notices BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER incident_reports_snapshot_dirty_published AFTER UPDATE OF published_at ON incident_reports WHEN NEW.published_at IS NOT OLD.published_at BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER incident_reports_snapshot_dirty_delete AFTER DELETE ON incident_reports WHEN OLD.published_at IS NOT NULL BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
