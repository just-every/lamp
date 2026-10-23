-- A deleted component's incident and maintenance attachments keep its name for
-- published history (COMP-007). The deletion itself records whether that
-- component was internal, so its attachments stay as private as it was
-- (COMP-005). Attachments detached before this migration keep their visibility.
ALTER TABLE incident_components ADD COLUMN detached_internal INTEGER NOT NULL DEFAULT 0 CHECK (detached_internal IN (0, 1));
ALTER TABLE maintenance_components ADD COLUMN detached_internal INTEGER NOT NULL DEFAULT 0 CHECK (detached_internal IN (0, 1));
CREATE TRIGGER incident_components_detach_internal BEFORE DELETE ON components WHEN OLD.internal = 1
BEGIN
  UPDATE incident_components SET detached_internal = 1 WHERE component_id = OLD.id;
END;
CREATE TRIGGER maintenance_components_detach_internal BEFORE DELETE ON components WHEN OLD.internal = 1
BEGIN
  UPDATE maintenance_components SET detached_internal = 1 WHERE component_id = OLD.id;
END;
