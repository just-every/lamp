-- Additive routing metadata: no subscriber addresses or message bodies.
-- A selected secondary never changes back for an already attempted message.
CREATE TABLE mail_provider_routes (
  message_key TEXT PRIMARY KEY,
  notification_delivery_id TEXT,
  envelope_hash TEXT NOT NULL,
  configuration_hash TEXT NOT NULL,
  primary_provider TEXT NOT NULL,
  secondary_provider TEXT NOT NULL,
  selected_provider TEXT NOT NULL,
  first_retryable_failure_at TEXT,
  ambiguous_failure INTEGER NOT NULL DEFAULT 0 CHECK (ambiguous_failure IN (0,1)),
  state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready','sending','accepted')),
  claimed_at TEXT,
  provider_message_id TEXT,
  accepting_provider TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX mail_provider_routes_delivery_idx ON mail_provider_routes(notification_delivery_id);

-- Secondary delivery stays off until an owner selects the configured provider.
CREATE TABLE mail_provider_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  secondary_provider TEXT,
  updated_at TEXT NOT NULL
);
