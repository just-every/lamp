CREATE TABLE lamp_agent_jobs (
  id TEXT PRIMARY KEY,
  input_json TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
