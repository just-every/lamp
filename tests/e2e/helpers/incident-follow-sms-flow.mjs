import assert from "node:assert/strict";

/** SUB-019 reuses the enabled SMS opt-in and signed STOP transport unchanged. */
export async function incidentFollowSmsFlow({ fixture, publish, inbound, flush, messagesFor, component, pageOrigin }) {
  const { api, post, raw, db } = fixture;
  const initial = await publish(component, "Synthetic Lamp SMS-follow initial update.");
  const incident = initial.incident;
  const phone = "+12025550177";
  const subscribed = await raw(`${pageOrigin}/subscribe/incident`, { method: "POST", headers: { Origin: pageOrigin, Accept: "text/html", "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "192.0.2.177" }, body: new URLSearchParams({ incidentId: incident.id, channel: "sms", phone }).toString() });
  assert.equal(subscribed.status, 202, await subscribed.text());
  assert.equal(messagesFor(phone).length, 1, "an enabled incident SMS form sends only its existing YES opt-in");
  assert.equal((await inbound(phone, "YES")).status, 200);
  const subscriber = (await fixture.list()).find(row => row.destination === phone);
  assert.equal(subscriber.state, "active");
  assert.equal(subscriber.incident.reference, incident.reference);
  const update = async impact => {
    const saved = await api(`/api/app/incidents/${incident.id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle: "Identified", affectedAudience: "Synthetic Lamp incident followers", customerImpact: impact, whatStillWorks: "The status page is available.", details: "The operator reviewed this update.", nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString() }) });
    assert.equal(saved.status, 200, saved.text);
    const sent = await post(`/api/app/incidents/${incident.id}/publish`, { channels: [] });
    assert.equal(sent.status, 200, sent.text);
    await flush();
  };
  const beforeNext = messagesFor(phone).length;
  await update("Synthetic Lamp SMS-follow next update.");
  assert.equal(messagesFor(phone).length, beforeNext + 1, "the followed incident notifies SMS even when a page-wide channel is not selected");
  const beforeOther = messagesFor(phone).length;
  await publish(component, "Synthetic Lamp SMS-follow other incident on the same component.");
  assert.equal(messagesFor(phone).length, beforeOther, "another incident on the same component sends no SMS to this follower");
  const stopped = await inbound(phone, "STOP");
  assert.equal(stopped.status, 200, await stopped.text());
  const ended = await db.prepare("SELECT ended_at,final_event_id FROM incident_subscriptions WHERE subscriber_id=?").bind(subscriber.id).first();
  assert.ok(ended.ended_at, "signed STOP ends incident following in the same consent transaction");
  assert.equal(ended.final_event_id, null);
  assert.equal((await fixture.list()).find(row => row.id === subscriber.id).state, "deactivated");
  const afterStop = messagesFor(phone).length;
  await update("Synthetic Lamp SMS-follow publication after STOP.");
  assert.equal(messagesFor(phone).length, afterStop, "an ended incident SMS subscription sends nothing after STOP");
  const result = await (await fixture.runtime.getWorker()).scheduled({ cron: "* * * * *", scheduledTime: Date.parse(ended.ended_at) + 86_400_000 });
  assert.equal(result.outcome, "ok");
  for (const [table, data] of await fixture.databaseState()) assert.ok(!data.includes(phone), `the stopped incident number is erased from ${table} within 24 hours`);
}
