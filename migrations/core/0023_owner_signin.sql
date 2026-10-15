-- Base's one-use owner entry for rer signin, adopted additively.
CREATE TABLE IF NOT EXISTS oa_owner_signins (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
 operator_id TEXT NOT NULL REFERENCES oa_operators(id), operator_version INTEGER NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
);
