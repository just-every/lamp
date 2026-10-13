BEGIN TRANSACTION;
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
  updated_at TEXT NOT NULL, preset TEXT CHECK (preset IS NULL OR preset IN ('datadog', 'uptimerobot', 'betterstack', 'pingdom')), component_id TEXT REFERENCES components(id) ON DELETE SET NULL,
  CHECK ((credential_kind = 'hmac-sha256' AND signing_secret IS NOT NULL AND bearer_token_hash IS NULL)
      OR (credential_kind = 'bearer-token' AND bearer_token_hash IS NOT NULL AND signing_secret IS NULL))
);
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
INSERT INTO "audit_entries" VALUES('prior-audit','operator','01J00000000000000000000001','prior-action','01J00000000000000000000001',NULL,'{"retained":true}','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');
CREATE TABLE channel_destination_components (
  destination_id TEXT NOT NULL REFERENCES channel_destinations(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  PRIMARY KEY (destination_id, component_id)
);
CREATE TABLE channel_destinations (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('slack', 'teams')),
  name TEXT NOT NULL,
  sealed_url TEXT NOT NULL,
  host TEXT NOT NULL,
  selection_mode TEXT NOT NULL DEFAULT 'all' CHECK (selection_mode IN ('all', 'selected')),
  created_by_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE channel_posts (
  id TEXT PRIMARY KEY NOT NULL,
  incident_update_id TEXT NOT NULL REFERENCES incident_updates(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES channel_destinations(id) ON DELETE CASCADE,
  queued_at TEXT NOT NULL,
  UNIQUE (incident_update_id, destination_id)
);
CREATE TABLE component_claim_events (
  id TEXT PRIMARY KEY NOT NULL,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  cause_type TEXT NOT NULL CHECK (cause_type IN ('standing-claim', 'incident', 'maintenance')),
  cause_id TEXT,
  state TEXT CHECK (state IN ('Operational', 'Degraded performance', 'Partially unavailable', 'Major outage', 'Under maintenance')),
  changed_at TEXT NOT NULL,
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
CREATE TABLE component_standing_claims (
  id TEXT PRIMARY KEY NOT NULL,
  component_id TEXT NOT NULL UNIQUE REFERENCES components(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('Operational', 'Degraded performance', 'Partially unavailable', 'Major outage', 'Under maintenance')),
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE component_state_corrections (
  id TEXT PRIMARY KEY NOT NULL,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  history_id TEXT NOT NULL REFERENCES component_state_history(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('Operational', 'Degraded performance', 'Partially unavailable', 'Major outage', 'Under maintenance')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
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
CREATE TABLE ik_batches (
 job_id TEXT NOT NULL REFERENCES ik_jobs(id), action TEXT NOT NULL, position INTEGER NOT NULL,
 end_position INTEGER NOT NULL, fence INTEGER NOT NULL, PRIMARY KEY(job_id,action,position)
);
CREATE TABLE ik_d1_assertions (ok INTEGER NOT NULL CONSTRAINT IMPORT_ATOMIC_GUARD CHECK(ok=1));
CREATE TABLE ik_d1_creation_plans (job_id TEXT NOT NULL REFERENCES ik_jobs(id), ordinal INTEGER NOT NULL, body TEXT NOT NULL, released INTEGER NOT NULL DEFAULT 0 CHECK(released IN (0,1)), PRIMARY KEY(job_id,ordinal));
CREATE TABLE ik_d1_custody_revisions (job_id TEXT PRIMARY KEY REFERENCES ik_jobs(id) ON DELETE CASCADE,revision INTEGER NOT NULL DEFAULT 0,seal TEXT);
CREATE TABLE ik_d1_custody_states (job_id TEXT PRIMARY KEY REFERENCES ik_jobs(id) ON DELETE CASCADE,revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE ik_d1_entries (job_id TEXT NOT NULL REFERENCES ik_jobs(id), ordinal INTEGER NOT NULL, source_identity TEXT NOT NULL, owner_job_id TEXT NOT NULL REFERENCES ik_jobs(id), effects_hash TEXT NOT NULL, PRIMARY KEY(job_id,ordinal));
CREATE TABLE ik_d1_erased_sources (destination TEXT NOT NULL, identity TEXT NOT NULL, PRIMARY KEY(destination,identity));
CREATE TABLE ik_d1_erased_targets (destination TEXT NOT NULL, identity TEXT NOT NULL, PRIMARY KEY(destination,identity));
CREATE TABLE ik_d1_history (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES ik_jobs(id), ordinal INTEGER NOT NULL, effect_ordinal INTEGER NOT NULL, source_identity TEXT NOT NULL, destination TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, reversed INTEGER NOT NULL CHECK(reversed=0), record_json TEXT NOT NULL, successor_id TEXT NOT NULL UNIQUE);
CREATE TABLE ik_d1_indexed_jobs (job_id TEXT PRIMARY KEY REFERENCES ik_jobs(id), fingerprint TEXT NOT NULL);
CREATE TABLE ik_d1_native_staging (id TEXT PRIMARY KEY,generation TEXT NOT NULL,destination TEXT NOT NULL,namespace TEXT NOT NULL,mapping_version TEXT NOT NULL,principal_id TEXT NOT NULL,job_id TEXT NOT NULL REFERENCES ik_jobs(id) ON DELETE CASCADE,fingerprint TEXT NOT NULL,job_fence INTEGER NOT NULL,action TEXT NOT NULL,values_count INTEGER NOT NULL,chunks_count INTEGER NOT NULL,identities INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 0,registered_revision INTEGER,sealed_revision INTEGER,UNIQUE(destination,principal_id,job_id,action));
CREATE TABLE ik_d1_native_staging_index (stage_id TEXT NOT NULL REFERENCES ik_d1_native_staging(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL,source_identity TEXT NOT NULL,target_identity TEXT NOT NULL,PRIMARY KEY(stage_id,ordinal,target_identity));
CREATE TABLE ik_d1_native_staging_values (stage_id TEXT NOT NULL REFERENCES ik_d1_native_staging(id) ON DELETE CASCADE,value_ordinal INTEGER NOT NULL,ordinal INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,body_size INTEGER NOT NULL,value_chunks INTEGER NOT NULL,PRIMARY KEY(stage_id,value_ordinal,ordinal));
CREATE TABLE ik_d1_original_chunks (job_id TEXT NOT NULL REFERENCES ik_jobs(id), kind TEXT NOT NULL, original_key TEXT NOT NULL, ordinal INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(job_id,kind,original_key,ordinal));
CREATE TABLE ik_d1_plan_chunks (job_id TEXT NOT NULL REFERENCES ik_jobs(id), ordinal INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(job_id,ordinal));
CREATE TABLE ik_d1_plan_index (job_id TEXT NOT NULL REFERENCES ik_jobs(id), ordinal INTEGER NOT NULL, source_identity TEXT NOT NULL, target_identity TEXT NOT NULL, PRIMARY KEY(job_id,ordinal,target_identity));
CREATE TABLE ik_d1_preparation_receipts (stage_id TEXT PRIMARY KEY REFERENCES ik_d1_staging(id) ON DELETE CASCADE, generation TEXT NOT NULL, codec_id TEXT, header_hash TEXT NOT NULL, header_size INTEGER NOT NULL, header_chunks INTEGER NOT NULL);
CREATE TABLE ik_d1_publication_fences (stream_id TEXT NOT NULL,job_id TEXT PRIMARY KEY);
CREATE TABLE ik_d1_reversal_reports (job_id TEXT NOT NULL REFERENCES ik_jobs(id), effect_id TEXT NOT NULL, position INTEGER NOT NULL, record_json TEXT NOT NULL, PRIMARY KEY(job_id,effect_id), UNIQUE(job_id,position));
CREATE TABLE ik_d1_staging (id TEXT PRIMARY KEY, generation TEXT NOT NULL, destination TEXT NOT NULL, namespace TEXT NOT NULL, mapping_version TEXT NOT NULL, principal_id TEXT NOT NULL, fingerprint TEXT NOT NULL, operation_key TEXT NOT NULL, total INTEGER NOT NULL, pages INTEGER NOT NULL, layout_hash TEXT NOT NULL, reversal_policy TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, registered_revision INTEGER, sealed_revision INTEGER, UNIQUE(destination,principal_id,operation_key));
CREATE TABLE ik_d1_staging_chunks (stage_id TEXT NOT NULL REFERENCES ik_d1_staging(id) ON DELETE CASCADE, page_ordinal INTEGER NOT NULL, ordinal INTEGER NOT NULL, body TEXT NOT NULL, body_hash TEXT NOT NULL, body_size INTEGER NOT NULL, PRIMARY KEY(stage_id,page_ordinal,ordinal));
CREATE TABLE ik_d1_staging_headers (stage_id TEXT NOT NULL REFERENCES ik_d1_staging(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, body TEXT NOT NULL, body_hash TEXT NOT NULL, body_size INTEGER NOT NULL, PRIMARY KEY(stage_id,ordinal));
CREATE TABLE ik_d1_staging_index (stage_id TEXT NOT NULL REFERENCES ik_d1_staging(id) ON DELETE CASCADE, page_ordinal INTEGER NOT NULL, ordinal INTEGER NOT NULL, source_identity TEXT NOT NULL, target_identity TEXT NOT NULL, PRIMARY KEY(stage_id,page_ordinal,ordinal,target_identity));
CREATE TABLE ik_d1_staging_originals (stage_id TEXT NOT NULL REFERENCES ik_d1_staging(id) ON DELETE CASCADE, original_key TEXT NOT NULL, name TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, PRIMARY KEY(stage_id,original_key));
CREATE TABLE ik_d1_staging_pages (stage_id TEXT NOT NULL REFERENCES ik_d1_staging(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, job_id TEXT NOT NULL UNIQUE, total INTEGER NOT NULL, fingerprint TEXT NOT NULL, plan_json TEXT NOT NULL, body_hash TEXT NOT NULL, body_size INTEGER NOT NULL, chunks INTEGER NOT NULL, identities INTEGER NOT NULL, index_hash TEXT NOT NULL, policy_hash TEXT NOT NULL, inline_plan INTEGER NOT NULL CHECK(inline_plan IN (0,1)), PRIMARY KEY(stage_id,ordinal));
CREATE TABLE ik_d1_stream_origins (job_id TEXT PRIMARY KEY,stream_id TEXT NOT NULL,ordinal INTEGER NOT NULL,page_total INTEGER NOT NULL,job_operation_key TEXT NOT NULL,parent_destination TEXT NOT NULL,parent_namespace TEXT NOT NULL,parent_mapping_version TEXT NOT NULL,parent_principal_id TEXT NOT NULL,parent_fingerprint TEXT NOT NULL,parent_operation_key TEXT NOT NULL,parent_total INTEGER NOT NULL,parent_layout_hash TEXT NOT NULL);
CREATE TABLE ik_d1_stream_pages (stream_id TEXT NOT NULL REFERENCES ik_d1_streams(id), ordinal INTEGER NOT NULL, job_id TEXT NOT NULL UNIQUE REFERENCES ik_jobs(id), total INTEGER NOT NULL, erased_records INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(stream_id,ordinal));
CREATE TABLE ik_d1_stream_revisions(stream_id TEXT PRIMARY KEY,destination TEXT NOT NULL,namespace TEXT NOT NULL,mapping_version TEXT NOT NULL,principal_id TEXT NOT NULL,fingerprint TEXT NOT NULL,operation_key TEXT NOT NULL,total INTEGER NOT NULL,layout_hash TEXT NOT NULL,layout_revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(layout_revision)='integer' AND layout_revision>=0),progress_revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(progress_revision)='integer' AND progress_revision>=0));
CREATE TABLE ik_d1_streams (id TEXT PRIMARY KEY, destination TEXT NOT NULL, namespace TEXT NOT NULL, mapping_version TEXT NOT NULL, principal_id TEXT NOT NULL, fingerprint TEXT NOT NULL, operation_key TEXT NOT NULL, total INTEGER NOT NULL, layout_hash TEXT NOT NULL, state TEXT NOT NULL, UNIQUE(destination,principal_id,operation_key));
CREATE TABLE ik_jobs (
 id TEXT PRIMARY KEY, destination TEXT NOT NULL, namespace TEXT NOT NULL,
 mapping_version TEXT NOT NULL, principal_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
 operation_key TEXT NOT NULL, plan_json TEXT NOT NULL, state TEXT NOT NULL,
 checkpoint INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, fence INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT, lease_expires INTEGER, error TEXT, reversal_policy TEXT NOT NULL DEFAULT 'strict' CHECK(reversal_policy IN ('strict','preserve-conflicts')), reversal_policy_hash TEXT, reversal_cursor INTEGER NOT NULL DEFAULT 0 CHECK(reversal_cursor>=0), reversal_hash TEXT NOT NULL DEFAULT '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
 UNIQUE(destination, principal_id, operation_key)
);
CREATE TABLE ik_original_sets (
 job_id TEXT PRIMARY KEY REFERENCES ik_jobs(id), version INTEGER NOT NULL
);
CREATE TABLE ik_originals (
 job_id TEXT NOT NULL REFERENCES ik_jobs(id), kind TEXT NOT NULL, original_key TEXT NOT NULL,
 name TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, bytes BLOB,
 PRIMARY KEY(job_id,kind,original_key)
);
CREATE TABLE ik_provenance (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES ik_jobs(id), ordinal INTEGER NOT NULL, effect_ordinal INTEGER NOT NULL,
 source_identity TEXT NOT NULL, destination TEXT NOT NULL, target_kind TEXT NOT NULL,
 target_id TEXT NOT NULL, reversed INTEGER NOT NULL DEFAULT 0, record_json TEXT NOT NULL
);
CREATE TABLE ik_sources (
 identity TEXT PRIMARY KEY, source_hash TEXT NOT NULL, mapping_version TEXT NOT NULL,
 effects_hash TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES ik_jobs(id)
);
CREATE TABLE ik_stages (
 job_id TEXT NOT NULL REFERENCES ik_jobs(id), fence INTEGER NOT NULL, effect_id TEXT NOT NULL,
 sha256 TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(job_id,fence,effect_id)
);
CREATE TABLE ik_targets (
 destination TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
 revision TEXT NOT NULL, value_json TEXT NOT NULL, attachment_json TEXT,
 PRIMARY KEY(destination,kind,id)
);
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
CREATE TABLE incident_components (
  id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  component_id TEXT REFERENCES components(id) ON DELETE SET NULL,
  component_name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('Operational', 'Degraded performance', 'Partially unavailable', 'Major outage', 'Under maintenance')),
  relationship TEXT NOT NULL DEFAULT 'Primary' CHECK (relationship IN ('Primary', 'Dependent')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, published_at TEXT);
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
, scheduled_publish_at TEXT, scheduled_channels_json TEXT, reviewed_by_operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL, reviewed_at TEXT, corrects_update_id TEXT REFERENCES incident_updates(id) ON DELETE SET NULL);
CREATE TABLE incident_internal_notes (
  id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
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
CREATE TABLE incident_updates (
  id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('Investigating', 'Identified', 'Monitoring', 'Resolved')),
  affected_audience TEXT NOT NULL CHECK (length(affected_audience) <= 250),
  customer_impact TEXT NOT NULL CHECK (length(customer_impact) <= 250),
  what_still_works TEXT NOT NULL DEFAULT '' CHECK (length(what_still_works) <= 250),
  details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 500),
  published_at TEXT NOT NULL,
  author_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  corrects_update_id TEXT REFERENCES incident_updates(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, is_retroactive INTEGER NOT NULL DEFAULT 0 CHECK (is_retroactive IN (0, 1)), next_update_at TEXT);
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
, peak_impact TEXT);
CREATE TABLE integration_attempts (
 namespace TEXT NOT NULL, id TEXT NOT NULL, delivery_id TEXT NOT NULL, number INTEGER NOT NULL,
 started_at INTEGER NOT NULL, finished_at INTEGER, outcome TEXT,
 PRIMARY KEY(namespace,id), UNIQUE(namespace,delivery_id,number)
);
CREATE TABLE integration_deliveries (
 namespace TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, destination_hash TEXT NOT NULL,
 envelope TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('queued','sending','accepted','rejected','uncertain')),
 attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, next_at INTEGER NOT NULL,
 claim TEXT, claim_until INTEGER, max_attempts INTEGER NOT NULL, retry_delays TEXT NOT NULL,
 PRIMARY KEY(namespace,id)
);
CREATE TABLE integration_replays (
 namespace TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, envelope TEXT NOT NULL, received_at INTEGER NOT NULL,
 PRIMARY KEY(namespace,id)
);
CREATE TABLE integration_resolutions (
 namespace TEXT NOT NULL, id TEXT NOT NULL, delivery_id TEXT NOT NULL, at INTEGER NOT NULL, outcome TEXT NOT NULL,
 PRIMARY KEY(namespace,id)
);
CREATE TABLE integration_token_events (
 namespace TEXT NOT NULL, id TEXT NOT NULL, token_id TEXT NOT NULL, at INTEGER NOT NULL,
 action TEXT NOT NULL, feature TEXT NOT NULL,
 PRIMARY KEY(namespace,id)
);
CREATE TABLE integration_token_usage (
 namespace TEXT NOT NULL, id TEXT NOT NULL, token_id TEXT, at INTEGER NOT NULL, required_scopes TEXT NOT NULL, allowed INTEGER NOT NULL,
 request_id TEXT, resource TEXT,
 PRIMARY KEY(namespace,id)
);
CREATE TABLE integration_tokens (
 namespace TEXT NOT NULL, id TEXT NOT NULL, token_hash TEXT NOT NULL, name TEXT NOT NULL, scopes TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER, revoked_at INTEGER,
 PRIMARY KEY(namespace,id), UNIQUE(namespace,token_hash)
);
CREATE TABLE mail_provider_webhook_events (
  id TEXT PRIMARY KEY NOT NULL,
  provider_event_id TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL
, hard_bounce INTEGER NOT NULL DEFAULT 0, claimed_at TEXT, applied_at TEXT, delivery_id TEXT REFERENCES notification_deliveries(id) ON DELETE SET NULL);
CREATE TABLE mail_send_ledger (
  id TEXT PRIMARY KEY,
  envelope_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('sending', 'accepted', 'uncertain', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, provider_receipt TEXT);
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
CREATE TABLE maintenance_components (
  id TEXT PRIMARY KEY NOT NULL,
  maintenance_id TEXT NOT NULL REFERENCES maintenance(id) ON DELETE CASCADE,
  component_id TEXT REFERENCES components(id) ON DELETE SET NULL,
  component_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'Under maintenance' CHECK (state = 'Under maintenance'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
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
CREATE TABLE notification_channel_selections (
  incident_update_id TEXT NOT NULL REFERENCES incident_updates(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (incident_update_id, channel)
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
  updated_at TEXT NOT NULL, notification_event_id TEXT, notification_event_type TEXT, incident_report_id TEXT REFERENCES incident_reports(id) ON DELETE RESTRICT, mail_payload_json TEXT, dispatch_locked_at TEXT,
  CHECK (incident_update_id IS NOT NULL OR maintenance_id IS NOT NULL)
);
CREATE TABLE notification_delivery_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES notification_deliveries(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  attempted_at TEXT NOT NULL,
  provider_message_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL, local_capture_id TEXT
  CHECK (local_capture_id IS NULL OR
    (length(local_capture_id) > 0 AND provider_message_id IS NULL AND error IS NULL)),
  UNIQUE(delivery_id, attempt_number)
);
CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('delivery-dispatch', 'operator-alert')),
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  available_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TEXT,
  completed_at TEXT,
  failed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE operator_magic_links (
  id TEXT PRIMARY KEY NOT NULL,
  operator_id TEXT REFERENCES operators(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('signin', 'invite')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  invited_by_operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO "operator_magic_links" VALUES('legacy-link','01J00000000000000000000001','owner@example.test','Operator 1','signin','Uo7oVGqT6yn1vRdiM-1IqH_rRTQ26gj2GhpM_IBYqvo','2035-01-01T00:00:00.000Z',NULL,NULL,NULL,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');
CREATE TABLE operators (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  is_setup_operator INTEGER NOT NULL DEFAULT 0 CHECK (is_setup_operator IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, deactivated_at TEXT);
INSERT INTO "operators" VALUES('01J00000000000000000000001','owner@example.test','Operator 1',1,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z',NULL);
INSERT INTO "operators" VALUES('01J00000000000000000000002','second@example.test','Operator 2',0,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z',NULL);
INSERT INTO "operators" VALUES('01J00000000000000000000003','third@example.test','Operator 3',0,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z',NULL);
INSERT INTO "operators" VALUES('01J00000000000000000000004','inactive@example.test','Operator 4',0,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');
INSERT INTO "operators" VALUES('01J00000000000000000000005','deleted-01j00000000000000000000005@operator.invalid','Operator 5',0,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');
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
, logo_key TEXT, logo_content_type TEXT, widget_allowed_origins TEXT NOT NULL DEFAULT '[]', mail_from_address TEXT NOT NULL DEFAULT '', ai_tone_instructions TEXT NOT NULL DEFAULT '', feed_id TEXT NOT NULL DEFAULT 'pending-feed-identity');
CREATE TABLE public_snapshot_work (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'default'),
  requested_revision INTEGER NOT NULL DEFAULT 0,
  completed_revision INTEGER NOT NULL DEFAULT 0,
  retry_lease_id TEXT,
  retry_lease_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO "public_snapshot_work" VALUES('default',0,0,NULL,NULL,'2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z');
CREATE TABLE reference_allocations (
  namespace TEXT NOT NULL REFERENCES reference_counters(namespace) ON DELETE RESTRICT,
  reference TEXT NOT NULL,
  PRIMARY KEY (namespace, reference)
);
CREATE TABLE reference_counters (
  namespace TEXT PRIMARY KEY NOT NULL CHECK (namespace IN ('INC', 'SCH')),
  last_number INTEGER NOT NULL DEFAULT 0
    CHECK (last_number >= 0 AND last_number <= 9007199254740991)
);
INSERT INTO "reference_counters" VALUES('INC',0);
INSERT INTO "reference_counters" VALUES('SCH',0);
CREATE TABLE request_rate_windows (
  rate_key TEXT PRIMARY KEY NOT NULL,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO "sessions" VALUES('01J00000000000000000000060','01J00000000000000000000001','2035-01-01T00:00:00.000Z','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');
CREATE TABLE setup_readiness (
  step TEXT PRIMARY KEY,
  evidence_key TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
INSERT INTO "setup_readiness" VALUES('first-run','complete','2026-10-01T00:00:00.000Z');
CREATE TABLE snapshot_build_control (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'default'),
  next_generation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO "snapshot_build_control" VALUES('default',0,'2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z');
CREATE TABLE snapshot_builds (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('building', 'published', 'failed')),
  version TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE statuspage_import_invites (
  subscriber_id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  sent_at TEXT
);
CREATE TABLE statuspage_import_targets (
  kind TEXT NOT NULL CHECK (kind IN ('group', 'component', 'incident', 'maintenance', 'subscriber')),
  id TEXT NOT NULL,
  revision TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE TABLE subscriber_components (
  id TEXT PRIMARY KEY NOT NULL,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(subscriber_id, component_id)
);
CREATE TABLE subscriber_confirmation_attempts (
  email_hash TEXT PRIMARY KEY NOT NULL,
  last_sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE subscriber_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('confirm', 'manage', 'unsubscribe')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO "subscriber_tokens" VALUES('prior-manage','prior-subscriber','manage','p6Q1FDouHu_-YVsj1WdiDr7TCW_Uz81XA3D-LpytIR0',NULL,NULL,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');
INSERT INTO "subscriber_tokens" VALUES('prior-unsubscribe','prior-subscriber','unsubscribe','Por69k5_6Ki5MRHQoFSJVN-YMQll6CS2qiuEHQLxraA',NULL,NULL,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');
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
INSERT INTO "subscribers" VALUES('prior-subscriber','email','subscriber@example.test',NULL,'active','all','prior-subscription-hash',NULL,NULL,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');
CREATE INDEX sessions_operator_id_idx ON sessions(operator_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
CREATE UNIQUE INDEX component_groups_display_order_idx ON component_groups(display_order);
CREATE INDEX components_group_order_idx ON components(group_id, display_order);
CREATE INDEX component_state_history_component_changed_idx ON component_state_history(component_id, changed_at);
CREATE INDEX incidents_lifecycle_opened_idx ON incidents(lifecycle, opened_at DESC);
CREATE INDEX incident_components_incident_id_idx ON incident_components(incident_id);
CREATE INDEX incident_components_component_id_idx ON incident_components(component_id);
CREATE INDEX incident_updates_incident_published_idx ON incident_updates(incident_id, published_at DESC);
CREATE INDEX incident_internal_notes_incident_created_idx ON incident_internal_notes(incident_id, created_at DESC);
CREATE INDEX incident_attachments_incident_id_idx ON incident_attachments(incident_id);
CREATE INDEX maintenance_state_start_idx ON maintenance(state, starts_at);
CREATE INDEX maintenance_components_maintenance_id_idx ON maintenance_components(maintenance_id);
CREATE INDEX subscribers_state_idx ON subscribers(state);
CREATE INDEX notification_deliveries_subscriber_idx ON notification_deliveries(subscriber_id, queued_at DESC);
CREATE INDEX notification_deliveries_update_idx ON notification_deliveries(incident_update_id, queued_at DESC);
CREATE UNIQUE INDEX incident_drafts_incident_id_unique
  ON incident_drafts(incident_id);
CREATE INDEX component_state_corrections_component_interval_idx
  ON component_state_corrections(component_id, starts_at, ends_at);
CREATE INDEX snapshot_builds_status_started_idx ON snapshot_builds(status, started_at);
CREATE INDEX audit_entries_entity_created_idx ON audit_entries(entity_type, entity_id, created_at DESC);
CREATE INDEX incident_template_components_template_idx ON incident_template_components(template_id);
CREATE INDEX incident_reports_published_idx ON incident_reports(published_at DESC);
CREATE INDEX maintenance_notices_maintenance_published_idx ON maintenance_notices(maintenance_id, published_at DESC);
CREATE UNIQUE INDEX maintenance_notices_one_transition_idx ON maintenance_notices(maintenance_id, kind)
  WHERE kind IN ('scheduled', 'reminder', 'started', 'completed', 'cancelled');
CREATE INDEX alert_receipts_dedup_idx ON alert_receipts(source_id, deduplication_key, received_at DESC);
CREATE INDEX alert_receipts_incident_idx ON alert_receipts(incident_id, received_at DESC);
CREATE INDEX operator_magic_links_active_idx
  ON operator_magic_links(token_hash, expires_at, consumed_at, revoked_at);
CREATE UNIQUE INDEX subscriber_tokens_one_active_scope
  ON subscriber_tokens(subscriber_id, scope)
  WHERE revoked_at IS NULL;
CREATE INDEX subscriber_tokens_lookup_idx
  ON subscriber_tokens(token_hash, scope, expires_at, revoked_at);
CREATE INDEX notification_deliveries_dispatch_claim_idx ON notification_deliveries(outcome, dispatch_locked_at);
CREATE INDEX notification_outbox_ready_idx
  ON notification_outbox(completed_at, failed_at, available_at);
CREATE UNIQUE INDEX notification_outbox_one_delivery_event
  ON notification_outbox(kind, aggregate_id)
  WHERE kind = 'delivery-dispatch';
CREATE UNIQUE INDEX notification_outbox_one_operator_alert
  ON notification_outbox(kind, aggregate_id)
  WHERE kind = 'operator-alert';
CREATE INDEX notification_delivery_attempts_delivery_idx
  ON notification_delivery_attempts(delivery_id, attempted_at DESC);
CREATE UNIQUE INDEX notification_deliveries_one_event_channel
  ON notification_deliveries(subscriber_id, notification_event_id, channel)
  WHERE notification_event_id IS NOT NULL;
CREATE INDEX request_rate_windows_expiry_idx ON request_rate_windows(expires_at);
CREATE INDEX incident_components_publication_idx ON incident_components(incident_id, published_at);
CREATE TRIGGER page_settings_snapshot_dirty_insert AFTER INSERT ON page_settings BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER page_settings_snapshot_dirty_update AFTER UPDATE ON page_settings BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER components_snapshot_dirty_insert AFTER INSERT ON components BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER components_snapshot_dirty_update AFTER UPDATE ON components BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER components_snapshot_dirty_delete AFTER DELETE ON components BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_groups_snapshot_dirty_insert AFTER INSERT ON component_groups BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_groups_snapshot_dirty_update AFTER UPDATE ON component_groups BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_groups_snapshot_dirty_delete AFTER DELETE ON component_groups BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_claims_snapshot_dirty_insert AFTER INSERT ON component_standing_claims BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_claims_snapshot_dirty_update AFTER UPDATE ON component_standing_claims BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_claims_snapshot_dirty_delete AFTER DELETE ON component_standing_claims BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_history_snapshot_dirty_insert AFTER INSERT ON component_state_history BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER component_corrections_snapshot_dirty_insert AFTER INSERT ON component_state_corrections BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER incident_components_snapshot_dirty_published AFTER UPDATE OF published_at ON incident_components WHEN NEW.published_at IS NOT OLD.published_at BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER incident_updates_snapshot_dirty_insert AFTER INSERT ON incident_updates BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER incident_updates_snapshot_dirty_delete AFTER DELETE ON incident_updates BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER incidents_snapshot_dirty_deleted AFTER UPDATE OF deleted_at ON incidents WHEN NEW.deleted_at IS NOT OLD.deleted_at BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_snapshot_dirty_insert AFTER INSERT ON maintenance BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_snapshot_dirty_update AFTER UPDATE ON maintenance BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_snapshot_dirty_delete AFTER DELETE ON maintenance BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_components_snapshot_dirty_insert AFTER INSERT ON maintenance_components BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_components_snapshot_dirty_update AFTER UPDATE ON maintenance_components BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_components_snapshot_dirty_delete AFTER DELETE ON maintenance_components BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_notices_snapshot_dirty_insert AFTER INSERT ON maintenance_notices BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_notices_snapshot_dirty_update AFTER UPDATE ON maintenance_notices BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER maintenance_notices_snapshot_dirty_delete AFTER DELETE ON maintenance_notices BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER incident_reports_snapshot_dirty_published AFTER UPDATE OF published_at ON incident_reports WHEN NEW.published_at IS NOT OLD.published_at BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER incident_reports_snapshot_dirty_delete AFTER DELETE ON incident_reports WHEN OLD.published_at IS NOT NULL BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE UNIQUE INDEX page_settings_feed_id_unique ON page_settings(feed_id);
CREATE INDEX mail_provider_webhook_events_pending_idx
  ON mail_provider_webhook_events(provider_message_id, applied_at, claimed_at);
CREATE INDEX component_claim_events_component_changed_idx ON component_claim_events(component_id, changed_at);
CREATE TRIGGER component_claim_events_maintenance_started
AFTER UPDATE OF state ON maintenance
WHEN OLD.state = 'Scheduled' AND NEW.state = 'In progress'
BEGIN
  INSERT INTO component_claim_events (id, component_id, cause_type, cause_id, state, changed_at, created_at, updated_at)
  SELECT substr(NEW.id, 1, 10) || upper(substr(hex(randomblob(16)), 1, 16)), component_id, 'maintenance', NEW.id, 'Under maintenance', NEW.updated_at, NEW.updated_at, NEW.updated_at
  FROM maintenance_components
  WHERE maintenance_id = NEW.id AND component_id IS NOT NULL;
END;
CREATE TRIGGER component_claim_events_maintenance_completed
AFTER UPDATE OF state ON maintenance
WHEN OLD.state = 'In progress' AND NEW.state = 'Completed'
BEGIN
  INSERT INTO component_claim_events (id, component_id, cause_type, cause_id, state, changed_at, created_at, updated_at)
  SELECT substr(NEW.id, 1, 10) || upper(substr(hex(randomblob(16)), 1, 16)), component_id, 'maintenance', NEW.id, NULL, NEW.updated_at, NEW.updated_at, NEW.updated_at
  FROM maintenance_components
  WHERE maintenance_id = NEW.id AND component_id IS NOT NULL;
END;
CREATE TRIGGER incidents_reserve_reference AFTER INSERT ON incidents
BEGIN
  INSERT OR IGNORE INTO reference_allocations (namespace, reference) VALUES ('INC', NEW.reference);
END;
CREATE TRIGGER maintenance_reserve_reference AFTER INSERT ON maintenance
BEGIN
  INSERT OR IGNORE INTO reference_allocations (namespace, reference) VALUES ('SCH', NEW.reference);
END;
CREATE UNIQUE INDEX ik_active_target ON ik_provenance(destination,target_kind,target_id) WHERE reversed=0;
CREATE INDEX ik_d1_history_job ON ik_d1_history(job_id);
CREATE TRIGGER ik_d1_creation_plan_capture AFTER INSERT ON ik_d1_plan_chunks BEGIN INSERT INTO ik_d1_creation_plans(job_id,ordinal,body) VALUES(NEW.job_id,NEW.ordinal,NEW.body); END;
CREATE TRIGGER ik_d1_creation_plan_immutable BEFORE UPDATE ON ik_d1_creation_plans WHEN NEW.job_id IS NOT OLD.job_id OR NEW.ordinal IS NOT OLD.ordinal OR NEW.body IS NOT OLD.body OR OLD.released<>0 OR NEW.released<>1 OR NOT EXISTS(SELECT 1 FROM ik_d1_plan_chunks p WHERE p.job_id=OLD.job_id AND p.ordinal=OLD.ordinal AND p.body IS OLD.body) BEGIN SELECT RAISE(ABORT,'IMPORT_CREATION_SNAPSHOT_CHANGED'); END;
CREATE TRIGGER ik_d1_creation_plan_release BEFORE DELETE ON ik_d1_creation_plans WHEN OLD.released<>1 BEGIN SELECT RAISE(ABORT,'IMPORT_CREATION_SNAPSHOT_CHANGED'); END;
CREATE TRIGGER ik_d1_stream_page_delete AFTER DELETE ON ik_d1_stream_pages BEGIN UPDATE ik_d1_streams SET state='invalid' WHERE id=OLD.stream_id; END;
CREATE TRIGGER ik_d1_stream_page_update AFTER UPDATE OF stream_id,ordinal,job_id,total ON ik_d1_stream_pages BEGIN UPDATE ik_d1_streams SET state='invalid' WHERE id=OLD.stream_id OR id=NEW.stream_id; END;
CREATE TRIGGER ik_d1_stream_page_insert AFTER INSERT ON ik_d1_stream_pages BEGIN UPDATE ik_d1_streams SET state='invalid' WHERE id=NEW.stream_id; END;
CREATE INDEX ik_d1_plan_index_source ON ik_d1_plan_index(source_identity,job_id);
CREATE INDEX ik_d1_plan_index_target ON ik_d1_plan_index(target_identity,job_id);
CREATE TRIGGER ik_d1_plan_index_insert AFTER INSERT ON ik_d1_plan_index BEGIN DELETE FROM ik_d1_indexed_jobs WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_plan_index_delete AFTER DELETE ON ik_d1_plan_index BEGIN DELETE FROM ik_d1_indexed_jobs WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_plan_index_update AFTER UPDATE ON ik_d1_plan_index BEGIN DELETE FROM ik_d1_indexed_jobs WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE INDEX ik_d1_stream_origin_parent ON ik_d1_stream_origins(stream_id,ordinal);
CREATE TRIGGER ik_d1_stream_origin_insert BEFORE INSERT ON ik_d1_stream_origins WHEN EXISTS(SELECT 1 FROM ik_d1_stream_origins WHERE job_id=NEW.job_id) OR NOT EXISTS(SELECT 1 FROM ik_d1_stream_pages p JOIN ik_d1_streams s ON s.id=p.stream_id JOIN ik_jobs j ON j.id=p.job_id WHERE ((((NEW.job_id IS p.job_id AND NEW.stream_id IS s.id) AND (NEW.ordinal IS p.ordinal AND NEW.page_total IS p.total)) AND ((NEW.job_operation_key IS j.operation_key AND NEW.parent_destination IS s.destination) AND (NEW.parent_namespace IS s.namespace AND (NEW.parent_mapping_version IS s.mapping_version AND NEW.parent_principal_id IS s.principal_id)))) AND (((NEW.parent_fingerprint IS s.fingerprint AND NEW.parent_operation_key IS s.operation_key) AND (NEW.parent_total IS s.total AND (NEW.parent_layout_hash IS s.layout_hash AND p.stream_id IS s.id))) AND ((j.total IS p.total AND j.destination IS s.destination) AND (j.namespace IS s.namespace AND (j.mapping_version IS s.mapping_version AND j.principal_id IS s.principal_id)))))) BEGIN SELECT RAISE(ABORT,'IMPORT_STREAM_ORIGIN_CHANGED'); END;
CREATE TRIGGER ik_d1_stream_origin_update BEFORE UPDATE ON ik_d1_stream_origins BEGIN SELECT RAISE(ABORT,'IMPORT_STREAM_ORIGIN_CHANGED'); END;
CREATE TRIGGER ik_d1_stream_origin_delete BEFORE DELETE ON ik_d1_stream_origins WHEN EXISTS(SELECT 1 FROM ik_jobs WHERE id=OLD.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_STREAM_ORIGIN_CHANGED'); END;
CREATE TRIGGER ik_d1_stream_origin_job_delete AFTER DELETE ON ik_jobs BEGIN DELETE FROM ik_d1_stream_origins WHERE job_id=OLD.id; END;
CREATE TRIGGER ik_d1_stream_origin_page_insert AFTER INSERT ON ik_d1_stream_pages BEGIN INSERT INTO ik_d1_stream_origins(job_id,stream_id,ordinal,page_total,job_operation_key,parent_destination,parent_namespace,parent_mapping_version,parent_principal_id,parent_fingerprint,parent_operation_key,parent_total,parent_layout_hash) SELECT p.job_id,s.id,p.ordinal,p.total,j.operation_key,s.destination,s.namespace,s.mapping_version,s.principal_id,s.fingerprint,s.operation_key,s.total,s.layout_hash FROM ik_d1_stream_pages p JOIN ik_d1_streams s ON s.id=p.stream_id JOIN ik_jobs j ON j.id=p.job_id WHERE NOT EXISTS(SELECT 1 FROM ik_d1_stream_origins o WHERE o.job_id=p.job_id) AND j.total IS p.total AND j.destination IS s.destination AND j.namespace IS s.namespace AND j.mapping_version IS s.mapping_version AND j.principal_id IS s.principal_id AND p.job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_stream_origin_page_update AFTER UPDATE OF stream_id,ordinal,job_id,total ON ik_d1_stream_pages BEGIN INSERT INTO ik_d1_stream_origins(job_id,stream_id,ordinal,page_total,job_operation_key,parent_destination,parent_namespace,parent_mapping_version,parent_principal_id,parent_fingerprint,parent_operation_key,parent_total,parent_layout_hash) SELECT p.job_id,s.id,p.ordinal,p.total,j.operation_key,s.destination,s.namespace,s.mapping_version,s.principal_id,s.fingerprint,s.operation_key,s.total,s.layout_hash FROM ik_d1_stream_pages p JOIN ik_d1_streams s ON s.id=p.stream_id JOIN ik_jobs j ON j.id=p.job_id WHERE NOT EXISTS(SELECT 1 FROM ik_d1_stream_origins o WHERE o.job_id=p.job_id) AND j.total IS p.total AND j.destination IS s.destination AND j.namespace IS s.namespace AND j.mapping_version IS s.mapping_version AND j.principal_id IS s.principal_id AND p.job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_stream_revision_insert BEFORE INSERT ON ik_d1_stream_revisions WHEN EXISTS(SELECT 1 FROM ik_d1_stream_revisions WHERE stream_id=NEW.stream_id) BEGIN SELECT RAISE(ABORT,'IMPORT_STREAM_REVISION_CHANGED'); END;
CREATE TRIGGER ik_d1_stream_revision_update BEFORE UPDATE ON ik_d1_stream_revisions WHEN NEW.stream_id IS NOT OLD.stream_id OR NEW.destination IS NOT OLD.destination OR NEW.namespace IS NOT OLD.namespace OR NEW.mapping_version IS NOT OLD.mapping_version OR NEW.principal_id IS NOT OLD.principal_id OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.operation_key IS NOT OLD.operation_key OR NEW.total IS NOT OLD.total OR NEW.layout_hash IS NOT OLD.layout_hash OR NEW.layout_revision<OLD.layout_revision OR NEW.progress_revision<=OLD.progress_revision BEGIN SELECT RAISE(ABORT,'IMPORT_STREAM_REVISION_CHANGED'); END;
CREATE TRIGGER ik_d1_stream_revision_delete BEFORE DELETE ON ik_d1_stream_revisions BEGIN SELECT RAISE(ABORT,'IMPORT_STREAM_REVISION_CHANGED'); END;
CREATE TRIGGER ik_d1_stream_revision_parent_insert AFTER INSERT ON ik_d1_streams BEGIN INSERT INTO ik_d1_stream_revisions(stream_id,destination,namespace,mapping_version,principal_id,fingerprint,operation_key,total,layout_hash) SELECT NEW.id,NEW.destination,NEW.namespace,NEW.mapping_version,NEW.principal_id,NEW.fingerprint,NEW.operation_key,NEW.total,NEW.layout_hash WHERE NOT EXISTS(SELECT 1 FROM ik_d1_stream_revisions WHERE stream_id=NEW.id); UPDATE ik_d1_stream_revisions SET layout_revision=layout_revision+1,progress_revision=progress_revision+1 WHERE stream_id=NEW.id; END;
CREATE TRIGGER ik_d1_stream_revision_parent_delete AFTER DELETE ON ik_d1_streams BEGIN UPDATE ik_d1_stream_revisions SET layout_revision=layout_revision+1,progress_revision=progress_revision+1 WHERE stream_id=OLD.id; END;
CREATE TRIGGER ik_d1_stream_revision_parent_update AFTER UPDATE ON ik_d1_streams BEGIN UPDATE ik_d1_stream_revisions SET progress_revision=progress_revision+1 WHERE stream_id=OLD.id OR stream_id=NEW.id; END;
CREATE TRIGGER ik_d1_stream_revision_parent_layout AFTER UPDATE OF id,destination,namespace,mapping_version,principal_id,fingerprint,operation_key,total,layout_hash ON ik_d1_streams BEGIN UPDATE ik_d1_stream_revisions SET layout_revision=layout_revision+1,progress_revision=progress_revision+1 WHERE stream_id=OLD.id OR stream_id=NEW.id; END;
CREATE TRIGGER ik_d1_stream_revision_ik_d1_stream_pages_insert AFTER INSERT ON ik_d1_stream_pages BEGIN UPDATE ik_d1_stream_revisions SET layout_revision=layout_revision+1,progress_revision=progress_revision+1 WHERE stream_id=NEW.stream_id; END;
CREATE TRIGGER ik_d1_stream_revision_ik_d1_stream_pages_update AFTER UPDATE OF stream_id,ordinal,job_id,total ON ik_d1_stream_pages BEGIN UPDATE ik_d1_stream_revisions SET layout_revision=layout_revision+1,progress_revision=progress_revision+1 WHERE stream_id=OLD.stream_id OR stream_id=NEW.stream_id; END;
CREATE TRIGGER ik_d1_stream_revision_ik_d1_stream_pages_delete AFTER DELETE ON ik_d1_stream_pages BEGIN UPDATE ik_d1_stream_revisions SET layout_revision=layout_revision+1,progress_revision=progress_revision+1 WHERE stream_id=OLD.stream_id; END;
CREATE TRIGGER ik_d1_stream_revision_ik_d1_stream_origins_insert AFTER INSERT ON ik_d1_stream_origins BEGIN UPDATE ik_d1_stream_revisions SET layout_revision=layout_revision+1,progress_revision=progress_revision+1 WHERE stream_id=NEW.stream_id; END;
CREATE TRIGGER ik_d1_stream_revision_ik_d1_stream_origins_update AFTER UPDATE ON ik_d1_stream_origins BEGIN UPDATE ik_d1_stream_revisions SET layout_revision=layout_revision+1,progress_revision=progress_revision+1 WHERE stream_id=OLD.stream_id OR stream_id=NEW.stream_id; END;
CREATE TRIGGER ik_d1_stream_revision_ik_d1_stream_origins_delete AFTER DELETE ON ik_d1_stream_origins BEGIN UPDATE ik_d1_stream_revisions SET layout_revision=layout_revision+1,progress_revision=progress_revision+1 WHERE stream_id=OLD.stream_id; END;
CREATE TRIGGER ik_d1_stream_revision_page_erasure AFTER UPDATE OF erased_records ON ik_d1_stream_pages BEGIN UPDATE ik_d1_stream_revisions SET progress_revision=progress_revision+1 WHERE stream_id=OLD.stream_id OR stream_id=NEW.stream_id; END;
CREATE TRIGGER ik_d1_stream_revision_job_insert AFTER INSERT ON ik_jobs BEGIN UPDATE ik_d1_stream_revisions SET layout_revision=layout_revision+1,progress_revision=progress_revision+1 WHERE stream_id IN (SELECT stream_id FROM ik_d1_stream_pages WHERE job_id=NEW.id UNION SELECT stream_id FROM ik_d1_stream_origins WHERE job_id=NEW.id); END;
CREATE TRIGGER ik_d1_stream_revision_job_update AFTER UPDATE ON ik_jobs BEGIN UPDATE ik_d1_stream_revisions SET progress_revision=progress_revision+1 WHERE stream_id IN (SELECT stream_id FROM ik_d1_stream_pages WHERE job_id=OLD.id OR job_id=NEW.id UNION SELECT stream_id FROM ik_d1_stream_origins WHERE job_id=OLD.id OR job_id=NEW.id); END;
CREATE TRIGGER ik_d1_stream_revision_job_delete AFTER DELETE ON ik_jobs BEGIN UPDATE ik_d1_stream_revisions SET layout_revision=layout_revision+1,progress_revision=progress_revision+1 WHERE stream_id IN (SELECT stream_id FROM ik_d1_stream_pages WHERE job_id=OLD.id UNION SELECT stream_id FROM ik_d1_stream_origins WHERE job_id=OLD.id); END;
CREATE TRIGGER ik_d1_stream_revision_job_layout AFTER UPDATE OF id,destination,namespace,mapping_version,principal_id,fingerprint,operation_key,total,reversal_policy,reversal_policy_hash ON ik_jobs BEGIN UPDATE ik_d1_stream_revisions SET layout_revision=layout_revision+1,progress_revision=progress_revision+1 WHERE stream_id IN (SELECT stream_id FROM ik_d1_stream_pages WHERE job_id=OLD.id OR job_id=NEW.id UNION SELECT stream_id FROM ik_d1_stream_origins WHERE job_id=OLD.id OR job_id=NEW.id); END;
CREATE INDEX ik_d1_publication_fence_stream ON ik_d1_publication_fences(stream_id);
CREATE TRIGGER ik_d1_publication_ik_jobs_insert BEFORE INSERT ON ik_jobs WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_jobs_update BEFORE UPDATE ON ik_jobs WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.id OR job_id=NEW.id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_jobs_delete BEFORE DELETE ON ik_jobs WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_streams_insert BEFORE INSERT ON ik_d1_streams WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE stream_id=NEW.id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_streams_update BEFORE UPDATE ON ik_d1_streams WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE stream_id=OLD.id OR stream_id=NEW.id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_streams_delete BEFORE DELETE ON ik_d1_streams WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE stream_id=OLD.id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_plan_chunks_insert BEFORE INSERT ON ik_d1_plan_chunks WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_plan_chunks_update BEFORE UPDATE ON ik_d1_plan_chunks WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id OR job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_plan_chunks_delete BEFORE DELETE ON ik_d1_plan_chunks WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_plan_index_insert BEFORE INSERT ON ik_d1_plan_index WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_plan_index_update BEFORE UPDATE ON ik_d1_plan_index WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id OR job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_plan_index_delete BEFORE DELETE ON ik_d1_plan_index WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_originals_insert BEFORE INSERT ON ik_originals WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_originals_update BEFORE UPDATE ON ik_originals WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id OR job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_originals_delete BEFORE DELETE ON ik_originals WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_original_chunks_insert BEFORE INSERT ON ik_d1_original_chunks WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_original_chunks_update BEFORE UPDATE ON ik_d1_original_chunks WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id OR job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_original_chunks_delete BEFORE DELETE ON ik_d1_original_chunks WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_original_sets_insert BEFORE INSERT ON ik_original_sets WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_original_sets_update BEFORE UPDATE ON ik_original_sets WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id OR job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_original_sets_delete BEFORE DELETE ON ik_original_sets WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_indexed_jobs_insert BEFORE INSERT ON ik_d1_indexed_jobs WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_indexed_jobs_update BEFORE UPDATE ON ik_d1_indexed_jobs WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id OR job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_indexed_jobs_delete BEFORE DELETE ON ik_d1_indexed_jobs WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_reversal_reports_insert BEFORE INSERT ON ik_d1_reversal_reports WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_reversal_reports_update BEFORE UPDATE ON ik_d1_reversal_reports WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id OR job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_reversal_reports_delete BEFORE DELETE ON ik_d1_reversal_reports WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_provenance_insert BEFORE INSERT ON ik_provenance WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_provenance_update BEFORE UPDATE ON ik_provenance WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id OR job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_provenance_delete BEFORE DELETE ON ik_provenance WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_sources_insert BEFORE INSERT ON ik_sources WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_sources_update BEFORE UPDATE ON ik_sources WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id OR job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_sources_delete BEFORE DELETE ON ik_sources WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_entries_insert BEFORE INSERT ON ik_d1_entries WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_entries_update BEFORE UPDATE ON ik_d1_entries WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id OR job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_entries_delete BEFORE DELETE ON ik_d1_entries WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_history_insert BEFORE INSERT ON ik_d1_history WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_history_update BEFORE UPDATE ON ik_d1_history WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id OR job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_history_delete BEFORE DELETE ON ik_d1_history WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_batches_insert BEFORE INSERT ON ik_batches WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_batches_update BEFORE UPDATE ON ik_batches WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id OR job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_batches_delete BEFORE DELETE ON ik_batches WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_stream_pages_insert BEFORE INSERT ON ik_d1_stream_pages WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE stream_id=NEW.stream_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_stream_pages_update BEFORE UPDATE ON ik_d1_stream_pages WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE stream_id=OLD.stream_id OR stream_id=NEW.stream_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_ik_d1_stream_pages_delete BEFORE DELETE ON ik_d1_stream_pages WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE stream_id=OLD.stream_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_parent_update BEFORE UPDATE ON ik_d1_streams WHEN EXISTS(SELECT 1 FROM ik_d1_stream_pages p JOIN ik_d1_publication_fences f ON f.job_id=p.job_id WHERE p.stream_id=OLD.id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_parent_delete BEFORE DELETE ON ik_d1_streams WHEN EXISTS(SELECT 1 FROM ik_d1_stream_pages p JOIN ik_d1_publication_fences f ON f.job_id=p.job_id WHERE p.stream_id=OLD.id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_child_page_insert BEFORE INSERT ON ik_d1_stream_pages WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_child_page_update BEFORE UPDATE ON ik_d1_stream_pages WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id OR job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_publication_child_page_delete BEFORE DELETE ON ik_d1_stream_pages WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=OLD.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE INDEX ik_d1_staging_source ON ik_d1_staging_index(source_identity,stage_id);
CREATE INDEX ik_d1_staging_target ON ik_d1_staging_index(target_identity,stage_id);
CREATE TRIGGER ik_d1_staging_binding BEFORE UPDATE OF id,generation,destination,namespace,mapping_version,principal_id,fingerprint,operation_key,total,pages,layout_hash,reversal_policy ON ik_d1_staging BEGIN SELECT RAISE(ABORT,'IMPORT_STAGE_BINDING_CHANGED'); END;
CREATE TRIGGER ik_d1_staging_pages_insert AFTER INSERT ON ik_d1_staging_pages BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL,registered_revision=NULL WHERE id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_staging_pages_update AFTER UPDATE ON ik_d1_staging_pages BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL,registered_revision=NULL WHERE id=OLD.stage_id OR id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_staging_pages_delete AFTER DELETE ON ik_d1_staging_pages BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL,registered_revision=NULL WHERE id=OLD.stage_id; END;
CREATE TRIGGER ik_d1_staging_index_insert AFTER INSERT ON ik_d1_staging_index BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL,registered_revision=NULL WHERE id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_staging_index_update AFTER UPDATE ON ik_d1_staging_index BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL,registered_revision=NULL WHERE id=OLD.stage_id OR id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_staging_index_delete AFTER DELETE ON ik_d1_staging_index BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL,registered_revision=NULL WHERE id=OLD.stage_id; END;
CREATE TRIGGER ik_d1_staging_chunks_insert AFTER INSERT ON ik_d1_staging_chunks BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL WHERE id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_staging_chunks_update AFTER UPDATE ON ik_d1_staging_chunks BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL WHERE id=OLD.stage_id OR id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_staging_chunks_delete AFTER DELETE ON ik_d1_staging_chunks BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL WHERE id=OLD.stage_id; END;
CREATE TRIGGER ik_d1_staging_originals_insert AFTER INSERT ON ik_d1_staging_originals BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL WHERE id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_staging_originals_update AFTER UPDATE ON ik_d1_staging_originals BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL WHERE id=OLD.stage_id OR id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_staging_originals_delete AFTER DELETE ON ik_d1_staging_originals BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL WHERE id=OLD.stage_id; END;
CREATE TRIGGER ik_d1_staging_index_custody_insert AFTER INSERT ON ik_d1_staging_index WHEN EXISTS(SELECT 1 FROM ik_d1_staging_chunks WHERE stage_id=NEW.stage_id) OR EXISTS(SELECT 1 FROM ik_d1_staging_originals WHERE stage_id=NEW.stage_id) BEGIN DELETE FROM ik_d1_staging_chunks WHERE stage_id=NEW.stage_id; DELETE FROM ik_d1_staging_originals WHERE stage_id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_staging_index_custody_update AFTER UPDATE ON ik_d1_staging_index WHEN EXISTS(SELECT 1 FROM ik_d1_staging_chunks WHERE stage_id=OLD.stage_id OR stage_id=NEW.stage_id) OR EXISTS(SELECT 1 FROM ik_d1_staging_originals WHERE stage_id=OLD.stage_id OR stage_id=NEW.stage_id) BEGIN DELETE FROM ik_d1_staging_chunks WHERE stage_id=OLD.stage_id OR stage_id=NEW.stage_id; DELETE FROM ik_d1_staging_originals WHERE stage_id=OLD.stage_id OR stage_id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_staging_index_custody_delete AFTER DELETE ON ik_d1_staging_index WHEN EXISTS(SELECT 1 FROM ik_d1_staging_chunks WHERE stage_id=OLD.stage_id) OR EXISTS(SELECT 1 FROM ik_d1_staging_originals WHERE stage_id=OLD.stage_id) BEGIN DELETE FROM ik_d1_staging_chunks WHERE stage_id=OLD.stage_id; DELETE FROM ik_d1_staging_originals WHERE stage_id=OLD.stage_id; END;
CREATE TRIGGER ik_d1_staging_chunks_registered BEFORE INSERT ON ik_d1_staging_chunks WHEN NOT EXISTS(SELECT 1 FROM ik_d1_staging WHERE id=NEW.stage_id AND registered_revision IS NOT NULL) BEGIN SELECT RAISE(ABORT,'IMPORT_STAGE_INDEX_REQUIRED'); END;
CREATE TRIGGER ik_d1_staging_originals_registered BEFORE INSERT ON ik_d1_staging_originals WHEN NOT EXISTS(SELECT 1 FROM ik_d1_staging WHERE id=NEW.stage_id AND registered_revision IS NOT NULL) BEGIN SELECT RAISE(ABORT,'IMPORT_STAGE_INDEX_REQUIRED'); END;
CREATE TRIGGER ik_d1_custody_receipt_revision AFTER UPDATE OF revision ON ik_d1_custody_revisions BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_receipt_insert BEFORE INSERT ON ik_d1_custody_revisions WHEN NEW.seal IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.job_id AND stream_id=NEW.seal) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_RECEIPT_CHANGED'); END;
CREATE TRIGGER ik_d1_custody_receipt_seal BEFORE UPDATE OF seal ON ik_d1_custody_revisions WHEN NEW.seal IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ik_d1_publication_fences WHERE job_id=NEW.job_id AND stream_id=NEW.seal) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_RECEIPT_CHANGED'); END;
CREATE TRIGGER ik_d1_receipt_ik_jobs_insert AFTER INSERT ON ik_jobs BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.id; END;
CREATE TRIGGER ik_d1_receipt_ik_jobs_update AFTER UPDATE ON ik_jobs BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.id OR job_id=NEW.id; END;
CREATE TRIGGER ik_d1_receipt_ik_jobs_delete AFTER DELETE ON ik_jobs BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_plan_chunks_insert AFTER INSERT ON ik_d1_plan_chunks BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_plan_chunks_update AFTER UPDATE ON ik_d1_plan_chunks BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_plan_chunks_delete AFTER DELETE ON ik_d1_plan_chunks BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_plan_index_insert AFTER INSERT ON ik_d1_plan_index BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_plan_index_update AFTER UPDATE ON ik_d1_plan_index BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_plan_index_delete AFTER DELETE ON ik_d1_plan_index BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_originals_insert AFTER INSERT ON ik_originals BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_originals_update AFTER UPDATE ON ik_originals BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_originals_delete AFTER DELETE ON ik_originals BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_original_chunks_insert AFTER INSERT ON ik_d1_original_chunks BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_original_chunks_update AFTER UPDATE ON ik_d1_original_chunks BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_original_chunks_delete AFTER DELETE ON ik_d1_original_chunks BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_original_sets_insert AFTER INSERT ON ik_original_sets BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_original_sets_update AFTER UPDATE ON ik_original_sets BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_original_sets_delete AFTER DELETE ON ik_original_sets BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_indexed_jobs_insert AFTER INSERT ON ik_d1_indexed_jobs BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_indexed_jobs_update AFTER UPDATE ON ik_d1_indexed_jobs BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_indexed_jobs_delete AFTER DELETE ON ik_d1_indexed_jobs BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_reversal_reports_insert AFTER INSERT ON ik_d1_reversal_reports BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_reversal_reports_update AFTER UPDATE ON ik_d1_reversal_reports BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_reversal_reports_delete AFTER DELETE ON ik_d1_reversal_reports BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_provenance_insert AFTER INSERT ON ik_provenance BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_provenance_update AFTER UPDATE ON ik_provenance BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_provenance_delete AFTER DELETE ON ik_provenance BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_sources_insert AFTER INSERT ON ik_sources BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_sources_update AFTER UPDATE ON ik_sources BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_sources_delete AFTER DELETE ON ik_sources BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_entries_insert AFTER INSERT ON ik_d1_entries BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_entries_update AFTER UPDATE ON ik_d1_entries BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_entries_delete AFTER DELETE ON ik_d1_entries BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_history_insert AFTER INSERT ON ik_d1_history BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_history_update AFTER UPDATE ON ik_d1_history BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_d1_history_delete AFTER DELETE ON ik_d1_history BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_batches_insert AFTER INSERT ON ik_batches BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_batches_update AFTER UPDATE ON ik_batches BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_ik_batches_delete AFTER DELETE ON ik_batches BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_receipt_pages_insert AFTER INSERT ON ik_d1_stream_pages BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_pages_update AFTER UPDATE ON ik_d1_stream_pages BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_receipt_pages_delete AFTER DELETE ON ik_d1_stream_pages BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_receipt_stream_update BEFORE UPDATE ON ik_d1_streams BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id IN (SELECT job_id FROM ik_d1_stream_pages WHERE stream_id=OLD.id); END;
CREATE TRIGGER ik_d1_receipt_stream_delete BEFORE DELETE ON ik_d1_streams BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id IN (SELECT job_id FROM ik_d1_stream_pages WHERE stream_id=OLD.id); END;
CREATE TRIGGER ik_d1_custody_job_insert AFTER INSERT ON ik_jobs BEGIN INSERT INTO ik_d1_custody_revisions(job_id) VALUES(NEW.id); END;
CREATE TRIGGER ik_d1_custody_job_update AFTER UPDATE OF plan_json ON ik_jobs BEGIN UPDATE ik_d1_custody_revisions SET revision=revision+1 WHERE job_id=OLD.id OR job_id=NEW.id; END;
CREATE TRIGGER ik_d1_custody_chunks_insert AFTER INSERT ON ik_d1_plan_chunks BEGIN UPDATE ik_d1_custody_revisions SET revision=revision+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_chunks_update AFTER UPDATE ON ik_d1_plan_chunks BEGIN UPDATE ik_d1_custody_revisions SET revision=revision+1 WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_chunks_delete AFTER DELETE ON ik_d1_plan_chunks BEGIN UPDATE ik_d1_custody_revisions SET revision=revision+1 WHERE job_id=OLD.job_id; END;
CREATE INDEX ik_d1_native_staging_source ON ik_d1_native_staging_index(source_identity,stage_id);
CREATE INDEX ik_d1_native_staging_target ON ik_d1_native_staging_index(target_identity,stage_id);
CREATE TRIGGER ik_d1_native_staging_binding BEFORE UPDATE OF id,generation,destination,namespace,mapping_version,principal_id,job_id,fingerprint,job_fence,action,values_count,chunks_count,identities ON ik_d1_native_staging BEGIN SELECT RAISE(ABORT,'IMPORT_NATIVE_STAGE_BINDING_CHANGED'); END;
CREATE TRIGGER ik_d1_native_staging_index_insert AFTER INSERT ON ik_d1_native_staging_index BEGIN UPDATE ik_d1_native_staging SET revision=revision+1,sealed_revision=NULL,registered_revision=NULL WHERE id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_native_staging_index_update AFTER UPDATE ON ik_d1_native_staging_index BEGIN UPDATE ik_d1_native_staging SET revision=revision+1,sealed_revision=NULL,registered_revision=NULL WHERE id=OLD.stage_id OR id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_native_staging_index_delete AFTER DELETE ON ik_d1_native_staging_index BEGIN UPDATE ik_d1_native_staging SET revision=revision+1,sealed_revision=NULL,registered_revision=NULL WHERE id=OLD.stage_id; END;
CREATE TRIGGER ik_d1_native_staging_values_insert AFTER INSERT ON ik_d1_native_staging_values BEGIN UPDATE ik_d1_native_staging SET revision=revision+1,sealed_revision=NULL WHERE id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_native_staging_values_update AFTER UPDATE ON ik_d1_native_staging_values BEGIN UPDATE ik_d1_native_staging SET revision=revision+1,sealed_revision=NULL WHERE id=OLD.stage_id OR id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_native_staging_values_delete AFTER DELETE ON ik_d1_native_staging_values BEGIN UPDATE ik_d1_native_staging SET revision=revision+1,sealed_revision=NULL WHERE id=OLD.stage_id; END;
CREATE TRIGGER ik_d1_native_staging_index_custody_insert AFTER INSERT ON ik_d1_native_staging_index BEGIN DELETE FROM ik_d1_native_staging_values WHERE stage_id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_native_staging_index_custody_update AFTER UPDATE ON ik_d1_native_staging_index BEGIN DELETE FROM ik_d1_native_staging_values WHERE stage_id=OLD.stage_id OR stage_id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_native_staging_index_custody_delete AFTER DELETE ON ik_d1_native_staging_index BEGIN DELETE FROM ik_d1_native_staging_values WHERE stage_id=OLD.stage_id; END;
CREATE TRIGGER ik_d1_native_staging_values_registered BEFORE INSERT ON ik_d1_native_staging_values WHEN NOT EXISTS(SELECT 1 FROM ik_d1_native_staging WHERE id=NEW.stage_id AND registered_revision IS NOT NULL) BEGIN SELECT RAISE(ABORT,'IMPORT_NATIVE_STAGE_INDEX_REQUIRED'); END;
CREATE TRIGGER ik_d1_custody_state_monotonic BEFORE UPDATE ON ik_d1_custody_states WHEN NEW.job_id IS NOT OLD.job_id OR NEW.revision<=OLD.revision BEGIN SELECT RAISE(ABORT,'IMPORT_CUSTODY_STATE_CHANGED'); END;
CREATE TRIGGER ik_d1_custody_state_delete BEFORE DELETE ON ik_d1_custody_states WHEN EXISTS(SELECT 1 FROM ik_jobs WHERE id=OLD.job_id) BEGIN SELECT RAISE(ABORT,'IMPORT_CUSTODY_STATE_CHANGED'); END;
CREATE TRIGGER ik_d1_custody_state_publication BEFORE UPDATE ON ik_d1_custody_states WHEN EXISTS(SELECT 1 FROM ik_d1_publication_fences f JOIN ik_d1_custody_revisions r ON r.job_id=f.job_id WHERE (f.job_id=OLD.job_id OR f.job_id=NEW.job_id) AND r.seal IS NOT NULL) BEGIN SELECT RAISE(ABORT,'IMPORT_PUBLICATION_CHANGED'); END;
CREATE TRIGGER ik_d1_custody_state_receipt AFTER UPDATE ON ik_d1_custody_states BEGIN UPDATE ik_d1_custody_revisions SET seal=NULL WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_create AFTER INSERT ON ik_jobs BEGIN INSERT INTO ik_d1_custody_states(job_id) VALUES(NEW.id); END;
CREATE TRIGGER ik_d1_custody_state_ik_jobs_insert AFTER INSERT ON ik_jobs BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=NEW.id; END;
CREATE TRIGGER ik_d1_custody_state_ik_jobs_update AFTER UPDATE ON ik_jobs BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.id OR job_id=NEW.id; END;
CREATE TRIGGER ik_d1_custody_state_ik_jobs_delete AFTER DELETE ON ik_jobs BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_plan_chunks_insert AFTER INSERT ON ik_d1_plan_chunks BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_plan_chunks_update AFTER UPDATE ON ik_d1_plan_chunks BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_plan_chunks_delete AFTER DELETE ON ik_d1_plan_chunks BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_creation_plans_insert AFTER INSERT ON ik_d1_creation_plans BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_creation_plans_update AFTER UPDATE ON ik_d1_creation_plans BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_creation_plans_delete AFTER DELETE ON ik_d1_creation_plans BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_plan_index_insert AFTER INSERT ON ik_d1_plan_index BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_plan_index_update AFTER UPDATE ON ik_d1_plan_index BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_plan_index_delete AFTER DELETE ON ik_d1_plan_index BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_originals_insert AFTER INSERT ON ik_originals BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_originals_update AFTER UPDATE ON ik_originals BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_originals_delete AFTER DELETE ON ik_originals BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_original_chunks_insert AFTER INSERT ON ik_d1_original_chunks BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_original_chunks_update AFTER UPDATE ON ik_d1_original_chunks BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_original_chunks_delete AFTER DELETE ON ik_d1_original_chunks BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_original_sets_insert AFTER INSERT ON ik_original_sets BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_original_sets_update AFTER UPDATE ON ik_original_sets BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_original_sets_delete AFTER DELETE ON ik_original_sets BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_indexed_jobs_insert AFTER INSERT ON ik_d1_indexed_jobs BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_indexed_jobs_update AFTER UPDATE ON ik_d1_indexed_jobs BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_indexed_jobs_delete AFTER DELETE ON ik_d1_indexed_jobs BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_reversal_reports_insert AFTER INSERT ON ik_d1_reversal_reports BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_reversal_reports_update AFTER UPDATE ON ik_d1_reversal_reports BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_reversal_reports_delete AFTER DELETE ON ik_d1_reversal_reports BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_provenance_insert AFTER INSERT ON ik_provenance BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_provenance_update AFTER UPDATE ON ik_provenance BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_provenance_delete AFTER DELETE ON ik_provenance BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_sources_insert AFTER INSERT ON ik_sources BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_sources_update AFTER UPDATE ON ik_sources BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_sources_delete AFTER DELETE ON ik_sources BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_entries_insert AFTER INSERT ON ik_d1_entries BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_entries_update AFTER UPDATE ON ik_d1_entries BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_entries_delete AFTER DELETE ON ik_d1_entries BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_history_insert AFTER INSERT ON ik_d1_history BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_history_update AFTER UPDATE ON ik_d1_history BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_history_delete AFTER DELETE ON ik_d1_history BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_batches_insert AFTER INSERT ON ik_batches BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_batches_update AFTER UPDATE ON ik_batches BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_batches_delete AFTER DELETE ON ik_batches BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_stream_pages_insert AFTER INSERT ON ik_d1_stream_pages BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_stream_pages_update AFTER UPDATE ON ik_d1_stream_pages BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id OR job_id=NEW.job_id; END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_stream_pages_delete AFTER DELETE ON ik_d1_stream_pages BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id=OLD.job_id; END;
CREATE TRIGGER ik_d1_custody_state_stream_update BEFORE UPDATE ON ik_d1_streams BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_stream_pages WHERE stream_id=OLD.id); END;
CREATE TRIGGER ik_d1_custody_state_stream_delete BEFORE DELETE ON ik_d1_streams BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_stream_pages WHERE stream_id=OLD.id); END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_erased_sources_insert AFTER INSERT ON ik_d1_erased_sources BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT i.job_id FROM ik_d1_plan_index i JOIN ik_jobs j ON j.id=i.job_id WHERE i.source_identity=NEW.identity AND j.destination=NEW.destination); END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_erased_sources_update AFTER UPDATE ON ik_d1_erased_sources BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT i.job_id FROM ik_d1_plan_index i JOIN ik_jobs j ON j.id=i.job_id WHERE (i.source_identity=OLD.identity AND j.destination=OLD.destination) OR (i.source_identity=NEW.identity AND j.destination=NEW.destination)); END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_erased_sources_delete AFTER DELETE ON ik_d1_erased_sources BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT i.job_id FROM ik_d1_plan_index i JOIN ik_jobs j ON j.id=i.job_id WHERE i.source_identity=OLD.identity AND j.destination=OLD.destination); END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_erased_targets_insert AFTER INSERT ON ik_d1_erased_targets BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT i.job_id FROM ik_d1_plan_index i JOIN ik_jobs j ON j.id=i.job_id WHERE i.target_identity=NEW.identity AND j.destination=NEW.destination); END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_erased_targets_update AFTER UPDATE ON ik_d1_erased_targets BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT i.job_id FROM ik_d1_plan_index i JOIN ik_jobs j ON j.id=i.job_id WHERE (i.target_identity=OLD.identity AND j.destination=OLD.destination) OR (i.target_identity=NEW.identity AND j.destination=NEW.destination)); END;
CREATE TRIGGER ik_d1_custody_state_ik_d1_erased_targets_delete AFTER DELETE ON ik_d1_erased_targets BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT i.job_id FROM ik_d1_plan_index i JOIN ik_jobs j ON j.id=i.job_id WHERE i.target_identity=OLD.identity AND j.destination=OLD.destination); END;
CREATE TRIGGER ik_d1_preparation_receipts_insert AFTER INSERT ON ik_d1_preparation_receipts BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL WHERE id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_staging_headers_insert AFTER INSERT ON ik_d1_staging_headers BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL WHERE id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_preparation_receipts_update AFTER UPDATE ON ik_d1_preparation_receipts BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL WHERE id=OLD.stage_id OR id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_staging_headers_update AFTER UPDATE ON ik_d1_staging_headers BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL WHERE id=OLD.stage_id OR id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_preparation_receipts_delete AFTER DELETE ON ik_d1_preparation_receipts BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL WHERE id=OLD.stage_id; END;
CREATE TRIGGER ik_d1_staging_headers_delete AFTER DELETE ON ik_d1_staging_headers BEGIN UPDATE ik_d1_staging SET revision=revision+1,sealed_revision=NULL WHERE id=OLD.stage_id; END;
CREATE TRIGGER ik_d1_preparation_receipt_immutable BEFORE UPDATE ON ik_d1_preparation_receipts BEGIN SELECT RAISE(ABORT,'IMPORT_PREPARATION_CHANGED'); END;
CREATE TRIGGER ik_d1_staging_headers_registered BEFORE INSERT ON ik_d1_staging_headers WHEN NOT EXISTS(SELECT 1 FROM ik_d1_staging WHERE id=NEW.stage_id AND registered_revision IS NOT NULL) BEGIN SELECT RAISE(ABORT,'IMPORT_STAGE_INDEX_REQUIRED'); END;
CREATE TRIGGER ik_d1_preparation_privacy_insert AFTER INSERT ON ik_d1_staging_index BEGIN DELETE FROM ik_d1_staging_headers WHERE stage_id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_preparation_privacy_update AFTER UPDATE ON ik_d1_staging_index BEGIN DELETE FROM ik_d1_staging_headers WHERE stage_id=OLD.stage_id OR stage_id=NEW.stage_id; END;
CREATE TRIGGER ik_d1_preparation_privacy_delete AFTER DELETE ON ik_d1_staging_index BEGIN DELETE FROM ik_d1_staging_headers WHERE stage_id=OLD.stage_id; END;
CREATE INDEX integration_deliveries_due ON integration_deliveries(namespace,state,next_at);
COMMIT;
