-- Dismiss one occurrence only; a later commitment or failure remains visible.
CREATE TABLE follow_up_dismissals (
  follow_up_id TEXT NOT NULL,
  occurrence TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  PRIMARY KEY(follow_up_id, occurrence)
);
