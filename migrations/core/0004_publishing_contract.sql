-- Incident publication, alert intake, and post-incident reporting for Lamp 1.0.
-- These additions preserve the immutable published-update record established in 0001.

ALTER TABLE page_settings ADD COLUMN ai_tone_instructions TEXT NOT NULL DEFAULT '';

ALTER TABLE incident_drafts ADD COLUMN scheduled_publish_at TEXT;
ALTER TABLE incident_drafts ADD COLUMN scheduled_channels_json TEXT;
ALTER TABLE incident_drafts ADD COLUMN reviewed_by_operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL;
ALTER TABLE incident_drafts ADD COLUMN reviewed_at TEXT;
ALTER TABLE incident_drafts ADD COLUMN corrects_update_id TEXT REFERENCES incident_updates(id) ON DELETE SET NULL;

CREATE TABLE audit_entries (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL,
  reason TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX audit_entries_entity_created_idx ON audit_entries(entity_type, entity_id, created_at DESC);

CREATE TABLE incident_templates (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('Investigating', 'Identified', 'Monitoring', 'Resolved')),
  affected_audience TEXT NOT NULL DEFAULT '' CHECK (length(affected_audience) <= 250),
  customer_impact TEXT NOT NULL DEFAULT '' CHECK (length(customer_impact) <= 250),
  what_still_works TEXT NOT NULL DEFAULT '' CHECK (length(what_still_works) <= 250),
  details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 500),
  next_update_offset_minutes INTEGER,
  created_by_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE incident_template_components (
  id TEXT PRIMARY KEY NOT NULL,
  template_id TEXT NOT NULL REFERENCES incident_templates(id) ON DELETE CASCADE,
  component_id TEXT REFERENCES components(id) ON DELETE SET NULL,
  component_name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('Operational', 'Degraded performance', 'Partially unavailable', 'Major outage', 'Under maintenance')),
  relationship TEXT NOT NULL DEFAULT 'Primary' CHECK (relationship IN ('Primary', 'Dependent')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX incident_template_components_template_idx ON incident_template_components(template_id);

CREATE TABLE incident_reports (
  id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  timeline TEXT NOT NULL DEFAULT '',
  cause TEXT NOT NULL DEFAULT '',
  remediation TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  author_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX incident_reports_published_idx ON incident_reports(published_at DESC);

-- A maintenance window can produce more than one customer-facing event. The
-- immutable notice identifier is also the notification-deduplication key.
CREATE TABLE maintenance_notices (
  id TEXT PRIMARY KEY NOT NULL,
  maintenance_id TEXT NOT NULL REFERENCES maintenance(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('scheduled', 'rescheduled', 'reminder', 'started', 'completed', 'cancelled')),
  body TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL,
  author_operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX maintenance_notices_maintenance_published_idx ON maintenance_notices(maintenance_id, published_at DESC);
CREATE UNIQUE INDEX maintenance_notices_one_transition_idx ON maintenance_notices(maintenance_id, kind)
  WHERE kind IN ('scheduled', 'reminder', 'started', 'completed', 'cancelled');

CREATE TABLE alert_sources (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  credential_kind TEXT NOT NULL CHECK (credential_kind IN ('hmac-sha256', 'bearer-token')),
  signing_secret TEXT,
  bearer_token_hash TEXT,
  timestamp_header TEXT NOT NULL DEFAULT 'x-lamp-timestamp',
  signature_header TEXT NOT NULL DEFAULT 'x-lamp-signature',
  deduplication_path TEXT NOT NULL,
  title_path TEXT NOT NULL,
  state_path TEXT NOT NULL,
  recovered_value TEXT NOT NULL DEFAULT 'recovered',
  created_by_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((credential_kind = 'hmac-sha256' AND signing_secret IS NOT NULL AND bearer_token_hash IS NULL)
      OR (credential_kind = 'bearer-token' AND bearer_token_hash IS NOT NULL AND signing_secret IS NULL))
);

CREATE TABLE alert_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES alert_sources(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  deduplication_key TEXT,
  incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('firing', 'recovered', 'invalid')),
  received_at TEXT NOT NULL,
  recovered_at TEXT,
  payload_json TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, request_hash)
);
CREATE INDEX alert_receipts_dedup_idx ON alert_receipts(source_id, deduplication_key, received_at DESC);
CREATE INDEX alert_receipts_incident_idx ON alert_receipts(incident_id, received_at DESC);
