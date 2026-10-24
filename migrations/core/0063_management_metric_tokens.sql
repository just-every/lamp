-- Product scope metadata is durable; Base oa_credentials remains the sole
-- hashed bearer authority and is excluded from native archives. A restored row
-- therefore cannot authorize a request until a new token is explicitly issued.
CREATE TABLE management_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  scope TEXT CHECK(scope IS NULL OR scope='metrics:write'),
  issuer_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at TEXT NOT NULL
);
