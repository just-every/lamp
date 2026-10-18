import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authFixture } from './runtime.mjs';
import { lampRuntime, moveIn, preview, source, suspendedBody } from './lamp-runtime.mjs';
import { moveInDoor } from '../helpers/import-notifications.mjs';

const statuspage = { 'X-Import-Source': 'statuspage' };
const reviewed = plan => ({ planId: plan.planId, reviewedFingerprint: plan.fingerprint });
import { sessionCookieName } from '../helpers/session-cookie.mjs';

test("Import mutations remain bound to current session and provider authority", async t => {
  t.diagnostic("an import admitted before provider unlink, pin drift or generation changes commits no source records");
  await (async t => {
  for (const change of [
    "UPDATE oa_identity_providers SET status='unlinked'",
    "UPDATE oa_identity_providers SET issuer='https://replacement.example.test'",
    "UPDATE oa_identity_providers SET client_id='replacement-client'",
    'UPDATE oa_identity_providers SET linked_at=linked_at+1',
    'UPDATE oa_auth_settings SET generation=generation+1',
    'UPDATE oa_auth_settings SET idp_sign_in=0',
  ]) {
    const r = await lampRuntime(t);
    const cookie = await r.providerSession(r.owner.id);
    const body = await preview(r, cookie, source());
    const pending = await suspendedBody(r, '/api/operator/import/apply', cookie, reviewed(body), statuspage);
    try {
      // A committed link/settings change after public middleware authenticated
      // this request, while its actual streamed HTTP body is still arriving.
      await r.db.prepare(change).run();
      assert.equal((await r.call('/api/app/session', { cookie })).status, 401);
    } finally { pending.release(); }
    assert.equal((await pending.response).status, 409);
    assert.equal((await r.db.prepare('SELECT count(*) n FROM components').first()).n, 0);
    assert.equal((await r.db.prepare('SELECT count(*) n FROM ik_jobs').first()).n, 0);
    assert.equal(r.publications, 0);
  }
})(t);
  t.diagnostic("a provider import resumes, reads and undoes through current authority; revoked access preserves the durable job");
  await (async t => {
  const r = await lampRuntime(t);
  let cookie = await r.providerSession(r.owner.id);
  const body = await preview(r, cookie, source('multi-batch', 32));
  let response = await r.call('/api/operator/import/apply', { method: 'POST', cookie, body: reviewed(body), headers: statuspage });
  assert.equal(response.status, 200);
  let result = await response.json();
  assert.equal(result.job.state, 'applying');
  const id = result.job.id;
  assert.equal((await r.call(`/api/app/statuspage-import/jobs/${id}`, { cookie })).status, 200);
  const checkpoint = await r.db.prepare('SELECT checkpoint,state FROM ik_jobs WHERE id=?').bind(id).first();
  const resuming = await suspendedBody(r, '/api/operator/import/apply', cookie, reviewed(body), statuspage);
  try { await r.db.prepare("UPDATE oa_identity_providers SET status='unlinked'").run(); }
  finally { resuming.release(); }
  assert.equal((await resuming.response).status, 409);
  assert.deepEqual(await r.db.prepare('SELECT checkpoint,state FROM ik_jobs WHERE id=?').bind(id).first(), checkpoint);
  await r.db.prepare("UPDATE oa_identity_providers SET status='linked',linked_at=linked_at+1").run();
  assert.equal((await r.call('/api/app/session', { cookie })).status, 401);
  cookie = await r.providerSession(r.owner.id);
  while (result.job.state === 'applying') {
    response = await r.call('/api/operator/import/apply', { method: 'POST', cookie, body: reviewed(body), headers: statuspage });
    assert.equal(response.status, 200);
    result = await response.json();
  }
  assert.equal(result.job.state, 'completed');
  assert.equal((await r.db.prepare('SELECT count(*) n FROM components').first()).n, 32);
  const before = (await r.db.prepare('SELECT * FROM components ORDER BY id').all()).results;
  const undoing = await suspendedBody(r, '/api/operator/import/undo', cookie, { planId: body.planId }, statuspage);
  try { await r.db.prepare("UPDATE oa_identity_providers SET status='unlinked'").run(); }
  finally { undoing.release(); }
  const refusedUndo = await undoing.response;
  assert.deepEqual([refusedUndo.status, (await refusedUndo.json()).error], [403, 'owner_required'], 'the door refuses an undo whose session lost its authority');
  // A mutation delivered after unlink is rejected by Base itself on every door.
  for (const suffix of ['', '/resume', '/undo']) {
    response = await r.call(`/api/app/statuspage-import/jobs/${id}${suffix}`, { cookie, ...(suffix ? { method: 'POST', body: {} } : {}) });
    assert.equal(response.status, 401);
  }
  for (const [action, input] of [['apply', reviewed(body)], ['undo', { planId: body.planId }]]) {
    response = await r.call(`/api/operator/import/${action}`, { method: 'POST', cookie, body: input, headers: statuspage });
    assert.equal(response.status, 401);
  }
  assert.equal((await r.call('/api/app/statuspage-import/jobs', { cookie })).status, 401);
  assert.deepEqual((await r.db.prepare('SELECT * FROM components ORDER BY id').all()).results, before);
  // Relink permits only a new provider session; the earlier pin stays obsolete.
  await r.db.prepare("UPDATE oa_identity_providers SET status='linked',linked_at=linked_at+1").run();
  assert.equal((await r.call('/api/app/session', { cookie })).status, 401);
  // Native recovery shares the operator's job and can perform the undo.
  const recovered = await moveIn(r, r.cookie).undo({ planId: body.planId, source: 'statuspage' });
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  assert.equal(recovered.body.job.state, 'undone');
  assert.equal((await r.db.prepare('SELECT count(*) n FROM components').first()).n, 0);
})(t);
  t.diagnostic("native and password revocation stop waiting imports; review and dev sessions retain their request gates");
  await (async t => {
  const r = await lampRuntime(t);
  for (const kind of ['native', 'password']) {
    const cookie = kind === 'native' ? r.cookie : (await r.base.auth.admitVerifiedPassword(r.request('/auth/password', { method: 'POST' }), r.owner.id)).cookie.split(';')[0];
    const body = await preview(r, cookie, source(kind));
    const pending = await suspendedBody(r, '/api/operator/import/apply', cookie, reviewed(body), statuspage);
    try {
      if (kind === 'native') await r.auth.signOut(r.request('/auth/signout', { method: 'POST', cookie }));
      else await r.providerSession(r.owner.id); // Base revokes password authority when binding.
    } finally { pending.release(); }
    assert.equal((await pending.response).status, 409);
    assert.equal((await r.db.prepare('SELECT count(*) n FROM components').first()).n, 0);
  }
  const local = await lampRuntime(t, { local: true });
  const reviewing = authFixture(local.db, { origin: local.base.origin, review: { enabled: true, operatorEmail: 'owner@example.test' } });
  const review = await reviewing.handle(reviewing.request('/auth/review-session', { method: 'POST', body: {} }));
  assert.equal(review.status, 303);
  const reviewCookie = review.headers.get('set-cookie').split(';')[0];
  assert.equal((await moveIn(local, reviewCookie).preview({ files: source('review') })).status, 401, 'Lamp never enables Base review sessions');

  const worker = local.modules.withDevIdentity({ fetch: request => local.app.fetch(request, local.bindings) }, { config: local.modules.authConfig });
  const entered = local.request('/auth/dev/enter');
  entered.headers.set('x-rer-dev-key', local.bindings.RER_DEV_KEY);
  const signed = await worker.fetch(entered, local.bindings);
  assert.equal(signed.status, 303);
  const cookie = signed.headers.getSetCookie().find(value => value.startsWith(`${sessionCookieName(local.base.origin)}=`)).split(';')[0];
  const dev = withKey => moveInDoor(async (path, body, headers) => {
    const request = local.request(path, { method: body === undefined ? 'GET' : 'POST', cookie, body, headers });
    if (withKey) request.headers.set('x-rer-dev-key', local.bindings.RER_DEV_KEY);
    const response = await worker.fetch(request, local.bindings);
    return { status: response.status, body: await response.json() };
  });
  assert.equal((await dev(false).preview({ files: source('dev') })).status, 401);
  const report = await dev(true).preview({ files: source('dev') });
  assert.equal(report.status, 200);
  assert.equal((await dev(true).apply(report.body)).status, 200);
  assert.equal((await local.db.prepare('SELECT count(*) n FROM components').first()).n, 1);
})(t);
});
