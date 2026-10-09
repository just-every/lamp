-- Lamp's first released core schema. This migration is immutable once tagged.
PRAGMA foreign_keys = ON;

CREATE TABLE operators (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  is_setup_operator INTEGER NOT NULL DEFAULT 0 CHECK (is_setup_operator IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX sessions_operator_id_idx ON sessions(operator_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE page_settings (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'default'),
  page_name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  accent_color TEXT NOT NULL,
  timezone TEXT NOT NULL,
  hostname TEXT NOT NULL,
  footer_credit_enabled INTEGER NOT NULL DEFAULT 1 CHECK (footer_credit_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE component_groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX component_groups_display_order_idx ON component_groups(display_order);

CREATE TABLE components (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT REFERENCES component_groups(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  internal INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0, 1)),
  display_order INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 250),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX components_group_order_idx ON components(group_id, display_order);

CREATE TABLE component_standing_claims (
  id TEXT PRIMARY KEY NOT NULL,
  component_id TEXT NOT NULL UNIQUE REFERENCES components(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('Operational', 'Degraded performance', 'Partially unavailable', 'Major outage', 'Under maintenance')),
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE component_state_history (
  id TEXT PRIMARY KEY NOT NULL,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  previous_state TEXT NOT NULL CHECK (previous_state IN ('Operational', 'Degraded performance', 'Partially unavailable', 'Major outage', 'Under maintenance')),
  new_state TEXT NOT NULL CHECK (new_state IN ('Operational', 'Degraded performance', 'Partially unavailable', 'Major outage', 'Under maintenance')),
  cause_type TEXT NOT NULL CHECK (cause_type IN ('standing-claim', 'incident', 'maintenance', 'correction')),
  cause_id TEXT,
  operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL,
  supersedes_history_id TEXT REFERENCES component_state_history(id) ON DELETE SET NULL,
  changed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX component_state_history_component_changed_idx ON component_state_history(component_id, changed_at);

CREATE TABLE incidents (
  id TEXT PRIMARY KEY NOT NULL,
  reference TEXT NOT NULL UNIQUE CHECK (reference GLOB 'INC-[0-9]*'),
  title TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('Investigating', 'Identified', 'Monitoring', 'Resolved')),
  opened_at TEXT NOT NULL,
  resolved_at TEXT,
  created_by_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  deleted_at TEXT,
  deletion_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX incidents_lifecycle_opened_idx ON incidents(lifecycle, opened_at DESC);

CREATE TABLE incident_components (
  id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  component_id TEXT REFERENCES components(id) ON DELETE SET NULL,
  component_name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('Operational', 'Degraded performance', 'Partially unavailable', 'Major outage', 'Under maintenance')),
  relationship TEXT NOT NULL DEFAULT 'Primary' CHECK (relationship IN ('Primary', 'Dependent')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX incident_components_incident_id_idx ON incident_components(incident_id);
CREATE INDEX incident_components_component_id_idx ON incident_components(component_id);

CREATE TABLE incident_updates (
  id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('Investigating', 'Identified', 'Monitoring', 'Resolved')),
  affected_audience TEXT NOT NULL CHECK (length(affected_audience) <= 250),
  customer_impact TEXT NOT NULL CHECK (length(customer_impact) <= 250),
  what_still_works TEXT NOT NULL DEFAULT '' CHECK (length(what_still_works) <= 250),
  details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 500),
  next_update_at TEXT NOT NULL,
  published_at TEXT NOT NULL,
  author_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  corrects_update_id TEXT REFERENCES incident_updates(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX incident_updates_incident_published_idx ON incident_updates(incident_id, published_at DESC);

CREATE TABLE incident_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('Investigating', 'Identified', 'Monitoring', 'Resolved')),
  affected_audience TEXT NOT NULL DEFAULT '' CHECK (length(affected_audience) <= 250),
  customer_impact TEXT NOT NULL DEFAULT '' CHECK (length(customer_impact) <= 250),
  what_still_works TEXT NOT NULL DEFAULT '' CHECK (length(what_still_works) <= 250),
  details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 500),
  next_update_at TEXT,
  author_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX incident_drafts_incident_updated_idx ON incident_drafts(incident_id, updated_at DESC);

CREATE TABLE incident_internal_notes (
  id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX incident_internal_notes_incident_created_idx ON incident_internal_notes(incident_id, created_at DESC);

CREATE TABLE incident_attachments (
  id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  incident_update_id TEXT REFERENCES incident_updates(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  uploaded_by_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX incident_attachments_incident_id_idx ON incident_attachments(incident_id);

CREATE TABLE maintenance (
  id TEXT PRIMARY KEY NOT NULL,
  reference TEXT NOT NULL UNIQUE CHECK (reference GLOB 'SCH-[0-9]*'),
  title TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('Scheduled', 'In progress', 'Completed', 'Cancelled')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  completed_at TEXT,
  created_by_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX maintenance_state_start_idx ON maintenance(state, starts_at);

CREATE TABLE maintenance_components (
  id TEXT PRIMARY KEY NOT NULL,
  maintenance_id TEXT NOT NULL REFERENCES maintenance(id) ON DELETE CASCADE,
  component_id TEXT REFERENCES components(id) ON DELETE SET NULL,
  component_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'Under maintenance' CHECK (state = 'Under maintenance'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX maintenance_components_maintenance_id_idx ON maintenance_components(maintenance_id);

CREATE TABLE subscribers (
  id TEXT PRIMARY KEY NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook')),
  destination TEXT NOT NULL UNIQUE,
  contact_email TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'deactivated')),
  selection_mode TEXT NOT NULL DEFAULT 'all' CHECK (selection_mode IN ('all', 'selected')),
  token_hash TEXT NOT NULL UNIQUE,
  deactivation_reason TEXT,
  deactivated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX subscribers_state_idx ON subscribers(state);

CREATE TABLE subscriber_components (
  id TEXT PRIMARY KEY NOT NULL,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(subscriber_id, component_id)
);

CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE RESTRICT,
  incident_update_id TEXT REFERENCES incident_updates(id) ON DELETE RESTRICT,
  maintenance_id TEXT REFERENCES maintenance(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook')),
  outcome TEXT NOT NULL CHECK (outcome IN ('queued', 'delivered', 'bounced', 'complained', 'suppressed', 'failed')),
  queued_at TEXT NOT NULL,
  outcome_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (incident_update_id IS NOT NULL OR maintenance_id IS NOT NULL)
);
CREATE INDEX notification_deliveries_subscriber_idx ON notification_deliveries(subscriber_id, queued_at DESC);
CREATE INDEX notification_deliveries_update_idx ON notification_deliveries(incident_update_id, queued_at DESC);
