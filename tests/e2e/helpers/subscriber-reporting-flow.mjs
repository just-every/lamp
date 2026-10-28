import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { authFixture } from '../../auth-adoption/runtime.mjs';

function csvRecords(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') { if (quoted && text[index + 1] === '"') { field += '"'; index++; } else quoted = !quoted; }
    else if (character === ',' && !quoted) { row.push(field); field = ''; }
    else if ((character === '\r' || character === '\n') && !quoted) { if (character === '\r' && text[index + 1] === '\n') index++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  const [header, ...values] = rows;
  return values.map(values => Object.fromEntries(header.map((key, index) => [key, values[index]])));
}

/** Reuses a suite's real migrated D1 and Vite loader. No process or test case.
 * Imported rows are fixture data, never a substitute repository or service.
 */
export async function subscriberReportingFlow({ vite, bindings }) {
  const reporting = await vite.ssrLoadModule('/src/core/features/subscriber-reporting/index.ts');
  const subscribers = await vite.ssrLoadModule('/src/core/features/subscribers/index.ts');
  const { requireOperator } = await vite.ssrLoadModule('/src/core/features/operators/routes.ts');
  const { createUlid } = await vite.ssrLoadModule('/src/core/shared/ids.ts');
  const db = bindings.DB, prefix = `reporting-${randomUUID()}`, fixture = authFixture(db);
  const email = `${prefix}@example.test`, actor = createUlid(), component = createUlid(), imported = [createUlid(), createUlid(), createUlid()];
  const now = new Date().toISOString(), day = now.slice(0, 10), to = new Date(Date.parse(now.slice(0, 10)) + 86_400_000).toISOString().slice(0, 10);
  const query = `from=${day}&to=${to}`;
  await db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES(?,?,?,'member','active',?)").bind(actor, email, 'Reporting operator', Date.now()).run();
  await db.prepare("INSERT INTO operator_roles(operator_id,role) VALUES(?,'communicator')").bind(actor).run();
  const cookie = await fixture.signIn(email), app = new Hono();
  app.use('*', async (context, next) => { context.env = { ...bindings, DB: db }; await next(); });
  app.use('/api/app/*', requireOperator(() => fixture.auth));
  subscribers.registerSubscriberRoutes(app, subscribers.createSubscribersService(subscribers.createSubscriberRepository(db)));
  reporting.registerSubscriberReportingRoutes(app, reporting.createSubscriberReportingService(reporting.createSubscriberReportingRepository(db)));
  const request = (path, options = {}) => app.fetch(fixture.request(path, { cookie, ...options }));
  const read = async (suffix = '') => {
    const response = await request(`/api/app/subscriber-reporting?${query}${suffix}`);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  };
  const changes = report => report.daily.reduce((totals, row) => ({ joined: totals.joined + row.joined, left: totals.left + row.left }), { joined: 0, left: 0 });
  const list = async () => {
    const listed = [];
    for (let offset = 0;; offset += 100) {
      const response = await request(`/api/app/subscribers?limit=100&offset=${offset}`), page = await response.json();
      assert.equal(response.status, 200); listed.push(...page.subscribers); if (!page.hasMore) break;
    }
    return listed.filter(row => !row.destination.startsWith('deleted:'));
  };
  const ids = [...imported];
  try {
    for (const format of ['', '?format=csv']) assert.equal((await app.fetch(fixture.request(`/api/app/subscriber-reporting${format}`))).status, 401);
    for (const invalid of ['month=2026-13', 'from=2026-02-30&to=2026-03-02', 'from=2020-01-01&to=2026-01-01', 'from=2026-01-01', 'month=2026-01&from=2026-01-01&to=2026-02-01', 'channel=voice', 'limit=1']) assert.equal((await request(`/api/app/subscriber-reporting?${invalid}`)).status, 400);
    const before = await read(), beforeChanges = changes(before), beforeList = await list();
    await db.prepare("INSERT INTO components(id,name,description,internal,display_order,note,created_at,updated_at) VALUES(?, '=SUM(1,2)', '', 0, 1, '', ?, ?)").bind(component, now, now).run();
    // Native import writes carry old creation dates; observation stays today.
    await db.batch(imported.map((id, index) => db.prepare("INSERT INTO subscribers(id,channel,destination,state,selection_mode,token_hash,deactivation_reason,created_at,updated_at) VALUES(?,'email',?,?,'selected',?,?,?,?)")
      .bind(id, `${prefix}-${index}@example.test`, ['pending', 'active', 'deactivated'][index], `${prefix}-${index}`, index === 2 ? 'unsubscribed' : null, '2001-01-01T00:00:00.000Z', now)));
    await db.prepare('INSERT INTO subscriber_components(id,subscriber_id,component_id,created_at,updated_at) VALUES(?,?,?,?,?)').bind(createUlid(), imported[1], component, now, now).run();
    const created = await request('/api/app/subscribers/webhook', { method: 'POST', body: { destination: `https://${prefix}.example.test/hook`, contactEmail: email, componentIds: [] } });
    assert.equal(created.status, 201, await created.clone().text());
    const webhook = (await created.json()).subscriber; ids.push(webhook.id);
    const mixed = await read();
    assert.equal(mixed.total, before.total + 4); assert.equal(mixed.eligible, before.eligible + 3);
    assert.deepEqual(changes(mixed), { joined: beforeChanges.joined + 3, left: beforeChanges.left });
    assert.equal(mixed.components.find(row => row.componentId === component && row.channel === 'email' && row.state === 'active').count, 1 + beforeList.filter(row => row.channel === 'email' && row.state === 'active' && row.selectionMode === 'all').length);
    assert.equal(mixed.deactivationReasons.find(row => row.channel === 'email' && row.reason === 'unsubscribed').count, (before.deactivationReasons.find(row => row.channel === 'email' && row.reason === 'unsubscribed')?.count ?? 0) + 1);
    const csvResponse = await request(`/api/app/subscriber-reporting?${query}&format=csv`);
    assert.equal(csvResponse.headers.get('cache-control'), 'no-store');
    const csv = csvRecords(await csvResponse.text());
    assert.equal(Number(csv.find(row => row.scope === 'summary').total), mixed.total);
    assert.ok(csv.some(row => row.scope === 'component' && row.component_name === "'=SUM(1,2)"));
    for (const row of mixed.daily) {
      assert.equal(row.netChange, row.joined - row.left);
      assert.equal(row.closingInventory, row.openingInventory + row.netChange);
      const exported = csv.find(value => value.scope === 'daily' && value.day === row.day && value.channel === row.channel);
      assert.equal(Number(exported.net_change), row.netChange); assert.equal(Number(exported.closing_inventory), row.closingInventory);
    }
    // Confirmation is neutral; channel moves leave/join; deactivation and
    // erasure leave once. Physical import undo must also decrement inventory.
    await db.prepare("UPDATE subscribers SET state='active' WHERE id=?").bind(imported[0]).run();
    assert.deepEqual(changes(await read()), changes(mixed));
    await db.prepare("UPDATE subscribers SET channel='email' WHERE id=?").bind(webhook.id).run();
    await db.prepare("UPDATE subscribers SET state='deactivated',deactivation_reason='bounced' WHERE id=?").bind(imported[0]).run();
    assert.equal((await request(`/api/app/subscribers/${imported[1]}`, { method: 'DELETE' })).status, 204);
    await db.prepare('DELETE FROM subscribers WHERE id=?').bind(webhook.id).run();
    const after = await read();
    assert.equal(after.total, before.total + 2); assert.equal(after.eligible, before.eligible);
    assert.deepEqual(changes(after), { joined: beforeChanges.joined + 4, left: beforeChanges.left + 4 });
    const retained = await list();
    assert.equal(after.total, retained.length);
    for (const row of after.counts) assert.equal(row.count, retained.filter(subscriber => subscriber.channel === row.channel && subscriber.state === row.state).length);
    const emailOnly = await read('&channel=email');
    assert.equal(emailOnly.total, retained.filter(row => row.channel === 'email').length);
    assert.ok(emailOnly.daily.every(row => row.channel === 'email'));
    for (const destination of imported.map((_, index) => `${prefix}-${index}@example.test`)) assert.ok(!JSON.stringify(after).includes(destination));
    for (const id of ids) assert.ok(!JSON.stringify(after).includes(id));
    const earliest = await request('/api/app/subscriber-reporting?month=1000-01');
    assert.deepEqual((await earliest.json()).daily, [], 'Unobserved historical days remain unknown');
    assert.deepEqual(after.unsupportedDimensions, ['audience', 'language']);
  } finally {
    for (const id of ids) await db.batch([
      db.prepare('DELETE FROM subscriber_components WHERE subscriber_id=?').bind(id),
      db.prepare("DELETE FROM audit_entries WHERE entity_type='subscriber' AND entity_id=?").bind(id),
      db.prepare('DELETE FROM subscribers WHERE id=?').bind(id),
    ]);
    await db.prepare('DELETE FROM components WHERE id=?').bind(component).run();
    await db.prepare('DELETE FROM oa_sessions WHERE operator_id=?').bind(actor).run();
    await db.prepare('DELETE FROM oa_tokens WHERE operator_id=?').bind(actor).run();
    await db.prepare('DELETE FROM operators WHERE id=?').bind(actor).run();
    await db.prepare('DELETE FROM operator_roles WHERE operator_id=?').bind(actor).run();
    await db.prepare('DELETE FROM oa_operators WHERE id=?').bind(actor).run();
  }
}
