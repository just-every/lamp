-- Base operator-auth 2ebade63004ebc12071c6f5ad4e5d0a20276adcd; additive Lamp adoption.
-- Additive schema draft. Integrator assigns the next migration number; never
-- replace an applied migration. All epoch timestamps are milliseconds.
CREATE TABLE oa_operators (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
 status TEXT NOT NULL CHECK(status IN ('invited','active','inactive')),
 version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE oa_bootstrap (singleton INTEGER PRIMARY KEY CHECK(singleton=1), claim_id TEXT NOT NULL UNIQUE, claimed_at INTEGER NOT NULL);
CREATE TABLE oa_tokens (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('magic','invite')),
 operator_id TEXT NOT NULL REFERENCES oa_operators(id), operator_version INTEGER NOT NULL,
 issuer_id TEXT REFERENCES oa_operators(id), issuer_version INTEGER,
 return_to TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 consumed_at INTEGER, revoked_at INTEGER,
 CHECK((kind='invite' AND issuer_id IS NOT NULL AND issuer_version IS NOT NULL)
    OR (kind='magic' AND issuer_id IS NULL AND issuer_version IS NULL))
);
CREATE TABLE oa_sessions (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
 operator_id TEXT NOT NULL REFERENCES oa_operators(id), operator_version INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('native','review','oidc','password','dev')),
 source_token_id TEXT UNIQUE REFERENCES oa_tokens(id),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE INDEX oa_sessions_operator ON oa_sessions(operator_id);
CREATE TABLE oa_external_identities (
 issuer TEXT NOT NULL, subject TEXT NOT NULL, operator_id TEXT NOT NULL REFERENCES oa_operators(id),
 PRIMARY KEY(issuer, subject)
);
CREATE TABLE oa_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TRIGGER oa_preserve_last_owner_update BEFORE UPDATE OF status,role ON oa_operators
 WHEN OLD.role='owner' AND OLD.status='active' AND (NEW.role!='owner' OR NEW.status!='active')
 AND (SELECT COUNT(*) FROM oa_operators WHERE role='owner' AND status='active') <= 1
 BEGIN SELECT RAISE(ABORT, 'last_owner'); END;
CREATE TRIGGER oa_preserve_last_owner_delete BEFORE DELETE ON oa_operators
 WHEN OLD.role='owner' AND OLD.status='active'
 AND (SELECT COUNT(*) FROM oa_operators WHERE role='owner' AND status='active') <= 1
 BEGIN SELECT RAISE(ABORT, 'last_owner'); END;
-- A status/role change invalidates every preexisting session and link, including
-- after a later reactivation. Keep this invariant for direct administrative SQL.
CREATE TRIGGER oa_operator_version AFTER UPDATE OF status,role ON oa_operators
 WHEN OLD.status != NEW.status OR OLD.role != NEW.role
 BEGIN UPDATE oa_operators SET version=OLD.version+1 WHERE id=NEW.id; END;

-- Fresh installs include local dev identity. Apply schema/dev-sessions.sql as a
-- NEW numbered migration in existing stores; it is also safe after this file.
-- A credential minted while signed in with a dev session is recorded here and,
-- like the dev session itself, counts only behind the local key gate.
CREATE TABLE IF NOT EXISTS oa_dev_credentials (
 credential TEXT NOT NULL, id TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(credential, id)
);

-- Fresh installs include the additive invitation cancellation ledger.
-- Apply as a NEW numbered migration after operator-auth.sql in existing stores.
-- This durable record is admission state, not an expiring credential. Never prune it.
-- Existing active/inactive operators retain their recorded status: no historical
-- acceptance is inferred. Only a witnessed invited -> inactive transition records
-- an unaccepted cancellation, including direct administrative SQL transitions.
CREATE TABLE oa_invitation_cancellations (
 operator_id TEXT PRIMARY KEY REFERENCES oa_operators(id),
 operator_version INTEGER NOT NULL
);
CREATE TRIGGER oa_record_invitation_cancellation AFTER UPDATE OF status ON oa_operators
 WHEN OLD.status='invited' AND NEW.status='inactive'
 BEGIN INSERT INTO oa_invitation_cancellations(operator_id,operator_version)
 VALUES(NEW.id,OLD.version+1)
 ON CONFLICT(operator_id) DO UPDATE SET operator_version=excluded.operator_version; END;
