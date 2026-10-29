-- Opaque native email-proof references. These contain no bearer or session cookie.
CREATE TABLE lamp_agent_native_proofs (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES oa_operators(id),
  agent_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  arguments_sha256 TEXT NOT NULL,
  native_session_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX lamp_agent_native_proofs_person ON lamp_agent_native_proofs(operator_id,expires_at);
