import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, cp, copyFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { Hono } from 'hono';
import { authFixture, secret, setupToken } from './runtime.mjs';
import { load } from '../operator-readiness/runtime.mjs';
const exec = promisify(execFile);

async function checkout(root, destination) {
  await mkdir(destination, { recursive: true });
  const { stdout } = await exec('git', ['ls-files', '-z'], { cwd: root });
  for (const path of stdout.split('\0').filter(path => path && !path.includes('/'))) await copyFile(join(root, path), join(destination, path));
  for (const path of ['scripts', 'migrations', 'src', 'management']) await cp(join(root, path), join(destination, path), { recursive: true });
  await symlink(join(root, 'node_modules'), join(destination, 'node_modules'));
}
async function command(root, ...args) {
  // Each copied installation owns its own operation lock. The verifier's
  // checkout-local token cannot authorize an operation in this other checkout;
  // retain process custody so the verifier can still clean up its descendants.
  const { RER_LOCAL_OPERATION, ...environment } = process.env;
  try { return await exec(process.execPath, ['node_modules/@runeditrun/rer/bin/rer.mjs', ...args, '--json'], { cwd: root, env: { ...environment, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, maxBuffer: 4 * 1024 * 1024, timeout: 120000 }); }
  catch (error) {
    // Receipts carry symbolic errors only; never echo private archive or settings.
    const events = String(error.stdout ?? '').split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    throw new Error(`Native ${args[0]} failed: ${events.filter(e => e.event === 'error').map(e => e.code + ': ' + e.message).join('; ') || 'child exit ' + error.code}`);
  }
}
const proxy = root => getPlatformProxy({ configPath: join(root, 'wrangler.jsonc'), remoteBindings: false, persist: { path: join(root, '.wrangler/state/v3') } });

test('ACCESS-001 native rer archive restores owner continuity and subscriber authority without restoring sessions or provider approval', async () => {
  const root = process.cwd(), directory = await mkdtemp(join(root, '.lamp-auth-portability-'));
  const source = join(directory, 'source'), target = join(directory, 'target');
  let current;
  try {
    await checkout(root, source); await checkout(root, target);
    await command(source, 'export', '--output', join(directory, 'empty.rer'));
    current = await proxy(source);
    const db = current.env.DB, native = authFixture(db);
    await db.prepare("INSERT INTO oc_owner_claims(singleton,jti,installation_id,email,issued_at,expires_at,consumed_at,operator_id,session_id,completed) VALUES(1,'consumed-portable-claim','portable-installation','owner@example.test',1,10,2,'opaque-owner','opaque-session',1)").run();
    const bootstrap = await native.handle(native.request('/auth/bootstrap', { method: 'POST', body: { token: setupToken, displayName: 'Portable owner' } }));
    assert.equal(bootstrap.status, 303);
    const oldCookie = await native.signIn();
    const actor = await native.auth.getSession(native.request('/auth/session', { cookie: oldCookie }));
    await db.prepare('UPDATE oc_owner_claims SET operator_id=?,session_id=?').bind(actor.operator.id, actor.id).run();
    await db.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) VALUES('portable-audit','operator',?,'portable history',?,'{}','2026-10-01','2026-10-01')").bind(actor.operator.id, actor.operator.id).run();
    const pending = await native.auth.invite(native.request('/auth/invite', { method: 'POST', cookie: oldCookie }), { email: 'pending@example.test', displayName: 'Pending', role: 'owner' });
    assert.ok(pending);
    await db.prepare("INSERT INTO rer_dependency_pending(interface,issuer,approved_by,expires_at,approved_session,approved_version,callbacks,attempt_id) VALUES('oidc-provider@1','https://identity.example.test',?,9999999999999,?,1,'[]','pending-attempt')").bind(actor.operator.id, actor.id).run();
    await db.prepare("INSERT INTO rer_dependency_link(interface,issuer,client_id,metadata,needs_relink,linked_at) VALUES('oidc-provider@1','https://identity.example.test','portable-client','{}',0,1)").run();
    const { createSubscriberRepository, createSubscribersService, registerSubscriberRoutes } = await load('tests/auth-adoption/adapter.ts');
    const subscribers = createSubscribersService(createSubscriberRepository(db), { tokenSecret: 'portable-subscriber-secret', mail: { configured: false } });
    // Retain a real signed manage capability through the native archive.
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO subscribers(id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES('portable-reader','email','reader@example.test','reader@example.test','active','all','retained',?,?)").bind(now, now).run();
    const { SubscriberTokenCodec } = await load('src/core/features/subscribers/tokens.ts');
    const codec = new SubscriberTokenCodec('portable-subscriber-secret');
    const manage = await codec.encode({ id: 'portable-token', scope: 'manage' });
    await db.prepare("INSERT INTO subscriber_tokens(id,subscriber_id,scope,token_hash,created_at,updated_at) VALUES('portable-token','portable-reader','manage',?,?,?)").bind(await codec.hash(manage), now, now).run();
    const subscriberApp = new Hono(); registerSubscriberRoutes(subscriberApp, subscribers);
    assert.equal((await subscriberApp.fetch(new Request(native.origin + '/manage/' + manage))).status, 200);
    await current.dispose(); current = null;
    await command(source, 'export', '--output', join(directory, 'installation.rer'));
    await command(target, 'import', '--input', join(directory, 'installation.rer'), '--yes');
    current = await proxy(target);
    const restored = current.env.DB, fresh = authFixture(restored);
    assert.equal((await fresh.handle(fresh.request('/auth/bootstrap', { method: 'POST', body: { token: setupToken, displayName: 'Replacement' } }))).status, 409);
    assert.equal(await fresh.auth.getSession(fresh.request('/auth/session', { cookie: oldCookie })), null);
    const cookie = await fresh.signIn();
    const session = await fresh.auth.getSession(fresh.request('/auth/session', { cookie }));
    assert.equal(session.operator.id, actor.operator.id);
    assert.equal((await restored.prepare("SELECT operator_id FROM audit_entries WHERE id='portable-audit'").first()).operator_id, actor.operator.id);
    assert.equal((await restored.prepare('SELECT completed FROM oc_owner_claims').first()).completed, 1);
    assert.equal((await restored.prepare('SELECT COUNT(*) n FROM rer_dependency_pending').first()).n, 0);
    assert.equal((await restored.prepare('SELECT needs_relink FROM rer_dependency_link').first()).needs_relink, 1);
    assert.equal((await restored.prepare('SELECT idp_sign_in FROM oa_auth_settings').first()).idp_sign_in, 0);
    const restoredApp = new Hono();
    registerSubscriberRoutes(restoredApp, createSubscribersService(createSubscriberRepository(restored), { tokenSecret: 'portable-subscriber-secret' }));
    assert.equal((await restoredApp.fetch(new Request(fresh.origin + '/manage/' + manage))).status, 200);
    assert.equal((await restored.prepare("SELECT status FROM oa_operators WHERE email='pending@example.test'").first()).status, 'invited');
    assert.equal((await restored.prepare('SELECT COUNT(*) n FROM oa_tokens').first()).n, 1, 'only the newly consumed sign-in link exists after restore');
  } finally { await current?.dispose(); await rm(directory, { recursive: true, force: true }); }
});
