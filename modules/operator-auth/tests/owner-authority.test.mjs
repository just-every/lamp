import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from '../identity/oidc/tests/fake-runtime.mjs';
import { runtime as devRuntime, read, cookies, DEV_KEY } from './dev-runtime.mjs';
import { STEP_UP_SECONDS } from '../service.mjs';

const post = (input, cookie) => ({ method: 'POST', input, cookie });
const email = 'target@example.com';
const cases = [
  { name: 'new owner invitation', route: '/auth/invite', input: { email, displayName: 'Target', role: 'owner' }, role: 'owner', status: 'invited' },
  ...['reissue', 'reinvite'].map(kind => ({ name: `${kind} owner invitation`, kind, before: ['owner', kind === 'reinvite' ? 'cancelled' : 'invited'], route: '/auth/invite', input: { email, displayName: 'Target', role: 'owner' }, role: 'owner', status: 'invited' })),
  { name: 'cancel owner invitation', before: ['owner', 'invited'], route: '/auth/invite/cancel', role: 'owner', status: 'inactive' },
  ...['active', 'inactive', 'invited'].flatMap(status => [
    { name: `grant ${status} owner role`, before: ['member', status], route: '/auth/operator/role', input: { role: 'owner' }, role: 'owner', status },
    { name: `remove ${status} owner role`, before: ['owner', status], route: '/auth/operator/role', input: { role: 'member' }, role: 'member', status },
  ]),
  { name: 'reactivate owner', before: ['owner', 'inactive'], route: '/auth/operator/status', input: { status: 'active' }, role: 'owner', status: 'active' },
  { name: 'deactivate owner', before: ['owner', 'active'], route: '/auth/operator/status', input: { status: 'inactive' }, role: 'owner', status: 'inactive' },
];

async function snapshot(r) {
  const rows = async sql => (await r.db.prepare(sql).all()).results;
  return {
    operators: await rows('SELECT id,email,role,status,version FROM oa_operators ORDER BY id'),
    invitations: await rows('SELECT id,operator_id,operator_version,consumed_at,revoked_at FROM oa_tokens ORDER BY id'),
    sessions: await rows('SELECT id,operator_id,operator_version,revoked_at FROM oa_sessions ORDER BY id'),
    cancellations: await rows('SELECT * FROM oa_invitation_cancellations ORDER BY operator_id'),
    mails: (await rows('SELECT id FROM test_mail ORDER BY id')).length,
  };
}

async function prepare(r, setup, before) {
  if (!before) return {};
  const [role, status] = before;
  assert.equal((await r.call('/auth/invite', post({ email, role, displayName: 'Target' }, setup))).status, 202);
  const token = await r.link();
  const target = await r.db.prepare('SELECT id FROM oa_operators WHERE email=?').bind(email).first();
  let cookie;
  if (status === 'cancelled') {
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: target.id }, setup))).status, 200);
  } else if (status !== 'invited') {
    const joined = await r.call('/auth/confirm', post({ token }));
    assert.equal(joined.status, 303);
    cookie = r.session(joined);
    if (status === 'inactive') assert.equal((await r.call('/auth/operator/status', post({ operatorId: target.id, status }, setup))).status, 200);
  }
  return { operatorId: target.id, token, cookie };
}

test('all owner-authority routes demand fresh local proof and preserve non-owner status behavior', async () => {
  for (const row of cases) {
    const cleanup = [];
    const r = await runtime({ after: fn => cleanup.push(fn) });
    try {
      const setup = await r.bootstrap();
      assert.equal((await r.stepUp(setup, 'owner:transfer')).status, 303);
      const target = await prepare(r, setup, row.before);
      const signedIn = await r.login('auth');
      assert.equal(signedIn.status, 303);
      const actor = r.session(signedIn);
      const input = { ...(target.operatorId ? { operatorId: target.operatorId } : {}), ...row.input };
      for (const proof of ['absent provider-session proof', 'expired local proof']) {
        if (proof === 'expired local proof') {
          assert.equal((await r.stepUp(actor, 'owner:transfer')).status, 303);
          await r.clock(11 * 60000);
        }
        const before = await snapshot(r);
        const refused = await r.call(row.route, post(input, actor));
        assert.equal(refused.status, 403, `${row.name}: ${proof}`);
        assert.deepEqual(await refused.json(), { error: 'step_up_required' });
        assert.equal(refused.headers.get('set-cookie'), null);
        assert.deepEqual(await snapshot(r), before, `${row.name}: refused without changing authority or sending credentials`);
      }
      assert.equal((await r.stepUp(actor, 'owner:transfer')).status, 303);
      const allowed = await r.call(row.route, post(input, actor));
      assert.equal(allowed.status, row.route === '/auth/invite' ? 202 : 200, `${row.name}: fresh local proof`);
      const operators = await (await r.call('/auth/operators', { cookie: actor })).json();
      const changed = operators.find(operator => operator.email === email);
      assert.deepEqual([changed.role, changed.status], [row.role, row.status], row.name);
      if (target.cookie) assert.equal((await r.call('/auth/session', { cookie: target.cookie })).status, 401, 'authority changes revoke the old session');
      if (row.route === '/auth/invite') {
        const accepted = await r.call('/auth/confirm', post({ token: await r.link() }));
        assert.equal(accepted.status, 303);
        const session = await (await r.call('/auth/session', { cookie: r.session(accepted) })).json();
        assert.equal(session.operator.role, 'owner');
      } else if (row.route === '/auth/invite/cancel') {
        assert.equal((await r.call('/auth/confirm', post({ token: target.token }))).status, 400);
      } else if (row.status === 'active') {
        assert.equal((await r.call('/auth/magic-link', post({ email }))).status, 202);
        const admitted = await r.call('/auth/confirm', post({ token: await r.link() }));
        assert.equal(admitted.status, 303);
        const session = await (await r.call('/auth/session', { cookie: r.session(admitted) })).json();
        assert.equal(session.operator.role, row.role);
      }
      console.log(JSON.stringify({ case: row.name, absent: '403 step_up_required', expired: '403 step_up_required', fresh: allowed.status }));
    } finally { for (const fn of cleanup.reverse()) await fn(); }
  }

  const cleanup = [];
  const r = await runtime({ after: fn => cleanup.push(fn) });
  try {
    await r.bootstrap();
    const actor = r.session(await r.login('auth'));
    for (const role of ['member', 'admin']) {
      const id = await r.operator(`${role}@example.com`, role);
      for (const status of ['inactive', 'active']) {
        const response = await r.call('/auth/operator/status', post({ operatorId: id, status }, actor));
        assert.equal(response.status, 200);
        assert.deepEqual([(await response.json()).status], [status]);
      }
    }
    const owner = await (await r.call('/auth/session', { cookie: actor })).json();
    const before = await snapshot(r);
    for (const [route, input] of [
      ['/auth/operator/status', { status: 'active' }],
      ['/auth/operator/role', { role: 'owner' }],
    ]) assert.equal((await r.call(route, post({ operatorId: owner.operator.id, ...input }, actor))).status, 200);
    assert.deepEqual(await snapshot(r), before, 'unchanged owner role/status preserves authority and sessions without step-up');
  } finally { for (const fn of cleanup.reverse()) await fn(); }

});

