import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { database, load } from '../operator-readiness/runtime.mjs';
import { openSnapshotCacheRuntime } from '../e2e/snapshot-cache-runtime.mjs';
import { claimKeys, signClaim } from '@runeditrun/rer/internal/modules/demo-host/claim.mjs';

test('host-configured signed owner claim creates a native Lamp session and refuses replay; a Business install opens its import door at the first bootstrap claim', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lamp-demo-claim-'));
  const storage = await database(directory);
  const cache = await openSnapshotCacheRuntime(directory);
  try {
    const { createApp } = await load('src/core/app/server.ts');
    const origin = 'https://demo.example.test', email = 'owner@demo.invalid', installationId = crypto.randomUUID();
    const keys = await claimKeys();
    const env = { DB: storage.db, SNAPSHOT_CACHE: cache.namespace, SNAPSHOTS: storage.bucket, LAMP_LOCAL_ORIGIN: origin,
      LAMP_APP_HOST: 'demo.example.test', LAMP_PAGE_HOST: 'page.demo.example.test', MAIL_FROM_ADDRESS: 'status@demo.invalid',
      OWNER_EMAIL: email, SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(), SETUP_TOKEN: crypto.randomUUID(),
      RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(keys.publicKeys), RER_OWNER_CLAIM_ISSUER: origin, RER_OWNER_CLAIM_INSTALLATION_ID: installationId };
    const { app } = createApp(env);
    const token = await signClaim(keys, { origin, installationId, email, now: Date.now() });
    const post = (claim, requestOrigin = origin) => app.fetch(new Request(origin + '/auth/owner-claim', {
      method: 'POST', headers: { Host: new URL(origin).host, Origin: requestOrigin, 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '192.0.2.1' }, body: new URLSearchParams({ token: claim }),
    }), env);
    assert.equal((await post(token, 'https://foreign.example.test')).status, 403, 'origin must match configured authority');
    const unrelated = await claimKeys();
    assert.equal((await post(await signClaim(unrelated, { origin, installationId, email, now: Date.now() }))).status, 403, 'a visitor cannot choose its own claim key');
    const admitted = await post(token);
    assert.equal(admitted.status, 303);
    const cookie = admitted.headers.get('set-cookie').split(';')[0];
    const session = await app.fetch(new Request(origin + '/api/app/session', { headers: { Host: new URL(origin).host, Cookie: cookie, 'CF-Connecting-IP': '192.0.2.1' } }), env);
    assert.equal(session.status, 200);
    assert.equal((await session.json()).operator.email, email);
    assert.notEqual((await post(token)).status, 303, 'consumed native claim cannot be replayed');
    const providerBindings = { ...env, AI_PROVIDER_URL: 'https://ai.example.invalid/v1', AI_PROVIDER_MODEL: 'test', AI_PROVIDER_API_KEY: 'synthetic-test-credential' };
    const authorized = path => new Request(origin + path, { headers: { Host: new URL(origin).host, Cookie: cookie } });
    const ordinary = createApp(providerBindings).app;
    assert.equal((await (await ordinary.fetch(authorized('/api/app/ai/status'), providerBindings)).json()).configured, true);
    const demoBindings = { ...providerBindings, RER_DEMO: '1' }, demo = createApp(demoBindings).app;
    assert.equal((await (await demo.fetch(authorized('/api/app/ai/status'), demoBindings)).json()).configured, true, 'demo offers suggestions through its demo effect');

    await businessDoorAtFirstClaim(createApp);

  } finally { await cache.dispose(); await storage.runtime.dispose(); await rm(directory, { recursive: true, force: true }); }
});

const doorOrigin = 'https://status-admin.example.test', doorEmail = 'owner@lamp.invalid', issuer = 'https://business.example.test', kid = 'business-1';
const json64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const keyPair = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });

