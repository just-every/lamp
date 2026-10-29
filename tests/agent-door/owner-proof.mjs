import assert from 'node:assert/strict';

/** Complete normal native email proof before protected owner commands. */
export async function refreshOwnerEmailProof({ request, origin, cookie, mail }) {
  // Credential minting retains the production recent-email-proof boundary.
  const asked = await request(new URL('/auth/step-up', origin).href, {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'credentials:mint', returnTo: '/app/settings' }),
  });
  assert.equal(asked.status, 202, 'Owner requests a real recent-email proof');
  await asked.body?.cancel();
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
  return Date.now();
}
