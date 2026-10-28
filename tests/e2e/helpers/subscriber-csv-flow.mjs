import assert from 'node:assert/strict';
import { openSubscriberManagementFixture, subscriberCsv, subscriberCsvRows } from './subscriber-management-fixture.mjs';
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
  } finally { await fixture.close(); }
  await subscriberLimitsFlow();
}

export async function subscriberBatchAuthorityFlow(fixture) {
  const response = await fixture.post('/auth/invite', { email: 'member@example.test', displayName: 'Member', role: 'member' });
  assert.equal(response.status, 403, response.text);
  assert.equal((await fixture.api('/api/app/subscribers/import/batches')).status, 200);
}