/** A Business-provisioned install opens its import door at the first bootstrap claim, and only there. */
async function businessDoorAtFirstClaim(createApp) {
  const directory = await mkdtemp(join(tmpdir(), 'lamp-door-claim-'));
  const rer = keyPair(), stranger = keyPair();
  const installs = [];
  // One fresh installation as RER provisions it: bootstrap claim mode (a setup
  // token) with RER's owner-claim trust, and `RER_IMPORT_DOOR` as given.
  async function install(door) {
    const state = join(directory, String(installs.length));
    const storage = await database(state), cache = await openSnapshotCacheRuntime(state);
    installs.push(storage, cache);
    const installationId = randomUUID(), setupToken = randomUUID();
    const env = { DB: storage.db, SNAPSHOT_CACHE: cache.namespace, SNAPSHOTS: storage.bucket, AUTH_ORIGIN: doorOrigin,
      LAMP_APP_HOST: new URL(doorOrigin).host, LAMP_PAGE_HOST: 'status.example.test', MAIL_FROM_ADDRESS: 'status@lamp.invalid',
      OWNER_EMAIL: doorEmail, SESSION_SECRET: randomUUID() + randomUUID(), SETUP_TOKEN: setupToken,
      RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify({ [kid]: rer.publicKey.export({ format: 'jwk' }) }),
      RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId, RER_OWNER_CLAIM_APP_ORIGIN: doorOrigin,
      ...(door ? { RER_IMPORT_DOOR: door } : {}) };
    const { app } = createApp(env);
    const call = (path, init = {}) => app.fetch(new Request(doorOrigin + path, { ...init,
      headers: { Host: new URL(doorOrigin).host, Origin: doorOrigin, 'CF-Connecting-IP': '192.0.2.1', ...init.headers } }), env);
    const claim = token => call('/auth/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, displayName: 'Owner' }) });
    let cookie;
    const settings = async () => (await (await call('/api/app/import-door/settings', { headers: { Cookie: cookie } })).json()).enabled;
    const choose = async enabled => assert.equal((await call('/api/app/import-door/settings', { method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })).status, 200);
    // RER's upload grant through the public grant door, with one real chunk.
    const upload = async ({ key = rer.privateKey, installation = installationId } = {}) => {
      const bytes = Buffer.from(JSON.stringify({ source: 'statuspage', files: [] }));
      const iat = Math.floor(Date.now() / 1000), sha = createHash('sha256').update(bytes).digest('hex');
      const input = `${json64({ alg: 'ES256', typ: 'rer-import-grant+jwt', kid })}.${json64({ v: 1, iss: issuer, aud: doorOrigin,
        installationId: installation, email: doorEmail, jti: randomUUID(), iat, exp: iat + 300, action: 'uploads', namespace: 'statuspage',
        maxBytes: 1 << 20, maxChunks: 4, maxRecords: 100 })}`;
      const grant = `${input}.${sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
      const response = await call('/api/rer/import/uploads', { method: 'POST', headers: { Authorization: `Bearer ${grant}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'statuspage.json', bundleSha256: sha, totalBytes: bytes.length, totalChunks: 1, index: 0, chunkSha256: sha, base64: bytes.toString('base64') }) });
      return { status: response.status, body: await response.json() };
    };
    return { setupToken, claim, settings, choose, upload, signIn(response) { cookie = response.headers.get('set-cookie').split(';')[0]; } };
  }
  try {
    const business = await install('on');
    assert.equal((await business.upload()).status, 404, 'no door before the owner claims');
    assert.equal((await business.claim(randomUUID())).status, 403, 'a claim without the setup token is refused');
    assert.equal((await business.upload()).status, 404, 'a refused claim opens nothing');
    const claimed = await business.claim(business.setupToken);
    assert.equal(claimed.status, 303, 'Lamp keeps its bootstrap claim alongside RER trust');
    business.signIn(claimed);
    assert.equal(await business.settings(), true, 'the first owner claim opened the door');
    const accepted = await business.upload();
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.match(accepted.body.uploadId, /\S/);
    assert.deepEqual(await business.upload({ installation: randomUUID() }), { status: 403, body: { error: 'invalid_grant' } }, 'a grant for another installation is refused');
    assert.deepEqual(await business.upload({ key: stranger.privateKey }), { status: 403, body: { error: 'invalid_grant' } }, 'a grant signed by another key is refused');
    await business.choose(false);
    assert.equal((await business.upload()).status, 404, 'the owner turned the door off');
    assert.equal((await business.claim(business.setupToken)).status, 409, 'a second claim is refused');
    assert.equal(await business.settings(), false, 'and does not reopen the door');
    assert.equal((await business.upload()).status, 404);
    await business.choose(true);
    assert.equal((await business.upload()).status, 200, 'the owner can turn the door back on');

    const selfHost = await install(undefined);
    const owner = await selfHost.claim(selfHost.setupToken);
    assert.equal(owner.status, 303);
    selfHost.signIn(owner);
    assert.equal(await selfHost.settings(), false, 'without RER_IMPORT_DOOR=on the first claim leaves the door off');
    assert.equal((await selfHost.upload()).status, 404);
    await selfHost.choose(true);
    assert.equal((await selfHost.upload()).status, 200, 'its trust is read for door grants once the owner opts in');
  } finally {
    for (const runtime of installs.reverse()) await (runtime.dispose ?? (() => runtime.runtime.dispose()))();
    await rm(directory, { recursive: true, force: true });
  }
}
