import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, post, SETUP } from './regression-runtime.mjs';

const raw = (type, body) => ({ method: 'POST', body, headers: { 'Content-Type': type } });
const form = (body) => raw('application/x-www-form-urlencoded', body);
const json = (body) => raw('application/json', body);
async function snapshot(r) {
  const db = await r.db;
  return Promise.all(['SELECT id,status,version FROM oa_operators ORDER BY id',
    'SELECT id FROM oa_sessions ORDER BY id', 'SELECT id,consumed_at,revoked_at FROM oa_tokens ORDER BY id',
    'SELECT key,window,count FROM oa_limits ORDER BY key'].map(async (sql) => (await db.prepare(sql).all()).results));
}
async function rejected(r, path, input, token) {
  const before = await snapshot(r);
  const response = await r.call(path, input);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const text = await response.text();
  assert.equal(text.includes(token), false, 'Rejection must not reflect credentials');
  assert.equal(text.includes('invalid_input'), true);
  assert.deepEqual(await snapshot(r), before, 'Ambiguous input must be rejected before any auth operation');
}
function bodies(token, extra = '') {
  const forms = ['token', '%74oken', 'to%6ben'];
  const keys = ['token', '\\u0074oken', 'to\\u006ben'];
  return [
    ...forms.flatMap((key) => [form(`token=invalid&${key}=${token}${extra}`), form(`${key}=${token}&token=invalid${extra}`), form(`token=${token}&${key}=${token}${extra}`)]),
    ...keys.flatMap((key) => [json(`{"token":"invalid","${key}":"${token}","displayName":"Owner"}`), json(`{"${key}":"${token}","token":"invalid","displayName":"Owner"}`), json(`{"token":"${token}","${key}":"${token}","displayName":"Owner"}`)]),
  ];
}

test('setup rejects duplicate form/JSON credentials before owner claim, with a single escaped form field positive control', async () => {
  const r = await runtime();
  try {
    for (const input of bodies(SETUP, '&displayName=Owner')) await rejected(r, '/auth/bootstrap', input, SETUP);
    await rejected(r, `/auth/bootstrap?token=invalid`, post({ token: SETUP, displayName: 'Owner' }), SETUP);
    const valid = await r.call('/auth/bootstrap', form(`%74oken=${SETUP}&displayName=Owner`));
    assert.equal(valid.status, 303);
    assert.ok(valid.headers.get('set-cookie'));
    assert.equal((await (await r.db).prepare('SELECT count(*) AS n FROM oa_operators').first()).n, 1);
  } finally { await r.close(); }
});

for (const kind of ['magic', 'invite']) test(`${kind} rejects query/form/JSON token ambiguity without preview, writes or credential leakage`, async () => {
  const r = await runtime();
  try {
    const owner = await r.bootstrap();
    const issued = kind === 'magic'
      ? await r.call('/auth/magic-link', post({ email: 'owner@example.com', returnTo: '/app/queue' }))
      : await r.call('/auth/invite', post({ email: 'staff@example.com', displayName: 'Staff', returnTo: '/app/queue' }, owner));
    assert.equal(issued.status, 202);
    const token = await r.link();
    for (const key of ['token', '%74oken', 'to%6Ben']) {
      for (const query of [`token=invalid&${key}=${token}`, `${key}=${token}&token=invalid`, `token=${token}&${key}=${token}`]) {
        for (const method of ['GET', 'HEAD']) await rejected(r, `/auth/confirm?${query}`, { method }, token);
      }
    }
    for (const input of bodies(token)) await rejected(r, '/auth/confirm', input, token);
    await rejected(r, '/auth/confirm?%74oken=invalid', post({ token }), token);
    await rejected(r, `/auth/confirm?token=${token}`, post({ token: 'invalid' }), token);
    await rejected(r, '/auth/confirm', json(`{"token":"${token}","metadata":{"x":1,"\\u0078":2}}`), token);
    const before = await snapshot(r);
    const preview = await r.call(`/auth/confirm?%74oken=${token}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('set-cookie'), null);
    assert.deepEqual(await snapshot(r), before);
    const accepted = await r.call('/auth/confirm', kind === 'invite' ? form(`to%6ben=${token}`)
      : json(`{"\\u0074oken":"${token}","metadata":[{"x":1},{"x":2}],"quoted":"\\\"token\\\":{}[]"}`));
    assert.equal(accepted.status, 303);
    assert.equal(accepted.headers.get('location'), '/app/queue');
    assert.ok(accepted.headers.get('set-cookie'));
    assert.equal((await r.call('/auth/confirm', post({ token }))).status, 400);
  } finally { await r.close(); }
});
