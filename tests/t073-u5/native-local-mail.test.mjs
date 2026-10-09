import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { getPlatformProxy } from 'wrangler';
import { openSnapshotCacheRuntime } from '../e2e/snapshot-cache-runtime.mjs';
import { compileMailModules } from './compile-modules.mjs';

// Uses actual local workerd R2/D1, native repositories, services and Hono routes.
// It must run on the integrated branch: U0 wires request-bound mail and U1
// records captured attempts. No mail, authentication or repository mock is used.
let directory, platform, cache, vite, modules, createApp, createSessionRepository;
let bindings;
const origin = 'http://127.0.0.1:56800';
const operator = 'operator@u5.example.test';
const subscriber = 'subscriber@u5.example.test';
const operatorId = '01J00000000000000000000081';
const request = path => new Request(`${origin}${path}`);
let configPath;

async function reopenStorage() {
  await platform?.dispose();
  platform = await getPlatformProxy({ configPath, persist: { path: join(directory, 'state/v3') }, remoteBindings: false });
  bindings = { ...platform.env, SNAPSHOT_CACHE: cache.namespace, LAMP_APP_HOST: '127.0.0.1', LAMP_PAGE_HOST: '127.0.0.1', MAIL_FROM_ADDRESS: 'lamp@localhost.invalid' };
}

before(async () => {
  directory = await mkdtemp(resolve('.t073-u5-native-'));
  configPath = join(directory, 'wrangler.toml');
  const config = (await readFile('deploy/wrangler.template.toml', 'utf8')).replace(/^main = .*\n/m, '');
  await writeFile(configPath, `${config}\n[[r2_buckets]]\nbinding = "LAMP_DEV_OUTBOX"\nbucket_name = "lamp-local-development-outbox"\n`);
  execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', join(directory, 'state'), '--config', 'deploy/wrangler.template.toml'], { stdio: 'pipe' });
  cache = await openSnapshotCacheRuntime(directory);
  await reopenStorage();
  modules = await compileMailModules(true);
  vite = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false } });
  ({ createApp } = await vite.ssrLoadModule('/src/core/app/server.ts'));
  ({ createSessionRepository } = await vite.ssrLoadModule('/src/core/features/session/repository.ts'));
});
after(async () => {
  await platform?.dispose(); await cache?.dispose(); await vite?.close(); await modules?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function localRuntime(incoming = request('/')) {
  const prepared = await modules.mail.prepareDevelopmentMailBindings(bindings, incoming);
  return { runtime: createApp(prepared, incoming), prepared };
}
async function nativeFetch(path, init = {}) {
  const incoming = new Request(`${origin}${path}`, init);
  const { runtime, prepared } = await localRuntime(incoming);
  const pending = [];
  const response = await runtime.app.fetch(incoming, prepared, { waitUntil(work) { pending.push(work); }, passThroughOnException() {} });
  await Promise.all(pending);
  return response;
}
async function envelopes() {
  const response = await modules.routes.handleDevOutboxRequest(request('/__dev/outbox?format=json'), bindings);
  assert.equal(response.status, 200);
  return (await response.json()).envelopes;
}

 test('T073 U5 real local R2 captures once, persists across restart and keeps configuration private', async () => {
  const incoming = request('/signin/request');
  const sender = modules.mail.createDevelopmentMailSender(bindings, incoming);
  const message = { from: 'lamp@localhost.invalid', to: 'test@u5.example.test', subject: 'R2 durability', text: 'Stored locally', headers: { b: 'second', a: 'first' }, idempotencyKey: 't073-u5-r2-durability' };
  const results = await Promise.all([sender.send(message), sender.send({ ...message, headers: { a: 'first', b: 'second' } })]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].disposition, 'captured');
  assert.equal('providerMessageId' in results[0], false);
  await assert.rejects(sender.send({ ...message, text: 'Changed' }), /different envelope/);
  const prepared = await modules.mail.prepareDevelopmentMailBindings(bindings, incoming);
  assert.match(prepared.SUBSCRIBER_TOKEN_SECRET, /^[a-f0-9]{64}$/);
  await reopenStorage();
  const restarted = await modules.mail.prepareDevelopmentMailBindings(bindings, incoming);
  assert.equal(await modules.mail.resolveDevelopmentMailOrigin(bindings), origin);
  await assert.rejects(modules.mail.prepareDevelopmentMailBindings({ ...bindings, SUBSCRIBER_TOKEN_SECRET: prepared.SUBSCRIBER_TOKEN_SECRET }, new Request('http://127.0.0.1:56801/')), /differs from the persisted/);
  assert.equal(await modules.mail.resolveDevelopmentMailOrigin(bindings), origin, 'a changed request port cannot replace the canonical origin');
  assert.equal(restarted.SUBSCRIBER_TOKEN_SECRET, prepared.SUBSCRIBER_TOKEN_SECRET);
  const captured = (await envelopes()).filter(envelope => envelope.id === results[0].captureId);
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].message, { ...message, headers: { a: 'first', b: 'second' } });
  assert.equal((await bindings.SNAPSHOTS.list()).objects.length, 0, 'capture never uses the public/export bucket');
  assert.equal((await modules.routes.handleDevOutboxRequest(request('/__dev/outbox/configuration/subscriber-token-secret'), bindings)).status, 404);
});

