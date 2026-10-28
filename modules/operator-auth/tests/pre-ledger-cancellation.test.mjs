import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, post } from './pre-ledger-runtime.mjs';
import { credentials, NOW } from './fixtures/pre-ledger/owner-state.mjs';
import { snapshot, authoritySnapshot, operator, marker, owner, invite, error, session, deniedLink, conflict, guarded, accept } from './pre-ledger-assertions.mjs';

test('post-upgrade witnessed cancellation remains guarded through reissue/restart and atomic acceptance', async () => {
  const r = await runtime();
  try {
    await r.migrate();
    const original = await operator(r, 'guarded');
    const oldLink = credentials.guardedLink;
    assert.equal((await r.call(`/auth/confirm?token=${oldLink}`)).status, 200);
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: original.id }, owner))).status, 200);
    assert.deepEqual(await operator(r, 'guarded'), { ...original, status: 'inactive', version: 2 });
    const cancellation = { operator_id: original.id, operator_version: 2 };
    assert.deepEqual(await marker(r, 'guarded'), cancellation);
    await deniedLink(r, oldLink);
    await guarded(r, 'guarded');
    await conflict(r, 'guarded', 'admin');
    await r.restart();
    assert.deepEqual(await marker(r, 'guarded'), cancellation);
    await guarded(r, 'guarded');
    await deniedLink(r, oldLink);
    const returnTo = '/original/guarded?view=invitation';
    assert.equal((await invite(r, 'guarded', 'member', returnTo)).status, 202);
    const freshLink = await r.latestLink();
    const reissued = await operator(r, 'guarded');
    assert.equal(reissued.id, original.id);
    assert.equal(reissued.created_at, original.created_at);
    assert.equal(reissued.status, 'invited');
    assert.equal(reissued.version, 3);
    assert.deepEqual(await marker(r, 'guarded'), cancellation);
    await guarded(r, 'guarded');
    await conflict(r, 'guarded', 'admin');
    await deniedLink(r, oldLink);
    await r.restart();
    assert.deepEqual(await operator(r, 'guarded'), reissued);
    assert.deepEqual(await marker(r, 'guarded'), cancellation);
    await guarded(r, 'guarded');
    await deniedLink(r, oldLink);

    // Real D1 abort at activation must roll back the preceding session insertion
    // and ledger deletion, as well as leave token consumption untouched.
    const db = await r.db;
    await db.prepare("CREATE TRIGGER test_abort_acceptance BEFORE UPDATE OF status ON oa_operators WHEN NEW.id='guarded' AND NEW.status='active' BEGIN SELECT RAISE(ABORT,'test_acceptance_abort'); END").run();
    const before = await authoritySnapshot(r);
    await error(await r.call('/auth/confirm', post({ token: freshLink })), 503, 'auth_unavailable');
    assert.deepEqual(await authoritySnapshot(r), before, 'Failed activation rolls back every acceptance write');
    await db.prepare('DROP TRIGGER test_abort_acceptance').run();
    const cookie = await accept(r, freshLink, original.id, 4, returnTo);
    assert.deepEqual(await operator(r, 'guarded'), { ...reissued, status: 'active', version: 4 });
    await deniedLink(r, oldLink);
    await r.restart();
    await session(r, cookie, original.id, 4);
    assert.equal(await marker(r, 'guarded'), null);
    await deniedLink(r, oldLink);
    await deniedLink(r, freshLink);
  } finally { await r.close(); }
});

test('owner deliberate removal and reinvitation replaces an unrecorded legacy cancellation', async () => {
  const r = await runtime();
  try {
    await r.migrate();
    await session(r, owner, 'owner', 1);
    const legacy = await operator(r, 'cancelled');
    assert.equal(await marker(r, legacy.id), null);
    await conflict(r, 'cancelled');
    await deniedLink(r, credentials.cancelledLink);
    const before = await snapshot(r);
    // No delete API exists. This is the owner's explicit database operation,
    // deleting FK dependencies first, not a runtime workaround or inferred marker.
    const db = await r.db;
    await db.batch([
      db.prepare('DELETE FROM oa_sessions WHERE operator_id=? OR source_token_id IN (SELECT id FROM oa_tokens WHERE operator_id=? OR issuer_id=?)').bind(legacy.id, legacy.id, legacy.id),
      db.prepare('DELETE FROM oa_tokens WHERE operator_id=? OR issuer_id=?').bind(legacy.id, legacy.id),
      db.prepare('DELETE FROM oa_external_identities WHERE operator_id=?').bind(legacy.id),
      db.prepare('DELETE FROM oa_invitation_cancellations WHERE operator_id=?').bind(legacy.id),
      db.prepare('DELETE FROM oa_operators WHERE id=?').bind(legacy.id),
    ]);
    assert.equal(await operator(r, legacy.id), null);
    const after = await snapshot(r);
    assert.deepEqual(after, { ...before,
      oa_operators: before.oa_operators.filter(row => row.id !== legacy.id),
      oa_tokens: before.oa_tokens.filter(row => row.operator_id !== legacy.id),
    }, 'Only the deliberately removed legacy identity and its invitation are removed');
    await deniedLink(r, credentials.cancelledLink);
    const returnTo = '/original/cancelled?view=invitation';
    assert.equal((await invite(r, 'cancelled', 'member', returnTo)).status, 202);
    const replacement = await (await r.db).prepare('SELECT * FROM oa_operators WHERE email=?').bind(legacy.email).first();
    assert.notEqual(replacement.id, legacy.id);
    assert.equal(replacement.email, legacy.email);
    assert.equal(replacement.created_at, NOW);
    assert.notEqual(replacement.created_at, legacy.created_at);
    assert.equal(replacement.status, 'invited');
    assert.equal(replacement.version, 1);
    const freshLink = await r.latestLink();
    await deniedLink(r, credentials.cancelledLink);
    const cookie = await accept(r, freshLink, replacement.id, 2, returnTo);
    await r.restart();
    await session(r, cookie, replacement.id, 2);
    await deniedLink(r, credentials.cancelledLink);
    await deniedLink(r, freshLink);
    await session(r, owner, 'owner', 1);
  } finally { await r.close(); }
});
