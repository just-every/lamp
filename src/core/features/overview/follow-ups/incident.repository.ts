/** Each SELECT projects only operator-safe obligation metadata. */
export const incidentFollowUpsSql = `
SELECT 'next-update:' || u.id AS id, 'next-update' AS kind,
  i.reference || ': next update — ' || i.title AS title,
  o.id AS owner_id, o.display_name AS owner_name, u.next_update_at AS due_at,
  'Publish a newer update or resolve the incident.' AS stop_condition,
  CASE WHEN julianday(u.next_update_at)<julianday(c.now) THEN 'The promised next update is overdue.' END AS failure_message,
  CASE WHEN julianday(u.next_update_at)<julianday(c.now) THEN u.next_update_at END AS failure_at,
  '/app/incidents/' || i.id AS link,
  json_array(u.id,u.next_update_at,julianday(u.next_update_at)<julianday(c.now)) AS occurrence
FROM incidents i
JOIN incident_updates u ON u.id=(SELECT latest.id FROM incident_updates latest WHERE latest.incident_id=i.id ORDER BY latest.published_at DESC,latest.created_at DESC,latest.id DESC LIMIT 1)
LEFT JOIN incident_communication_owners a ON a.incident_id=i.id
LEFT JOIN oa_operators o ON o.id=COALESCE(a.operator_id,i.created_by_operator_id) AND o.status='active'
CROSS JOIN follow_up_clock c
WHERE i.deleted_at IS NULL AND i.lifecycle<>'Resolved' AND u.lifecycle<>'Resolved' AND u.is_retroactive=0 AND u.next_update_at IS NOT NULL
UNION ALL
SELECT 'scheduled-publication:' || d.id,'scheduled-publication',
  i.reference || ': scheduled publication — ' || i.title,
  o.id,o.display_name,d.scheduled_publish_at,
  'Publish the scheduled draft or remove its schedule.',
  CASE WHEN julianday(d.scheduled_publish_at)<julianday(c.now) THEN 'The scheduled publication has not completed.' END,
  CASE WHEN julianday(d.scheduled_publish_at)<julianday(c.now) THEN d.scheduled_publish_at END,
  '/app/incidents/' || i.id,
  json_array(d.id,d.scheduled_publish_at,d.updated_at,julianday(d.scheduled_publish_at)<julianday(c.now))
FROM incident_drafts d JOIN incidents i ON i.id=d.incident_id
LEFT JOIN oa_operators o ON o.id=d.author_operator_id AND o.status='active'
CROSS JOIN follow_up_clock c
WHERE i.deleted_at IS NULL AND d.scheduled_publish_at IS NOT NULL`;
