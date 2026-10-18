CREATE INDEX audit_entries_actor_time_idx ON audit_entries(operator_id, created_at DESC, id DESC);
CREATE INDEX audit_entries_action_time_idx ON audit_entries(action, created_at DESC, id DESC);
CREATE INDEX audit_entries_time_idx ON audit_entries(created_at DESC, id DESC);

-- State history is already an immutable source of attribution. Mirror its facts
-- inside the same write transaction, including states published with an update.
INSERT OR IGNORE INTO audit_entries(id, entity_type, entity_id, action, operator_id, payload_json, created_at, updated_at)
SELECT 'state-history/' || id, 'component', component_id, 'state-changed', operator_id,
  json_object('previousState', previous_state, 'newState', new_state, 'causeType', cause_type, 'causeId', cause_id), created_at, updated_at
FROM component_state_history;
CREATE TRIGGER component_state_audit AFTER INSERT ON component_state_history BEGIN
  INSERT INTO audit_entries(id, entity_type, entity_id, action, operator_id, payload_json, created_at, updated_at)
  VALUES ('state-history/' || NEW.id, 'component', NEW.component_id, 'state-changed', NEW.operator_id,
    json_object('previousState', NEW.previous_state, 'newState', NEW.new_state, 'causeType', NEW.cause_type, 'causeId', NEW.cause_id), NEW.created_at, NEW.updated_at);
END;
