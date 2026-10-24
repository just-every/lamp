-- Additive: preserve all older backup tables, receipts and sealed connections.
ALTER TABLE alert_sources ADD COLUMN vendor_preset TEXT CHECK (vendor_preset IN ('jsm','opsgenie','newrelic'));
ALTER TABLE alert_sources ADD COLUMN close_alert_on_resolve INTEGER NOT NULL DEFAULT 0 CHECK (close_alert_on_resolve IN (0,1));
