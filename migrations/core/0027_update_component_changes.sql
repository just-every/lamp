ALTER TABLE incident_drafts ADD COLUMN component_changes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(component_changes_json) AND json_type(component_changes_json) = 'array');
ALTER TABLE incident_updates ADD COLUMN component_changes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(component_changes_json) AND json_type(component_changes_json) = 'array');
ALTER TABLE incident_updates ADD COLUMN component_snapshot_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(component_snapshot_json) AND json_type(component_snapshot_json) = 'array');

-- Pending notifications from before this migration retain a snapshot of the
-- recorded claims at their update, rather than reading a future live claim.
UPDATE incident_updates AS u SET component_snapshot_json = (
  SELECT json_group_array(json_object(
    'componentId', ic.component_id, 'name', ic.component_name,
    'previousState', COALESCE((SELECT e.state FROM component_claim_events e
      WHERE e.component_id = ic.component_id AND e.cause_type = 'incident' AND e.cause_id = u.incident_id AND e.changed_at < u.published_at
      ORDER BY e.changed_at DESC,e.created_at DESC,e.id DESC LIMIT 1), 'Operational'),
    'newState', CASE WHEN u.lifecycle = 'Resolved' THEN 'Operational' ELSE COALESCE((SELECT e.state FROM component_claim_events e
      WHERE e.component_id = ic.component_id AND e.cause_type = 'incident' AND e.cause_id = u.incident_id AND e.changed_at <= u.published_at
      ORDER BY e.changed_at DESC,e.created_at DESC,e.id DESC LIMIT 1), 'Operational') END,
    'internal', json(CASE WHEN c.internal = 1 THEN 'true' ELSE 'false' END)
  )) FROM incident_components ic JOIN components c ON c.id = ic.component_id
  WHERE ic.incident_id = u.incident_id AND ic.published_at <= u.published_at
)
-- Imported history never notified subscribers. Preserve its sealed move-in
-- value so upgrading alone cannot make undo treat it as an operator edit.
WHERE NOT EXISTS (SELECT 1 FROM statuspage_import_targets t WHERE t.kind = 'incident' AND t.id = u.incident_id);
