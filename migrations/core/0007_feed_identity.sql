-- Atom IDs identify this deployment, not its editable public hostname.
-- Existing rows receive a durable random identity before the uniqueness rule.
ALTER TABLE page_settings ADD COLUMN feed_id TEXT NOT NULL DEFAULT 'pending-feed-identity';
UPDATE page_settings
SET feed_id = lower(hex(randomblob(16)))
WHERE feed_id = 'pending-feed-identity';
CREATE UNIQUE INDEX page_settings_feed_id_unique ON page_settings(feed_id);
