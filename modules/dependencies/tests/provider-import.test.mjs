import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runtime, ORIGIN, ISSUER } from './runtime.mjs';
import { createPortability, createPortabilityHandler } from '../../portability/index.mjs';
import { makePart, ContentVerifier, ArchiveVerifier, readArchive } from '../../portability/format.mjs';

const policy = { product: 'test/app', includeTables: ['oa_setup_links', 'oa_provider_session_pins', 'oa_operators', 'oa_bootstrap', 'oa_external_identities', 'oa_tokens', 'oa_invitation_cancellations', 'oa_auth_settings', 'oa_auth_audit', 'oa_domain_rules', 'oa_logout_events', 'oc_owner_claims', 'oc_idp_grants'] };
const migration = await readFile(new URL('../../portability/schema/portability.sql', import.meta.url), 'utf8');

async function login(app) {
  const start = await app.call('/auth/oidc/auth/start', { body: {} });
  assert.equal(start.status, 303);
  const grant = await app.idp.authorize(start.headers.get('location'));
  return app.call(`/auth/oidc/auth/callback?code=${grant.code}&state=${grant.state}`, { cookie: start.headers.get('set-cookie') });
}

async function archive(source, settings) {
  const service = await createPortability({ db: source.db, policy }), id = await service.exports.create();
  while ((await service.exports.advance(id, { maxParts: 16 })).phase === 'building') {}
  const records = (await new Response(await service.exports.download(id)).text()).trim().split('\n').map(JSON.parse);
  assert.equal(records.filter(record=>record.kind==='part').flatMap(part=>part.items).some(item=>item.table==='oa_setup_links'),false,'setup authority is never portable');
  const manifest = records[0], parts = [];
  for (const part of records.filter(record => record.kind === 'part')) {
    const items = part.items.filter(item => settings !== null || item.table !== 'oa_auth_settings');
    for (const item of items) if (item.table === 'oa_auth_settings') Object.assign(item.row, settings);
    if (items.length) parts.push(await makePart(parts.length, items));
  }
  if (settings === null) manifest.tables.find(table => table.name === 'oa_auth_settings').count = 0;
  manifest.partCount = parts.length;
  const verifier = new ContentVerifier(manifest);
  for (const part of parts) for (const item of part.items) verifier.add(item);
  const integrity = new ArchiveVerifier(manifest);
  for (const part of parts) integrity.add(part);
  const closing = { kind: 'closing', partCount: parts.length, contentHash: verifier.digest(), archiveHash: integrity.digest() };
  // Read the complete normal archive, including freshly computed part and content integrity.
  const checked = [];
  for await (const record of readArchive(new Response([manifest, ...parts, closing].map(JSON.stringify).join('\n') + '\n').body)) checked.push(record);
  return { manifest: checked[0], parts: checked.filter(record => record.kind === 'part'), contentHash: checked.at(-1).contentHash, archiveHash: checked.at(-1).archiveHash };
}

test('public import refuses enabled provider settings before applying data; valid off and absent settings survive approved re-link', async t => {
  const source = await runtime(t);
  await source.bootstrap(); await source.link(); assert.equal((await login(source)).status, 303);
  source.sqlite.exec(migration);
  const proof = await source.proof();
  for (const settings of [{ idp_sign_in: 1, first_setup: 0 }, { idp_sign_in: 0, first_setup: 1 }, { idp_sign_in: 0, first_setup: 0 }, null]) {
    await t.test(settings === null ? 'absent settings remain off' : JSON.stringify(settings), async t => {
      const target = await runtime(t); target.sqlite.exec(migration);
      const bundle = await archive(source, settings);
      // The control installation authorizes restoration with its actual native owner proof.
      const handler = await createPortabilityHandler({ db: target.db, policy, appOrigin: ORIGIN,
        authorize: async request => (await source.auth().requireStepUp(request, 'export')).operator.id });
      const call = (path, method, body) => handler(source.request('/api/portability/' + path, { method, body, cookie: proof }));
      const applicationTables = target.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'rer_portability_*' AND name NOT GLOB 'sqlite_*' ORDER BY name").all();
      const snapshot = () => Object.fromEntries(applicationTables.map(table => [table.name, target.sqlite.prepare(`SELECT * FROM "${table.name}"`).all()]));
      const before = snapshot();
      const created = await call('imports', 'POST', { manifest: bundle.manifest, confirmed: true });
      assert.equal(created.status, 201); const { id } = await created.json();
      for (const part of bundle.parts) assert.equal((await call(`imports/${id}/parts/${part.index}`, 'PUT', part)).status, 200);
      const finalized = await call(`imports/${id}/finalize`, 'POST', { contentHash: bundle.contentHash, archiveHash: bundle.archiveHash });
      if (settings?.idp_sign_in || settings?.first_setup) {
        assert.equal(finalized.status, 409);
        assert.deepEqual(await finalized.json(), { error: 'provider_sign_in_must_be_off' });
        assert.deepEqual(snapshot(), before, 'refusal leaves every destination application table unchanged');
        assert.equal((await (await call(`imports/${id}`, 'GET')).json()).phase, 'staging');
        assert.equal(target.sqlite.prepare('SELECT applying FROM rer_portability_state').get().applying, 0);
        assert.equal((await call(`imports/${id}/abort`, 'POST', {})).status, 200);
        t.diagnostic(JSON.stringify({ settings, finalize: finalized.status, targetUnchanged: true, applying: 0 }));
        return;
      }
      assert.equal(finalized.status, 200);
      assert.equal((await finalized.json()).contentHash, bundle.contentHash);
      const owner = await target.proof();
      const setting = async () => (await (await target.call('/auth/settings/identity', { cookie: owner })).json()).idpSignIn;
      assert.equal(await setting(), false);
      assert.equal((await target.call('/auth/oidc/auth/start', { body: {} })).status, 403);
      const sector = target.sqlite.prepare('SELECT sector_id FROM rer_dependency_installation').get();
      const bindings = target.sqlite.prepare('SELECT * FROM oa_external_identities').all();
      assert.equal((await target.call('/auth/dependencies/relink', { cookie: owner, body: { issuer: ISSUER } })).status, 200);
      assert.equal((await target.link()).status, 200);
      assert.deepEqual(target.sqlite.prepare('SELECT sector_id FROM rer_dependency_installation').get(), sector);
      assert.deepEqual(target.sqlite.prepare('SELECT * FROM oa_external_identities').all(), bindings);
      assert.equal(await setting(), false);
      assert.equal((await target.call('/auth/oidc/auth/start', { body: {} })).status, 403);
      assert.equal((await target.call('/auth/settings/identity', { cookie: owner, body: { idpSignIn: true } })).status, 200);
      const signed = await login(target); assert.equal(signed.status, 303);
      assert.equal((await target.call('/auth/session', { cookie: signed.headers.get('set-cookie') })).status, 200);
      t.diagnostic(JSON.stringify({ settings, finalize: finalized.status, afterImport: 'off', afterRelink: 'off', ownerEnabledCallback: signed.status, session: 200 }));
    });
  }
});
