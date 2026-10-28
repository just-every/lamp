/** Slack/Teams have a separate durable integration delivery store. */
export const channelFollowUpsSql = `
SELECT 'channel-notification:' || p.id AS id,'channel-notification' AS kind,
  i.reference || ': ' || d.kind || ' channel notification — ' || d.name AS title,
  o.id AS owner_id,o.display_name AS owner_name,
  CASE WHEN x.id IS NULL THEN p.queued_at ELSE strftime('%Y-%m-%dT%H:%M:%fZ',x.next_at/1000.0,'unixepoch') END AS due_at,
  'Complete channel delivery, remove the destination, or dismiss this failure with a reason.' AS stop_condition,
  CASE WHEN x.state IN ('rejected','uncertain') OR (x.state='queued' AND x.attempts>0) THEN 'Channel notification delivery failed or needs confirmation.' END AS failure_message,
  CASE WHEN x.state IN ('rejected','uncertain') OR (x.state='queued' AND x.attempts>0) THEN
    strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE((SELECT MAX(a.finished_at) FROM integration_attempts a WHERE a.namespace=x.namespace AND a.delivery_id=x.id),x.next_at)/1000.0,'unixepoch') END AS failure_at,
  '/app/deliveries' AS link,
  json_array(p.id,x.state,x.attempts,x.next_at) AS occurrence
FROM delivery_channel_posts p JOIN delivery_channel_destinations d ON d.id=p.destination_id
JOIN incident_updates u ON u.id=p.incident_update_id JOIN incidents i ON i.id=u.incident_id
LEFT JOIN oa_operators o ON o.id=d.created_by_operator_id AND o.status='active'
LEFT JOIN integration_deliveries x ON x.namespace='lamp-channels' AND x.id=p.id
WHERE d.removed_at IS NULL AND i.deleted_at IS NULL AND (x.id IS NULL OR x.state<>'accepted')`;
