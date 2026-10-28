import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { database, load } from '../operator-readiness/runtime.mjs';
import { authFixture, secret, setupToken } from './runtime.mjs';
import { moveInDoor } from '../helpers/import-notifications.mjs';

// Cutover's contract assertions share the surviving provider-import journey.
// Each stage owns and closes its fixtures and restores its mocks before the
// next stage; none of these calls register another Node test.
async function runCase(parent, label, run) {
  parent.diagnostic(label);
  const cleanups = [];
  const context = {
    diagnostic: message => parent.diagnostic(message),
    after: cleanup => cleanups.push(cleanup),
    mock: { method(...args) {
      const mocked = parent.mock.method(...args);
      cleanups.push(() => mocked.mock.restore());
      return mocked;
    } },
  };
  try { await run(context); }
  finally {
    const failures = [];
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Cutover fixture cleanup failed');
  }
}


const adapter = load('tests/auth-adoption/adapter.ts');
const linkToken = message => new URL(message.text.match(/https?:\/\/[^\s]+/)[0]).searchParams.get('token');
async function lampRuntime(t, { local = false, ownerClaim = false, registerRoutes } = {}) {
  const dir = await mkdtemp(join(process.cwd(), '.lamp-auth-correctness-'));
  const { runtime, db, baseMail, bucket } = await database(dir);
  t.after(async () => { await runtime.dispose(); await rm(dir, { recursive: true, force: true }); });
  const origin = local ? 'http://127.0.0.1:8912' : 'https://app.example.test';
  const base = authFixture(db, { origin });
  const modules = await adapter;
  const messages = [];
  const bindings = { DB: db, LAMP_APP_HOST: new URL(origin).host, AUTH_ORIGIN: origin, AUTH_LOCAL: String(local), SETUP_OPERATOR_EMAIL: 'owner@example.test', SESSION_SECRET: secret, SETUP_TOKEN: setupToken, MAIL_FROM_ADDRESS: 'lamp@example.test', RER_DEV_KEY: 'test-only-local-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  const auth = modules.createLampAuth(bindings, { configured: true, async send(message) { messages.push(message); } });
  const authHandle = modules.createAuthHandler(auth);
  const app = new Hono();
  app.use('/api/app/*', modules.requireOperator(() => auth));
  modules.registerOperatorRoutes(app, () => auth, 'page.example.test');
  // Mail and publication are the external effect boundaries. Routes, services,
  // identity authority and every import/erasure statement use real D1.
  let publications = 0;
  const subscribers = modules.createSubscribersService(modules.createSubscriberRepository(db), {
    mail: { configured: true, async send(message) { messages.push(message); return { providerMessageId: `captured-${messages.length}` }; } },
    fromAddress: 'lamp@example.test', tokenSecret: secret,
  });
  const imports = modules.createStatuspageImportService(db, { inviteSubscriber: (id, authority) => subscribers.inviteImported(id, 'https://page.example.test', 'Test page', authority), async publicDataChanged() { publications++; } });
  modules.registerStatuspageImportRoutes(app, imports);
  modules.registerImportDoor(app, bindings, imports, async () => { publications++; }, () => auth);
  await registerRoutes?.({ app, db, modules });
  const request = (path, options = {}) => {
    const req = base.request(path, options);
    req.headers.set('CF-Connecting-IP', '192.0.2.10');
    for (const [name, value] of Object.entries(options.headers ?? {})) req.headers.set(name, value);
    return req;
  };
  const call = (path, options = {}) => app.fetch(request(path, options), bindings);
  if (ownerClaim) {
    // A consumed claim fixture is inserted before the store is initialized, as
    // required by Base's empty-store trigger. Its opaque IDs are attached below.
    await db.prepare("INSERT INTO oc_owner_claims(singleton,jti,installation_id,email,issued_at,expires_at,consumed_at,operator_id,session_id,completed) VALUES(1,'consumed-claim','fixture-installation','owner@example.test',1,10,2,'claim-actor','claim-session',1)").run();
    await db.prepare("INSERT INTO oc_idp_grants(issuer,client_id,jti,subject,sector_id) VALUES('https://idp.example.test','lamp-client','consumed-claim','personal-owner-subject','fixture-installation'),('https://other.example.test','other-client','consumed-claim','other-subject','other-installation')").run();
  }
  const bootstrap = await base.handle(request('/auth/bootstrap', { method: 'POST', body: { token: setupToken, displayName: 'Owner' } }));
  assert.equal(bootstrap.status, 303);
  const cookie = await base.signIn();
  const owner = (await (await call('/api/app/session', { cookie })).json()).operator;
  if (ownerClaim) await db.batch([
    db.prepare('UPDATE oc_owner_claims SET operator_id=?,session_id=(SELECT id FROM oa_sessions WHERE operator_id=? LIMIT 1)').bind(owner.id, owner.id),
    db.prepare("UPDATE oc_idp_grants SET subject=? WHERE issuer='https://idp.example.test'").bind(`provider-person-${owner.id}`),
    db.prepare("INSERT INTO oa_external_identities(issuer,subject,operator_id) VALUES('https://idp.example.test',?,?)").bind(`provider-person-${owner.id}`, owner.id),
  ]);
  async function invite(email, accept = false) {
    assert.equal((await call('/api/app/operators/invite', { method: 'POST', cookie, body: { email, displayName: 'Invited Person' } })).status, 202);
    const token = linkToken(messages.at(-1));
    const target = await db.prepare('SELECT id FROM oa_operators WHERE email=?').bind(email).first();
    if (!accept) return { id: target.id, token };
    const accepted = await base.handle(request('/auth/confirm', { method: 'POST', body: { token } }));
    assert.equal(accepted.status, 303);
    return { id: target.id, token, cookie: accepted.headers.get('set-cookie').split(';')[0] };
  }
  async function providerSession(id) {
    await db.prepare('UPDATE oa_auth_settings SET idp_sign_in=1').run();
    await db.prepare(`INSERT OR IGNORE INTO oa_identity_providers(provider_id,preset,status,issuer,client_id,jwks_uri,authorization_endpoint,token_endpoint,algorithms,token_auth_method,response_iss,linked_at)
      VALUES('auth','auth','linked','https://idp.example.test','lamp-client','https://idp.example.test/jwks','https://idp.example.test/authorize','https://idp.example.test/token','["ES256"]','private_key_jwt',1,1)`).run();
    const pin = await db.prepare('SELECT provider_id AS id,issuer,client_id AS clientId,linked_at AS linkedAt FROM oa_identity_providers').first();
    const person = await db.prepare('SELECT id,version FROM oa_operators WHERE id=?').bind(id).first();
    const generation = (await db.prepare('SELECT generation FROM oa_auth_settings').first()).generation;
    // The server-only admission boundary receives a verified provider principal.
    // Its pin/binding/session transaction is Base's real implementation.
    const issued = await base.auth.accounts.bindAndIssueSession({ person, principal: { issuer: 'https://idp.example.test', subject: `provider-person-${id}`, sid: `provider-session-${id}`, providerGeneration: generation, providerPin: pin }, returnTo: '/app' });
    assert.ok(issued);
    return issued.cookie.split(';')[0];
  }
  async function stepUp(actorCookie) {
    assert.equal((await base.handle(request('/auth/step-up', { method: 'POST', cookie: actorCookie, body: { action: 'delete', returnTo: '/app/settings' } }))).status, 202);
    const response = await base.handle(request('/auth/confirm', { method: 'POST', cookie: actorCookie, body: { token: linkToken(base.messages.at(-1)) } }));
    assert.equal(response.status, 303);
  }
  return { db, baseMail, bucket, app, bindings, auth, authHandle, base, request, call, cookie, owner, messages, invite, providerSession, stepUp, modules, get publications() { return publications; } };
}

const source = (name = 'imported', count = 1) => [{ name: 'page.json', text: JSON.stringify({ id: 'synthpage01', viewers_must_be_team_members: false, ip_restrictions: null }) }, { name: 'page-access-groups.json', text: '[]' }, { name: 'components.json', text: JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: `${name}-${i}`, name: `${name} ${i}`, position: i, status: 'operational', created_at: '2026-01-01T00:00:00Z' }))) }];
/** Move in's door client as this signed-in session. */
const moveIn = (r, cookie) => moveInDoor(async (path, body, headers) => {
  const response = await r.call(path, { method: body === undefined ? 'GET' : 'POST', cookie, body, headers });
  return { status: response.status, body: await response.json() };
});
/** A reviewed dry run of saved responses, ready to apply. */
async function preview(r, cookie, files) {
  const response = await moveIn(r, cookie).preview({ files });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}
