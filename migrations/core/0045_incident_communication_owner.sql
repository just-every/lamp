-- Private ownership defaults to the incident opener until explicitly reassigned.
CREATE TABLE incident_communication_owners (
  incident_id TEXT PRIMARY KEY REFERENCES incidents(id) ON DELETE CASCADE,
  operator_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Preserve all issued reminders while extending SQLite's checked kind set.
ALTER TABLE incident_update_reminders RENAME TO incident_update_reminders_v1;
CREATE TABLE incident_update_reminders (
  update_id TEXT NOT NULL REFERENCES incident_updates(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('due-soon', 'overdue', 'escalation')),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (update_id, kind)
);
INSERT INTO incident_update_reminders SELECT update_id,kind,recorded_at FROM incident_update_reminders_v1;
DROP TABLE incident_update_reminders_v1;
