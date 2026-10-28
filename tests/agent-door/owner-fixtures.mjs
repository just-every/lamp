import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { retainFixture } from './fixture-state.mjs';

/** Harmless topology prepared only through native person/provider doors. */
export async function prepareNativeFixtures({ request, origin, cookie, email, token, mail }) {
  const call = async (path, method = 'GET', body) => {
    const response = await request(new URL(path, origin).href, {
      method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, `Native fixture ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
  const { components } = await call('/api/app/components');
  const componentId = components.find(component => component.name === 'Conformance API')?.id;
  assert.ok(componentId, 'Ordinary first-run creates the native fixture component');
  const intake = await call('/api/app/intake/sources', 'POST', {
    name: 'Conformance signed alert', credentialKind: 'bearer-token', bearerToken: token,
    componentId, deduplicationPath: 'id', titlePath: 'title', statePath: 'state', recoveredValue: 'recovered',
  });
  await call('/api/app/channels', 'POST', {
    kind: 'slack', name: 'Conformance operations',
    url: 'https://hooks.slack.com/services/TCONFORMANCE/BCONFORMANCE/SyntheticLampWebhook',
    componentIds: [componentId], operatorAlerts: true,
  });
  // Repeated policy phases consume ordinary pending batches; import sends nothing.
  const beforeImports = mail.read({ limit: 20 });
  for (let index = 0; index < 16; index++) {
    const csv = `email\nlamp-conformance-import-${index}@example.com\n`;
    const preview = await call('/api/app/subscribers/import/preview', 'POST', { csv });
    assert.equal(preview.counts.created, 1);
    const imported = await call('/api/app/subscribers/import/apply', 'POST', { csv, reviewedFingerprint: preview.fingerprint });
    assert.equal(imported.counts.created, 1);
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
  for (let index = 0; index < 16; index++) {
    const credential = await call('/api/app/management-tokens', 'POST', {
      name: `Conformance read client ${index}`, scopes: ['read'], expiresInSeconds: 3600,
    });
    assert.ok(credential.credential?.id && credential.token, 'A real fenced credential is issued');
    const link = await call('/api/app/chat-links', 'POST', {});
    assert.ok(link.code);
    const raw = new URLSearchParams({ command: '/lamp', team_id: 'TCONFORMANCE', user_id: `UCONFORMANCE${index}`, text: `link ${link.code}` }).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac('sha256', token).update(`v0:${timestamp}:${raw}`).digest('hex')}`;
    const linked = await request(new URL('/api/chat/slack', origin).href, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature }, body: raw,
    });
    assert.equal(linked.status, 200, 'Slack linking requires exact signed provider bytes');
    await linked.body?.cancel();
  }
  const { operator } = await call('/api/app/session');
  assert.equal(operator.email, email, 'Fixture authority belongs to the claimed owner');
  retainFixture({source: intake.source, token, componentId, mail, proofAt: Date.now()});
}
