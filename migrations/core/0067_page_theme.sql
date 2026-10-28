ALTER TABLE page_settings ADD COLUMN theme TEXT NOT NULL DEFAULT 'null';
ALTER TABLE page_settings ADD COLUMN theme_assets TEXT NOT NULL DEFAULT '[]';