async function suspendedBody(r, path, cookie, body, headers = {}) {
  let release, reading;
  const paused = new Promise(resolve => { reading = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  const stream = new ReadableStream({ async pull(controller) { reading(); await released; controller.enqueue(new TextEncoder().encode(JSON.stringify(body))); controller.close(); } }, { highWaterMark: 0 });
  const request = r.request(path, { method: 'POST', cookie, headers: { 'Content-Type': 'application/json', ...headers } });
  const response = r.app.fetch(new Request(request, { body: stream, duplex: 'half', headers: request.headers }), r.bindings);
  await Promise.race([paused, response.then(() => { throw new Error("Request finished before reading the streamed body"); })]);
  return { response, release };
}


const adapters = load('src/core/platform/mail/index.ts');

// Real routes, native authority, sender preparation and D1/R2. Only the remote
// provider boundary is faked; no actual provider/account request is allowed.
async function exerciseMailPreparation(t, apply) {
  const { SendGridMailSender, ResendMailSender, createMailSendRepository, MailPreparationError } = await adapters;
  for (const failure of ['sendgrid-ledger', 'sendgrid-envelope', 'sendgrid-key', 'sendgrid-ambiguous', 'resend-request', 'resend-ambiguous', 'extension-prepare', 'extension-ambiguous']) await runCase(t, failure, async t => {
    const r = await lampRuntime(t);
    const imported = await apply(r);
    const rows = (await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results;
    const journal = (await r.db.prepare('SELECT * FROM ik_provenance ORDER BY ordinal').all()).results;
    let broken = true;
    const remote = [], originalFetch = globalThis.fetch;
    t.mock.method(globalThis, 'fetch', async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (['api.sendgrid.com', 'api.resend.com'].includes(url.hostname)) {
        remote.push(await request.json());
        if (broken && failure.endsWith('-ambiguous') && !failure.startsWith('extension')) throw Error('Provider acceptance unknown');
        return url.hostname === 'api.sendgrid.com' ? new Response(null, {status: 202}) : Response.json({id: `receipt-${remote.length}`});
      }
      if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return originalFetch(input, init);
      throw Error('The invitation proof forbids external network');
    });
    const app = new Hono();
    app.use('/api/app/*', r.modules.requireOperator(() => r.auth));
    r.modules.registerStatuspageImportRoutes(app, r.modules.createStatuspageImportService(r.db, {
      async inviteSubscriber(id, claim) {
        const fromAddress = broken && failure.endsWith('-envelope') ? 'invalid-address' : 'lamp@example.test';
        const apiKey = broken && failure === 'resend-request' ? 'invalid\nheader' : broken && failure === 'sendgrid-key' ? ' ' : 'test-only-key';
        const resend = new ResendMailSender({apiKey, fromAddress});
        const mail = failure.startsWith('sendgrid')
          ? new SendGridMailSender({apiKey, fromAddress}, createMailSendRepository(r.db))
          : failure.startsWith('extension') ? {configured: true, async send(message) {
            if (broken && failure === 'extension-prepare') throw new MailPreparationError(Error('Extension preparation failed'));
            const result = await resend.send(message);
            if (broken) throw Object.assign(Error('Extension acceptance unknown'), {name: 'MailPreparationError', retryable: true});
            return result;
          }} : resend;
        return r.modules.createSubscribersService(r.modules.createSubscriberRepository(r.db), {mail, tokenSecret: secret, fromAddress})
          .inviteImported(id, 'https://page.example.test', 'Test page', claim);
      },
      async publicDataChanged() {},
    }));
    const attempt = () => app.fetch(r.request(`/api/app/statuspage-import/jobs/${imported.job.id}/send-invitations`, {method: 'POST', cookie: r.cookie, body: {}}), r.bindings);
    if (failure === 'sendgrid-ledger') await r.db.prepare("CREATE TRIGGER refuse_ledger_preparation BEFORE INSERT ON mail_send_ledger BEGIN SELECT RAISE(ABORT, 'Local mail ledger unavailable'); END").run();
    assert.equal((await attempt()).status, 409);
    const ambiguous = failure.endsWith('-ambiguous');
    assert.equal((await r.db.prepare('SELECT count(*) n FROM statuspage_import_invites WHERE sent_at IS NOT NULL').first()).n, ambiguous ? 1 : 0);
    assert.equal(remote.length, ambiguous ? 1 : 0, 'preparation failure never reaches the provider');
    broken = false;
    if (failure === 'sendgrid-ledger') await r.db.prepare('DROP TRIGGER refuse_ledger_preparation').run();
    assert.ok((await Promise.all([attempt(), attempt()])).every(response => response.status === 200));
    assert.equal((await attempt()).status, 200);
    assert.equal((await r.db.prepare('SELECT count(*) n FROM statuspage_import_invites WHERE sent_at IS NOT NULL').first()).n, 2);
    const messages = remote;
    assert.equal(messages.length, 2, 'both addresses get one handoff after repair, including concurrent and repeated actions');
    assert.equal(new Set(messages.map(message => JSON.stringify(message.to ?? message.personalizations[0].to))).size, 2);
    assert.deepEqual((await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results, rows);
    assert.deepEqual((await r.db.prepare('SELECT * FROM ik_provenance ORDER BY ordinal').all()).results, journal);
  });
}

// Pause a real D1 token write after it commits. The old split revoke/lookup
// path pauses between those operations; the atomic path pauses after its batch.
// All statements and returned rows come from the migrated workerd database.
function holdConfirmationWrite(db, subscriberId) {
  const entered = Promise.withResolvers(), released = Promise.withResolvers();
  const statements = new WeakMap();
  let armed = true;
  const matches = ({ sql, args }) => /(?:UPDATE|INSERT INTO)\s+["`]?subscriber_tokens/i.test(sql) && args.includes('confirm') && args.includes(subscriberId);
  async function hold() {
    if (!armed) return;
    armed = false; entered.resolve(); await released.promise;
  }
  function wrap(native, sql, args = []) {
    const proxy = new Proxy(native, { get(target, property) {
      if (property === 'bind') return (...values) => wrap(target.bind(...values), sql, values);
      const value = Reflect.get(target, property);
      if (['run', 'all', 'raw', 'first'].includes(property)) return async (...values) => {
        const result = await value.apply(target, values);
        if (matches({ sql, args })) await hold();
        return result;
      };
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    statements.set(proxy, { native, sql, args });
    return proxy;
  }
  return {
    binding: new Proxy(db, { get(target, property) {
      if (property === 'prepare') return sql => wrap(target.prepare(sql), sql);
      if (property === 'batch') return async batch => {
        const metadata = batch.map(statement => statements.get(statement));
        const result = await target.batch(batch.map((statement, i) => metadata[i]?.native ?? statement));
        if (metadata.some(statement => statement && matches(statement))) await hold();
        return result;
      };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } }),
    async wait() {
      let timeout;
      try { await Promise.race([entered.promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Confirmation write was not reached')), 10_000); })]); }
      finally { clearTimeout(timeout); }
    },
    release: () => released.resolve(),
  };
}


const fixture = family => readdirSync(`tests/fixtures/statuspage/${family}`).map(name => ({ name, text: readFileSync(`tests/fixtures/statuspage/${family}/${name}`, 'utf8') }));
const endpoint = id => `/api/app/statuspage-import/jobs/${id}`;
async function apply(r, files, cookie = r.cookie) {
  const response = await moveIn(r, cookie).apply(await preview(r, cookie, files));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.job.state, 'completed');
  return response.body;
}
const send = (r, id, cookie = r.cookie) => r.call(`${endpoint(id)}/send-invitations`, { method: 'POST', cookie, body: {} });


export async function cutoverContractFlow(t) {
await runCase(t, "MOVE-012 MOVE-006 MOVE-013 — Owner-approved cutover invitations and preparation failure recovery", async t => {
  t.diagnostic("MOVE-006 — dry runs and saved cutover previews carry truthful destinations and mail waits for the owner across batches and repeats");
  await runCase(t, 'Cutover lifecycle stage', async t => {
  const r = await lampRuntime(t);
  t.diagnostic("MOVE-012 — documented private Statuspage pages and unknown visibility are refused before preview or apply writes");
  const publicFiles = fixture('small');
  const privatePage = readFileSync('tests/fixtures/statuspage/private/page.json', 'utf8');
  const withoutVisibility = publicFiles.filter(file => !['page.json', 'page-access-groups.json'].includes(file.name));
  for (const visibility of [
    [],
    [{ name: 'page.json', text: privatePage }, { name: 'page-access-groups.json', text: '[]' }],
    [{ name: 'page.json', text: '{}' }, { name: 'page-access-groups.json', text: '[]' }],
    [{ name: 'page.json', text: JSON.stringify({ id: 'synthpage01', viewers_must_be_team_members: false, ip_restrictions: '192.0.2.0/24' }) }, { name: 'page-access-groups.json', text: '[]' }],
    [{ name: 'page.json', text: JSON.stringify({ id: 'synthpage01', viewers_must_be_team_members: false, ip_restrictions: null }) }, { name: 'page-access-groups.json', text: '[{"id":"team-only"}]' }],
  ]) {
    const files = [...withoutVisibility, ...visibility];
    // Move in's one import path is the owner door: the dry run is refused there.
    const response = await moveIn(r, r.cookie).preview({ files });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.match(response.body.error, /visibility|private|restricted|audience/i);
    // No plan exists to apply, so an apply naming one writes nothing either.
    const direct = await moveIn(r, r.cookie).door('statuspage', 'apply', { planId: 'plan-never-made', reviewedFingerprint: '0'.repeat(64) });
    assert.equal(direct.status, 409, JSON.stringify(direct.body));
    assert.match(direct.body.error, /changed since the dry run/);
    assert.equal((await r.db.prepare('SELECT count(*) n FROM components').first()).n, 0);
    assert.equal((await r.db.prepare('SELECT count(*) n FROM ik_jobs').first()).n, 0);
  }
  const files = fixture('small');
  files.find(file => file.name === 'subscribers.json').text = JSON.stringify(Array.from({length: 57}, (_, i) => ({ id: `subscriber-${i}`, email: `person-${i}@example.test`, mode: 'email', created_at: '2026-01-01T00:00:00Z' })));
  const dry = (await preview(r, r.cookie, files)).report.cutover;
  assert.ok(dry.rows.length > 0);
  assert.ok(dry.rows.every(row => /^\/(incidents\/INC|maintenance\/SCH)-\d+$/.test(row.target)));
  const result = await apply(r, files);
  const id = result.job.id;
  assert.deepEqual(result.report.cutover.rows, dry.rows);
  assert.equal(result.report.cutover.invitations.eligible, 57);
  for (const path of [endpoint(id), '/api/app/statuspage-import/jobs']) assert.equal((await r.call(path, {cookie:r.cookie})).status, 200);
  await moveIn(r, r.cookie).apply(result.door);
  await apply(r, files);
  assert.equal(r.messages.length, 0);
  assert.equal((await r.db.prepare('SELECT count(*) n FROM notification_deliveries').first()).n, 0);
  assert.equal((await send(r, id, '')).status, 401);
  const responses = await Promise.all([send(r, id), send(r, id)]);
  assert.ok(responses.every(response => response.status === 200));
  while ((await (await r.call(endpoint(id), {cookie:r.cookie})).json()).invites.remaining) assert.equal((await send(r, id)).status, 200);
  await send(r, id);
  assert.equal(r.messages.length, 57);
  assert.equal(new Set(r.messages.map(message => message.to)).size, 57);
  assert.equal(new Set(r.messages.map(message => message.idempotencyKey)).size, 57);
  assert.equal((await r.db.prepare('SELECT count(*) n FROM notification_deliveries').first()).n, 0);
  const large = await moveIn(r, r.cookie).preview({ files: fixture('large') });
  // Source overlaps this import, so the door plans it as this import's catch-up:
  // a shared source identity is replaced or unchanged, never created twice.
  assert.equal(large.status, 200, JSON.stringify(large.body));
  assert.ok(large.body.differences.replacements.length + large.body.differences.unchanged.length > 0);
  assert.ok(large.body.differences.additions.every(key => !large.body.differences.replacements.includes(key) && !large.body.differences.unchanged.includes(key)));
});
  t.diagnostic("MOVE-013 — invitation preparation failures remain retryable while ambiguous transport failures stay claimed");
  await runCase(t, 'Cutover lifecycle stage', async t => {
  await exerciseMailPreparation(t, r => apply(r, fixture('small')));
  for (const failure of ['origin', 'configuration', 'tokens', 'authority', 'transport']) await runCase(t, failure, async t => {
    const r = await lampRuntime(t);
    const imported = await apply(r, fixture('small'));
    let broken = true, cookie = r.cookie;
    const mail = { configured: true, async send(message) {
      r.messages.push(message);
      if (broken && failure === 'transport') throw Error('Transport result unknown');
    } };
    const subscriberService = r.modules.createSubscribersService(r.modules.createSubscriberRepository(r.db), {
      mail, tokenSecret: secret,
      async fromAddress() {
        if (broken && failure === 'configuration') return undefined;
        if (broken && failure === 'authority') await r.db.prepare('UPDATE oa_sessions SET revoked_at=1').run();
        return 'lamp@example.test';
      },
    });
    if (failure === 'tokens') await r.db.prepare("CREATE TRIGGER refuse_token_preparation BEFORE INSERT ON subscriber_tokens BEGIN SELECT RAISE(ABORT, 'Token preparation unavailable'); END").run();
    const app = new Hono();
    app.use('/api/app/*', r.modules.requireOperator(() => r.auth));
    r.modules.registerStatuspageImportRoutes(app, r.modules.createStatuspageImportService(r.db, {
      async inviteSubscriber(id, claim) {
        return subscriberService.inviteImported(id, broken && failure === 'origin' ? 'invalid-origin' : 'https://page.example.test', 'Test page', claim);
      },
      async publicDataChanged() {},
    }));
    const attempt = () => app.fetch(r.request(`${endpoint(imported.job.id)}/send-invitations`, {method:'POST', cookie, body:{}}), r.bindings);
    assert.equal((await attempt()).status, 409);
    const claims = (await r.db.prepare('SELECT count(*) n FROM statuspage_import_invites WHERE sent_at IS NOT NULL').first()).n;
    assert.equal(claims, failure === 'transport' ? 1 : 0, `${failure} consumes only a transport handoff`);
    assert.equal(r.messages.length, failure === 'transport' ? 1 : 0);
    broken = false;
    if (failure === 'tokens') await r.db.prepare('DROP TRIGGER refuse_token_preparation').run();
    if (failure === 'authority') cookie = await r.base.signIn();
    assert.ok((await Promise.all([attempt(), attempt()])).every(response => response.status === 200));
    assert.equal((await attempt()).status, 200);
    assert.equal(r.messages.length, 2, `${failure}: each address handed to transport once after repair`);
    assert.equal(new Set(r.messages.map(message => message.to)).size, 2);
  });
});
});



await runCase(t, "MOVE-013 MOVE-006 TEAM-007 — Imported invitation expiry audit, revoked authority and public subscription races", async t => {
  t.diagnostic("MOVE-013 — delayed invitations retain the original expiry and undo rows; expired pending subscribers are not sent mail");
  await runCase(t, 'Cutover lifecycle stage', async t => {
  const r = await lampRuntime(t, { registerRoutes: ({ app, db, modules }) => modules.registerAuditLogRoutes(app, modules.createAuditLogRepository(db)) });
  const result = await apply(r, fixture('small'));
  const rows = (await r.db.prepare("SELECT id,created_at,updated_at FROM subscribers ORDER BY id").all()).results;
  const delayed = new Date(Date.now() - 48*60*60*1000).toISOString();
  const expired = new Date(Date.now() - 73*60*60*1000).toISOString();
  // Simulate the persisted native rows at a later date without mocking the clock.
  await r.db.prepare('UPDATE subscribers SET created_at=? WHERE id=?').bind(delayed, rows[0].id).run();
  await r.db.prepare('UPDATE subscribers SET created_at=? WHERE id=?').bind(expired, rows[1].id).run();
  const before = (await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results;
  const journal = (await r.db.prepare('SELECT * FROM ik_provenance ORDER BY ordinal').all()).results;
  const read = (await (await r.call(endpoint(result.job.id), {cookie:r.cookie})).json()).report.cutover;
  assert.equal(read.invitations.eligible, 1); assert.equal(read.invitations.expired, 1);
  assert.equal((await send(r, result.job.id)).status, 200);
  assert.equal((await send(r, result.job.id)).status, 200);
  assert.equal(r.messages.length, 1);
  const deadline = new Date(Date.parse(delayed)+72*60*60*1000).toISOString();
  assert.ok(r.messages[0].text.includes(deadline));
  const token = await r.db.prepare("SELECT expires_at FROM subscriber_tokens WHERE subscriber_id=? AND scope='confirm' AND revoked_at IS NULL").bind(rows[0].id).first();
  assert.equal(token.expires_at, deadline);
  assert.deepEqual((await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results, before);
  assert.deepEqual((await r.db.prepare('SELECT * FROM ik_provenance ORDER BY ordinal').all()).results, journal);
  const service = r.modules.createSubscribersService(r.modules.createSubscriberRepository(r.db), { tokenSecret: secret });
  await service.expirePending(); await service.expirePending();
  const expiredAudit = (await r.db.prepare("SELECT * FROM audit_entries WHERE entity_id=? AND action='expired'").bind(rows[1].id).all()).results;
  assert.equal(expiredAudit.length, 1, 'imported pending expiry records exactly one audit event');
  assert.equal(expiredAudit[0].operator_id, null, 'the scheduler is the System actor');
  assert.equal(expiredAudit[0].payload_json, '{}', 'expiry retains no address');
  const sorryFiles = readdirSync('tests/fixtures/sorry/authenticated').map(name => ({ name, text: readFileSync(`tests/fixtures/sorry/authenticated/${name}`, 'utf8') }));
  const sorryReview = await moveIn(r, r.cookie).preview({ source: 'sorry', publicAccessAcknowledged: true, files: sorryFiles });
  assert.equal(sorryReview.status, 200, JSON.stringify(sorryReview.body));
  const sorry = await moveIn(r, r.cookie).apply(sorryReview.body);
  assert.equal(sorry.status, 200, JSON.stringify(sorry.body));
  const held = (await r.db.prepare("SELECT id FROM subscribers WHERE deactivation_reason='held for Sorry cutover'").all()).results;
  assert.ok(held.length, 'real Sorry import supplies held subscribers');
  const { expireHeldSorrySubscribers } = await load('src/core/features/statuspage-import/sorry-release.repository.ts');
  const future = Date.now() + 91 * 86400000;
  await expireHeldSorrySubscribers(r.db, future); await expireHeldSorrySubscribers(r.db, future);
  for (const row of held) {
    const audit = (await r.db.prepare("SELECT * FROM audit_entries WHERE entity_id=? AND action='expired'").bind(row.id).all()).results;
    assert.equal(audit.length, 1, 'held Sorry expiry records exactly one System audit event');
    assert.equal(audit[0].operator_id, null); assert.equal(audit[0].payload_json, '{}');
  }
  const auditResponse = await r.call('/api/app/audit-log?action=expired&limit=100', { cookie: r.cookie });
  assert.equal(auditResponse.status, 200);
  const expiryEntries = (await auditResponse.json()).entries;
  for (const id of [rows[1].id, ...held.map(row => row.id)]) {
    const entries = expiryEntries.filter(entry => entry.entityId === id);
    assert.equal(entries.length, 1); assert.equal(entries[0].actorName, 'System');
  }
  const expiryCsv = await (await r.call('/api/app/audit-log?action=expired&format=csv', { cookie: r.cookie })).text();
  for (const entry of expiryEntries) assert.ok(expiryCsv.includes(`"${entry.id}"`));
  assert.equal(expiryCsv.trimEnd().split('\r\n').length - 1, expiryEntries.length);
});
  t.diagnostic("MOVE-006 — owner revocation before an invitation action sends nothing; saved large previews cap rows without losing the count");
  await runCase(t, 'Cutover lifecycle stage', async t => {
  const r = await lampRuntime(t);
  const cookie = await r.providerSession(r.owner.id);
  const result = await apply(r, fixture('small'), cookie);
  const pending = await suspendedBody(r, `${endpoint(result.job.id)}/send-invitations`, cookie, {});
  try { await r.db.prepare("UPDATE oa_identity_providers SET status='unlinked'").run(); }
  finally { pending.release(); }
  assert.equal((await pending.response).status, 409);
  assert.equal(r.messages.length, 0);
  assert.equal((await r.db.prepare('SELECT count(*) n FROM statuspage_import_invites').first()).n, 0);
  const other = await lampRuntime(t);
  const cutover = (await preview(other, other.cookie, fixture('large'))).report.cutover;
  assert.ok(cutover.rows.length <= 25); assert.ok(cutover.total > cutover.rows.length);
  assert.ok(cutover.rows.every(row => row.address && row.path && row.target));
});
  t.diagnostic("MOVE-013 — public subscriptions racing owner invitations cannot extend either imported confirmation deadline");
  await runCase(t, 'Cutover lifecycle stage', async t => {
  const r = await lampRuntime(t);
  const result = await apply(r, fixture('small'));
  const rows = (await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results;
  const deadline = new Date(Date.now() + 15_000).toISOString();
  const createdAt = new Date(Date.parse(deadline) - 72*60*60*1000).toISOString();
  await r.db.prepare('UPDATE subscribers SET created_at=?').bind(createdAt).run();
  const before = (await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results;
  const journal = (await r.db.prepare('SELECT * FROM ik_provenance ORDER BY ordinal').all()).results;
  const gate = holdConfirmationWrite(r.db, rows[0].id);
  const options = { tokenSecret: secret, fromAddress: 'lamp@example.test', mail: { configured: true, async send(message) { r.messages.push(message); } } };
  const publicApp = new Hono(), ownerApp = new Hono();
  const publicService = r.modules.createSubscribersService(r.modules.createSubscriberRepository(r.db), options);
  const invitationService = r.modules.createSubscribersService(r.modules.createSubscriberRepository(gate.binding), options);
  r.modules.registerSubscriberRoutes(publicApp, publicService);
  ownerApp.use('/api/app/*', r.modules.requireOperator(() => r.auth));
  r.modules.registerStatuspageImportRoutes(ownerApp, r.modules.createStatuspageImportService(r.db, {
    inviteSubscriber: (id, authority) => invitationService.inviteImported(id, 'https://page.example.test', 'Test page', authority),
    async publicDataChanged() {},
  }));
  const subscribe = email => publicApp.request('https://page.example.test/subscribe', { method: 'POST', body: new URLSearchParams({ email }) });
  // One public request commits before the owner's action. The other runs while
  // that action is held at its first real confirmation-token write.
  assert.equal((await subscribe(rows[1].destination)).status, 202);
  const sending = ownerApp.fetch(r.request(`${endpoint(result.job.id)}/send-invitations`, { method:'POST', cookie:r.cookie, body:{} }), r.bindings);
  try {
    await gate.wait();
    assert.equal((await subscribe(rows[0].destination)).status, 202);
  } finally { gate.release(); }
  assert.equal((await sending).status, 200);
  const invitations = r.messages.filter(message => message.idempotencyKey?.startsWith('subscriber-import-invite/'));
  assert.equal(invitations.length, 2);
  const expiries = [];
  for (const row of rows) {
    const tokens = (await r.db.prepare("SELECT expires_at FROM subscriber_tokens WHERE subscriber_id=? AND scope='confirm' AND revoked_at IS NULL").bind(row.id).all()).results;
    expiries.push(tokens);
    assert.ok(invitations.find(message => message.to === row.destination).text.includes(deadline));
  }
  assert.deepEqual((await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results, before);
  assert.deepEqual((await r.db.prepare('SELECT * FROM ik_provenance ORDER BY ordinal').all()).results, journal);
  assert.equal((await send(r, result.job.id)).status, 200);
  assert.equal(r.messages.length, 4, 'each public request and one claimed invitation per address sends once');
  assert.ok(Date.now() < Date.parse(deadline), 'the racing requests completed before expiry');
  await new Promise(resolve => setTimeout(resolve, Date.parse(deadline) - Date.now() + 100));
  for (const invitation of invitations) {
    const link = invitation.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/u)[0];
    assert.equal((await publicApp.request(link)).status, 404, 'the raced invitation cannot activate after its displayed deadline');
  }
  assert.deepEqual(expiries, rows.map(() => [{ expires_at: deadline }]));
  assert.deepEqual((await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results, before);
  // A separate, explicit opt-in after opting out still gets a fresh window,
  // independent of its old import window.
  const unsubscribe = invitations[0].text.match(/https?:\/\/\S+\/unsubscribe\/\S+/u)[0];
  assert.equal((await publicApp.request(unsubscribe, { method:'POST', body:new URLSearchParams({ 'List-Unsubscribe':'One-Click' }) })).status, 200);
  await r.db.prepare("UPDATE subscriber_confirmation_attempts SET last_sent_at='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await subscribe(invitations[0].to)).status, 202);
  const fresh = r.messages.at(-1).text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/u)[0];
  const renewed = await r.db.prepare('SELECT id,created_at FROM subscribers WHERE destination=?').bind(invitations[0].to).first();
  await publicService.expirePending();
  assert.equal((await publicApp.request(fresh)).status, 200, 'cleanup after the original deadline preserves the renewed confirmation');
  const rejoined = await r.db.prepare('SELECT state,created_at FROM subscribers WHERE destination=?').bind(invitations[0].to).first();
  assert.deepEqual(rejoined, { state:'active', created_at:renewed.created_at });
  assert.equal((await publicApp.request(unsubscribe, {method:'POST', body:new URLSearchParams({'List-Unsubscribe':'One-Click'})})).status, 404, 'previous unsubscribe authority stays revoked');
  const currentUnsubscribe = r.messages.at(-1).text.match(/https?:\/\/\S+\/unsubscribe\/\S+/u)[0];
  assert.equal((await publicApp.request(currentUnsubscribe, {method:'POST', body:new URLSearchParams({'List-Unsubscribe':'One-Click'})})).status, 200);
  const beforeRejoin = r.messages.length;
  assert.equal((await subscribe(invitations[0].to)).status, 202);
  assert.equal(r.messages.length, beforeRejoin + 1, 'the address\'s own unsubscribe restores its allowance, so a rejoin gets a fresh confirmation (SUB-001)');
  assert.match(r.messages.at(-1).text, /confirm-subscription/);
  assert.equal((await subscribe(invitations[0].to)).status, 202);
  assert.equal(r.messages.length, beforeRejoin + 1, 'a repeated rejoin within 24 hours keeps the anti-bomb bound');
  await r.db.prepare("UPDATE subscriber_confirmation_attempts SET last_sent_at='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await subscribe(invitations[0].to)).status, 202);
  const finalPending = await r.db.prepare('SELECT created_at FROM subscribers WHERE id=?').bind(renewed.id).first();
  // The cleanup repository takes a 72-hour cutoff; advance that cutoff just
  // beyond the renewed deadline without changing the process or D1 clock.
  await r.modules.createSubscriberRepository(r.db).deleteExpiredPending(new Date(Date.parse(finalPending.created_at)+1).toISOString(), 3);
  assert.equal(await r.db.prepare('SELECT id FROM subscribers WHERE id=?').bind(renewed.id).first(), null, 'cleanup after the renewed deadline removes the unconfirmed address');
});
});
}
