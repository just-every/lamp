import { subscriberLimits } from "../../subscribers/limits";

/** Capacity is a current obligation, never dismissible while the channel is
 * full. Deactivation or deletion removes it on the next read. */
export const subscriberLimitFollowUpsSql = `
SELECT 'subscriber-limit:' || bucket AS id,'subscriber-limit' AS kind,
  label || ' subscriptions are full (' || count || '/' || capacity || ')' AS title,
  NULL AS owner_id,NULL AS owner_name,(SELECT now FROM follow_up_clock) AS due_at,
  'Bring this channel below its subscriber limit.' AS stop_condition,
  NULL AS failure_message,NULL AS failure_at,'/app/subscribers' AS link,
  bucket AS occurrence
FROM (
  SELECT 'all' AS bucket,'All channels' AS label,COUNT(*) AS count,${subscriberLimits.total} AS capacity
  FROM subscriber_directory AS subscribers WHERE state IN ('pending','active')
  UNION ALL SELECT 'webhook','Webhook',COUNT(*),${subscriberLimits.webhook}
  FROM subscriber_directory AS subscribers WHERE state IN ('pending','active') AND channel='webhook'
  UNION ALL SELECT 'chat','Slack and Teams',COUNT(*),${subscriberLimits.chat}
  FROM subscriber_directory AS subscribers WHERE state IN ('pending','active') AND channel IN ('slack','teams')
) WHERE count>=capacity`;
