-- Keep applied lifecycle CHECKs: Verifying is an active maintenance claim with
-- its public lifecycle recorded separately. Existing title-only records stay so.
ALTER TABLE maintenance ADD COLUMN affected_audience TEXT NOT NULL DEFAULT '';
ALTER TABLE maintenance ADD COLUMN customer_impact TEXT NOT NULL DEFAULT '';
ALTER TABLE maintenance ADD COLUMN what_still_works TEXT NOT NULL DEFAULT '';
ALTER TABLE maintenance ADD COLUMN details TEXT NOT NULL DEFAULT '';
ALTER TABLE maintenance ADD COLUMN wording_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE maintenance ADD COLUMN verifying INTEGER NOT NULL DEFAULT 0;
ALTER TABLE maintenance ADD COLUMN auto_start INTEGER NOT NULL DEFAULT 1;
ALTER TABLE maintenance ADD COLUMN auto_complete INTEGER NOT NULL DEFAULT 1;
ALTER TABLE maintenance ADD COLUMN remind_prior INTEGER NOT NULL DEFAULT 1;
ALTER TABLE maintenance ADD COLUMN calendar_sequence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE maintenance_notices ADD COLUMN snapshot_json TEXT;
ALTER TABLE maintenance_notices ADD COLUMN notice_kind TEXT;
ALTER TABLE maintenance_notices ADD COLUMN corrects_notice_id TEXT REFERENCES maintenance_notices(id);
CREATE TABLE maintenance_drafts (
 id TEXT PRIMARY KEY NOT NULL,
 version INTEGER NOT NULL,
 payload_json TEXT NOT NULL,
 author_operator_id TEXT NOT NULL REFERENCES operators(id),
 updated_at TEXT NOT NULL
);
CREATE TABLE maintenance_channel_posts (
 id TEXT PRIMARY KEY NOT NULL,
 notice_id TEXT NOT NULL REFERENCES maintenance_notices(id) ON DELETE CASCADE,
 destination_id TEXT NOT NULL REFERENCES channel_destinations(id),
 queued_at TEXT NOT NULL,
 UNIQUE(notice_id,destination_id)
);
ALTER TABLE import_maintenance_updates ADD COLUMN source_status TEXT;
