import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';

async function wrapper() {
  const source = (await readFile(new URL('../scripts/delivery/rer-entry.template.mjs', import.meta.url), 'utf8'))
    .replace("import worker from './index.js';", "const worker = { fetch: () => new Response('application'), scheduled: () => 'scheduled', queue: () => 'queue' };")
    .replace("export * from './index.js';", '');
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
}
function grant(env, expiresAt = Date.now() + 60_000, releaseDigest = env.RER_RELEASE_DIGEST) {
  const payload = Buffer.from(JSON.stringify({ releaseDigest, expiresAt })).toString('base64url');
  return payload + '.' + createHmac('sha256', env.RER_PREVIEW_TOKEN).update(payload).digest('base64url');
}
test('preview grant authenticates assets and receipt with expiry and release binding', async () => {
  const worker = await wrapper();
  const env = { RER_PREVIEW_TOKEN: 'preview-secret', RER_RELEASE_DIGEST: 'release-one', RER_VERSION_METADATA: { id: 'version-one' } };
  const fetch = (path, headers) => worker.fetch(new Request('https://preview.example' + path, { headers }), env, {});
  assert.equal((await fetch('/app-assets/app.js')).status, 401);
  assert.equal((await fetch('/__rer/release')).status, 401);
  const token = grant(env);
  const response = await fetch('/?rer_preview_grant=' + token + '&x=1');
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/?x=1');
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=None/);
  const headers = { Cookie: '__Host-rer_preview=' + token };
  assert.equal(await (await fetch('/app-assets/app.js', headers)).text(), 'application');
  assert.deepEqual(await (await fetch('/__rer/release', headers)).json(), { releaseDigest: 'release-one', versionId: 'version-one' });
  assert.equal((await fetch('/__rer/release', { Authorization: 'Bearer preview-secret' })).status, 200);
  assert.equal((await fetch('/', { Authorization: 'Bearer preview-secret' })).status, 401);
  for (const invalid of [grant(env, Date.now() - 1), grant(env, Date.now() + 60_000, 'old-release'), token + 'x']) {
    assert.equal((await fetch('/?rer_preview_grant=' + invalid)).status, 401);
    assert.equal((await fetch('/', { Cookie: '__Host-rer_preview=' + invalid })).status, 401);
  }
  assert.equal(await worker.scheduled({}, env, {}), undefined);
  await assert.rejects(worker.queue({}, env, {}), /disabled/);
  assert.equal(await worker.scheduled({}, {}, {}), 'scheduled');
  assert.equal(await worker.queue({}, {}, {}), 'queue');
});
