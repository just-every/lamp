CREATE TABLE report_waivers (
  incident_id TEXT PRIMARY KEY REFERENCES incidents(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  operator_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE report_reminders (
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  week INTEGER NOT NULL CHECK(week >= 0),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(incident_id, week)
);