test('local owner persona creation keeps its proof fence with product insert triggers', async () => {
  const setup = 'fixture-owner-persona-setup-token';
  const dev = await devRuntime([await read('../accounts/schema/operator-auth.sql'), await read('./fixtures/trigger-writes.sql')], { SETUP_TOKEN: setup }, 'owner-persona-worker.mjs');
  try {
    const boot = await dev.call('/auth/bootstrap', { method: 'POST', input: { token: setup, displayName: 'Owner' } });
    assert.equal(boot.status, 303);
    const actor = cookies(boot);
    const enter = () => dev.call('/auth/dev/enter?as=co-owner', { cookie: actor, key: DEV_KEY });
    const prove = async () => {
      assert.equal((await dev.call('/auth/step-up', { method: 'POST', cookie: actor, input: { action: 'owner:transfer' } })).status, 202);
      assert.equal((await dev.call('/auth/confirm', { method: 'POST', cookie: actor, input: { token: await dev.latestLink() } })).status, 303);
    };
    for (const proof of ['absent', 'expired']) {
      if (proof === 'expired') {
        await prove();
        await dev.db.prepare('UPDATE oa_step_up_challenges SET consumed_at=consumed_at-? WHERE consumed_at IS NOT NULL').bind((STEP_UP_SECONDS + 60) * 1000).run();
      }
      const before = await snapshot(dev);
      const refused = await enter();
      assert.equal(refused.status, 403, `local owner creation: ${proof} proof`);
      assert.deepEqual(await refused.json(), { error: 'step_up_required' });
      assert.equal(refused.headers.get('set-cookie'), null);
      assert.deepEqual(await snapshot(dev), before);
    }
    await prove();
    const created = await enter();
    assert.equal(created.status, 303);
    const who = await dev.call('/auth/session', { cookie: cookies(created), key: DEV_KEY });
    assert.equal(who.status, 200);
    const session = await who.json();
    assert.deepEqual([session.operator.role, session.operator.status, session.kind], ['owner', 'active', 'dev']);
    assert.ok(await dev.db.prepare("SELECT 1 FROM test_auth_writes WHERE table_name='oa_operators' AND row_key=? AND event='insert'").bind(session.operator.id).first(), 'the persona insert also ran the product audit trigger');
    await dev.db.prepare("CREATE TRIGGER test_ignore_owner BEFORE INSERT ON oa_operators WHEN NEW.email='blocked-owner@dev.localhost' BEGIN INSERT INTO test_auth_writes VALUES('oa_operators',NEW.id,'ignored'); SELECT RAISE(IGNORE); END").run();
    const ignored = await dev.call('/auth/dev/enter?as=blocked-owner', { cookie: actor, key: DEV_KEY });
    assert.equal(ignored.status, 409, 'a trigger write alone is not successful owner creation');
    assert.deepEqual(await ignored.json(), { error: 'authority_changed' });
    assert.equal(ignored.headers.get('set-cookie'), null);
    assert.equal(await dev.db.prepare("SELECT id FROM oa_operators WHERE email='blocked-owner@dev.localhost'").first(), null);
    assert.ok(await dev.db.prepare("SELECT 1 FROM test_auth_writes WHERE event='ignored'").first(), 'the ignored insert still ran a trigger write');
    console.log(JSON.stringify({ case: 'create local owner persona', absent: '403 step_up_required', expired: '403 step_up_required', fresh: 303 }));
  } finally { await dev.close(); }
});