CREATE TRIGGER oa_reject_cancelled_invitation_reactivation BEFORE UPDATE OF status ON oa_operators
 WHEN NEW.status='active' AND EXISTS(SELECT 1 FROM oa_invitation_cancellations WHERE operator_id=OLD.id)
 BEGIN SELECT RAISE(ABORT, 'invitation_required'); END;

-- Fresh installs include domain rules and step-up proofs. Apply
-- schema/domain-rules-step-up.sql as a NEW numbered migration in existing
-- stores; it is also safe after this file.
-- A required sign-in provider for an email domain. Sign-ins for that domain by
-- any other route are refused; app owners are exempt.
CREATE TABLE IF NOT EXISTS oa_domain_rules (
 domain TEXT PRIMARY KEY, provider_id TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES oa_operators(id), created_at INTEGER NOT NULL
);
-- A step-up proof: an app-local email link sent to the operator's own address,
-- bound to the session that asked and completed only in that session. No
-- foreign key names oa_sessions, which schema/dev-sessions.sql rebuilds.
CREATE TABLE IF NOT EXISTS oa_step_up_challenges (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
 session_id TEXT NOT NULL, operator_id TEXT NOT NULL REFERENCES oa_operators(id),
 operator_version INTEGER NOT NULL, action TEXT NOT NULL, return_to TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS oa_step_up_session ON oa_step_up_challenges(session_id);

-- Additive provider controls. An absent setting means off, including upgrades.
CREATE TABLE IF NOT EXISTS oa_auth_settings (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), idp_sign_in INTEGER NOT NULL CHECK(idp_sign_in IN (0,1)), generation INTEGER NOT NULL DEFAULT 0, first_setup INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS oa_auth_audit (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, value TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oa_provider_sessions (
 session_id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, sid TEXT, generation INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oa_provider_session_identity ON oa_provider_sessions(issuer,subject,sid);
CREATE TABLE IF NOT EXISTS oa_logout_events (
 issuer TEXT NOT NULL, jti TEXT NOT NULL, consumed_at INTEGER NOT NULL CHECK(consumed_at>=0), PRIMARY KEY(issuer,jti)
);

CREATE TRIGGER IF NOT EXISTS oa_first_setup_provider_setting AFTER INSERT ON oa_bootstrap BEGIN
 INSERT INTO oa_auth_settings(singleton,idp_sign_in,generation,first_setup) VALUES(1,0,0,1) ON CONFLICT DO NOTHING;
END;

CREATE TABLE IF NOT EXISTS oa_credentials (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, operator_id TEXT NOT NULL REFERENCES oa_operators(id),
 operator_version INTEGER, kind TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
);

-- Session provenance for OIDC pins. Apply as a new migration on existing stores.
-- External admission has no OIDC pin and does not require OIDC protocol tables.
CREATE TABLE IF NOT EXISTS oa_provider_session_pins (
 session_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, issuer TEXT NOT NULL,
 client_id TEXT NOT NULL, linked_at INTEGER NOT NULL
);

-- Identity providers (OpenID Connect). Apply as a NEW numbered migration after
-- the accounts schema. Every statement is IF NOT EXISTS, so a store that applied
-- an earlier version of this file applies the current one again as its next
-- migration and gains only what it lacks.
CREATE TABLE IF NOT EXISTS oa_oidc_transactions (
  state_hash TEXT PRIMARY KEY,
  binding_hash TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oa_oidc_transactions_expiry ON oa_oidc_transactions(expires_at);
CREATE TABLE IF NOT EXISTS oa_oidc_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
-- One pinned link per configured provider. Linking stores the issuer, JWKS URI,
-- client id, endpoints and allowed algorithms; a changed configuration only
-- records a pending re-link, which the owner completes with a step-up proof.
CREATE TABLE IF NOT EXISTS oa_identity_providers (
  provider_id TEXT PRIMARY KEY,
  preset TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('linked','unlinked')),
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  jwks_uri TEXT NOT NULL,
  authorization_endpoint TEXT NOT NULL,
  token_endpoint TEXT NOT NULL,
  algorithms TEXT NOT NULL,
  token_auth_method TEXT NOT NULL,
  response_iss INTEGER NOT NULL,
  interface_version TEXT,
  linked_at INTEGER NOT NULL,
  pending_issuer TEXT,
  pending_client_id TEXT,
  pending_preset TEXT,
  pending_at INTEGER,
  jwks TEXT,
  jwks_fetched_at INTEGER
);
-- Reachability per configured provider, linked or not. A provider that has
-- failed discovery or JWKS for 5 minutes, or answered 404 or a DNS failure, is
-- hidden from the sign-in page until a later check succeeds.
CREATE TABLE IF NOT EXISTS oa_identity_provider_health (
  provider_id TEXT PRIMARY KEY,
  failing_since INTEGER,
  hard_failure_at INTEGER,
  checked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rer_dependency_installation (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), sector_id TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS rer_dependency_link (
 interface TEXT PRIMARY KEY, issuer TEXT NOT NULL, client_id TEXT NOT NULL, metadata TEXT NOT NULL,
 needs_relink INTEGER NOT NULL DEFAULT 0, linked_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rer_dependency_pending (
 interface TEXT PRIMARY KEY, issuer TEXT NOT NULL, approved_by TEXT NOT NULL, expires_at INTEGER NOT NULL, approved_session TEXT NOT NULL, approved_version INTEGER NOT NULL, callbacks TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rer_dependency_codes (
 digest TEXT PRIMARY KEY, created_at INTEGER NOT NULL CHECK(created_at>=0)
);

CREATE TABLE IF NOT EXISTS rer_dependency_keys (interface TEXT PRIMARY KEY, private_key TEXT NOT NULL);

-- Apply after operator-auth.sql as a new numbered migration. Never prune this ledger.
CREATE TABLE oc_owner_claims (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  jti TEXT NOT NULL UNIQUE,
  installation_id TEXT NOT NULL,
  email TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER NOT NULL CHECK(consumed_at<expires_at),
  operator_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1))
);
CREATE TRIGGER oc_owner_claim_empty_store BEFORE INSERT ON oc_owner_claims
WHEN EXISTS(SELECT 1 FROM oa_bootstrap) OR EXISTS(SELECT 1 FROM oa_operators)
BEGIN
  SELECT RAISE(ABORT, 'owner_claim_already_initialized');
END;

CREATE TABLE IF NOT EXISTS oc_idp_grants (
 issuer TEXT NOT NULL, client_id TEXT NOT NULL, jti TEXT NOT NULL, subject TEXT NOT NULL, sector_id TEXT NOT NULL,
 PRIMARY KEY(issuer,client_id), UNIQUE(issuer,jti)
);


-- Keep released product attribution IDs, but only oa_ grants access.
INSERT INTO oa_operators(id,email,display_name,role,status,created_at)
 SELECT id,lower(email),display_name,'owner',CASE WHEN deactivated_at IS NULL THEN 'active' ELSE 'inactive' END,
 CAST(strftime('%s',created_at) AS INTEGER)*1000 FROM operators
 WHERE lower(email) <> 'deleted-' || lower(id) || '@operator.invalid';
-- Setup authority moves only with the copied setup operator. When it erased
-- itself, no operator held that authority before, and none gains it now.
INSERT INTO oa_bootstrap(singleton,claim_id,claimed_at)
 SELECT 1,COALESCE((SELECT o.id FROM operators o JOIN oa_operators a ON a.id=o.id WHERE o.is_setup_operator=1 ORDER BY o.created_at,o.id LIMIT 1),'legacy-closed'),unixepoch()*1000 WHERE EXISTS(SELECT 1 FROM operators);
-- An upgrade is never a fresh setup provider-enablement window.
UPDATE oa_auth_settings SET first_setup=0 WHERE singleton=1;
DELETE FROM sessions;
DELETE FROM operator_magic_links;
DROP TABLE sessions;
DROP TABLE operator_magic_links;
-- Product records continue to reference operators. This one-way projection is
-- attribution only: inserts/updates here never create oa_ authority.
CREATE TRIGGER lamp_operator_attribution_insert AFTER INSERT ON oa_operators BEGIN
 INSERT INTO operators(id,email,display_name,is_setup_operator,created_at,updated_at,deactivated_at)
 VALUES(NEW.id,NEW.email,NEW.display_name,EXISTS(SELECT 1 FROM oa_bootstrap WHERE claim_id=NEW.id),
 strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at/1000.0,'unixepoch'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 CASE WHEN NEW.status='active' THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now') END)
 ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,deactivated_at=excluded.deactivated_at,updated_at=excluded.updated_at;
END;
CREATE TRIGGER lamp_operator_attribution_update AFTER UPDATE ON oa_operators BEGIN
 UPDATE operators SET email=NEW.email,display_name=NEW.display_name,
 deactivated_at=CASE WHEN NEW.status='active' THEN NULL ELSE COALESCE(deactivated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) END,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
END;
