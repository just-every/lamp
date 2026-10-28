import assert from 'node:assert/strict';

export default async function reviewer({ request, origin, email, owner, mail }) {
  const invitation = await request(new URL('/api/app/operators/invite', origin).href, {
    method: 'POST', headers: { Origin: origin, Cookie: owner.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, displayName: 'Independent Lamp reviewer' }),
  });
  assert.equal(invitation.status, 202, 'The owner must invite the real native reviewer');
  await invitation.body?.cancel();
  const message = mail.read({ limit: 20 }).findLast(item => /\/auth\/confirm\?token=/.test(item.text));
  const link = message?.text.match(/https:\/\/[^\s<>]+\/auth\/confirm\?token=[A-Za-z0-9_-]+/)?.[0];
  assert.ok(link, 'Only the declared reviewer mailbox supplies their invitation');
  assert.equal(new URL(link).origin, origin);
  const accepted = await request(new URL('/auth/confirm', origin).href, {
    method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: new URL(link).searchParams.get('token') }),
  });
  assert.equal(accepted.status, 303, 'Native confirmation must issue the reviewer session');
  return accepted;
}
