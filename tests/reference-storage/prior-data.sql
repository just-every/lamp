INSERT INTO operators (id,email,display_name,is_setup_operator,created_at,updated_at)
VALUES ('op','operator@example.test','Test operator',1,'2026-01-01','2026-01-01');
INSERT INTO components (id,name,display_order,created_at,updated_at)
VALUES ('component','Checkout',0,'2026-01-01','2026-01-01');
INSERT INTO incidents (id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,created_at,updated_at)
VALUES ('old','INC-1750000000000123456','Legacy incident','Resolved','2026-01-01','2026-01-02','op','2026-01-01','2026-01-02');
INSERT INTO incident_components (id,incident_id,component_id,component_name,state,published_at,created_at,updated_at)
VALUES ('attached','old','component','Checkout','Major outage','2026-01-01','2026-01-01','2026-01-01');
INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,corrects_update_id,created_at,updated_at,is_retroactive)
VALUES ('initial','old','Investigating','Checkout users','Payment delayed','Browse available','Initial facts','2026-01-01T02:00:00Z','2026-01-01T01:00:00Z','op',NULL,'2026-01-01','2026-01-01',0),
('resolved','old','Resolved','Checkout users','Payment restored','Browse available','Resolution facts','2026-01-02T02:00:00Z','2026-01-02T01:00:00Z','op','initial','2026-01-02','2026-01-02',1);
INSERT INTO incident_drafts (id,incident_id,lifecycle,author_operator_id,corrects_update_id,reviewed_by_operator_id,reviewed_at,created_at,updated_at)
VALUES ('draft','old','Investigating','op','resolved','op','2026-01-02','2026-01-02','2026-01-02');
INSERT INTO incident_attachments (id,incident_id,incident_update_id,file_name,content_type,storage_key,uploaded_by_operator_id,created_at,updated_at)
VALUES ('attachment','old','initial','facts.txt','text/plain','original/facts.txt','op','2026-01-01','2026-01-01');
INSERT INTO subscribers (id,channel,destination,state,token_hash,created_at,updated_at)
VALUES ('subscriber','email','subscriber@example.test','active','fixture-subscriber-token-hash','2026-01-01','2026-01-01');
INSERT INTO notification_channel_selections (incident_update_id,channel,created_at)
VALUES ('resolved','email','2026-01-02');
INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,notification_event_id,notification_event_type,mail_payload_json,created_at,updated_at)
VALUES ('delivery','subscriber','resolved','email','delivered','2026-01-02','resolved','incident-update','{"fixture":"original envelope"}','2026-01-02','2026-01-02');
INSERT INTO notification_delivery_attempts (id,delivery_id,attempt_number,attempted_at,provider_message_id,created_at)
VALUES ('attempt','delivery',1,'2026-01-02','fixture-provider-receipt','2026-01-02');
INSERT INTO notification_outbox (id,kind,aggregate_id,payload_json,available_at,created_at,updated_at)
VALUES ('outbox','delivery-dispatch','resolved','{"fixture":"original job"}','2026-01-02','2026-01-02','2026-01-02');
INSERT INTO maintenance (id,reference,title,state,starts_at,ends_at,created_by_operator_id,created_at,updated_at)
VALUES ('scheduled','SCH-1750000000000123456','Legacy maintenance','Scheduled','2026-03-01','2026-03-02','op','2026-01-01','2026-01-01');
INSERT INTO maintenance_components (id,maintenance_id,component_id,component_name,created_at,updated_at)
VALUES ('maintenance-component','scheduled','component','Checkout','2026-01-01','2026-01-01');
