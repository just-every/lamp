-- An absent sidecar row preserves automatic start and completion for every
-- pre-existing maintenance, without changing import-owned native record shapes.
CREATE TABLE maintenance_automation (
  maintenance_id TEXT PRIMARY KEY REFERENCES maintenance(id) ON DELETE CASCADE,
  auto_start INTEGER NOT NULL DEFAULT 1 CHECK(auto_start IN (0,1)),
  auto_complete INTEGER NOT NULL DEFAULT 1 CHECK(auto_complete IN (0,1))
);
