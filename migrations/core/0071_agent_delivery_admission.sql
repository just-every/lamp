ALTER TABLE maintenance_notices ADD COLUMN agent_action_json TEXT;
ALTER TABLE notification_outbox ADD COLUMN agent_action_json TEXT;
ALTER TABLE social_posts ADD COLUMN agent_action_json TEXT;
CREATE TABLE lamp_agent_maintenance (maintenance_id TEXT PRIMARY KEY);
