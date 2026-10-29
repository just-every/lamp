-- Existing public-data readers gain no access to private subscriber destinations.
ALTER TABLE management_tokens ADD COLUMN subscriber_read_scope INTEGER NOT NULL DEFAULT 0 CHECK(subscriber_read_scope IN (0,1));
