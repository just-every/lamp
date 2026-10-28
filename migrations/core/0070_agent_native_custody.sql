ALTER TABLE incident_updates ADD COLUMN agent_action_json TEXT;
ALTER TABLE incident_reports ADD COLUMN agent_action_json TEXT;
ALTER TABLE incident_drafts ADD COLUMN agent_scheduled INTEGER NOT NULL DEFAULT 0;
CREATE TABLE lamp_agent_jobs (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  args_json TEXT NOT NULL,
  due_at TEXT NOT NULL,
  principal_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN('pending','done','refused')),
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX lamp_agent_jobs_due ON lamp_agent_jobs(state,due_at);
