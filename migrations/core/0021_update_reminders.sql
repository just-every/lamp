-- One operator email per committed next-update time and kind (INCIDENT-010,
-- NOTIFY-006): the scheduled trigger records each reminder here before it is
-- sent, so repeated runs send nothing more.
CREATE TABLE incident_update_reminders (
  update_id TEXT NOT NULL REFERENCES incident_updates(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('due-soon', 'overdue')),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (update_id, kind)
);

-- A commitment that had already passed when this release was applied is
-- history: it is still marked overdue in the operator app, but sends no email.
INSERT INTO incident_update_reminders (update_id, kind, recorded_at)
SELECT incident_updates.id, kinds.kind, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM incident_updates
CROSS JOIN (SELECT 'due-soon' AS kind UNION ALL SELECT 'overdue') AS kinds
WHERE incident_updates.next_update_at IS NOT NULL
  AND incident_updates.next_update_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
