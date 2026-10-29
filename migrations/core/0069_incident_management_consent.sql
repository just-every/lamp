-- Existing credentials retain their scopes. Subscriber writes require explicit consent.
ALTER TABLE management_tokens ADD COLUMN subscriber_write_scope INTEGER NOT NULL DEFAULT 0 CHECK(subscriber_write_scope IN (0,1));
ALTER TABLE statuspage_import_invites ADD COLUMN confirmation_address_hash TEXT;
