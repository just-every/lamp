const createdAt = "2026-09-08T00:00:00.000Z";

/** Test-only persisted data for the legacy API journey. Production starts empty. */
export function legacyApiFixtureSql() {
  return `
INSERT INTO operators (id,email,display_name,is_setup_operator,deactivated_at,created_at,updated_at) VALUES
  ('01J00000000000000000000001','operator@example.test','Contract Operator',1,NULL,'${createdAt}','${createdAt}');
INSERT INTO page_settings (id,page_name,tagline,accent_color,timezone,hostname,footer_credit_enabled,logo_key,logo_content_type,widget_allowed_origins,mail_from_address,ai_tone_instructions,feed_id,created_at,updated_at) VALUES
  ('default','Atlas Cloud Status','Current availability and incident communications for Atlas Cloud.','#16794C','America/Los_Angeles','status.atlascloud.example',1,NULL,NULL,'[]','lamp@localhost.invalid','','legacy-api-feed-identity','${createdAt}','${createdAt}');
INSERT INTO component_groups (id,name,display_order,created_at,updated_at) VALUES
  ('01J00000000000000000000002','Customer experience',10,'${createdAt}','${createdAt}'),
  ('01J00000000000000000000003','Platform',20,'${createdAt}','${createdAt}');
INSERT INTO components (id,group_id,name,description,internal,display_order,note,created_at,updated_at) VALUES
  ('01J00000000000000000000010','01J00000000000000000000002','Web application','The Atlas Cloud customer dashboard.',0,10,'','${createdAt}','${createdAt}'),
  ('01J00000000000000000000011','01J00000000000000000000002','Public API','The Atlas Cloud public API.',0,20,'Elevated 5xx errors for some requests.','${createdAt}','${createdAt}'),
  ('01J00000000000000000000012','01J00000000000000000000002','Data sync','Background data delivery to dashboards.',0,30,'New data can arrive late.','${createdAt}','${createdAt}'),
  ('01J00000000000000000000013','01J00000000000000000000002','Authentication','Atlas Cloud sign-in and sessions.',0,40,'','${createdAt}','${createdAt}'),
  ('01J00000000000000000000014','01J00000000000000000000003','Database','Primary data storage.',0,10,'','${createdAt}','${createdAt}'),
  ('01J00000000000000000000015','01J00000000000000000000003','Background jobs','Asynchronous processing for Atlas Cloud.',0,20,'','${createdAt}','${createdAt}'),
  ('01J00000000000000000000016','01J00000000000000000000003','Internal metrics pipeline','Private operator telemetry.',1,30,'','${createdAt}','${createdAt}');
INSERT INTO component_standing_claims (id,component_id,state,operator_id,created_at,updated_at) VALUES
  ('01J00000000000000000000017','01J00000000000000000000010','Operational','01J00000000000000000000001','${createdAt}','${createdAt}'),
  ('01J00000000000000000000018','01J00000000000000000000011','Operational','01J00000000000000000000001','${createdAt}','${createdAt}'),
  ('01J00000000000000000000019','01J00000000000000000000012','Operational','01J00000000000000000000001','${createdAt}','${createdAt}'),
  ('01J0000000000000000000001A','01J00000000000000000000013','Operational','01J00000000000000000000001','${createdAt}','${createdAt}'),
  ('01J0000000000000000000001B','01J00000000000000000000014','Operational','01J00000000000000000000001','${createdAt}','${createdAt}'),
  ('01J0000000000000000000001C','01J00000000000000000000015','Operational','01J00000000000000000000001','${createdAt}','${createdAt}');
INSERT INTO component_state_history (id,component_id,previous_state,new_state,cause_type,cause_id,operator_id,changed_at,created_at,updated_at) VALUES
  ('01J0000000000000000000001D','01J00000000000000000000010','Operational','Operational','standing-claim','01J00000000000000000000017','01J00000000000000000000001','2026-06-10T00:00:00.000Z','${createdAt}','${createdAt}'),
  ('01J0000000000000000000001E','01J00000000000000000000011','Operational','Operational','standing-claim','01J00000000000000000000018','01J00000000000000000000001','2026-06-10T00:00:00.000Z','${createdAt}','${createdAt}'),
  ('01J0000000000000000000001F','01J00000000000000000000012','Operational','Operational','standing-claim','01J00000000000000000000019','01J00000000000000000000001','2026-06-10T00:00:00.000Z','${createdAt}','${createdAt}');
INSERT INTO incidents (id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,deleted_at,deletion_reason,peak_impact,created_at,updated_at) VALUES
  ('01J00000000000000000000020','INC-4821','Elevated API error rates','Monitoring','2026-09-08T00:02:00.000Z',NULL,'01J00000000000000000000001',NULL,NULL,'Partially unavailable','${createdAt}','${createdAt}');
INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,published_at,created_at,updated_at) VALUES
  ('01J00000000000000000000021','01J00000000000000000000020','01J00000000000000000000011','Public API','Partially unavailable','Primary','2026-09-08T01:26:00.000Z','${createdAt}','${createdAt}'),
  ('01J00000000000000000000022','01J00000000000000000000020','01J00000000000000000000012','Data sync','Degraded performance','Dependent','2026-09-08T01:26:00.000Z','${createdAt}','${createdAt}');
INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) VALUES
  ('01J00000000000000000000023','01J00000000000000000000020','Monitoring','Customers using the Public API in us-east-1 and eu-west-1.','Some API requests can return 5xx errors and dashboard data can arrive late.','Dashboard viewing, user management, and data exports continue to work.','Engineers have applied a mitigation and are watching recovery.','2026-09-08T03:00:00.000Z','2026-09-08T01:26:00.000Z','01J00000000000000000000001','${createdAt}','${createdAt}');
INSERT INTO incident_drafts (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,author_operator_id,created_at,updated_at) VALUES
  ('01J00000000000000000000024','01J00000000000000000000020','Monitoring','Customers using the Public API in us-east-1 and eu-west-1.','API responses are improving, but some requests can still fail.','Dashboard viewing, user management, and data exports continue to work.','We are continuing to monitor the mitigation before resolving this incident.','2026-09-08T03:00:00.000Z','01J00000000000000000000001','${createdAt}','${createdAt}');
INSERT INTO maintenance (id,reference,title,state,starts_at,ends_at,completed_at,created_by_operator_id,created_at,updated_at) VALUES
  ('01J00000000000000000000030','SCH-144','Database maintenance','Scheduled','2026-09-09T06:00:00.000Z','2026-09-09T07:00:00.000Z',NULL,'01J00000000000000000000001','${createdAt}','${createdAt}');
INSERT INTO maintenance_components (id,maintenance_id,component_id,component_name,state,created_at,updated_at) VALUES
  ('01J00000000000000000000031','01J00000000000000000000030','01J00000000000000000000014','Database','Under maintenance','${createdAt}','${createdAt}');
INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,deactivation_reason,deactivated_at,created_at,updated_at) VALUES
  ('01J00000000000000000000040','email','ops-team@atlascloud.example',NULL,'active','all','legacy-api-ops-token',NULL,NULL,'${createdAt}','${createdAt}'),
  ('01J00000000000000000000041','webhook','https://status-receiver.atlascloud.example/events','webhooks@atlascloud.example','active','selected','legacy-api-webhook-token',NULL,NULL,'${createdAt}','${createdAt}');
INSERT INTO subscriber_components (id,subscriber_id,component_id,created_at,updated_at) VALUES
  ('01J00000000000000000000042','01J00000000000000000000041','01J00000000000000000000011','${createdAt}','${createdAt}'),
  ('01J00000000000000000000043','01J00000000000000000000041','01J00000000000000000000012','${createdAt}','${createdAt}');
INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,maintenance_id,channel,outcome,queued_at,outcome_at,created_at,updated_at) VALUES
  ('01J00000000000000000000050','01J00000000000000000000040','01J00000000000000000000023',NULL,'email','queued','2026-09-08T01:26:00.000Z',NULL,'${createdAt}','${createdAt}'),
  ('01J00000000000000000000051','01J00000000000000000000041','01J00000000000000000000023',NULL,'webhook','queued','2026-09-08T01:26:00.000Z',NULL,'${createdAt}','${createdAt}');`;
}
