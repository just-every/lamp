-- Additive; PagerDuty's issued columns and all prior source/receipt rows stay intact.
ALTER TABLE alert_sources ADD COLUMN operations_preset TEXT CHECK (operations_preset IN ('jsm','opsgenie'));
ALTER TABLE alert_sources ADD COLUMN close_alert_on_resolve INTEGER NOT NULL DEFAULT 0;
ALTER TABLE alert_responder_posts ADD COLUMN close_state TEXT NOT NULL DEFAULT 'none' CHECK (close_state IN ('none','queued','sending','sent','failed'));
ALTER TABLE alert_responder_posts ADD COLUMN close_error TEXT;
