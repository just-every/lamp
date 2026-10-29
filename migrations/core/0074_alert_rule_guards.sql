-- Each rule owns its firing delay and recovery hold. Immediate rules remain
-- available explicitly; new rules use the conservative flap guard defaults.
ALTER TABLE alert_rules ADD COLUMN firing_delay_seconds INTEGER NOT NULL DEFAULT 120 CHECK(firing_delay_seconds BETWEEN 0 AND 86400);
ALTER TABLE alert_rules ADD COLUMN recovery_hold_seconds INTEGER NOT NULL DEFAULT 300 CHECK(recovery_hold_seconds BETWEEN 0 AND 86400);
ALTER TABLE alert_rule_runs ADD COLUMN undone_at TEXT;
ALTER TABLE alert_rule_runs ADD COLUMN undone_by_operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL;
CREATE TABLE alert_rule_windows (
  rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  source_incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  receipt_id TEXT NOT NULL REFERENCES alert_receipts(id) ON DELETE CASCADE,
  firing INTEGER NOT NULL CHECK(firing IN (0,1)),
  changed_at TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  PRIMARY KEY(rule_id,source_incident_id)
);
CREATE INDEX alert_rule_windows_due ON alert_rule_windows(completed,due_at);