test('T073 U5 native sign-in, confirmation and incident notification use real captured envelopes', async () => {
  const timestamp = new Date().toISOString();
  await createSessionRepository(bindings.DB).insertOperator({ id: operatorId, email: operator, displayName: 'U5 test operator', isSetupOperator: true, createdAt: timestamp, updatedAt: timestamp });
  const { runtime } = await localRuntime();
  await runtime.services.pageSettings.ensureInitial({ pageName: 'Local mail test', tagline: 'Native development journey', accentColor: '#123456', timezone: 'UTC', hostname: '127.0.0.1', footerCreditEnabled: true });
  assert.equal((await nativeFetch('/api/app/components')).status, 401);
  const unknownSignIn = await nativeFetch('/signin/request', { method: 'POST', body: new URLSearchParams({ email: 'unknown@u5.example.test' }) });
  assert.equal(unknownSignIn.status, 202);
  const unknownSignInBody = await unknownSignIn.text();
  assert.match(unknownSignInBody, /\/__dev\/outbox/);
  const signIn = await nativeFetch('/signin/request', { method: 'POST', body: new URLSearchParams({ email: operator }) });
  assert.equal(signIn.status, 202);
  assert.equal(await signIn.text(), unknownSignInBody, 'local response does not enumerate allowed operators');
  const signInEnvelope = (await envelopes()).find(envelope => envelope.message.to === operator && envelope.message.subject === 'Sign in to Lamp');
  assert.ok(signInEnvelope, 'native sign-in created an envelope');
  const signInUrl = signInEnvelope.message.text.match(/http:\/\/[^\s]+\/signin\/complete\/[^\s]+/)[0];
  const completed = await nativeFetch(new URL(signInUrl).pathname);
  assert.equal(completed.status, 302);
  const cookie = completed.headers.get('set-cookie').split(';')[0];
  assert.equal((await nativeFetch(new URL(signInUrl).pathname)).status, 400, 'native magic link remains single-use');
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  assert.equal((await nativeFetch('/api/app/session', { headers })).status, 200);
  const subscription = await nativeFetch('/subscribe', { method: 'POST', body: new URLSearchParams({ email: subscriber }) });
  assert.equal(subscription.status, 202);
  const subscriptionBody = await subscription.text();
  assert.match(subscriptionBody, /\/__dev\/outbox/);
  const repeatedSubscription = await nativeFetch('/subscribe', { method: 'POST', body: new URLSearchParams({ email: subscriber }) });
  assert.equal(repeatedSubscription.status, 202);
  assert.equal(await repeatedSubscription.text(), subscriptionBody, 'suppressed confirmation retains generic local response');
  const confirmation = (await envelopes()).find(envelope => envelope.message.to === subscriber && envelope.message.subject === 'Confirm your Lamp status subscription');
  assert.ok(confirmation, 'native subscription created a confirmation envelope');
  assert.equal((await bindings.DB.prepare('SELECT state FROM subscribers WHERE destination = ?').bind(subscriber).first()).state, 'pending');
  const confirmPath = new URL(confirmation.message.text.match(/http:\/\/[^\s]+\/confirm-subscription\/[^\s]+/)[0]).pathname;
  await reopenStorage();
  assert.equal((await nativeFetch(confirmPath)).status, 200, 'native confirmation survives local storage restart');
  assert.equal((await bindings.DB.prepare('SELECT state FROM subscribers WHERE destination = ?').bind(subscriber).first()).state, 'active');
  const componentResponse = await nativeFetch('/api/app/components', { method: 'POST', headers, body: JSON.stringify({ groupId: null, name: 'Local API', description: '', internal: false, displayOrder: 0, note: '' }) });
  assert.equal(componentResponse.status, 201);
  const { component } = await componentResponse.json();
  const incidentResponse = await nativeFetch('/api/app/incidents', { method: 'POST', headers, body: JSON.stringify({ title: 'Native local capture', components: [{ componentId: component.id, state: 'Degraded performance' }] }) });
  assert.equal(incidentResponse.status, 201);
  const { incident } = await incidentResponse.json();
  const draft = await nativeFetch(`/api/app/incidents/${incident.id}/draft`, { method: 'PUT', headers, body: JSON.stringify({ lifecycle: 'Investigating', affectedAudience: 'API customers', customerImpact: 'Requests are delayed', whatStillWorks: 'Reads remain available', details: '', nextUpdateAt: new Date(Date.now() + 60 * 60_000).toISOString() }) });
  assert.equal(draft.status, 200);
  const published = await nativeFetch(`/api/app/incidents/${incident.id}/publish`, { method: 'POST', headers, body: JSON.stringify({ channels: ['email'] }) });
  assert.equal(published.status, 200, await published.clone().text());
  const { update } = await published.json();
  const { runtime: dispatch } = await localRuntime();
  await dispatch.services.deliveries.dispatchEvent(update.id, origin);
  await dispatch.services.deliveries.dispatchEvent(update.id, origin);
  const notifications = (await envelopes()).filter(envelope => envelope.message.to === subscriber && envelope.message.idempotencyKey.startsWith('notification/'));
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].disposition, 'captured');
  assert.match(notifications[0].message.text, /Requests are delayed/);
  assert.equal(notifications[0].message.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const attempt = await bindings.DB.prepare('SELECT provider_message_id, local_capture_id FROM notification_delivery_attempts WHERE local_capture_id = ?').bind(notifications[0].id).first();
  assert.equal(attempt.provider_message_id, null);
  assert.equal(attempt.local_capture_id, notifications[0].id);
  const counts = await bindings.DB.prepare('SELECT COUNT(*) AS count FROM notification_delivery_attempts').first();
  assert.equal(counts.count, 1, 'redelivery does not repeat a captured attempt');
  assert.equal((await bindings.DB.prepare("SELECT COUNT(*) AS count FROM notification_deliveries WHERE outcome = 'delivered'").first()).count, 0);
  const snapshots = await bindings.SNAPSHOTS.list();
  assert.equal(snapshots.objects.some(object => object.key.startsWith('envelopes/') || object.key.startsWith('configuration/')), false);
});
