export const importFollowUpsSql = `
SELECT 'imported-invitation:' || s.id AS id,'imported-invitation' AS kind,
  'Imported subscription confirmation expires' AS title,NULL AS owner_id,NULL AS owner_name,
  strftime('%Y-%m-%dT%H:%M:%fZ',s.created_at,'+72 hours') AS due_at,
  'The subscriber confirms, unsubscribes, or the pending invitation expires.' AS stop_condition,
  CASE WHEN julianday(s.created_at,'+72 hours')<=julianday(c.now) THEN 'The imported subscription confirmation has expired and awaits removal.' END AS failure_message,
  CASE WHEN julianday(s.created_at,'+72 hours')<=julianday(c.now) THEN strftime('%Y-%m-%dT%H:%M:%fZ',s.created_at,'+72 hours') END AS failure_at,
  '/app/cutover?job=' || p.job_id AS link,
  json_array(s.id,s.created_at,julianday(s.created_at,'+72 hours')<=julianday(c.now)) AS occurrence
FROM subscribers s JOIN ik_provenance p ON p.destination='lamp' AND p.target_kind='subscriber' AND p.target_id=s.id AND p.reversed=0
CROSS JOIN follow_up_clock c
WHERE s.state='pending' AND s.channel='email'
  AND p.job_id=(SELECT MIN(p2.job_id) FROM ik_provenance p2 WHERE p2.destination='lamp' AND p2.target_kind='subscriber' AND p2.target_id=s.id AND p2.reversed=0)`;
