-- Lamp refines Base's member authority without changing Base's account schema.
-- Existing Owners and Admins retain their authority; an unclassified member is
-- a Viewer. Product-role changes invalidate sessions and unused sign-in links.
CREATE TABLE operator_roles (
  operator_id TEXT PRIMARY KEY REFERENCES oa_operators(id),
  role TEXT NOT NULL CHECK(role IN ('communicator','responder','viewer'))
);
CREATE TRIGGER lamp_operator_role_insert AFTER INSERT ON operator_roles
BEGIN UPDATE oa_operators SET version=version+1 WHERE id=NEW.operator_id; END;
CREATE TRIGGER lamp_operator_role_update AFTER UPDATE OF role ON operator_roles
WHEN OLD.role<>NEW.role
BEGIN UPDATE oa_operators SET version=version+1 WHERE id=NEW.operator_id; END;
CREATE TRIGGER lamp_operator_role_delete AFTER DELETE ON operator_roles
BEGIN UPDATE oa_operators SET version=version+1 WHERE id=OLD.operator_id; END;
