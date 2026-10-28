import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { getPlatformProxy } from "wrangler";

import { contract } from "../contract.mjs";
import { applyOwnerMigrations } from "../../scripts/owner-migrations.mjs";
import { importHistoryForRestore, undoHistoryAfterRestore } from "../betterstack/portability.mjs";
import { installManaged } from "./helpers/managed-install.mjs";

const configPath = "wrangler.jsonc";
const logo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Jm4kAAAAASUVORK5CYII=", "base64");

function run(args) {
  execFileSync("pnpm", args, { cwd: process.cwd(), stdio: "pipe", ...(args.includes("migrations") ? { maxBuffer: 8 * 1024 * 1024 } : {}) });
}

function platformFor(statePath) {
  return getPlatformProxy({ configPath, remoteBindings: false, persist: { path: join(statePath, "v3") } });
}

function quoted(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

// One record of every released kind, and an original image with its metadata.
async function populate(env) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO operators (id, email, display_name, is_setup_operator, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind("operator-export", "owner@example.test", "Owner", 1, "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
    env.DB.prepare("INSERT OR REPLACE INTO page_settings (id, page_name, tagline, accent_color, timezone, hostname, footer_credit_enabled, logo_key, logo_content_type, widget_allowed_origins, mail_from_address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("default", "Export status", "Portable archive", "#16794c", "UTC", "status.example.test", 1, "branding/original.png", "image/png", '["https://embed.example.test"]', "status@example.test", "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
    env.DB.prepare("INSERT INTO component_groups (id, name, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("group-export", "Core services", 1, "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
    env.DB.prepare("INSERT INTO components (id, group_id, name, description, internal, display_order, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("component-export", "group-export", "Public API", "Customer API", 0, 1, "Watch this component.", "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
    env.DB.prepare("INSERT INTO component_state_history (id, component_id, previous_state, new_state, cause_type, cause_id, operator_id, supersedes_history_id, changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("history-export", "component-export", "Operational", "Major outage", "incident", "incident-export", "operator-export", null, "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
    env.DB.prepare("INSERT INTO incidents (id, reference, title, lifecycle, opened_at, resolved_at, created_by_operator_id, deleted_at, deletion_reason, peak_impact, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("incident-export", "INC-4242", "API availability", "Resolved", "2026-09-08T00:00:00.000Z", "2026-09-08T00:15:00.000Z", "operator-export", null, null, "Major outage", "2026-09-08T00:00:00.000Z", "2026-09-08T00:15:00.000Z"),
    env.DB.prepare("INSERT INTO incident_components (id, incident_id, component_id, component_name, state, relationship, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("incident-component-export", "incident-export", "component-export", "Public API", "Major outage", "Primary", "2026-09-08T00:05:00.000Z", "2026-09-08T00:00:00.000Z", "2026-09-08T00:05:00.000Z"),
    env.DB.prepare("INSERT INTO incident_updates (id, incident_id, lifecycle, affected_audience, customer_impact, what_still_works, details, next_update_at, published_at, author_operator_id, corrects_update_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("update-export", "incident-export", "Resolved", "API customers", "Requests failed", "Dashboard remained available", "The incident is resolved.", "2026-09-08T00:15:00.000Z", "2026-09-08T00:15:00.000Z", "operator-export", null, "2026-09-08T00:00:00.000Z", "2026-09-08T00:15:00.000Z"),
    env.DB.prepare("INSERT INTO incident_reports (id, incident_id, summary, timeline, cause, remediation, published_at, author_operator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("report-export", "incident-export", "Summary", "Timeline", "Cause", "Remediation", "2026-09-08T01:00:00.000Z", "operator-export", "2026-09-08T01:00:00.000Z", "2026-09-08T01:00:00.000Z"),
    env.DB.prepare("INSERT INTO maintenance (id, reference, title, state, starts_at, ends_at, completed_at, created_by_operator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("maintenance-export", "SCH-4242", "Database maintenance", "Completed", "2026-09-09T00:00:00.000Z", "2026-09-09T01:00:00.000Z", "2026-09-09T01:00:00.000Z", "operator-export", "2026-09-08T00:00:00.000Z", "2026-09-09T01:00:00.000Z"),
    env.DB.prepare("INSERT INTO maintenance_components (id, maintenance_id, component_id, component_name, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("maintenance-component-export", "maintenance-export", "component-export", "Public API", "Under maintenance", "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
    env.DB.prepare("INSERT INTO import_maintenance_updates (id,maintenance_id,body,published_at,source_states) VALUES (?,?,?,?,?)").bind("imported-maintenance-update", "maintenance-export", "Original provider maintenance message", "2026-09-09T00:15:00.000Z", "[]"),
    env.DB.prepare("INSERT INTO maintenance_notices (id, maintenance_id, kind, body, published_at, author_operator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("notice-export", "maintenance-export", "completed", "Maintenance complete.", "2026-09-09T01:00:00.000Z", "operator-export", "2026-09-09T01:00:00.000Z", "2026-09-09T01:00:00.000Z"),
    env.DB.prepare("INSERT INTO subscribers (id, channel, destination, contact_email, state, selection_mode, token_hash, deactivation_reason, deactivated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("subscriber-export", "email", "reader@example.test", "reader@example.test", "active", "selected", "token-hash-export", null, null, "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
    env.DB.prepare("INSERT INTO subscriber_components (id, subscriber_id, component_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("subscriber-component-export", "subscriber-export", "component-export", "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
    env.DB.prepare("INSERT INTO notification_deliveries (id, subscriber_id, incident_update_id, maintenance_id, channel, outcome, queued_at, outcome_at, created_at, updated_at, notification_event_id, notification_event_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("delivery-export", "subscriber-export", "update-export", null, "email", "delivered", "2026-09-08T00:15:00.000Z", "2026-09-08T00:15:01.000Z", "2026-09-08T00:15:00.000Z", "2026-09-08T00:15:01.000Z", "update-export", "incident-update"),
    env.DB.prepare("INSERT INTO alert_sources (id,name,credential_kind,bearer_token_hash,deduplication_path,title_path,state_path,created_by_operator_id,created_at,updated_at,grouped_preset,label_matchers_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind("group-source-export","Production Alertmanager","bearer-token","synthetic-archive-hash","preset:alertmanager","preset:alertmanager","preset:alertmanager","operator-export","2026-09-08","2026-09-08","alertmanager",JSON.stringify([{componentId:"component-export",labels:{service:"api",region:"us-east"}}])),
    env.DB.prepare("INSERT INTO alert_sources (id,name,credential_kind,signing_secret,deduplication_path,title_path,state_path,created_by_operator_id,created_at,updated_at,uptime_preset,monitor_mappings_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind("uptime-source-export","Production Uptime","hmac-sha256","synthetic-archive-uptime-secret","preset:uptime","preset:uptime","preset:uptime","operator-export","2026-09-08","2026-09-08","uptime",JSON.stringify([{monitorId:"checkout",componentId:"component-export"}])),
    env.DB.prepare("INSERT INTO alert_group_members (source_id,incident_id,group_key,fingerprint,state,received_at,recovered_at) VALUES (?,?,?,?,?,?,?)").bind("group-source-export","incident-export","service-group","alert-fingerprint","resolved","2026-09-08T00:15:00.000Z","2026-09-08T00:15:00.000Z"),
    env.DB.prepare("INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, reason, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("audit-export", "component-state-history", "history-export", "corrected", "operator-export", "Verified export", '{"before":"Operational","after":"Major outage"}', "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
  ]);
  // Synthetic retained delivery history, not provider-acceptance evidence. The
  // public failover journey separately proves how these durable facts arise.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO mail_provider_routes(message_key,notification_delivery_id,envelope_hash,configuration_hash,primary_provider,secondary_provider,selected_provider,first_retryable_failure_at,state,provider_message_id,accepting_provider,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'accepted',?,?,?,?)").bind(createHash('sha256').update('synthetic-lamp-route-1').digest('hex'),'delivery-export',createHash('sha256').update('synthetic-lamp-envelope-1').digest('hex'),createHash('sha256').update('synthetic-lamp-configuration-1').digest('hex'),'resend','mailgun','mailgun','2026-09-08T00:10:00.000Z','synthetic-lamp-provider-receipt-1','mailgun','2026-09-08T00:10:00.000Z','2026-09-08T00:15:01.000Z'),
    env.DB.prepare("INSERT INTO mail_provider_settings(id,secondary_provider,updated_at) VALUES('default','mailgun','2026-09-08T00:00:00.000Z')"),
  ]);
  // Retained chat consent and both notification carrier kinds travel through
  // the same technical archive. These chat recipients have already opted out;
  // current active-channel behavior is exercised by the subscription journey.
  const stamp="2026-09-08T00:00:00.000Z",confirmed="2026-09-08T00:01:00.000Z",deactivated="2026-09-08T00:16:00.000Z";
  for (const [number,kind] of [[1701,"slack"],[1702,"teams"]]) {
    const id=`synthetic-lamp-${number}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO subscribers(id,channel,chat_kind,destination,state,selection_mode,token_hash,event_kinds_json,preferences_set,deactivation_reason,deactivated_at,created_at,updated_at) VALUES(?,'webhook',?,?,'deactivated','selected',?, ?,1,'unsubscribed',?,?,?)").bind(id,kind,`${kind}:${id}`,`${id}-legacy-token`,'["maintenance","components"]',deactivated,stamp,deactivated),
      env.DB.prepare("INSERT INTO subscriber_chat_destinations(subscriber_id,kind,name,sealed_url,host,selection_mode,slack_team_id,slack_channel_id,created_at,updated_at) VALUES(?,?,?,?,?,'selected',?,?,?,?)").bind(id,kind,`Synthetic ${kind}`,`${id}-sealed`,kind==='slack'?'hooks.slack.com':'synthetic-lamp.environment.api.powerplatform.com',kind==='slack'?'synthetic-lamp-team':null,kind==='slack'?'synthetic-lamp-channel':null,stamp,deactivated),
      env.DB.prepare("INSERT INTO subscriber_components(id,subscriber_id,component_id,created_at,updated_at) VALUES(?,?,'component-export',?,?)").bind(`${id}-selection`,id,stamp,stamp),
      ...['confirm','manage','unsubscribe'].map(scope=>env.DB.prepare("INSERT INTO subscriber_tokens(id,subscriber_id,scope,token_hash,expires_at,revoked_at,created_at,updated_at) VALUES(?,?,?,?,NULL,?,?,?)").bind(`${id}-${scope}`,id,scope,`${id}-${scope}-hash`,scope==='confirm'?confirmed:deactivated,stamp,scope==='confirm'?confirmed:deactivated)),
      env.DB.prepare("INSERT INTO subscriber_channel_posts(id,incident_update_id,destination_id,queued_at,incident_impact) VALUES(?,'update-export',?,'2026-09-08T00:15:00.000Z','critical')").bind(`${id}-post`,id),
    ]);
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE subscribers SET event_kinds_json=?,preferences_set=1 WHERE id='subscriber-export'").bind('["incidents","maintenance","components"]'),
    env.DB.prepare("INSERT INTO channel_destinations(id,kind,name,sealed_url,host,selection_mode,created_by_operator_id,created_at,updated_at) VALUES('synthetic-lamp-1707','slack','Synthetic owner channel','synthetic-lamp-1707-sealed','hooks.slack.com','all','operator-export',?,?)").bind(stamp,stamp),
    env.DB.prepare("INSERT INTO channel_destination_components(destination_id,component_id) VALUES('synthetic-lamp-1707','component-export')"),
    env.DB.prepare("INSERT INTO channel_posts(id,incident_update_id,destination_id,queued_at) VALUES('synthetic-lamp-1708','update-export','synthetic-lamp-1707','2026-09-08T00:15:00.000Z')"),
    env.DB.prepare("INSERT INTO component_notification_events(id,component_id,component_name,component_created_at,previous_state,new_state,changed_at,claimant_kind) VALUES('synthetic-lamp-1703','component-export','Public API',?,'Operational','Major outage','2026-09-08T00:15:00.000Z','standing-claim')").bind(stamp),
    env.DB.prepare("INSERT INTO component_notification_deliveries(id,subscriber_id,channel,outcome,queued_at,outcome_at,created_at,updated_at,notification_event_id,notification_event_type,mail_payload_json,component_event_id) VALUES('synthetic-lamp-1704','subscriber-export','email','delivered','2026-09-08T00:15:00.000Z','2026-09-08T00:15:01.000Z',?,?,'synthetic-lamp-1703','component-change',?,'synthetic-lamp-1703')").bind(stamp,deactivated,JSON.stringify({subject:'Synthetic component change',text:'Retained component wording',to:'reader@example.test'})),
    env.DB.prepare("INSERT INTO component_delivery_attempts(id,delivery_id,attempt_number,attempted_at,provider_message_id,created_at) VALUES('synthetic-lamp-1705','synthetic-lamp-1704',1,'2026-09-08T00:15:00.000Z','synthetic-lamp-component-message',?)").bind(stamp),
    env.DB.prepare("INSERT INTO mail_provider_webhook_events(id,provider_event_id,provider_message_id,event_type,received_at,created_at,applied_at,component_delivery_id) VALUES('synthetic-lamp-1706','synthetic-lamp-component-event','synthetic-lamp-component-message','delivered','2026-09-08T00:15:01.000Z',?,'2026-09-08T00:15:01.000Z','synthetic-lamp-1704')").bind(stamp),
    env.DB.prepare("INSERT INTO notification_delivery_attempts(id,delivery_id,attempt_number,attempted_at,provider_message_id,created_at) VALUES('synthetic-lamp-1712','delivery-export',1,'2026-09-08T00:15:00.000Z','synthetic-lamp-incident-message',?)").bind(stamp),
    env.DB.prepare("INSERT INTO mail_provider_webhook_events(id,provider_event_id,provider_message_id,event_type,received_at,created_at,applied_at,delivery_id) VALUES('synthetic-lamp-1713','synthetic-lamp-incident-event','synthetic-lamp-incident-message','delivered','2026-09-08T00:15:01.000Z',?,'2026-09-08T00:15:01.000Z','delivery-export')").bind(stamp),
    env.DB.prepare("INSERT INTO channel_subscriber_events(id,subscriber_id,event_id,kind,queued_at) VALUES('synthetic-lamp-1710','synthetic-lamp-1701','notice-export','maintenance',?)").bind(stamp),
    env.DB.prepare("INSERT INTO channel_subscriber_events(id,subscriber_id,event_id,kind,queued_at) VALUES('synthetic-lamp-1711','synthetic-lamp-1702','synthetic-lamp-1703','component',?)").bind(stamp),
  ]);
  for (const transport of ['slack', 'teams']) await env.DB.prepare("INSERT INTO chat_links(id,operator_id,transport,tenant,subject,created_at) VALUES(?,?,?,?,?,?)").bind(`synthetic-lamp-${transport}`,'operator-export',transport,'synthetic-lamp-1','synthetic-lamp-2','2026-10-23').run();
  // Durable SMS consent, signed-reply replay receipt and delivered outcome
  // are product data. Provider credentials are deployment configuration only.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO subscribers(id,channel,sms_kind,destination,state,selection_mode,token_hash,event_kinds_json,preferences_set,deactivation_reason,deactivated_at,created_at,updated_at) VALUES('synthetic-lamp-1810','webhook',1,'+12025550110','deactivated','selected','synthetic-lamp-1811','[\"maintenance\"]',1,'STOP',?,?,?)").bind(deactivated,stamp,deactivated),
    env.DB.prepare("INSERT INTO subscriber_components(id,subscriber_id,component_id,created_at,updated_at) VALUES('synthetic-lamp-1812','synthetic-lamp-1810','component-export',?,?)").bind(stamp,stamp),
    env.DB.prepare("INSERT INTO sms_subscriptions(subscriber_id,page_name,opt_in_wording,pending_since) VALUES('synthetic-lamp-1810','Export status','synthetic-lamp-1813',?)").bind(stamp),
    env.DB.prepare("INSERT INTO sms_consents(id,subscriber_id,number,page_name,wording,consented_at) VALUES('synthetic-lamp-1814','synthetic-lamp-1810','+12025550110','Export status','synthetic-lamp-1813',?)").bind(confirmed),
    env.DB.prepare("INSERT INTO sms_inbound_events(message_sid,subscriber_id,received_at) VALUES('synthetic-lamp-1815','synthetic-lamp-1810',?)").bind(confirmed),
    env.DB.prepare("INSERT INTO sms_deliveries(id,subscriber_id,event_id,kind,incident_update_id,outcome,provider_message_id,queued_at,outcome_at) VALUES('synthetic-lamp-1816','synthetic-lamp-1810','update-export','incident-update','update-export','delivered','synthetic-lamp-1817',?,?)").bind(stamp,confirmed),
    env.DB.prepare("INSERT INTO sms_reporting_daily(day,joined,left_count) VALUES('2026-09-08',1,1)"),
    env.DB.prepare("UPDATE sms_settings SET countries_json='[\"US\",\"CA\",\"GB\"]',support_contact='support@example.test' WHERE id=1"),
  ]);
  await env.SNAPSHOTS.put("branding/original.png", logo, { httpMetadata: { contentType: "image/png", contentDisposition: "attachment; filename=brand.png", cacheControl: "public, max-age=60" }, customMetadata: { owner: "portable-brand" } });
}

async function assertSubscriberDeliveryHistory(db) {
  assert.deepEqual((await db.prepare("SELECT day,joined,left_count FROM sms_reporting_daily ORDER BY day").all()).results,[{day:'2026-09-08',joined:1,left_count:1}],'anonymous SMS inventory history survives restore');
  assert.deepEqual({...await db.prepare("SELECT channel,destination,state,selection_mode,event_kinds_json FROM subscriber_directory WHERE id='synthetic-lamp-1810'").first()},{channel:'sms',destination:'+12025550110',state:'deactivated',selection_mode:'selected',event_kinds_json:'["maintenance"]'},'SMS channel identity, STOP and preferences survive restore');
  assert.deepEqual({...await db.prepare("SELECT number,page_name,wording,consented_at FROM sms_consents WHERE subscriber_id='synthetic-lamp-1810'").first()},{number:'+12025550110',page_name:'Export status',wording:'synthetic-lamp-1813',consented_at:'2026-09-08T00:01:00.000Z'},'the exact consent receipt survives restore');
  assert.deepEqual({...await db.prepare("SELECT event_id,outcome,provider_message_id FROM sms_deliveries WHERE id='synthetic-lamp-1816'").first()},{event_id:'update-export',outcome:'delivered',provider_message_id:'synthetic-lamp-1817'},'the original SMS provider receipt prevents resending on restore');
  assert.deepEqual({...await db.prepare("SELECT countries_json,support_contact FROM sms_settings WHERE id=1").first()},{countries_json:'["US","CA","GB"]',support_contact:'support@example.test'},'owner country policy and support contact survive restore');
  assert.equal((await db.prepare("SELECT subscriber_id FROM sms_inbound_events WHERE message_sid='synthetic-lamp-1815'").first()).subscriber_id,'synthetic-lamp-1810','signed reply replay authority stays with its subscriber');

  assert.deepEqual((await db.prepare("SELECT notification_delivery_id,primary_provider,secondary_provider,selected_provider,state,provider_message_id,accepting_provider FROM mail_provider_routes ORDER BY message_key").all()).results,[{notification_delivery_id:'delivery-export',primary_provider:'resend',secondary_provider:'mailgun',selected_provider:'mailgun',state:'accepted',provider_message_id:'synthetic-lamp-provider-receipt-1',accepting_provider:'mailgun'}],'accepted provider routing survives restore without changing its replay decision');
  assert.deepEqual((await db.prepare("SELECT id,secondary_provider FROM mail_provider_settings").all()).results,[{id:'default',secondary_provider:'mailgun'}],'the owner-selected secondary travels with the archive');
  assert.deepEqual((await db.prepare("SELECT id,channel,state,selection_mode,event_kinds_json FROM subscriber_directory WHERE id IN ('synthetic-lamp-1701','synthetic-lamp-1702') ORDER BY id").all()).results,[
    {id:'synthetic-lamp-1701',channel:'slack',state:'deactivated',selection_mode:'selected',event_kinds_json:'["maintenance","components"]'},
    {id:'synthetic-lamp-1702',channel:'teams',state:'deactivated',selection_mode:'selected',event_kinds_json:'["maintenance","components"]'},
  ],'both chat channels retain their identity, opt-out and component preferences');
  assert.deepEqual((await db.prepare("SELECT id,subscriber_id,outcome,notification_event_id FROM notification_delivery_records ORDER BY id").all()).results,[
    {id:'delivery-export',subscriber_id:'subscriber-export',outcome:'delivered',notification_event_id:'update-export'},
    {id:'synthetic-lamp-1704',subscriber_id:'subscriber-export',outcome:'delivered',notification_event_id:'synthetic-lamp-1703'},
  ],'the product sees each incident and component delivery once with its retained outcome');
  assert.deepEqual((await db.prepare("SELECT delivery_id,attempt_number,provider_message_id FROM notification_attempt_records ORDER BY delivery_id").all()).results,[
    {delivery_id:'delivery-export',attempt_number:1,provider_message_id:'synthetic-lamp-incident-message'},
    {delivery_id:'synthetic-lamp-1704',attempt_number:1,provider_message_id:'synthetic-lamp-component-message'},
  ],'provider deduplication identities remain attached to the same two deliveries');
  assert.deepEqual((await db.prepare("SELECT provider_event_id,delivery_id,component_delivery_id FROM mail_provider_webhook_events ORDER BY provider_event_id").all()).results,[
    {provider_event_id:'synthetic-lamp-component-event',delivery_id:null,component_delivery_id:'synthetic-lamp-1704'},
    {provider_event_id:'synthetic-lamp-incident-event',delivery_id:'delivery-export',component_delivery_id:null},
  ],'callbacks retain the exact carrier authority for both kinds');
  assert.deepEqual((await db.prepare("SELECT id,destination_id,incident_update_id FROM delivery_channel_posts ORDER BY id").all()).results,[
    {id:'synthetic-lamp-1701-post',destination_id:'synthetic-lamp-1701',incident_update_id:'update-export'},
    {id:'synthetic-lamp-1702-post',destination_id:'synthetic-lamp-1702',incident_update_id:'update-export'},
    {id:'synthetic-lamp-1708',destination_id:'synthetic-lamp-1707',incident_update_id:'update-export'},
  ],'owner and subscriber chat posts keep their original update identity');
}

contract("HIST-004", "export restores every JSON entity, settings and audit entry plus original image bytes into an empty local deployment and into a new RER Managed installation", async () => {
  const sourceState = await mkdtemp(join(tmpdir(), "lamp-export-source-"));
  const targetState = await mkdtemp(join(tmpdir(), "lamp-export-target-"));
  const archive = await mkdtemp(join(tmpdir(), "lamp-export-archive-"));
  const restoredArchive = await mkdtemp(join(tmpdir(), "lamp-export-restored-"));
  let importedHistory;
  try {
    run(["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", sourceState, "--config", configPath]);
    await applyOwnerMigrations(configPath, ["--local", "--persist-to", sourceState]);
    const source = await platformFor(sourceState);
    try {
      await populate(source.env);
      importedHistory=await importHistoryForRestore(source.env.DB);
    } finally {
      await source.dispose();
    }

    run(["run", "export:cloudflare", "--", "--out", archive, "--persist-to", sourceState]);
    const manifestPath = join(archive, "manifest.json");
    const originalManifest = await readFile(manifestPath, "utf8");
    const damagedManifest = JSON.parse(originalManifest);
    damagedManifest.migrations[0].sha256 = "0".repeat(64);
    await writeFile(manifestPath, JSON.stringify(damagedManifest));
    assert.throws(() => run(["run", "import:cloudflare", "--", "--from", archive, "--persist-to", targetState]), /Command failed/);
    const untouched = await platformFor(targetState);
    try {
      const tables = await untouched.env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all();
      assert.equal(tables.results.length, 0, "schema mismatch must be rejected before destination migrations or records are written");
      assert.equal((await untouched.env.SNAPSHOTS.list()).objects.length, 0);
    } finally { await untouched.dispose(); }
    await writeFile(manifestPath, originalManifest);
    const originalEntities = await readFile(join(archive, "entities.json"));
    const incompatibleEntities = JSON.parse(originalEntities);
    incompatibleEntities.tables.push({ name: "missing_owner_table", dependsOn: [], rows: [{ id: "cannot-restore" }] });
    const incompatibleBytes = Buffer.from(JSON.stringify(incompatibleEntities));
    const incompatibleManifest = JSON.parse(originalManifest);
    incompatibleManifest.database.sha256 = createHash("sha256").update(incompatibleBytes).digest("hex");
    await writeFile(join(archive, "entities.json"), incompatibleBytes);
    await writeFile(manifestPath, JSON.stringify(incompatibleManifest));
    const partialState = join(targetState, "partial-attempt");
    assert.throws(() => run(["run", "import:cloudflare", "--", "--from", archive, "--persist-to", partialState]), /Command failed/, "a real SQL restore failure must stop without publishing");
    await writeFile(join(archive, "entities.json"), originalEntities);
    await writeFile(manifestPath, originalManifest);
    assert.throws(() => run(["run", "import:cloudflare", "--", "--from", archive, "--persist-to", partialState]), /Command failed/, "a failed destination must not be silently overwritten on retry");
    run(["run", "import:cloudflare", "--", "--from", archive, "--persist-to", targetState]);
    assert.throws(() => run(["run", "import:cloudflare", "--", "--from", archive, "--persist-to", targetState]), /Command failed/, "rerunning import must never overwrite a populated destination");
    run(["run", "export:cloudflare", "--", "--out", restoredArchive, "--persist-to", targetState]);

    const entities = JSON.parse(await readFile(join(archive, "entities.json"), "utf8"));
    const target = await platformFor(targetState);
    try {
      const restored = [];
      for (const table of entities.tables) {
        const rows = await target.env.DB.prepare(`SELECT * FROM ${quoted(table.name)} ORDER BY rowid`).all();
        restored.push({ name: table.name, dependsOn: table.dependsOn, rows: rows.results });
      }
      assert.deepEqual(restored, entities.tables);
      await assertSubscriberDeliveryHistory(target.env.DB);
      for (const name of ["sms_subscriptions","sms_settings","sms_consents","sms_inbound_events","sms_deliveries","sms_reporting_daily","subscriber_chat_destinations","subscriber_channel_posts","subscriber_tokens","channel_subscriber_events","component_notification_events","component_notification_deliveries","component_delivery_attempts","notification_delivery_attempts","mail_provider_webhook_events","mail_provider_routes","mail_provider_settings"]) assert.ok(entities.tables.find(table=>table.name===name)?.rows.length,`${name} must be represented by populated portable history`);
      assert.ok(entities.tables.find((table) => table.name === "page_settings")?.rows.length, "settings must be JSON entities in the archive");
      assert.ok(entities.tables.find((table) => table.name === "audit_entries")?.rows.length, "audit entries must be JSON entities in the archive");
      for (const name of ["components", "component_state_history", "incidents", "incident_updates", "incident_reports", "maintenance", "maintenance_notices", "subscribers", "notification_deliveries"]) {
        assert.ok(entities.tables.find((table) => table.name === name)?.rows.length, `${name} must be represented by a real entity row`);
      }
      const restoredLogo = await target.env.SNAPSHOTS.get("branding/original.png");
      assert.equal(restoredLogo?.httpMetadata?.contentType, "image/png");
      assert.equal(restoredLogo.httpMetadata.contentDisposition, "attachment; filename=brand.png");
      assert.equal(restoredLogo.httpMetadata.cacheControl, "public, max-age=60");
      assert.deepEqual(restoredLogo.customMetadata, { owner: "portable-brand" });
      assert.deepEqual(Buffer.from(await restoredLogo.arrayBuffer()), logo);
      await undoHistoryAfterRestore(target.env.DB,importedHistory);
    } finally {
      await target.dispose();
    }
    assert.deepEqual(
      JSON.parse(await readFile(join(restoredArchive, "entities.json"), "utf8")),
      entities,
      "a second export after import must preserve the entire entity graph",
    );
    // Archives from before subscriber reporting have no observed daily facts.
    // Restore their real inventory as a new baseline rather than inventing it
    // from historical creation dates.
    const legacyEntities = { ...entities, tables: entities.tables.filter(table => !table.name.startsWith("subscriber_reporting_")) };
    const legacyBytes = Buffer.from(JSON.stringify(legacyEntities));
    const legacyManifest = JSON.parse(originalManifest);
    legacyManifest.database.sha256 = createHash("sha256").update(legacyBytes).digest("hex");
    await writeFile(join(archive, "entities.json"), legacyBytes);
    await writeFile(manifestPath, JSON.stringify(legacyManifest));
    const legacyState = join(targetState, "legacy-copy");
    run(["run", "import:cloudflare", "--", "--from", archive, "--persist-to", legacyState]);
    const legacy = await platformFor(legacyState);
    try {
      const baseline = (await legacy.env.DB.prepare("SELECT channel, eligible FROM subscriber_reporting_baseline ORDER BY channel").all()).results;
      const actual = (await legacy.env.DB.prepare("SELECT channels.channel, COUNT(s.id) AS eligible FROM (SELECT 'email' AS channel UNION ALL SELECT 'webhook') channels LEFT JOIN subscribers s ON s.channel = channels.channel AND s.state IN ('pending', 'active') AND s.destination NOT LIKE 'deleted:%' GROUP BY channels.channel ORDER BY channels.channel").all()).results;
      assert.deepEqual(baseline, actual);
      assert.equal((await legacy.env.DB.prepare("SELECT COUNT(*) AS n FROM subscriber_reporting_daily").first()).n, 0);
      assert.ok((await legacy.env.DB.prepare("SELECT started_at FROM subscriber_reporting_tracking WHERE id = 1").first()).started_at);
    } finally { await legacy.dispose(); }
    await managedRoundTrip();
  } finally {
    await Promise.all([rm(sourceState, { recursive: true, force: true }), rm(targetState, { recursive: true, force: true }), rm(archive, { recursive: true, force: true }), rm(restoredArchive, { recursive: true, force: true })]);
  }
});


// A RER Managed installation exports and restores into a new Managed
// installation while each keeps its own Platform migration ledger.
async function managedRoundTrip() {
  const sandbox = await mkdtemp(join(tmpdir(), "lamp-managed-archive-"));
  const state = (name) => join(sandbox, name);
  const archive = join(sandbox, "archive");
  const sql = (name, command) => run(["exec", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", state(name), "--config", configPath, "--command", command]);
  const exportFrom = (name, out) => run(["run", "export:cloudflare", "--", "--out", out, "--persist-to", state(name)]);
  const importInto = (name, from = archive) => run(["run", "import:cloudflare", "--", "--from", from, "--persist-to", state(name)]);
  const refused = (action, reason) => assert.throws(action, (error) => reason.test(String(error.stderr)));
  async function read(name, query) {
    const platform = await platformFor(state(name));
    try { return (await platform.env.DB.prepare(query).all()).results; } finally { await platform.dispose(); }
  }
  const ledger = (name) => read(name, "SELECT name, sha256, applied_at FROM rer_migrations ORDER BY name");
  const mismatch = /does not list exactly this revision's migrations/;
  try {
    for (const name of ["source", "target", "fresh"]) await installManaged(state(name), { config: configPath, pageName: `Managed ${name}` });
    for (const [name, time] of [["target", "2026-10-19T06:00:00Z"], ["fresh", "2026-10-19T07:00:00Z"]]) sql(name, `UPDATE rer_migrations SET applied_at = '${time}'`);
    const source = await platformFor(state("source"));
    try { await populate(source.env); } finally { await source.dispose(); }
    const [sourceLedger, targetLedger, freshLedger] = await Promise.all(["source", "target", "fresh"].map(ledger));
    assert.equal(sourceLedger.filter((row) => row.name.startsWith("core-")).length, (await readdir("migrations/core")).filter((file) => file.endsWith(".sql")).length);
    assert.ok(sourceLedger.some((row) => row.name === "setup-initial-page.sql"), "Platform records the page initializer");
    assert.deepEqual(await read("source", "SELECT name FROM sqlite_master WHERE name = 'd1_migrations'"), [], "Platform installs carry only its own ledger");

    // Lamp 1.8.0 archived this ledger as owner data, refused the Managed
    // destination as non-empty, and its restore would have rewritten the ledger.
    exportFrom("source", archive);
    const entities = JSON.parse(await readFile(join(archive, "entities.json"), "utf8"));
    assert.ok(!entities.tables.some((table) => table.name === "rer_migrations"), "the ledger never travels");
    importInto("target");
    assert.deepEqual(await ledger("target"), targetLedger, "restore neither rewrites nor drops the destination's Platform history");
    const restoredHistory=await platformFor(state("target"));
    try {await assertSubscriberDeliveryHistory(restoredHistory.env.DB);} finally {await restoredHistory.dispose();}
    assert.deepEqual(await ledger("source"), sourceLedger);
    exportFrom("target", join(sandbox, "re-export"));
    assert.deepEqual(JSON.parse(await readFile(join(sandbox, "re-export", "entities.json"), "utf8")), entities, "re-export after restore is identical");
    assert.deepEqual(JSON.parse(await readFile(join(sandbox, "re-export", "manifest.json"), "utf8")).objects, JSON.parse(await readFile(join(archive, "manifest.json"), "utf8")).objects, "original image bytes and metadata round trip");
    refused(() => importInto("target"), /new RER Managed installation whose owner has not signed in/);

    // The ledger is checked on both doors, not skipped.
    const [first, last] = [sourceLedger[0], sourceLedger.findLast((row) => row.name.startsWith("core-"))];
    sql("source", `UPDATE rer_migrations SET sha256 = '${"0".repeat(64)}' WHERE name = '${first.name}'`);
    refused(() => exportFrom("source", join(sandbox, "tampered")), mismatch);
    sql("source", `UPDATE rer_migrations SET sha256 = '${first.sha256}' WHERE name = '${first.name}'`);
    for (const [tamper, undo] of [
      [`UPDATE rer_migrations SET sha256 = '${"0".repeat(64)}' WHERE name = '${first.name}'`, `UPDATE rer_migrations SET sha256 = '${first.sha256}' WHERE name = '${first.name}'`],
      [`UPDATE rer_migrations SET name = '${last.name}#0-1' WHERE name = '${last.name}'`, `UPDATE rer_migrations SET name = '${last.name}' WHERE name = '${last.name}#0-1'`],
      [`DELETE FROM rer_migrations WHERE name = '${last.name}'`, `INSERT INTO rer_migrations VALUES ('${last.name}', '${last.sha256}', '2026-10-19T07:00:00Z')`],
      ["INSERT INTO rer_migrations(name, sha256) VALUES ('core-9999_unrecognized.sql', '" + "1".repeat(64) + "')", "DELETE FROM rer_migrations WHERE name = 'core-9999_unrecognized.sql'"],
    ]) {
      sql("fresh", tamper);
      refused(() => importInto("fresh"), mismatch);
      sql("fresh", undo);
    }
    // Exact-name recognition: any other rer_ table is unknown on either side.
    sql("fresh", "CREATE TABLE rer_migrations_future (id TEXT)");
    refused(() => importInto("fresh"), /tables differ from the archive \(rer_migrations_future\)/);
    sql("fresh", "DROP TABLE rer_migrations_future");
    sql("source", "CREATE TABLE rer_migrations_future (id TEXT)");
    exportFrom("source", join(sandbox, "unknown"));
    refused(() => importInto("fresh", join(sandbox, "unknown")), /tables differ from the archive \(rer_migrations_future\)/);
    assert.deepEqual(await ledger("fresh"), freshLedger);
    assert.deepEqual(await read("fresh", "SELECT id FROM operators"), [], "refused restores write nothing");

    // A 1.8.0 archive that carried the source ledger as data restores without writing it.
    const legacy = { ...entities, tables: [...entities.tables, { name: "rer_migrations", dependsOn: [], rows: sourceLedger }] };
    const legacyBytes = Buffer.from(JSON.stringify(legacy));
    const legacyManifest = JSON.parse(await readFile(join(archive, "manifest.json"), "utf8"));
    legacyManifest.database.sha256 = createHash("sha256").update(legacyBytes).digest("hex");
    await writeFile(join(archive, "entities.json"), legacyBytes);
    await writeFile(join(archive, "manifest.json"), JSON.stringify(legacyManifest));
    importInto("fresh");
    assert.deepEqual(await ledger("fresh"), freshLedger);
    assert.deepEqual(await read("fresh", "SELECT id FROM operators"), [{ id: "operator-export" }]);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

test("owner sidecar migrations apply once and survive export/import/export", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "lamp-owner-portability-"));
  const original = process.cwd();
  const sourceState = join(sandbox, "source");
  const targetState = join(sandbox, "target");
  const archive = join(sandbox, "archive");
  const config = resolve(configPath);
  const execute = (args) => execFileSync("pnpm", args, { cwd: sandbox, stdio: "pipe", ...(args.includes("migrations") ? { maxBuffer: 8 * 1024 * 1024 } : {}) });
  try {
    await mkdir(join(sandbox, "migrations", "ext"), { recursive: true });
    await symlink(join(original, "migrations", "core"), join(sandbox, "migrations", "core"));
    await symlink(join(original, "node_modules"), join(sandbox, "node_modules"));
    await writeFile(join(sandbox, "package.json"), JSON.stringify({ private: true, packageManager: "pnpm@10.12.4" }));
    await writeFile(join(sandbox, "migrations", "ext", "0001_owner_labels.sql"), await readFile(join(original, "tests/e2e/fixtures/owner-portability.sql")));
    execute(["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", sourceState, "--config", config]);
    const migrationScript = `import { applyOwnerMigrations } from ${JSON.stringify(join(original, "scripts", "owner-migrations.mjs"))}; await applyOwnerMigrations(${JSON.stringify(config)}, ["--local", "--persist-to", ${JSON.stringify(sourceState)}]);`;
    for (let attempt = 0; attempt < 2; attempt++) execFileSync(process.execPath, ["--input-type=module", "-e", migrationScript], { cwd: sandbox, stdio: "pipe" });
    execute(["exec", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", sourceState, "--config", config, "--command", "DELETE FROM owner_labels WHERE id = 'deleted'; DELETE FROM owner_empty;"]);
    execute(["exec", "node", join(original, "scripts", "export.mjs"), "--config", config, "--persist-to", sourceState, "--out", archive]);
    // Corrupt the entity graph with a valid checksum: FK enforcement must
    // reject it, roll back all data writes, and restore application triggers.
    const entitiesPath = join(archive, "entities.json");
    const manifestPath = join(archive, "manifest.json");
    const validEntities = await readFile(entitiesPath);
    const validManifest = await readFile(manifestPath);
    const invalid = JSON.parse(validEntities);
    invalid.tables.find((table) => table.name === "owner_tree").rows[0].parent = "absent-parent";
    const invalidBytes = Buffer.from(JSON.stringify(invalid));
    const invalidManifest = JSON.parse(validManifest);
    invalidManifest.database.sha256 = createHash("sha256").update(invalidBytes).digest("hex");
    await writeFile(entitiesPath, invalidBytes);
    await writeFile(manifestPath, JSON.stringify(invalidManifest));
    const failedState = join(sandbox, "invalid-graph");
    assert.throws(() => execute(["exec", "node", join(original, "scripts", "import.mjs"), "--config", config, "--persist-to", failedState, "--from", archive]), /Command failed/);
    const failedRows = JSON.parse(execute(["exec", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", failedState, "--config", config, "--json", "--command", "SELECT id FROM owner_labels ORDER BY id; SELECT name FROM sqlite_master WHERE type='trigger' AND name='owner_label_insert'; PRAGMA foreign_key_check;"]).toString());
    assert.deepEqual(failedRows[0].results, [{ id: "deleted" }, { id: "owner-1" }], "failed restore rolls back to migration seed rows");
    assert.deepEqual(failedRows[1].results, [{ name: "owner_label_insert" }], "failed restore restores triggers transactionally");
    assert.deepEqual(failedRows[2].results, [], "invalid references never commit");
    await writeFile(entitiesPath, validEntities);
    await writeFile(manifestPath, validManifest);
    const laterMigration = join(sandbox, "migrations", "ext", "0002_backfill_owner_labels.sql");
    await writeFile(laterMigration, "UPDATE owner_labels SET label = 'Backfilled owner intent';");
    assert.throws(() => execute(["exec", "node", join(original, "scripts", "import.mjs"), "--config", config, "--persist-to", targetState, "--from", archive]), /Command failed/, "restoring an older archive must not run later backfills against an empty table and then mark them applied");
    await rm(laterMigration);
    execute(["exec", "node", join(original, "scripts", "import.mjs"), "--config", config, "--persist-to", targetState, "--from", archive]);
    const restored = join(sandbox, "restored");
    execute(["exec", "node", join(original, "scripts", "export.mjs"), "--config", config, "--persist-to", targetState, "--out", restored]);
    const entities = JSON.parse(await readFile(join(archive, "entities.json"), "utf8"));
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_labels").rows, [{ id: "owner-1", label: "Preserve this owner intent" }]);
    assert.deepEqual(JSON.parse(await readFile(join(restored, "entities.json"), "utf8")), entities);
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_compound").rows, [{ category: "a", name: "first", value: "Owner value A" }, { category: "b", name: "second", value: "Owner value B" }]);
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_empty").rows, []);
    assert.deepEqual(entities.tables.find((table) => table.name === "xcf_owner").rows, [{ id: "Must not be mistaken for a reserved table" }]);
    assert.deepEqual(entities.tables.find((table) => table.name === "sqliteXowner").rows, [{ id: "Owner table, not SQLite metadata" }]);
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_changes").rows, []);
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_generated").rows, [{ id: "generated", qty: 3, total: 6 }]);
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_tree").rows, [{ id: "a-child", parent: "z-parent" }, { id: "z-parent", parent: null }]);
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_left").rows, [{ id: "left", right_id: "right" }]);
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_right").rows, [{ id: "right", left_id: "left" }]);
    const triggerOutput = execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", targetState, "--config", config, "--json", "--command", "INSERT INTO owner_labels VALUES ('after-restore', 'Trigger remains active'); SELECT label FROM owner_changes"], { cwd: sandbox, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    assert.match(triggerOutput, /Trigger remains active/);
    assert.equal(JSON.parse(await readFile(join(archive, "manifest.json"), "utf8")).ownerMigrations.length, 1);
  } finally { await rm(sandbox, { recursive: true, force: true }); }
});
