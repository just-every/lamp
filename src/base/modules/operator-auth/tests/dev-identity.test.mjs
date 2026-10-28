import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { runtime, read, cookies, DEV_KEY, OWNER, SECRET } from './dev-runtime.mjs';

async function fresh() {
  const r = await runtime([await read('../accounts/schema/operator-auth.sql')]);
  await r.db.prepare(`INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('owner','${OWNER}','Owner','owner','active',1)`).run();
  return r;
}
const gateOnly = cookie => cookie.split('; ').filter(pair => pair.startsWith('rer_dev_gate_8787=')).join('; ');
const sessionOnly = cookie => cookie.split('; ').filter(pair => !pair.startsWith('rer_dev_gate_8787=')).join('; ');

test('dev sign-in and personas answer only behind the key gate, and a dev session counts only there', async () => {
  const r = await fresh();
  try {
    for (const path of ['/auth/dev/enter?as=owner', '/__dev/personas']) {
      assert.equal((await r.call(path)).status, 404, `${path} without the key`);
      assert.equal((await r.call(path, { key: DEV_KEY.replace(/.$/, 'x') })).status, 404, `${path} with a wrong key`);
    }
    assert.deepEqual(await (await r.call('/__dev/personas', { key: DEV_KEY })).json(),
      [{ as: 'owner', email: OWNER }, { as: 'admin', email: 'admin@dev.localhost', role: 'admin' }, { as: 'signed-out' }]);
    const entered = await r.call('/auth/dev/enter?as=owner', { key: DEV_KEY });
    assert.equal(entered.status, 303);
    assert.equal(entered.headers.get('location'), '/app');
    const gate = entered.headers.getSetCookie().find(line => line.startsWith('rer_dev_gate_8787='));
    assert.match(gate, /; Path=\/; HttpOnly; SameSite=Lax/);
    assert.doesNotMatch(gate, /Domain=/i, 'host-only');
    const both = cookies(entered);
    assert.equal((await r.call('/auth/session', { cookie: both })).status, 200);
    assert.equal((await r.call('/auth/session', { cookie: sessionOnly(both) })).status, 401, 'a dev session without the gate is refused');
    // A provider's redirect back is a cross-site top-level GET: the session counts, the gated surfaces do not open.
    const crossSite = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' };
    assert.equal((await r.call('/auth/session', { cookie: both, headers: crossSite })).status, 200, 'a dev session survives a cross-site redirect');
    for (const path of ['/auth/dev/enter?as=admin', '/__dev/personas'])
      assert.equal((await r.call(path, { cookie: both, headers: crossSite })).status, 404, `${path} refuses a cross-site request`);
    assert.equal((await r.call('/signin', { cookie: both, headers: crossSite })).headers.get('location'), '/__dev/key');
    const signin = await (await r.call('/signin', { cookie: gateOnly(both) })).text();
    assert.match(signin, /href="\/auth\/dev\/enter\?as=owner/);
    assert.doesNotMatch(signin, /type="email"/);
    // The browser cookie alone passes the gate; reuse keeps the same session row.
    assert.equal((await r.call('/auth/dev/enter?as=owner', { cookie: both })).status, 303);
    assert.equal((await r.db.prepare("SELECT count(*) AS n FROM oa_sessions WHERE kind='dev'").first()).n, 1, 'reused');
    assert.equal((await r.call('/auth/email', { method: 'POST', cookie: both, input: { email: OWNER } })).status, 200, 'local entry supplies fresh proof without mail');
    // Persona: a real operator, created only here, behind version fences.
    const admin = await r.call('/auth/dev/enter?as=admin&returnTo=/app/team', { cookie: gateOnly(both) });
    assert.equal(admin.headers.get('location'), '/app/team');
    const adminCookie = [gateOnly(both), cookies(admin)].join('; ');
    assert.equal((await (await r.call('/auth/session', { cookie: adminCookie })).json()).operator.email, 'admin@dev.localhost');
    await r.db.prepare("UPDATE oa_operators SET role='member' WHERE email='admin@dev.localhost'").run();
    assert.equal((await r.call('/auth/session', { cookie: adminCookie })).status, 401, 'a role change fences the dev session');
    const person = (await (await r.call('/auth/operators', { cookie: both })).json()).find(person => person.email === 'admin@dev.localhost');
    assert.equal((await r.call('/auth/operator/status', { method: 'POST', cookie: both, input: { operatorId: person.id, status: 'inactive' } })).status, 200);
    const personas = await (await r.call('/__dev/personas', { key: DEV_KEY })).json();
    assert.ok(!personas.some(person => person.as === 'admin' || person.email === 'admin@dev.localhost'), 'a deactivated declaration is not offered by name or email');
    assert.doesNotMatch(await (await r.call('/signin', { cookie: gateOnly(both) })).text(), /href="\/auth\/dev\/enter\?as=admin/);
    const refused = await r.call('/auth/dev/enter?as=admin&returnTo=/app/team', { cookie: adminCookie, headers: { accept: 'text/html' } });
    assert.equal(refused.status, 403, 'a deactivated persona cannot sign in');
    assert.match(refused.headers.get('content-type'), /text\/html/);
    const refusal = await refused.text();
    assert.match(refusal, /<main>.*<h1>[^<]+<\/h1><p>[^<]+<\/p>/);
    assert.match(refusal, /href="\/signin\?returnTo=%2Fapp%2Fteam"/);
    assert.ok(!cookies(refused).includes('operator_session_local_8787='), 'a refusal never issues a session');
    for (const accept of ['application/json,text/html;q=0', 'application/json;q=1,text/html;q=0.5', 'application/json']) {
      const response = await r.call('/auth/dev/enter?as=admin', { key: DEV_KEY, headers: { accept } });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'sign_in_refused' });
      assert.equal(cookies(response), '', 'negotiation never issues a session');
    }
    for (const accept of [undefined, '*/*', 'text/html;q=invalid']) {
      const response = await r.call('/auth/dev/enter?as=admin', { key: DEV_KEY, headers: accept ? { accept } : {} });
      assert.equal(response.status, 403);
      assert.match(response.headers.get('content-type'), /text\/plain/, 'the direct inactive-persona route retains its main default');
    }
    const unknown = await r.call('/auth/dev/enter?as=nobody', { key: DEV_KEY, headers: { accept: 'application/json,text/html;q=0' } });
    assert.equal(unknown.status, 404);
    assert.equal(typeof (await unknown.json()).error, 'string');
    assert.equal((await r.call('/auth/operator/status', { method: 'POST', cookie: both, input: { operatorId: person.id, status: 'active' } })).status, 200);
    assert.ok((await (await r.call('/__dev/personas', { key: DEV_KEY })).json()).some(person => person.as === 'admin'), 'reactivation restores the local choice');
    // Signed-out revokes the current session.
    const out = await r.call('/auth/dev/enter?as=signed-out', { cookie: both });
    assert.equal(out.headers.get('location'), '/');
    assert.equal((await r.call('/auth/session', { cookie: both })).status, 401);
    assert.equal((await r.call('/auth/dev/enter?as=nobody', { cookie: both })).status, 404);
  } finally { await r.close(); }
});

