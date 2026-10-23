-- Private ownership defaults to the incident opener until explicitly reassigned.
CREATE TABLE incident_communication_owners (
  incident_id TEXT PRIMARY KEY REFERENCES incidents(id) ON DELETE CASCADE,
  operator_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Escalations have their own receipt so earlier archives restore without a
-- data-rewriting rebuild of the issued due-soon and overdue reminder table.
CREATE TABLE incident_update_escalations (
  update_id TEXT PRIMARY KEY REFERENCES incident_updates(id) ON DELETE CASCADE,
  recorded_at TEXT NOT NULL
);
