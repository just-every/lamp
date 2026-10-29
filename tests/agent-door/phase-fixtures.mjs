import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** Fresh native receipts and credentials for each policy round; mail is an edge. */
export default async function phaseFixtures({phase, request, origin, cookie, email, mail}) {
  const native = async (path, method = 'GET', body) => {
    const response = await request(new URL(path, origin).href, {method,
      headers: {Origin: origin, Cookie: cookie, 'Content-Type': 'application/json'},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    assert.ok(response.ok, `Native phase fixture ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
  const name = `Phase read client ${randomUUID()}`;
  const issued = await native('/api/app/management-tokens', 'POST', {name, scopes: ['read'], expiresInSeconds: 3600});
  assert.ok(issued.token && issued.credential?.id);
  const csv = `email\nlamp-phase-${randomUUID()}@example.com\n`;
  const preview = await native('/api/app/subscribers/import/preview', 'POST', {csv});
  const before = mail.read({limit: 20});
  const batch = await native('/api/app/subscribers/import/apply', 'POST', {csv, reviewedFingerprint: preview.fingerprint});
  assert.equal(batch.counts.created, 1);
  assert.deepEqual(mail.read({limit: 20}), before, 'Every phase import remains silent');
  const now = Date.now(), time = minutes => new Date(now + minutes * 60_000).toISOString();
  return {values: {batch: {batchId: batch.batchId}, clock: {minute: Math.floor(now / 60_000) * 60_000, startsAt: time(15), endsAt: time(75), updatedStartsAt: time(20), updatedEndsAt: time(80)}},
    clients: {'local-read': {token: issued.token, clientId: issued.credential.id,
      agent: {id: `management:${issued.credential.id}`, name, specialist: 'incident-communicator'}}}};
}
