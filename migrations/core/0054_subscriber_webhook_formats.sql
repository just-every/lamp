-- A native product column travels through both technical archives and the
-- existing page-data JSON export without carrying a second preference store.
ALTER TABLE subscribers ADD COLUMN webhook_format TEXT NOT NULL DEFAULT 'lamp'
  CHECK(webhook_format IN ('lamp','statuspage'));
