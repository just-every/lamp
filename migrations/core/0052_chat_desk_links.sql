-- Private chat identities, expiring approval authority and replay suppression.
CREATE TABLE chat_links (
  id TEXT PRIMARY KEY NOT NULL,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  transport TEXT NOT NULL CHECK(transport IN ('slack','teams')),
  tenant TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(transport,tenant,subject)
);
CREATE TABLE chat_link_codes (
  hash TEXT PRIMARY KEY NOT NULL,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE chat_requests (hash TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE chat_previews (
  hash TEXT PRIMARY KEY NOT NULL,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TRIGGER chat_links_revoke AFTER UPDATE OF status ON oa_operators WHEN NEW.status <> 'active' BEGIN
  DELETE FROM chat_links WHERE operator_id=NEW.id;
  DELETE FROM chat_link_codes WHERE operator_id=NEW.id;
  DELETE FROM chat_previews WHERE operator_id=NEW.id;
END;
