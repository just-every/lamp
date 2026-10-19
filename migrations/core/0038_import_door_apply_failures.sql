-- Base importDoorApplyFailureMigration (rer 0.2.61, modules/import-kit/src/door/schema.ts) for the door
-- installed in 0036: one atomic batch with foreign keys on. Children are copied before parents are dropped, so
-- every retained plan, snapshot chunk and approval survives; a failed apply is recorded as an audit fact.
CREATE TABLE IF NOT EXISTS ik_door_plans_apply_failure (
      id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, namespace TEXT NOT NULL,
      bundle_sha256 TEXT NOT NULL, fingerprint TEXT NOT NULL, previous_id TEXT,
      job_id TEXT UNIQUE, snapshot_hash TEXT NOT NULL,
      complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1)));

CREATE TABLE IF NOT EXISTS ik_door_plan_chunks_apply_failure (
      plan_id TEXT NOT NULL REFERENCES ik_door_plans_apply_failure(id), ordinal INTEGER NOT NULL,
      body TEXT NOT NULL, PRIMARY KEY(plan_id,ordinal));

CREATE TABLE IF NOT EXISTS ik_door_approvals_apply_failure (
      plan_id TEXT PRIMARY KEY REFERENCES ik_door_plans_apply_failure(id), approval_id TEXT NOT NULL,
      owner TEXT NOT NULL, approved_at TEXT NOT NULL, fingerprint TEXT NOT NULL,
      reviewer TEXT NOT NULL);

INSERT INTO ik_door_plans_apply_failure SELECT * FROM ik_door_plans;

INSERT INTO ik_door_plan_chunks_apply_failure SELECT * FROM ik_door_plan_chunks;

INSERT INTO ik_door_approvals_apply_failure SELECT * FROM ik_door_approvals;

DROP TABLE ik_door_approvals;

DROP TABLE ik_door_plan_chunks;

DROP TABLE ik_door_plans;

ALTER TABLE ik_door_plans_apply_failure RENAME TO ik_door_plans;

ALTER TABLE ik_door_plan_chunks_apply_failure RENAME TO ik_door_plan_chunks;

ALTER TABLE ik_door_approvals_apply_failure RENAME TO ik_door_approvals;

CREATE INDEX IF NOT EXISTS ik_door_plan_bundle ON ik_door_plans(installation_id,namespace,bundle_sha256);

CREATE TABLE IF NOT EXISTS ik_door_apply_failures (
    plan_id TEXT PRIMARY KEY REFERENCES ik_door_plans(id), reason_code TEXT NOT NULL);
