-- AUTO-001: owner-approved component/source rules and their durable executions.
ALTER TABLE incident_templates ADD COLUMN channels_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE incident_templates ADD COLUMN resolved_update_json TEXT;
ALTER TABLE incident_updates ADD COLUMN automation_attribution TEXT;
ALTER TABLE incident_updates ADD COLUMN automation_receipt_id TEXT;
CREATE TABLE alert_rules (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES alert_sources(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('draft','claim','claim-and-publish')),
  state TEXT NOT NULL CHECK(state IN ('Operational','Degraded performance','Partially unavailable','Major outage','Under maintenance')),
  template_id TEXT REFERENCES incident_templates(id) ON DELETE SET NULL,
  approved_by_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  degradation_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id,component_id)
);
CREATE TABLE alert_rule_runs (
  id TEXT PRIMARY KEY NOT NULL,
  rule_id TEXT REFERENCES alert_rules(id) ON DELETE SET NULL,
  source_incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  incident_id TEXT NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('claim','claim-and-publish')),
  firing_update_id TEXT REFERENCES incident_updates(id) ON DELETE SET NULL,
  recovery_update_id TEXT REFERENCES incident_updates(id) ON DELETE SET NULL,
  released_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX alert_rule_active_run ON alert_rule_runs(rule_id,source_incident_id) WHERE released_at IS NULL;
CREATE TABLE alert_rule_evidence (
  rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  source_incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  firing INTEGER NOT NULL CHECK(firing IN (0,1)),
  receipt_id TEXT NOT NULL REFERENCES alert_receipts(id) ON DELETE CASCADE,
  received_at TEXT NOT NULL,
  PRIMARY KEY(rule_id,source_incident_id,fingerprint)
);
-- Source/component erasure cascades rules. Their independent claims must end too.
CREATE TRIGGER alert_rules_release_before_delete BEFORE DELETE ON alert_rules BEGIN
  INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at)
    VALUES(lower(hex(randomblob(16))),'alert-rule',OLD.id,'deleted',OLD.approved_by_operator_id,'{}',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  INSERT INTO component_claim_events(id,component_id,cause_type,cause_id,state,changed_at,created_at,updated_at)
    SELECT lower(hex(randomblob(16))),OLD.component_id,'incident',incident_id,NULL,
      strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM alert_rule_runs WHERE rule_id=OLD.id AND released_at IS NULL;
  UPDATE incident_components SET state='Operational',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE incident_id IN (SELECT incident_id FROM alert_rule_runs WHERE rule_id=OLD.id AND released_at IS NULL);
  UPDATE incidents SET lifecycle=CASE WHEN EXISTS(SELECT 1 FROM incident_updates WHERE incident_id=incidents.id) THEN lifecycle ELSE 'Resolved' END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id IN (SELECT incident_id FROM alert_rule_runs WHERE rule_id=OLD.id AND released_at IS NULL);
  UPDATE alert_rule_runs SET released_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE rule_id=OLD.id AND released_at IS NULL;
END;
