import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { nativeFixture } from './fixture-state.mjs';

/** Each policy round prepares real, unconsumed records through native doors. */
export default async function preparePhase({ request, origin, cookie, mail, phase }) {
  const { token } = nativeFixture();
  const values = {};
  const call = async (path, method = 'GET', body) => {
    const response = await request(new URL(path, origin).href, {
      method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, `Native phase fixture ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
  // Repeated policy phases consume ordinary pending batches; import sends nothing.
  const beforeImports = mail.read({ limit: 20 });
  {
    const csv = `email\nlamp-conformance-import-${crypto.randomUUID()}@example.com\n`;
    const preview = await call('/api/app/subscribers/import/preview', 'POST', { csv });
    assert.equal(preview.counts.created, 1);
    const imported = await call('/api/app/subscribers/import/apply', 'POST', { csv, reviewedFingerprint: preview.fingerprint });
    assert.equal(imported.counts.created, 1);
    values.subscriberBatch = imported;
  }
  assert.deepEqual(mail.read({ limit: 20 }), beforeImports, 'Import sends no confirmation mail');
  // Credential minting retains the production recent-email-proof boundary.
  await call('/auth/step-up', 'POST', { action: 'credentials:mint', returnTo: '/app/settings' });
  const proof = mail.read({ limit: 20 }).findLast(message => /\/auth\/confirm\?token=/.test(message.text));
  const proofUrl = proof?.text.match(/https:\/\/[^\s<>]+\/auth\/confirm\?token=[A-Za-z0-9_-]+/)?.[0];
  assert.ok(proofUrl, 'Native step-up sends a genuine owner confirmation link');
  assert.equal(new URL(proofUrl).origin, origin);
  const confirmed = await request(new URL('/auth/confirm', origin).href, {
    method: 'POST', redirect: 'manual', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: new URL(proofUrl).searchParams.get('token') }),
  });
  assert.equal(confirmed.status, 303, 'Owner completes native recent-email proof');
  await confirmed.body?.cancel();
  {
    const credential = await call('/api/app/management-tokens', 'POST', {
      name: `Conformance read client ${phase}`, scopes: ['read'], expiresInSeconds: 3600,
    });
    assert.ok(credential.credential?.id && credential.token, 'A real fenced credential is issued');
    values.revocableCredential = { id: credential.credential.id };
    const beforeLinks = new Set((await call('/api/app/chat-links')).links.map(row => row.id));
    const link = await call('/api/app/chat-links', 'POST', {});
    assert.ok(link.code);
    const raw = new URLSearchParams({ command: '/lamp', team_id: 'TCONFORMANCE', user_id: `UCONFORMANCE${crypto.randomUUID().replaceAll('-', '')}`, text: `link ${link.code}` }).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac('sha256', token).update(`v0:${timestamp}:${raw}`).digest('hex')}`;
    const linked = await request(new URL('/api/chat/slack', origin).href, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature }, body: raw,
    });
    assert.equal(linked.status, 200, 'Slack linking requires exact signed provider bytes');
    await linked.body?.cancel();
    const access = await call('/api/app/chat-links');
    const chat = access.links.find(row => !beforeLinks.has(row.id));
    assert.ok(chat?.id);
    values.chat = { id: chat.id };
  }
  nativeFixture().proofAt = Date.now();
  const now = Date.now(), instant = seconds => new Date(now + seconds * 1000).toISOString();
  values.clock = { minute: Math.floor(now / 60_000) * 60_000, nextUpdateAt: instant(3600),
    windowStart: instant(7200), windowEnd: instant(10800), rescheduledStart: instant(9000), rescheduledEnd: instant(12600) };
  return { values };
}
