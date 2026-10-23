-- Native subscriber intake retains identifiers and attribution, never a copy
-- of the uploaded CSV or its addresses. Pending deletion removes this row too.
-- This native author column already participates in page-data author mapping.
ALTER TABLE subscribers ADD COLUMN created_by_operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL;
CREATE TABLE subscriber_intake (
  subscriber_id TEXT PRIMARY KEY REFERENCES subscribers(id) ON DELETE CASCADE,
  batch_id TEXT,
  source TEXT NOT NULL CHECK(source IN ('csv','operator')),
  operator_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  invitation_claimed_at TEXT,
  confirmed_at TEXT
);
CREATE INDEX subscriber_intake_batch ON subscriber_intake(batch_id,subscriber_id);
