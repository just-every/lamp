ALTER TABLE page_settings ADD COLUMN wording_blocked_terms TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(wording_blocked_terms) AND json_type(wording_blocked_terms) = 'array');
ALTER TABLE page_settings ADD COLUMN wording_friendly_length INTEGER NOT NULL DEFAULT 160 CHECK(wording_friendly_length BETWEEN 1 AND 500);
