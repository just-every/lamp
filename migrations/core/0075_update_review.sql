-- Existing publications have no retained review evidence. Preserve that absence.
ALTER TABLE incident_updates ADD COLUMN reviewed_by_operator_id TEXT REFERENCES operators(id);
ALTER TABLE incident_updates ADD COLUMN reviewed_at TEXT;
