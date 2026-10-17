-- Retain source template wording that needs shortening before native apply.
ALTER TABLE incident_templates ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE incident_templates ADD COLUMN folder TEXT NOT NULL DEFAULT '';
ALTER TABLE incident_templates ADD COLUMN should_send_notifications INTEGER CHECK (should_send_notifications IS NULL OR should_send_notifications IN (0,1));
ALTER TABLE incident_templates ADD COLUMN imported_fields_json TEXT CHECK (imported_fields_json IS NULL OR (json_valid(imported_fields_json) AND json_type(imported_fields_json) = 'object'));
CREATE TABLE statuspage_import_template_targets (
  id TEXT PRIMARY KEY NOT NULL,
  revision TEXT NOT NULL
);
