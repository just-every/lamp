/** Neither stored envelopes, destinations nor raw provider errors leave this projection. */
export const notificationFollowUpsSql = `
SELECT 'notification-dispatch:' || n.id AS id,'notification-dispatch' AS kind,
  CASE WHEN n.kind='operator-alert' THEN 'Operator alert dispatch' ELSE 'Subscriber notification dispatch' END AS title,
  NULL AS owner_id,NULL AS owner_name,n.available_at AS due_at,
  'Complete notification dispatch or dismiss this failure with a reason.' AS stop_condition,
  CASE WHEN n.failed_at IS NOT NULL OR n.last_error IS NOT NULL THEN 'Notification dispatch failed; delivery remains pending.' END AS failure_message,
  CASE WHEN n.failed_at IS NOT NULL OR n.last_error IS NOT NULL THEN COALESCE(n.failed_at,n.updated_at) END AS failure_at,
  '/app/deliveries' AS link,
  json_array(n.id,n.attempts,n.available_at,n.failed_at,n.last_error IS NOT NULL,n.updated_at) AS occurrence
FROM notification_outbox n
WHERE n.completed_at IS NULL AND (n.kind='operator-alert' OR EXISTS(
  SELECT 1 FROM notification_deliveries d JOIN subscribers s ON s.id=d.subscriber_id
  WHERE d.notification_event_id=n.aggregate_id AND d.outcome='queued' AND s.state='active'
    AND NOT EXISTS(SELECT 1 FROM notification_delivery_attempts accepted WHERE accepted.delivery_id=d.id AND (accepted.provider_message_id IS NOT NULL OR accepted.local_capture_id IS NOT NULL))))
UNION ALL
SELECT 'notification-delivery:' || d.id,'notification-delivery','Failed ' || d.channel || ' notification',
  NULL,NULL,COALESCE(d.outcome_at,d.updated_at),
  'Resolve the failed notification or dismiss it with a reason.',
  'Notification delivery failed.',COALESCE(d.outcome_at,d.updated_at),'/app/deliveries',
  json_array(d.id,d.outcome_at,d.updated_at,(SELECT COUNT(*) FROM notification_delivery_attempts a WHERE a.delivery_id=d.id))
FROM notification_deliveries d WHERE d.outcome='failed'`;
