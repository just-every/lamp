import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { database, load } from '../operator-readiness/runtime.mjs';
import { openSnapshotCacheRuntime } from '../e2e/snapshot-cache-runtime.mjs';
import { claimKeys, signClaim } from '@runeditrun/rer/internal/modules/demo-host/claim.mjs';

test('host-configured signed owner claim creates a native Lamp session and refuses replay', async () => {
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
    assert.equal((await storage.db.prepare('SELECT kind FROM oa_sessions').first()).kind, 'native');
    const providerBindings = { ...env, AI_PROVIDER_URL: 'https://ai.example.invalid/v1', AI_PROVIDER_MODEL: 'test', AI_PROVIDER_API_KEY: 'synthetic-test-credential' };
    const authorized = path => new Request(origin + path, { headers: { Host: new URL(origin).host, Cookie: cookie } });
    const ordinary = createApp(providerBindings).app;
    assert.equal((await (await ordinary.fetch(authorized('/api/app/ai/status'), providerBindings)).json()).configured, true);
    const demoBindings = { ...providerBindings, RER_DEMO: '1' }, demo = createApp(demoBindings).app;
    assert.equal((await (await demo.fetch(authorized('/api/app/ai/status'), demoBindings)).json()).configured, true, 'demo offers suggestions through its demo effect');

    const { seedDemoRecords } = await load('src/core/features/demo/repository.ts');
    const seed = { ownerEmail: email, now: new Date(), pageHost: env.LAMP_PAGE_HOST, from: env.MAIL_FROM_ADDRESS };
    await seedDemoRecords(storage.db, seed);
    const readComponents = async () => (await (await app.fetch(authorized('/api/app/components'), env)).json()).components;
    const before = await readComponents(), first = before[0];
    const changed = await app.fetch(new Request(origin + '/api/app/components/' + first.id, { method: 'PUT', headers: { Host: new URL(origin).host, Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId: first.groupId, name: first.name, description: 'An operator edit kept across seed retry', internal: first.internal, note: first.note }) }), env);
    assert.equal(changed.status, 200);
    await seedDemoRecords(storage.db, { ...seed, now: new Date(Date.now() + 60000) });
    const after = await readComponents();
    assert.deepEqual(after.map(row => row.id).sort(), before.map(row => row.id).sort(), 'seed retry creates no duplicate components');
    assert.equal(after.find(row => row.id === first.id).description, 'An operator edit kept across seed retry');

  } finally { await cache.dispose(); await storage.runtime.dispose(); await rm(directory, { recursive: true, force: true }); }
});
