-- Delivery, subscriber-token, and operator-magic-link contracts for 1.0.
-- Existing recipient records remain the immutable per-update recipient set.

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
CREATE INDEX operator_magic_links_active_idx
  ON operator_magic_links(token_hash, expires_at, consumed_at, revoked_at);

-- Attribution remains queryable after an operator is removed. The allow-list
-- and every live session exclude deactivated operators.
ALTER TABLE operators ADD COLUMN deactivated_at TEXT;

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
CREATE UNIQUE INDEX subscriber_tokens_one_active_scope
  ON subscriber_tokens(subscriber_id, scope)
  WHERE revoked_at IS NULL;
CREATE INDEX subscriber_tokens_lookup_idx
  ON subscriber_tokens(token_hash, scope, expires_at, revoked_at);

-- This retains only an HMAC of an address and one timestamp. It is enough to
-- bound confirmation mail without retaining an unverified address after expiry.
CREATE TABLE subscriber_confirmation_attempts (
  email_hash TEXT PRIMARY KEY NOT NULL,
  last_sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notification_channel_selections (
  incident_update_id TEXT NOT NULL REFERENCES incident_updates(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (incident_update_id, channel)
);

ALTER TABLE notification_deliveries ADD COLUMN notification_event_id TEXT;
ALTER TABLE notification_deliveries ADD COLUMN notification_event_type TEXT;
ALTER TABLE notification_deliveries ADD COLUMN incident_report_id TEXT REFERENCES incident_reports(id) ON DELETE RESTRICT;
-- The complete email envelope is frozen on its first provider attempt. This
-- keeps Resend idempotency retries byte-for-byte identical when settings or
-- subscriber links later change.
ALTER TABLE notification_deliveries ADD COLUMN mail_payload_json TEXT;
-- A short durable claim prevents concurrent cron/Queue consumers from posting
-- the same webhook. Provider-accepted email attempts are separately detected
-- before a later consumer can resend them.
ALTER TABLE notification_deliveries ADD COLUMN dispatch_locked_at TEXT;
CREATE INDEX notification_deliveries_dispatch_claim_idx ON notification_deliveries(outcome, dispatch_locked_at);

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
CREATE INDEX notification_outbox_ready_idx
  ON notification_outbox(completed_at, failed_at, available_at);
-- Capturing a recipient set can be retried with the publisher's D1 batch.
-- There is one durable dispatcher command for each immutable event.
CREATE UNIQUE INDEX notification_outbox_one_delivery_event
  ON notification_outbox(kind, aggregate_id)
  WHERE kind = 'delivery-dispatch';
CREATE UNIQUE INDEX notification_outbox_one_operator_alert
  ON notification_outbox(kind, aggregate_id)
  WHERE kind = 'operator-alert';

CREATE TABLE notification_delivery_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES notification_deliveries(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  attempted_at TEXT NOT NULL,
  provider_message_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(delivery_id, attempt_number)
);
CREATE INDEX notification_delivery_attempts_delivery_idx
  ON notification_delivery_attempts(delivery_id, attempted_at DESC);

CREATE TABLE mail_provider_webhook_events (
  id TEXT PRIMARY KEY NOT NULL,
  provider_event_id TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX notification_deliveries_one_event_channel
  ON notification_deliveries(subscriber_id, notification_event_id, channel)
  WHERE notification_event_id IS NOT NULL;

-- Fixed one-minute public-write windows. They are keyed by the authority the
-- contract names (network address, token, or intake source), never process
-- memory, so a second Worker instance cannot bypass a limit.
CREATE TABLE request_rate_windows (
  rate_key TEXT PRIMARY KEY NOT NULL,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX request_rate_windows_expiry_idx ON request_rate_windows(expires_at);
