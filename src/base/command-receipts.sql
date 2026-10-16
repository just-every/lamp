-- Refresh-safe writes (command-receipts.ts): one row per actor and form command
-- key. A seed applies this as its next numbered migration; archives leave it out.
CREATE TABLE rer_command_receipts (
  actor TEXT NOT NULL,
  command_key TEXT NOT NULL,
  command TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('running','done')),
  result TEXT,
  once TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor, command_key)
);
CREATE INDEX rer_command_receipts_created ON rer_command_receipts(created_at);
