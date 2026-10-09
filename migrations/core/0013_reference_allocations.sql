-- Start short sequences independently of legacy timestamp-sized references.
-- Retain all historical references, even after a product record is deleted.
CREATE TABLE reference_counters (
  namespace TEXT PRIMARY KEY NOT NULL CHECK (namespace IN ('INC', 'SCH')),
  last_number INTEGER NOT NULL DEFAULT 0
    CHECK (last_number >= 0 AND last_number <= 9007199254740991)
);
INSERT INTO reference_counters (namespace) VALUES ('INC'), ('SCH');

CREATE TABLE reference_allocations (
  namespace TEXT NOT NULL REFERENCES reference_counters(namespace) ON DELETE RESTRICT,
  reference TEXT NOT NULL,
  PRIMARY KEY (namespace, reference)
);
INSERT INTO reference_allocations (namespace, reference) SELECT 'INC', reference FROM incidents;
INSERT INTO reference_allocations (namespace, reference) SELECT 'SCH', reference FROM maintenance;

-- Also reserve references introduced by old writers during a rolling update.
CREATE TRIGGER incidents_reserve_reference AFTER INSERT ON incidents
BEGIN
  INSERT OR IGNORE INTO reference_allocations (namespace, reference) VALUES ('INC', NEW.reference);
END;
CREATE TRIGGER maintenance_reserve_reference AFTER INSERT ON maintenance
BEGIN
  INSERT OR IGNORE INTO reference_allocations (namespace, reference) VALUES ('SCH', NEW.reference);
END;
