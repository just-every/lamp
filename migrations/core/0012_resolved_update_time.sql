-- UPDATE-001 amendment: a resolved update makes no next-update commitment.
-- Replace only this column instead of dropping/rebuilding the parent table:
-- dropping incident_updates would invoke CASCADE/SET NULL on its dependants.
-- The migration runner applies these statements in one transaction. Existing
-- values (including legacy resolved promises) remain immutable historical data;
-- renderers suppress the promise for Resolved updates.
ALTER TABLE incident_updates ADD COLUMN nullable_next_update_at TEXT;
UPDATE incident_updates SET nullable_next_update_at = next_update_at;
ALTER TABLE incident_updates DROP COLUMN next_update_at;
ALTER TABLE incident_updates RENAME COLUMN nullable_next_update_at TO next_update_at;
