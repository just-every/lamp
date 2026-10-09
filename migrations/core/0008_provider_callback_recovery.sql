-- Provider callbacks can arrive before the send response records its provider
-- message ID. The event ledger holds those callbacks until a delivery attempt
-- can claim and apply them exactly once.
ALTER TABLE mail_provider_webhook_events ADD COLUMN hard_bounce INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mail_provider_webhook_events ADD COLUMN claimed_at TEXT;
ALTER TABLE mail_provider_webhook_events ADD COLUMN applied_at TEXT;
ALTER TABLE mail_provider_webhook_events ADD COLUMN delivery_id TEXT REFERENCES notification_deliveries(id) ON DELETE SET NULL;
CREATE INDEX mail_provider_webhook_events_pending_idx
  ON mail_provider_webhook_events(provider_message_id, applied_at, claimed_at);
