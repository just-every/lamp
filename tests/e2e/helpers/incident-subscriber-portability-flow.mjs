import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/** Archive setup is a fixture, as for the existing portable metric/provider
 * records. The proof crosses rer export/import, then the native token page. */
export async function preparePortableIncidentSubscribers({ db, codec, now }) {
  const active = "synthetic-lamp-portable-incident-reader", ended = "synthetic-lamp-portable-ended-reader";
  const address = "synthetic-lamp-portable-follower@example.test";
  const destination = `incident:synthetic-lamp-1:email:${createHash("sha256").update(address).digest("base64url")}`;
  const reportIncident = "synthetic-lamp-portable-report-incident", reportId = "synthetic-lamp-portable-report";
  const reportDeliveryId = "synthetic-lamp-portable-report-delivery";
  const actor = (await db.prepare("SELECT created_by_operator_id AS id FROM incidents WHERE id='synthetic-lamp-1'").first()).id;
  const token = await codec.encode({ id: "synthetic-lamp-portable-incident-token", scope: "manage" });
  await db.batch([
    db.prepare("INSERT INTO subscribers(id,channel,destination,state,selection_mode,token_hash,created_at,updated_at) VALUES(?,'email',?,'active','all','synthetic-lamp-portable-hash',?,?)").bind(active,destination,now,now),
    db.prepare("INSERT INTO incident_subscriptions(subscriber_id,incident_id,destination,include_report,resolution_delivered_at,ended_at,final_event_id,created_at) VALUES(?,'synthetic-lamp-1',?,1,NULL,NULL,NULL,?)").bind(active,address,now),
    db.prepare("INSERT INTO subscriber_tokens(id,subscriber_id,scope,token_hash,created_at,updated_at) VALUES('synthetic-lamp-portable-incident-token',?,'manage',?,?,?)").bind(active,await codec.hash(token),now,now),
    db.prepare("INSERT INTO incidents(id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,created_at,updated_at) VALUES(?,'INC-9002','Synthetic Lamp portable report','Resolved',?,?,?,?,?)").bind(reportIncident,now,now,actor,now,now),
    db.prepare("INSERT INTO incident_updates(id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,published_at,author_operator_id,created_at,updated_at) VALUES('synthetic-lamp-portable-resolution',?,'Resolved','Synthetic Lamp readers','Service restored.','','Report follows.',?,?,?,?)").bind(reportIncident,now,actor,now,now),
    db.prepare("INSERT INTO incident_reports(id,incident_id,summary,timeline,cause,remediation,published_at,author_operator_id,created_at,updated_at) VALUES(?,?,'Portable summary','Portable timeline','Portable cause','Portable remedy',?,?,?,?)").bind(reportId,reportIncident,now,actor,now,now),
    db.prepare("INSERT INTO subscribers(id,channel,destination,state,selection_mode,token_hash,deactivation_reason,deactivated_at,created_at,updated_at) VALUES(?,'email','synthetic-lamp-portable-ended','deactivated','all','synthetic-lamp-ended-hash','incident follow ended',?,?,?)").bind(ended,now,now,now),
    db.prepare("INSERT INTO incident_subscriptions(subscriber_id,incident_id,destination,include_report,resolution_at,resolution_delivered_at,ended_at,final_event_id,created_at) VALUES(?,?,'synthetic-lamp-ended@example.test',1,?,?,?,?,?)").bind(ended,reportIncident,now,now,now,reportId,now),
    db.prepare("INSERT INTO report_notification_deliveries(id,subscriber_id,channel,outcome,queued_at,outcome_at,created_at,updated_at,notification_event_id,notification_event_type,incident_report_id,mail_payload_json) VALUES(?,?,'email','delivered',?,?,?,?,?,'incident-report',?,?)").bind(reportDeliveryId,ended,now,now,now,now,reportId,reportId,JSON.stringify({to:'synthetic-lamp-ended@example.test',subject:'Synthetic portable report',text:'Portable report wording'})),
    db.prepare("INSERT INTO report_delivery_attempts(id,delivery_id,attempt_number,attempted_at,provider_message_id,created_at) VALUES('synthetic-lamp-portable-report-attempt',?,1,?,'synthetic-lamp-portable-report-message',?)").bind(reportDeliveryId,now,now),
    db.prepare("INSERT INTO mail_provider_webhook_events(id,provider_event_id,provider_message_id,event_type,received_at,created_at,applied_at,report_delivery_id) VALUES('synthetic-lamp-portable-report-callback','synthetic-lamp-portable-report-event','synthetic-lamp-portable-report-message','delivered',?,?,?,?)").bind(now,now,now,reportDeliveryId),
    db.prepare("UPDATE incident_follow_settings SET include_report=0 WHERE id=1"),
  ]);
  const rows = (await db.prepare("SELECT * FROM incident_subscriptions ORDER BY subscriber_id").all()).results.map(row=>({...row}));
  const reportDelivery = {...await db.prepare("SELECT * FROM report_notification_deliveries WHERE id=?").bind(reportDeliveryId).first()};
  const reportAttempts = (await db.prepare("SELECT * FROM report_delivery_attempts WHERE delivery_id=?").bind(reportDeliveryId).all()).results.map(row=>({...row}));
  const reportCallback = {...await db.prepare("SELECT * FROM mail_provider_webhook_events WHERE report_delivery_id=?").bind(reportDeliveryId).first()};
  return { active, ended, address, token, rows, reportDelivery, reportAttempts, reportCallback };
}

export async function assertPortableIncidentSubscribers({ db, subscriberApp, origin, expected }) {
  assert.deepEqual((await db.prepare("SELECT * FROM incident_subscriptions ORDER BY subscriber_id").all()).results.map(row=>({...row})), expected.rows, "native archive retains the incident scope, report choice, resolution/ending instants and address");
  assert.deepEqual({...await db.prepare("SELECT * FROM report_notification_deliveries WHERE id=?").bind(expected.reportDelivery.id).first()},expected.reportDelivery,"native archive retains the final report's original delivery, frozen envelope and outcome");
  assert.deepEqual((await db.prepare("SELECT * FROM report_delivery_attempts WHERE delivery_id=?").bind(expected.reportDelivery.id).all()).results.map(row=>({...row})),expected.reportAttempts,"native archive retains final report attempts and provider acceptance identity");
  assert.deepEqual({...await db.prepare("SELECT * FROM mail_provider_webhook_events WHERE report_delivery_id=?").bind(expected.reportDelivery.id).first()},expected.reportCallback,"native archive retains the final report callback mapping without rebinding it to an incident delivery");
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM notification_delivery_records WHERE id=?").bind(expected.reportDelivery.id).first()).count,1,"the logical delivery view reads the restored report once");
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM notification_attempt_records WHERE delivery_id=?").bind(expected.reportDelivery.id).first()).count,1,"the logical attempt view reads the restored report attempt once");
  assert.equal((await db.prepare("SELECT include_report FROM incident_follow_settings WHERE id=1").first()).include_report,0,"the owner's report choice survives the seeded settings row on restore");
  assert.deepEqual({...await db.prepare("SELECT destination,state FROM subscriber_directory WHERE id=?").bind(expected.active).first()},{destination:expected.address,state:"active"},"the logical recipient address survives without broadening the subscription");
  const response = await subscriberApp.fetch(new Request(origin + "/manage/" + expected.token));
  assert.equal(response.status,200,"the original token still controls its own restored incident subscription");
  assert.match(await response.text(),/Following INC-9001/u);
}
