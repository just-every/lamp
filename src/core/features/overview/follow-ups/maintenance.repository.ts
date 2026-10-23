export const maintenanceFollowUpsSql = `
SELECT 'maintenance-start:' || m.id AS id,'maintenance-start' AS kind,
  m.reference || ': ' || CASE WHEN COALESCE(a.auto_start,1)=0 THEN 'start maintenance' ELSE 'automatic start' END || ' — ' || m.title AS title,
  o.id AS owner_id,o.display_name AS owner_name,m.starts_at AS due_at,
  'Start or cancel the maintenance window.' AS stop_condition,
  CASE WHEN julianday(m.starts_at)<=julianday(c.now) THEN 'Maintenance has reached its start time and is still scheduled.' END AS failure_message,
  CASE WHEN julianday(m.starts_at)<=julianday(c.now) THEN m.starts_at END AS failure_at,
  '/app/maintenance' AS link,
  json_array(m.id,m.starts_at,COALESCE(a.auto_start,1),julianday(m.starts_at)<=julianday(c.now)) AS occurrence
FROM maintenance m LEFT JOIN maintenance_automation a ON a.maintenance_id=m.id
LEFT JOIN oa_operators o ON o.id=m.created_by_operator_id AND o.status='active'
CROSS JOIN follow_up_clock c WHERE m.state='Scheduled'
UNION ALL
SELECT 'maintenance-end:' || m.id,'maintenance-end',m.reference || ': complete maintenance — ' || m.title,
  o.id,o.display_name,m.ends_at,'Complete or cancel the maintenance window.',
  CASE WHEN m.state='In progress' AND julianday(m.ends_at)<julianday(c.now) AND COALESCE(a.auto_complete,1)=1 THEN 'Automatic maintenance completion has not finished.' END,
  CASE WHEN m.state='In progress' AND julianday(m.ends_at)<julianday(c.now) AND COALESCE(a.auto_complete,1)=1 THEN m.ends_at END,
  '/app/maintenance',json_array(m.id,m.ends_at,COALESCE(a.auto_complete,1),m.state,julianday(m.ends_at)<julianday(c.now))
FROM maintenance m LEFT JOIN maintenance_automation a ON a.maintenance_id=m.id
LEFT JOIN oa_operators o ON o.id=m.created_by_operator_id AND o.status='active'
CROSS JOIN follow_up_clock c WHERE m.state IN ('Scheduled','In progress')
UNION ALL
SELECT 'maintenance-reminder:' || m.id,'maintenance-reminder',m.reference || ': subscriber reminder — ' || m.title,
  o.id,o.display_name,strftime('%Y-%m-%dT%H:%M:%fZ',m.starts_at,'-24 hours'),
  'Record the maintenance reminder, start the window, or cancel it.',
  CASE WHEN julianday(m.starts_at,'-24 hours')<=julianday(c.now) THEN 'The maintenance reminder has not been recorded.' END,
  CASE WHEN julianday(m.starts_at,'-24 hours')<=julianday(c.now) THEN strftime('%Y-%m-%dT%H:%M:%fZ',m.starts_at,'-24 hours') END,
  '/app/maintenance',json_array(m.id,m.starts_at,julianday(m.starts_at,'-24 hours')<=julianday(c.now))
FROM maintenance m LEFT JOIN oa_operators o ON o.id=m.created_by_operator_id AND o.status='active'
CROSS JOIN follow_up_clock c WHERE m.state='Scheduled' AND julianday(m.starts_at)>julianday(c.now)
  AND NOT EXISTS(SELECT 1 FROM maintenance_notices n WHERE n.maintenance_id=m.id AND n.kind='reminder')
UNION ALL
SELECT 'maintenance-overrun:' || m.id,'maintenance-overrun',m.reference || ': maintenance overrun — ' || m.title,
  o.id,o.display_name,strftime('%Y-%m-%dT%H:%M:%fZ',m.ends_at,'+15 minutes'),
  'Complete the maintenance window or extend its planned end.',
  'Maintenance is running longer than planned.',strftime('%Y-%m-%dT%H:%M:%fZ',m.ends_at,'+15 minutes'),
  '/app/maintenance',json_array(m.id,m.ends_at)
FROM maintenance m LEFT JOIN oa_operators o ON o.id=m.created_by_operator_id AND o.status='active'
CROSS JOIN follow_up_clock c WHERE m.state='In progress' AND julianday(m.ends_at,'+15 minutes')<=julianday(c.now)`;
