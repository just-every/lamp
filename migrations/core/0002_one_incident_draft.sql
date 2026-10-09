-- An incident has one operator draft. Keep the newest legacy row before
-- enforcing that invariant; future writes use an atomic upsert.
DELETE FROM incident_drafts
WHERE rowid NOT IN (
  SELECT MAX(rowid)
  FROM incident_drafts
  GROUP BY incident_id
);

CREATE UNIQUE INDEX incident_drafts_incident_id_unique
  ON incident_drafts(incident_id);

DROP INDEX incident_drafts_incident_updated_idx;
