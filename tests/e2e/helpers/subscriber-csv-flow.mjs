import assert from 'node:assert/strict';
import { openSubscriberManagementFixture, subscriberCsv, subscriberCsvRows, eventuallySubscriber } from './subscriber-management-fixture.mjs';
import { subscriberLimitsFlow } from './subscriber-limits-flow.mjs';

/** An owner reviews a mixed CSV, imports silently, explicitly invites, then
 * observes consent and real selected delivery. The source bytes are the input;
 * no file layout, wording or implementation fingerprint is pinned. */
export async function subscriberCsvFlow() {
  const fixture = await openSubscriberManagementFixture();
  try {
    const { api, post, list, messagesFor } = fixture;
    const component = await fixture.createComponent('Imported API');
    const email = '+imported-reader@example.test', contact = 'hook-owner@example.test';
    const destination = 'https://receiver.example.test/synthetic-lamp-1';
    const csv = subscriberCsv(['email', 'webhook_url', 'contact_email', 'components'], [
      [email, '', '', component.id],
      ['', destination, contact, component.id],
      ['invalid-address', '', '', component.id],
      [email, '', '', component.id],
    ]);
    assert.equal((await fixture.raw('/api/app/subscribers/import/preview', { method: 'POST', body: JSON.stringify({ csv }) })).status, 401);
    const before = await fixture.databaseState(), mailBefore = fixture.messages.length;
    const preview = await post('/api/app/subscribers/import/preview', { csv });
    assert.equal(preview.status, 200, preview.text);
    assert.deepEqual(preview.body.counts, { created: 2, refused: 1, skipped: 1 });
    assert.ok(preview.body.rows.find(row => row.outcome === 'refused').reason);
    await fixture.assertUnchanged(before);
    const changed = await post('/api/app/subscribers/import/apply', { csv: csv.replace(email, 'changed@example.test'), reviewedFingerprint: preview.body.fingerprint });
    assert.equal(changed.status, 409, changed.text);
    await fixture.assertUnchanged(before);
    const applied = await post('/api/app/subscribers/import/apply', { csv, reviewedFingerprint: preview.body.fingerprint });
    assert.equal(applied.status, 200, applied.text);
    assert.deepEqual(applied.body.counts, preview.body.counts);
    const pending = await list();
    assert.equal(pending.length, 2);
    assert.ok(pending.every(row => row.state === 'pending' && row.componentSelections.some(selection => selection.componentId === component.id)));
    assert.equal(fixture.messages.length, mailBefore, 'review and apply never imply permission to send');
    await fixture.publish(component, 'Published before imported readers consent');
    assert.equal(fixture.messages.length, mailBefore, 'pending imported destinations receive no publication');
    const owner = (await api('/api/app/session')).body.operator;
    assert.ok(pending.every(row => row.addedBy.id === owner.id));
    const batches = await api('/api/app/subscribers/import/batches');
    assert.ok(batches.body.batches.some(row => row.batchId === applied.body.batchId && row.remaining === pending.length));
    assert.ok(!batches.text.includes(email) && !batches.text.includes(contact));
    const exported = subscriberCsvRows(await (await fixture.request('/api/app/subscribers.csv')).text());
    assert.ok(exported.some(row => row.destination === "'" + email && row.consent_at === ''), 'CSV prevents formula execution and never invents consent');
    assert.ok(exported.some(row => row.destination === destination && row.contact_email === contact));
    const invite = `/api/app/subscribers/import/${applied.body.batchId}/send-invitations`;
    assert.equal((await fixture.raw(invite, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await api(invite, { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' }, body: '{}' })).status, 403);
    const sent = await post(invite);
    assert.equal(sent.status, 200, sent.text);
    assert.equal(sent.body.sent, pending.length);
    assert.equal(sent.body.remaining, 0);
    for (const repeated of await Promise.all([post(invite), post(invite)])) assert.equal(repeated.body.sent, 0);
    for (const recipient of [email, contact]) assert.equal(messagesFor(recipient).length, 1, 'one deliberate invitation per imported recipient');
    assert.ok((await list()).every(row => row.state === 'pending'), 'an invitation is not consent');
    const reportBeforeConsent = (await api('/api/app/subscriber-reporting')).body;
    assert.equal(reportBeforeConsent.total, pending.length);
    const changes = report => report.daily.reduce((sum, row) => sum + row.netChange, 0);
    await fixture.confirm(email); await fixture.confirm(contact); fixture.recoverWebhook();
    const report = (await api('/api/app/subscriber-reporting')).body;
    assert.equal(changes(report), changes(reportBeforeConsent), 'consent changes eligibility, not subscriber inventory');
    assert.equal(report.total, (await list()).length);
    for (const count of report.counts) assert.equal(count.count, (await list()).filter(row => row.channel === count.channel && row.state === count.state).length);
    const reportCsv = subscriberCsvRows(await (await fixture.request('/api/app/subscriber-reporting?format=csv')).text());
    assert.equal(Number(reportCsv.find(row => row.scope === 'summary').total), report.total);
    for (const day of report.daily) {
      assert.equal(day.netChange, day.joined - day.left);
      assert.equal(day.closingInventory, day.openingInventory + day.netChange);
      const exportedDay = reportCsv.find(row => row.scope === 'daily' && row.day === day.day && row.channel === day.channel);
      assert.equal(Number(exportedDay.net_change), day.netChange);
    }
    await fixture.publish(component, 'Published after imported readers consent');
    assert.ok(messagesFor(email).some(message => message.text.includes('Requests are delayed.')));
    assert.equal(fixture.webhookRequests.length, 1);
    assert.ok((await list()).every(row => row.state === 'active'));
    const audit = await api('/api/app/audit-log?action=subscriber.imported&limit=100');
    assert.ok(pending.every(row => audit.body.entries.some(entry => entry.entityId === row.id && entry.actorId === owner.id)));
    for (const row of pending) assert.equal((await api(`/api/app/subscribers/${row.id}`, { method: 'DELETE' })).status, 204);
    const reportAfterErasure = (await api('/api/app/subscriber-reporting')).body;
    assert.equal(reportAfterErasure.total, 0);
    assert.equal(changes(reportAfterErasure), changes(report) - pending.length, 'erasure leaves the reported daily inventory once');
    assert.ok(!JSON.stringify(reportAfterErasure).includes(email) && !JSON.stringify(reportAfterErasure).includes(contact));
    const erased = await fixture.databaseState();
    for (const [table, bytes] of erased) for (const address of [email, contact, destination]) assert.ok(!bytes.includes(address), `erasure removed imported contact from ${table}`);
    await subscriberBatchAuthorityFlow(fixture);
    // The same consent/reporting journey remains usable by a Communicator.
    const communicatorEmail='synthetic-lamp-reporting@example.test';
    assert.equal((await post('/api/app/operators/invite',{email:communicatorEmail,displayName:'Synthetic Lamp reporting operator'})).status,202);
    await fixture.signIn(communicatorEmail);
    const communicator=(await api('/api/app/session')).body.operator;
    await fixture.signIn();
    assert.equal((await post(`/api/app/operators/${communicator.id}/role`,{role:'communicator'})).status,200);
    await fixture.signIn(communicatorEmail,{fresh:true});
    assert.equal((await api('/api/app/session')).body.operator.role,'communicator');
    assert.equal((await api('/api/app/subscriber-reporting')).status,200);
    const communicatorCsv=await fixture.request('/api/app/subscriber-reporting?format=csv');
    assert.equal(communicatorCsv.status,200);assert.ok(subscriberCsvRows(await communicatorCsv.text()).length);
    const addedByCommunicator=await post('/api/app/subscribers',{channel:'email',email:'synthetic-lamp-communicator-reader@example.test',componentIds:[component.id]});
    assert.equal(addedByCommunicator.status,201,addedByCommunicator.text);
    const addedId=addedByCommunicator.body.subscriber.id;
    assert.ok((await list()).some(row=>row.id===addedId));
    assert.equal((await api(`/api/app/subscribers/${addedId}`,{method:'DELETE'})).status,204);
    await fixture.signIn();
  } finally { await fixture.close(); }
  await subscriberLimitsFlow();
}

/** A native Base member is a read-only Lamp Viewer. Batch invitation custody
 * remains owner-only, including after an actual invitation and confirmation. */
export async function subscriberBatchAuthorityFlow(fixture) {
  const { api, post, raw, appOrigin, messagesFor } = fixture;
  const email=['synthetic-lamp-batches-member','example.test'].join('@');
  const invitation=await post('/auth/invite',{email,displayName:'Synthetic Lamp batch viewer',role:'member'});
  assert.equal(invitation.status,202,invitation.text);
  const message=await eventuallySubscriber(()=>messagesFor(email).find(message=>message.text.includes('/auth/confirm?')),Boolean,'the Viewer invitation crosses the real mail edge');
  const token=new URL(message.text.match(/https?:\/\/[^\s]+/)[0]).searchParams.get('token');
  const confirmed=await raw('/auth/confirm',{method:'POST',headers:{Origin:appOrigin,'Content-Type':'application/json'},body:JSON.stringify({token})});
  assert.equal(confirmed.status,303,await confirmed.clone().text());
  const cookie=confirmed.headers.get('set-cookie').split(';')[0];
  const session=await raw('/api/app/session',{headers:{Cookie:cookie}});
  assert.equal(session.status,200);const person=(await session.json()).operator;assert.equal(person.role,'viewer');
  const before=await api('/api/app/subscribers/import/batches');assert.equal(before.status,200,'the owner retains the batch read');
  const denied=await raw('/api/app/subscribers/import/batches',{headers:{Cookie:cookie}});
  assert.equal(denied.status,403,'a signed-in Viewer cannot read owner invitation batches');
  assert.deepEqual((await api('/api/app/subscribers/import/batches')).body,before.body,'the refused read changes no batch');
  const audit=await api('/api/app/audit-log?action=access-denied&actorId='+person.id);
  assert.equal(audit.status,200);
  assert.ok(audit.body.entries.some(row=>row.entityId==='/api/app/subscribers/import/batches'&&row.actorId===person.id&&Number.isFinite(Date.parse(row.createdAt))));
}
