import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';

function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const value = text[index];
    if (value === '"') { if (quoted && text[index + 1] === '"') { field += '"'; index++; } else quoted = !quoted; }
    else if (value === ',' && !quoted) { row.push(field); field = ''; }
    else if ((value === '\r' || value === '\n') && !quoted) { if (value === '\r' && text[index + 1] === '\n') index++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += value;
  }
  if (row.length || field) { row.push(field); rows.push(row); }
  const [header, ...values] = rows;
  return values.map(values => Object.fromEntries(header.map((key, index) => [key, values[index]])));
}

/** Compose into an existing publishing/delivery case: real migrated D1 + Hono
 * read routes, fixture facts only. Creates no test cases, processes or servers.
 */
export async function communicationPerformanceFlow({ vite, bindings }) {
  const { createCommunicationPerformanceRepository, createCommunicationPerformanceService, registerCommunicationPerformanceRoutes } = await vite.ssrLoadModule('/src/core/features/communication-performance/index.ts');
  const { createSubscriberRepository } = await vite.ssrLoadModule('/src/core/features/subscribers/repository.ts');
  const db = bindings.DB, prefix = `performance-${randomUUID()}`, actor = `${prefix}-operator`;
  const measuredAt = '2024-04-15T00:00:00.000Z';
  const original = await db.prepare("SELECT timezone FROM page_settings WHERE id = 'default'").first();
  assert.ok(original, 'The existing publishing/delivery fixture configures page settings');
  const ids = [], subscribers = [];
  const app = new Hono();
  registerCommunicationPerformanceRoutes(app, createCommunicationPerformanceService(createCommunicationPerformanceRepository(db), undefined, () => measuredAt));
  const read = async path => {
    const response = await app.request(`https://app.example.test/api/app${path}`);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  };
  const incident = async (name, openedAt, resolvedAt = null, createdAt = openedAt) => {
    const id = `${prefix}-${name}`; ids.push(id);
    await db.prepare(`INSERT INTO incidents(id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,created_at,updated_at,peak_impact) VALUES(?,?,?,?,?,?,?,?,?,'Major outage')`).bind(id, `INC-9${id}`, name, resolvedAt ? 'Resolved' : 'Investigating', openedAt, resolvedAt, actor, createdAt, createdAt).run();
    return id;
  };
  const update = async (incidentId, name, publishedAt, nextUpdateAt, { createdAt = publishedAt, retroactive = false, resolved = false } = {}) => {
    const id = `${prefix}-${name}`;
    await db.prepare(`INSERT INTO incident_updates(id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,is_retroactive,created_at,updated_at) VALUES(?,?,?,'All customers','Requests unavailable','','',?,?,?,?,?,?)`).bind(id,incidentId,resolved?'Resolved':'Investigating',nextUpdateAt,publishedAt,actor,Number(retroactive),createdAt,createdAt).run();
    return id;
  };
  const alert = async (incidentId, at) => {
    await db.prepare(`INSERT INTO alert_receipts(id,source_id,request_hash,deduplication_key,incident_id,state,received_at,payload_json,error,created_at,updated_at) VALUES(?,?,?,?,?,'firing',?,'{}',NULL,?,?)`).bind(`${incidentId}-alert`,`${prefix}-source`,incidentId,incidentId,incidentId,at,at,at).run();
  };
  try {
    await db.prepare("UPDATE page_settings SET timezone='America/New_York' WHERE id='default'").run();
    await db.prepare('INSERT INTO operators(id,email,display_name,is_setup_operator,created_at,updated_at) VALUES(?,?,?,0,?,?)').bind(actor,`${prefix}@example.test`,'Performance operator',measuredAt,measuredAt).run();
    await db.prepare(`INSERT INTO alert_sources(id,name,credential_kind,signing_secret,bearer_token_hash,timestamp_header,signature_header,deduplication_path,title_path,state_path,recovered_value,created_by_operator_id,created_at,updated_at) VALUES(?,?,'bearer-token',NULL,'fixture','timestamp','signature','id','title','state','resolved',?,?,?)`).bind(`${prefix}-source`,`${prefix} alerts`,actor,measuredAt,measuredAt).run();
    const first = await incident('first','2024-03-03T09:00:00.000Z','2024-03-03T10:14:00.000Z');
    const second = await incident('second','2024-03-05T09:00:00.000Z','2024-03-05T10:24:00.000Z');
    const third = await incident('third','2024-03-01T05:00:00.000Z','2024-03-01T05:15:00.000Z');
    await incident('before','2024-03-01T04:59:59.999Z');
    await incident('after','2024-04-01T04:00:00.000Z');
    await alert(first,'2024-03-03T10:00:00.000Z'); await alert(second,'2024-03-05T10:00:00.000Z'); await alert(third,'2024-03-01T05:00:00.000Z');
    const firstUpdate = await update(first,'first-initial','2024-03-03T10:05:00.000Z','2024-03-03T10:15:00.000Z');
    const firstFollowup = await update(first,'first-followup','2024-03-03T10:14:00.000Z',null,{resolved:true});
    await update(second,'second-initial','2024-03-05T10:07:00.000Z','2024-03-05T10:20:00.000Z');
    await update(second,'second-followup','2024-03-05T10:24:00.000Z',null,{resolved:true});
    await update(third,'third-initial','2024-03-01T05:02:00.000Z','2024-03-01T05:15:00.000Z');
    await update(third,'third-followup','2024-03-01T05:15:00.000Z',null,{resolved:true});
    const month = await read('/communication-performance?month=2024-03');
    assert.equal(month.timezone,'America/New_York');
    assert.equal(month.startsAt,'2024-03-01T05:00:00.000Z'); assert.equal(month.endsAt,'2024-04-01T04:00:00.000Z');
    assert.deepEqual(new Set(month.incidents.map(row=>row.incidentId)),new Set([first,second,third]));
    assert.deepEqual(month.summary.commitments,{kept:2,missed:1,pending:0,evaluated:3,keptRate:2/3});
    assert.equal(month.summary.knownFirstUpdateLatencyCount,3);
    assert.equal(month.summary.firstUpdateLatencyTotalMs,14*60000);
    assert.equal(month.summary.reportsOwed,3);
    assert.equal(month.incidents.find(row=>row.incidentId===first).firstUpdateLatencyMs,5*60000);
    assert.equal(month.incidents.find(row=>row.incidentId===second).firstUpdateLatencyMs,7*60000);
    assert.equal(month.incidents.find(row=>row.incidentId===third).firstUpdateLatencyMs,2*60000);
    assert.equal(month.incidents.find(row=>row.incidentId===first).resolutionDurationMs,74*60000);

    // Late backdating must not turn the missed promise into an on-time one.
    await update(second,'backdated','2024-03-05T10:19:00.000Z',null,{createdAt:'2024-03-06T00:00:00.000Z',retroactive:true});
    const filtered=await read(`/communication-performance?month=2024-03&incidentId=${encodeURIComponent(second)}`);
    assert.equal(filtered.summary.incidentCount,1);assert.equal(filtered.summary.commitments.missed,1);
    const pending=await incident('pending','2024-03-25T10:00:00.000Z');
    await update(pending,'pending-initial','2024-03-25T10:00:00.000Z','2024-05-01T00:00:00.000Z');
    const pendingResult=await read(`/incidents/${pending}/reach`);assert.equal(pendingResult.incident.commitments.pending,1);assert.equal(pendingResult.incident.commitments.evaluated,0);assert.equal(pendingResult.incident.firstUpdateLatencyMs,null,'Manual opening never substitutes for an accepted alert');
    const overdue=await incident('overdue','2024-03-26T10:00:00.000Z');
    await update(overdue,'overdue-initial','2024-03-26T10:00:00.000Z','2024-03-26T10:15:00.000Z');
    assert.equal((await read(`/incidents/${overdue}/reach`)).incident.commitments.missed,1);

    const importedAt='2024-04-02T00:00:00.000Z', imported=await incident('imported','2024-03-12T10:00:00.000Z','2024-03-12T11:00:00.000Z',importedAt);
    await db.prepare("INSERT INTO statuspage_import_targets(kind,id,revision) VALUES('incident',?,'fixture')").bind(imported).run();
    await update(imported,'imported-update','2024-03-12T11:00:00.000Z',null,{createdAt:importedAt,retroactive:true,resolved:true});
    const historical=await read(`/incidents/${imported}/reach`);
    assert.equal(historical.incident.firstUpdateLatencyMs,null);
    assert.equal(historical.incident.channels[0].committed,null);assert.equal(historical.incident.channels[0].coverage,'unknown');
    const importedCsv=await app.request(`https://app.example.test/api/app/incidents/${imported}/reach?format=csv`);
    assert.equal(parseCsv(await importedCsv.text()).find(row=>row.scope==='update'&&row.channel==='email').committed,'unknown');

    for (const channel of ['email','webhook']) await db.prepare('INSERT INTO notification_channel_selections(incident_update_id,channel,created_at) VALUES(?,?,?)').bind(firstUpdate,channel,'2024-03-03T10:05:00.000Z').run();
    for(let index=0;index<12;index++) {
      const subscriber=`${prefix}-subscriber-${index}`,channel=index<10?'email':'webhook',delivery=`${prefix}-delivery-${index}`;
      subscribers.push(subscriber);
      await db.prepare("INSERT INTO subscribers(id,channel,destination,state,selection_mode,token_hash,created_at,updated_at) VALUES(?,?,?,'active','all',?,?,?)").bind(subscriber,channel,channel==='email'?`${subscriber}@example.test`:`https://example.test/${subscriber}`,subscriber,measuredAt,measuredAt).run();
      await db.prepare(`INSERT INTO notification_deliveries(id,subscriber_id,incident_update_id,channel,outcome,queued_at,outcome_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(delivery,subscriber,firstUpdate,channel,index===0?'bounced':'delivered','2024-03-03T10:05:00.000Z','2024-03-03T10:06:00.000Z','2024-03-03T10:05:00.000Z','2024-03-03T10:06:00.000Z').run();
      if(channel==='email') for(let attempt=1;attempt<=2;attempt++) await db.prepare('INSERT INTO notification_delivery_attempts(id,delivery_id,attempt_number,attempted_at,provider_message_id,error,created_at) VALUES(?,?,?,?,?,NULL,?)').bind(`${delivery}-${attempt}`,delivery,attempt,'2024-03-03T10:05:30.000Z',`${delivery}-accepted`,'2024-03-03T10:05:30.000Z').run();
    }
    const reach=await read(`/incidents/${first}/reach?updateId=${firstUpdate}`),email=reach.updates[0].channels.find(row=>row.channel==='email'),webhook=reach.updates[0].channels.find(row=>row.channel==='webhook');
    assert.equal(reach.updates.length,1);assert.equal(email.committed,10);assert.equal(email.delivered,9);assert.equal(email.bounced,1);assert.equal(email.providerAccepted,10,'Two attempts never double the accepted count');assert.equal(webhook.committed,2);assert.equal(webhook.delivered,2);
    const csv=await app.request(`https://app.example.test/api/app/incidents/${first}/reach?format=csv`),csvRows=parseCsv(await csv.text()),csvEmail=csvRows.find(row=>row.scope==='update'&&row.update_id===firstUpdate&&row.channel==='email');
    assert.equal(csvEmail.committed,'10');assert.equal(csvEmail.delivered,'9');assert.equal(csvEmail.bounced,'1');assert.equal(csvEmail.provider_accepted,'10');
    // A provider acceptance without a signed receipt remains queued.
    await db.prepare("UPDATE notification_deliveries SET outcome='queued' WHERE id=?").bind(`${prefix}-delivery-1`).run();
    const acceptedOnly=(await read(`/incidents/${first}/reach`)).updates.find(row=>row.updateId===firstUpdate).channels[0];
    assert.equal(acceptedOnly.providerAccepted,10);assert.equal(acceptedOnly.delivered,8);assert.equal(acceptedOnly.queued,1);
    // Same subscribers on a second update: send counts grow, distinct reach does not.
    await db.prepare(`INSERT INTO notification_deliveries(id,subscriber_id,incident_update_id,channel,outcome,queued_at,outcome_at,created_at,updated_at) SELECT id||'-followup',subscriber_id,?,channel,outcome,queued_at,outcome_at,created_at,updated_at FROM notification_deliveries WHERE incident_update_id=?`).bind(firstFollowup,firstUpdate).run();
    const dedup=await read(`/incidents/${first}/reach`),dedupEmail=dedup.incident.channels[0];
    assert.equal(dedupEmail.committed,20);assert.equal(dedupEmail.distinctCommitted,10);assert.equal(dedupEmail.distinctDelivered,8);
    const beforeErasure=dedup.incident.channels;
    await createSubscriberRepository(db).anonymizeAndDeactivate(subscribers[2],actor,measuredAt);
    assert.deepEqual((await read(`/incidents/${first}/reach`)).incident.channels,beforeErasure,'Erasing a destination preserves opaque reach facts');
    const monthlyCsv=await app.request('https://app.example.test/api/app/communication-performance?month=2024-03&format=csv');assert.equal(monthlyCsv.status,200);assert.match(monthlyCsv.headers.get('content-type'),/text\/csv/);
    assert.equal(parseCsv(await monthlyCsv.text()).find(row=>row.scope==='month'&&row.channel==='email').distinct_committed,'10');
    assert.equal((await app.request('https://app.example.test/api/app/communication-performance?month=2024-13')).status,400);
    assert.equal((await app.request(`https://app.example.test/api/app/incidents/${first}/reach?updateId=absent`)).status,404);
  } finally {
    for(const id of ids) {
      await db.prepare('DELETE FROM notification_delivery_attempts WHERE delivery_id IN (SELECT d.id FROM notification_deliveries d JOIN incident_updates u ON u.id=d.incident_update_id WHERE u.incident_id=?)').bind(id).run();
      await db.prepare('DELETE FROM notification_deliveries WHERE incident_update_id IN (SELECT id FROM incident_updates WHERE incident_id=?)').bind(id).run();
      await db.prepare('DELETE FROM notification_channel_selections WHERE incident_update_id IN (SELECT id FROM incident_updates WHERE incident_id=?)').bind(id).run();
      await db.prepare('DELETE FROM incident_updates WHERE incident_id=?').bind(id).run();
      await db.prepare('DELETE FROM alert_receipts WHERE incident_id=?').bind(id).run();
      await db.prepare("DELETE FROM statuspage_import_targets WHERE kind='incident' AND id=?").bind(id).run();
      await db.prepare('DELETE FROM incidents WHERE id=?').bind(id).run();
    }
    for(const subscriber of subscribers) {
      await db.prepare("DELETE FROM audit_entries WHERE entity_type='subscriber' AND entity_id=?").bind(subscriber).run();
      await db.prepare('DELETE FROM subscribers WHERE id=?').bind(subscriber).run();
    }
    await db.prepare('DELETE FROM alert_sources WHERE id=?').bind(`${prefix}-source`).run();
    await db.prepare('DELETE FROM operators WHERE id=?').bind(actor).run();
    await db.prepare("UPDATE page_settings SET timezone=? WHERE id='default'").bind(original.timezone).run();
  }
}
