import assert from "node:assert/strict";
import { openSubscriberManagementFixture, eventuallySubscriber, pageOrigin } from "./subscriber-management-fixture.mjs";

/** Only bulk population is setup SQL. The limits, refusal, row accounting,
 * operator messages and recovery below are exercised through product doors. */
export async function seedSubscriberLimitFixture(db,start,count,channel="email") {
  const now=new Date().toISOString();
  await db.prepare(`WITH RECURSIVE sequence(n) AS (SELECT ? UNION ALL SELECT n+1 FROM sequence WHERE n<?)
    INSERT INTO subscribers(id,channel,chat_kind,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at)
    SELECT '01JLIMIT' || printf('%018d',n),?,?,CASE WHEN ?='email' THEN 'synthetic-lamp-limit-' || n || '@example.test'
      ELSE 'https://receiver.example.test/synthetic-lamp-limit-' || n END,NULL,'active','all','synthetic-lamp-limit-token-' || n,?,? FROM sequence`)
    .bind(start,start+count-1,channel === "slack" || channel === "teams" ? "webhook" : channel,channel === "slack" || channel === "teams" ? channel : null,channel,now,now).run();
}
export const subscriberLimitSourceFiles=(count)=>[
  {name:"page.json",text:JSON.stringify({id:"synthetic-lamp-limit-page",name:"Synthetic Lamp source",viewers_must_be_team_members:false,ip_restrictions:null})},
  {name:"page-access-groups.json",text:"[]"},
  {name:"components.json",text:JSON.stringify([{id:"synthetic-lamp-limit-component",name:"Synthetic Lamp imported API",position:1,status:"operational",created_at:"2026-10-01T00:00:00.000Z"}])},
  {name:"subscribers.json",text:JSON.stringify(Array.from({length:count},(_,index)=>({id:`synthetic-lamp-limit-import-${index}`,mode:"email",email:`synthetic-lamp-limit-import-${index}@example.test`,components:[],created_at:"2026-10-01T00:00:00.000Z"})))},
];

/** Saturate the capacity declared by this installation, refuse without a
 * partial CSV write or email, then free a real subscription and admit again. */
export async function subscriberLimitsFlow() {
  const fixture = await openSubscriberManagementFixture();
  try {
    const { api, post, db } = fixture;
    const capacity = (await api('/api/app/subscribers?limit=1')).body.capacity;
    const all = capacity.find(row => row.channel === 'all');
    assert.ok(all && all.limit > all.count);
    await seedSubscriberLimitFixture(db, 1, all.limit - all.count - 1);
    const address = 'capacity-reader@example.test';
    const subscribe = email => fixture.raw(pageOrigin + '/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: new URLSearchParams({ email }) });
    assert.equal((await subscribe(address)).status, 202);
    const current = (await api('/api/app/subscribers?limit=1')).body.capacity.find(row => row.channel === 'all');
    assert.equal(current.count, current.limit);
    const mailBefore = fixture.messages.length;
    const answers = [];
    for (const email of [address, 'new-capacity-reader@example.test']) {
      const denied = await subscribe(email); assert.equal(denied.status, 409);
      const html = await denied.text(); answers.push(html);
      assert.ok(html.includes('/feed.atom') && html.includes('/feed.rss'), 'a full page still offers public feeds');
    }
    assert.equal(answers[0], answers[1], 'capacity refusals cannot enumerate addresses');
    assert.equal(fixture.messages.length, mailBefore, 'full capacity sends no confirmation or management email');
    const csv = subscriberCsvInput('over-capacity@example.test');
    const before = await fixture.databaseState();
    const preview = await post('/api/app/subscribers/import/preview', { csv });
    assert.equal(preview.status, 200, preview.text);
    assert.equal(preview.body.counts.refused, 1);
    assert.ok(preview.body.limits.length);
    const apply = await post('/api/app/subscribers/import/apply', { csv, reviewedFingerprint: preview.body.fingerprint });
    assert.equal(apply.status, 409, apply.text);
    await fixture.assertUnchanged(before);
    const row = await db.prepare('SELECT id FROM subscribers WHERE destination=?').bind(address).first();
    assert.equal((await api(`/api/app/subscribers/${row.id}`, { method: 'DELETE' })).status, 204);
    const fitting = await post('/api/app/subscribers/import/preview', { csv });
    assert.equal(fitting.body.counts.created, 1);
    assert.equal((await post('/api/app/subscribers/import/apply', { csv, reviewedFingerprint: fitting.body.fingerprint })).status, 200);
    const fullAgain = (await api('/api/app/subscribers?limit=1')).body.capacity.find(row => row.channel === 'all');
    assert.equal(fullAgain.count, fullAgain.limit);
  } finally { await fixture.close(); }
}

const subscriberCsvInput = email => `email\r\n${email}\r\n`;
