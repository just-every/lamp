-- An operator's communication choice is independent of component claims.
ALTER TABLE incidents ADD COLUMN impact_override TEXT CHECK (impact_override IN ('none', 'minor', 'major', 'critical'));

CREATE TABLE incident_impact_changes (
  id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  operator_id TEXT NOT NULL REFERENCES operators(id),
  impact_override TEXT CHECK (impact_override IN ('none', 'minor', 'major', 'critical')),
  previous_override TEXT CHECK (previous_override IN ('none', 'minor', 'major', 'critical')),
  created_at TEXT NOT NULL
);
CREATE INDEX incident_impact_changes_incident_created_idx ON incident_impact_changes(incident_id, created_at DESC, id DESC);

CREATE TRIGGER incidents_snapshot_dirty_impact AFTER UPDATE OF impact_override ON incidents
WHEN NEW.impact_override IS NOT OLD.impact_override BEGIN
  UPDATE public_snapshot_work SET requested_revision = requested_revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default';
END;

-- Freeze impact with each committed recipient, before later operator edits.
ALTER TABLE notification_deliveries ADD COLUMN incident_impact TEXT CHECK (incident_impact IN ('none', 'minor', 'major', 'critical'));
ALTER TABLE channel_posts ADD COLUMN incident_impact TEXT CHECK (incident_impact IN ('none', 'minor', 'major', 'critical'));
CREATE TRIGGER notification_deliveries_capture_impact AFTER INSERT ON notification_deliveries
WHEN NEW.incident_update_id IS NOT NULL OR NEW.incident_report_id IS NOT NULL BEGIN
  UPDATE notification_deliveries SET incident_impact = (
    SELECT COALESCE(i.impact_override, CASE i.peak_impact WHEN 'Major outage' THEN 'critical'
      WHEN 'Partially unavailable' THEN 'major' WHEN 'Degraded performance' THEN 'minor' ELSE 'none' END)
    FROM incidents i WHERE i.id = COALESCE(
      (SELECT incident_id FROM incident_updates WHERE id = NEW.incident_update_id),
      (SELECT incident_id FROM incident_reports WHERE id = NEW.incident_report_id))
  ) WHERE id = NEW.id AND incident_impact IS NULL;
END;
CREATE TRIGGER channel_posts_capture_impact AFTER INSERT ON channel_posts BEGIN
  UPDATE channel_posts SET incident_impact = (
    SELECT COALESCE(i.impact_override, CASE i.peak_impact WHEN 'Major outage' THEN 'critical'
      WHEN 'Partially unavailable' THEN 'major' WHEN 'Degraded performance' THEN 'minor' ELSE 'none' END)
    FROM incidents i JOIN incident_updates u ON u.incident_id = i.id WHERE u.id = NEW.incident_update_id
  ) WHERE id = NEW.id AND incident_impact IS NULL;
END;
