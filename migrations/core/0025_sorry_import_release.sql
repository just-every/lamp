-- Sorry subscribers remain inert until the owner approves the live hostname.
CREATE TABLE sorry_import_releases (
  job_id TEXT PRIMARY KEY REFERENCES ik_jobs(id) ON DELETE CASCADE,
  live_origin TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  released_at TEXT NOT NULL
);
