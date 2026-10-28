-- Lamp refines Base's member authority without changing Base's account schema.
-- Existing Owners and Admins retain their authority; an unclassified member is
-- a Viewer. The role repository invalidates sessions in its audited transaction.
CREATE TABLE operator_roles (
  operator_id TEXT PRIMARY KEY REFERENCES oa_operators(id),
  role TEXT NOT NULL CHECK(role IN ('communicator','responder','viewer'))
);
