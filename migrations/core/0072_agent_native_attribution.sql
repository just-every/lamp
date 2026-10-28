-- Native agent preparer, sponsor, approvers and final queued admission custody.
CREATE TABLE lamp_agent_attribution (
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operator_id TEXT NOT NULL,
  agent_id TEXT NOT NULL, agent_name TEXT NOT NULL, approvers_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id, created_at)
);
CREATE INDEX lamp_agent_attribution_entity ON lamp_agent_attribution(entity_type, entity_id, created_at DESC);
CREATE TABLE lamp_agent_queued_operations (
  kind TEXT NOT NULL, id TEXT NOT NULL, tool TEXT NOT NULL, args_json TEXT NOT NULL,
  principal_json TEXT NOT NULL, created_at TEXT NOT NULL, last_outcome_json TEXT,
  PRIMARY KEY(kind,id)
);