test('a link minted while using a dev session is a dev credential: it needs the gate and yields a dev session', async () => {
  const r = await fresh();
  try {
    const owner = cookies(await r.call('/auth/dev/enter?as=owner', { key: DEV_KEY }));
    const invited = await r.call('/auth/invite', { method: 'POST', cookie: owner, input: { email: 'new@example.com', displayName: 'New', role: 'member' } });
    assert.equal(invited.status, 202);
    const token = await r.latestLink();
    assert.equal((await r.db.prepare("SELECT credential FROM oa_dev_credentials").first()).credential, 'oa_tokens');
    assert.equal((await r.call(`/auth/confirm?token=${token}`)).status, 400, 'without the gate the link is invalid');
    assert.equal((await r.call('/auth/confirm', { method: 'POST', input: { token } })).status, 400);
    const confirmed = await r.call('/auth/confirm', { method: 'POST', input: { token }, cookie: gateOnly(owner) });
    assert.equal(confirmed.status, 303);
    const session = await r.call('/auth/session', { cookie: [gateOnly(owner), cookies(confirmed)].join('; ') });
    assert.deepEqual([(await session.json()).kind, session.status], ['dev', 200]);
  } finally { await r.close(); }
});

test("a person invited at a persona's address signs in as that person, with the role they were invited to", async () => {
  const r = await fresh();
  try {
    const owner = cookies(await r.call('/auth/dev/enter?as=owner', { key: DEV_KEY }));
    assert.equal((await r.call('/auth/invite', { method: 'POST', cookie: owner, input: { email: 'admin@dev.localhost', displayName: 'Invited Ada', role: 'member' } })).status, 202);
    const entered = await r.call('/auth/dev/enter?as=admin', { cookie: owner });
    assert.equal(entered.status, 303, 'the pending invitation signs in by the persona name');
    const person = (await (await r.call('/auth/session', { cookie: [gateOnly(owner), cookies(entered)].join('; ') })).json()).operator;
    assert.deepEqual([person.email, person.displayName, person.role, person.status], ['admin@dev.localhost', 'Invited Ada', 'member', 'active']);
    const operators = await r.db.prepare("SELECT role FROM oa_operators WHERE email='admin@dev.localhost'").all();
    assert.deepEqual(operators.results, [{ role: 'member' }], 'the persona never adds or widens a role');
  } finally { await r.close(); }
});

