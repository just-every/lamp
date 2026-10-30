import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, presets } from '../identity/oidc/tests/fake-runtime.mjs';

const post = (input, cookie) => ({ method: 'POST', input, cookie });
test('admin invitation and seed audit commit together, with refusals and audit failure closed', async t => {
  const r = await runtime(t, { ...presets(), audit: true });
  await r.db.prepare('CREATE TABLE fixture_admin_audit(payload TEXT NOT NULL)').run();
  const owner = await r.bootstrap();
  const actor = await (await r.call('/auth/session', { cookie: owner })).json();
  const input = { email: 'member@example.com', displayName: '<script>private name</script>', role: 'member' };
  assert.equal((await r.call('/auth/invite', post(input, owner))).status, 202);
  const target = await r.db.prepare('SELECT id FROM oa_operators WHERE email=?').bind(input.email).first();
  const rows = async () => (await r.db.prepare('SELECT payload FROM fixture_admin_audit').all()).results.map(row => JSON.parse(row.payload));
  const [event] = await rows();
  assert.deepEqual(event, { action: 'operators.invite', actorId: actor.operator.id, subjectId: target.id, detail: 'member', now: event.now });
  assert.equal(typeof event.now, 'number');
  const joined = await r.call('/auth/confirm', post({ token: await r.link() }));
  const member = r.session(joined);
  const refused = await r.call('/auth/invite', post({ ...input, email: 'forbidden@example.com' }, member));
  assert.equal(refused.status, 403);
  assert.deepEqual(await rows(), [event]);
  await r.db.prepare("INSERT INTO fixture_state(key,value) VALUES('auditFailure','true')").run();
  assert.equal((await r.call('/auth/invite', post({ ...input, email: 'rollback@example.com' }, owner))).status, 503);
  assert.equal(await r.db.prepare('SELECT id FROM oa_operators WHERE email=?').bind('rollback@example.com').first(), null);
  assert.deepEqual(await rows(), [event], 'audit SQL failure rolls back even the preceding audit insert');
});
