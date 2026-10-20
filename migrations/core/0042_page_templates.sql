-- Existing pages keep their approved default appearance until an owner chooses a template.
ALTER TABLE page_settings ADD COLUMN template TEXT NOT NULL DEFAULT 'default'
  CHECK (template IN ('default', 'calm', 'uptime', 'regions'));
ALTER TABLE components ADD COLUMN region TEXT;
