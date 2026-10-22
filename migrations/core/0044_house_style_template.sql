-- A page can save House style (owner L18) as its template; every existing page keeps the template it saved.
-- SQLite cannot change a CHECK in place, so page_settings is rebuilt with its index and snapshot triggers.
CREATE TABLE page_settings_next (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'default'),
  page_name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  accent_color TEXT NOT NULL,
  timezone TEXT NOT NULL,
  hostname TEXT NOT NULL,
  footer_credit_enabled INTEGER NOT NULL DEFAULT 1 CHECK (footer_credit_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  logo_key TEXT,
  logo_content_type TEXT,
  widget_allowed_origins TEXT NOT NULL DEFAULT '[]',
  mail_from_address TEXT NOT NULL DEFAULT '',
  ai_tone_instructions TEXT NOT NULL DEFAULT '',
  feed_id TEXT NOT NULL DEFAULT 'pending-feed-identity',
  wording_blocked_terms TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(wording_blocked_terms) AND json_type(wording_blocked_terms) = 'array'),
  wording_friendly_length INTEGER NOT NULL DEFAULT 160 CHECK(wording_friendly_length BETWEEN 1 AND 500),
  email_branding TEXT NOT NULL DEFAULT '{}',
  template TEXT NOT NULL DEFAULT 'default'
    CHECK (template IN ('default', 'calm', 'uptime', 'regions', 'house'))
);
INSERT INTO page_settings_next (id, page_name, tagline, accent_color, timezone, hostname, footer_credit_enabled, created_at, updated_at, logo_key, logo_content_type, widget_allowed_origins, mail_from_address, ai_tone_instructions, feed_id, wording_blocked_terms, wording_friendly_length, email_branding, template)
  SELECT id, page_name, tagline, accent_color, timezone, hostname, footer_credit_enabled, created_at, updated_at, logo_key, logo_content_type, widget_allowed_origins, mail_from_address, ai_tone_instructions, feed_id, wording_blocked_terms, wording_friendly_length, email_branding, template FROM page_settings;
DROP TABLE page_settings;
ALTER TABLE page_settings_next RENAME TO page_settings;
CREATE UNIQUE INDEX page_settings_feed_id_unique ON page_settings(feed_id);
CREATE TRIGGER page_settings_snapshot_dirty_insert AFTER INSERT ON page_settings BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
CREATE TRIGGER page_settings_snapshot_dirty_update AFTER UPDATE ON page_settings BEGIN UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default'; END;
