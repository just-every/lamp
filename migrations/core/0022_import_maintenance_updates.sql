-- Historical provider messages are not native lifecycle notices and never queue mail.
CREATE TABLE import_maintenance_updates (
  id TEXT PRIMARY KEY NOT NULL,
  maintenance_id TEXT NOT NULL REFERENCES maintenance(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  published_at TEXT NOT NULL,
  source_states TEXT NOT NULL
);
CREATE INDEX import_maintenance_updates_timeline ON import_maintenance_updates(maintenance_id, published_at);
CREATE TRIGGER import_maintenance_updates_snapshot_insert AFTER INSERT ON import_maintenance_updates BEGIN UPDATE public_snapshot_work SET requested_revision=requested_revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='default'; END;
CREATE TRIGGER import_maintenance_updates_snapshot_update AFTER UPDATE ON import_maintenance_updates BEGIN UPDATE public_snapshot_work SET requested_revision=requested_revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='default'; END;
CREATE TRIGGER import_maintenance_updates_snapshot_delete AFTER DELETE ON import_maintenance_updates BEGIN UPDATE public_snapshot_work SET requested_revision=requested_revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='default'; END;
