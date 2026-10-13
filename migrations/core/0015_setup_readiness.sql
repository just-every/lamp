-- Durable evidence for operator setup actions. Public GET paths never write it.
CREATE TABLE setup_readiness (
  step TEXT PRIMARY KEY,
  evidence_key TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
