import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** The earlier specialist's silence guarantee includes pre-existing work.
 * Only the old outbox row is fixture history. CSV review, apply, recovery and
 * explicit invitation use the production HTTP and scheduled entry points. */
export async function silentImportWithQueuedMail({ request, origin, cookie, email, mail, database, scheduled }) {
  const db = await database('DB');
  const person = async (path, body) => {
    const response = await request(new URL(path, origin).href, {
      method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, `Native subscriber import ${path}: HTTP ${response.status}`);
    return response.json();
  };
  const id = `synthetic-lamp-pending-before-import-${randomUUID()}`;
  const title = `Synthetic Lamp previously queued owner alert ${randomUUID()}`;
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO notification_outbox
    (id,kind,aggregate_id,payload_json,available_at,attempts,created_at,updated_at)
    VALUES (?,'operator-alert',?,?,?,0,?,?)`).bind(id, id, JSON.stringify({
    from: 'synthetic-lamp-sender@example.test', recipients: [email], title,
    text: 'This prior alert remains due after a silent subscriber import.',
  }), now, now, now).run();
  const csv = `email\n${email}\n`;
  const mailBeforePreview = mail.read({ limit: 20 });
  const previewImport = await person('/api/app/subscribers/import/preview', { csv });
  assert.deepEqual(mail.read({ limit: 20 }), mailBeforePreview, 'Import preview leaves previously queued mail silent');
  const mailBeforeImport = mail.read({ limit: 20 });
  const imported = await person('/api/app/subscribers/import/apply', { csv, reviewedFingerprint: previewImport.fingerprint });
  assert.equal(imported.counts.created, 1);
  assert.deepEqual(mail.read({ limit: 20 }), mailBeforeImport, 'Import applies silently');
  const queued = await db.prepare('SELECT completed_at,attempts,locked_at FROM notification_outbox WHERE id=?').bind(id).first();
  assert.deepEqual(queued, { completed_at: null, attempts: 0, locked_at: null }, 'Silent import leaves the original pending delivery unclaimed');

  await scheduled();
  assert.ok((await db.prepare('SELECT completed_at FROM notification_outbox WHERE id=?').bind(id).first()).completed_at,
    'Native Cron recovers the same queued work after the silent import');
  assert.equal(mail.read({ limit: 20 }).filter(message => message.subject.includes(title)).length, 1,
    'The previously queued alert reaches its provider once');
  const confirmationCount = () => mail.read({ limit: 20 }).filter(message => message.text.includes('/confirm-subscription/')).length;
  const beforeInviting = confirmationCount();
  const invitations = `/api/app/subscribers/import/${imported.batchId}/send-invitations`;
  assert.equal((await person(invitations, {})).sent, 1, 'Only an explicit owner action sends the imported invitation');
  const captured = mail.read({ limit: 20 });
  assert.equal((await person(invitations, {})).sent, 0);
  assert.deepEqual(mail.read({ limit: 20 }), captured, 'Invitation replay sends no second message');
  assert.equal(confirmationCount(), beforeInviting + 1);
  assert.equal((await db.prepare('SELECT state FROM subscribers WHERE id=?').bind(imported.subscriberIds[0]).first()).state,
    'pending', 'An explicit invitation is not subscriber confirmation');
}