test('dev sign-in obeys domain provider rules on issue and reuse, with an active owner exemption', async () => {
  const r = await runtime([await read('../accounts/schema/operator-auth.sql'), await read('../identity/oidc/schema/oidc.sql')], {
    OIDC_TRANSACTION_SECRET: 'test-only-dev-domain-transaction-secret',
    providers: [{ id: 'okta', preset: 'okta', issuer: 'https://corp.okta.example', clientId: 'dev-app', tokenAuthMethod: 'client_secret_post', clientSecret: 'test-only-okta-secret' }],
  });
  try {
    await r.db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('owner',?,'Owner','owner','active',1)").bind(OWNER).run();
    await r.call('/auth/magic-link', { method: 'POST', input: { email: OWNER } });
    const owner = cookies(await r.call('/auth/confirm', { method: 'POST', input: { token: await r.latestLink() } }));
    const admin = cookies(await r.call('/auth/dev/enter?as=admin', { key: DEV_KEY }));
    assert.equal((await r.call('/auth/session', { cookie: admin })).status, 200);
    for (const domain of ['dev.localhost', 'example.com']) {
      assert.equal((await r.call('/auth/domain-rules', { method: 'POST', cookie: owner, input: { domain, provider: 'okta' } })).status, 200);
    }
    const count = async () => (await r.db.prepare("SELECT count(*) AS n FROM oa_sessions WHERE kind='dev'").first()).n;
    const n = await count();
    for (const context of [{ key: DEV_KEY }, { cookie: admin }]) {
      const refused = await r.call('/auth/dev/enter?as=admin', context);
      assert.equal(refused.status, 403);
      assert.ok(refused.headers.get('content-type').startsWith('text/plain'));
      assert.ok(!cookies(refused).includes('operator_session_local_8787='));
      assert.equal(await count(), n, 'no new dev session');
    }
    const entered = await r.call('/auth/dev/enter?as=owner', { key: DEV_KEY });
    assert.equal(entered.status, 303);
    const ownerDev = cookies(entered);
    assert.equal((await r.call('/auth/session', { cookie: ownerDev })).status, 200);
    assert.equal((await r.call('/auth/dev/enter?as=owner', { cookie: ownerDev })).status, 303);
    assert.equal(await count(), n + 1, 'owner session reused');
    await r.db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('backup','backup@example.com','Backup','owner','active',1)").run();
    await r.db.prepare("UPDATE oa_operators SET status='inactive' WHERE id='owner'").run();
    // The setup owner has left: `owner` is now the remaining active owner, named and signed in.
    assert.equal((await (await r.call('/__dev/personas', { key: DEV_KEY })).json()).find(persona => persona.as === 'owner').email, 'backup@example.com');
    const remaining = await r.call('/auth/dev/enter?as=owner', { key: DEV_KEY });
    assert.equal(remaining.status, 303);
    assert.equal((await (await r.call('/auth/session', { cookie: cookies(remaining) })).json()).operator.email, 'backup@example.com');
  } finally { await r.close(); }
});


test('owner-side CLI proof signs into the local dev entry without mail and fences that proof to the owner version', async () => {
  const r = await runtime([await read('../accounts/schema/operator-auth.sql'), await read('./fixtures/trigger-writes.sql')]);
  const headers = { 'x-rer-local-cli': createHmac('sha256', SECRET).update('local-cli\0sign-in').digest('hex') };
  try {
    assert.equal((await r.call('/auth/local/cli-session', { method: 'POST', input: {}, headers })).status, 403);
    await r.db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('owner',?,'Owner','owner','active',1)").bind(OWNER).run();
    for (const presented of [{}, { 'x-rer-local-cli': 'forged' }, { 'x-rer-dev-key': DEV_KEY }]) {
      assert.equal((await r.call('/auth/local/cli-session', { method: 'POST', input: {}, headers: presented })).status, 404);
    }
    assert.equal((await r.call('/auth/local/cli-session', { method: 'POST', input: {}, headers: { ...headers, Origin: 'https://elsewhere.example' } })).status, 403);
    const entered = await r.call('/auth/local/cli-session', { method: 'POST', input: { returnTo: '/setup', email: 'admin@dev.localhost' }, headers });
    assert.equal(entered.status, 303);
    assert.equal(entered.headers.get('location'), '/setup');
    const cookie = cookies(entered);
    const session = await (await r.call('/auth/session', { cookie })).json();
    assert.equal(session.kind, 'native');
    assert.equal(session.operator.email, OWNER);
    assert.ok(await r.db.prepare("SELECT 1 FROM test_auth_writes WHERE table_name='oa_step_up_challenges'").first(), 'the local proof also ran the product audit trigger');
    assert.equal((await r.db.prepare('SELECT count(*) AS n FROM test_mail').first()).n, 0);
    assert.equal((await r.call('/auth/settings/identity', { method: 'POST', cookie, input: { idpSignIn: false } })).status, 200, 'the private local proof authorizes an owner control without mail');
    await r.db.prepare("UPDATE oa_operators SET version=version+1 WHERE id='owner'").run();
    assert.equal((await r.call('/auth/session', { cookie })).status, 401);
    assert.equal((await r.call('/auth/local/cli-session', { method: 'POST', input: {}, headers })).status, 303);
  } finally { await r.close(); }
});
