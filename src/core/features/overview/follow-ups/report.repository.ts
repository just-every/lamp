import { reportReminderEligibleSql } from "../../reports/reminder-eligibility";

export const reportCandidatesSql = `
SELECT i.id,i.reference,i.title,i.resolved_at,o.id AS owner_id,o.display_name AS owner_name,
  ${reportReminderEligibleSql("i")} AS reminder_eligible,
  strftime('%Y-%m-%dT%H:%M:%fZ',i.resolved_at,'+7 days') AS due_at,
  MAX(0,CAST((julianday(c.now)-julianday(i.resolved_at)-7)/7 AS INTEGER)) AS current_week
FROM incidents i
LEFT JOIN incident_communication_owners a ON a.incident_id=i.id
LEFT JOIN oa_operators o ON o.id=COALESCE(a.operator_id,i.created_by_operator_id) AND o.status='active'
CROSS JOIN follow_up_clock c
WHERE i.deleted_at IS NULL AND i.lifecycle='Resolved' AND i.resolved_at IS NOT NULL
  AND i.peak_impact IN ('Partially unavailable','Major outage')
  AND NOT EXISTS(SELECT 1 FROM incident_reports r WHERE r.incident_id=i.id AND r.published_at IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM report_waivers w WHERE w.incident_id=i.id)`;

export const reportFollowUpsSql = `
SELECT 'report:' || r.id AS id,'report' AS kind,r.reference || ': post-incident report — ' || r.title AS title,
  r.owner_id,r.owner_name,r.due_at,'Publish the report or record a reasoned waiver.' AS stop_condition,
  CASE WHEN julianday(r.due_at)<=julianday(c.now) THEN 'The post-incident report is overdue.' END AS failure_message,
  CASE WHEN julianday(r.due_at)<=julianday(c.now) THEN r.due_at END AS failure_at,
  '/app/incidents/' || r.id || '#post-incident-report' AS link,
  json_array(r.id,r.resolved_at,julianday(r.due_at)<=julianday(c.now)) AS occurrence
FROM follow_up_reports r CROSS JOIN follow_up_clock c
UNION ALL
SELECT 'report-reminder:' || r.id,'report-reminder',r.reference || ': report reminder — ' || r.title,
  r.owner_id,r.owner_name,
  strftime('%Y-%m-%dT%H:%M:%fZ',r.resolved_at,'+' || (7+7*(r.current_week+CASE WHEN sent.incident_id IS NULL THEN 0 ELSE 1 END)) || ' days'),
  'Send this weekly reminder, publish the report, or record a reasoned waiver.',
  CASE WHEN julianday(r.due_at)<=julianday(c.now) AND sent.incident_id IS NULL THEN 'The weekly report reminder has not been recorded.' END,
  CASE WHEN julianday(r.due_at)<=julianday(c.now) AND sent.incident_id IS NULL THEN strftime('%Y-%m-%dT%H:%M:%fZ',r.resolved_at,'+' || (7+7*r.current_week) || ' days') END,
  '/app/incidents/' || r.id || '#post-incident-report',
  json_array(r.id,r.resolved_at,r.current_week+CASE WHEN sent.incident_id IS NULL THEN 0 ELSE 1 END,julianday(r.due_at)<=julianday(c.now) AND sent.incident_id IS NULL)
FROM follow_up_reports r CROSS JOIN follow_up_clock c
LEFT JOIN report_reminders sent ON sent.incident_id=r.id AND sent.week=r.current_week
WHERE r.reminder_eligible=1`;
