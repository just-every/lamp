-- Page defaults apply only when scheduling a new window. Existing sidecars,
-- and pre-change windows without sidecars, retain their original choices.
CREATE TABLE maintenance_automation_defaults (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  auto_start INTEGER NOT NULL DEFAULT 1 CHECK(auto_start IN (0,1)),
  auto_complete INTEGER NOT NULL DEFAULT 1 CHECK(auto_complete IN (0,1))
);
