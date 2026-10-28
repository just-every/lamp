import assert from 'node:assert/strict';

/** Invite and confirm a distinct real native owner; only the mail edge is captured. */
export default async function reviewer({request, origin, email, owner, mail}) {
  const invited = await request(new URL('/api/app/operators/invite', origin).href, {
    method: 'POST', headers: {Origin: origin, Cookie: owner.cookie, 'Content-Type': 'application/json'},
    body: JSON.stringify({email, displayName: 'Independent Lamp reviewer'}),
  });
  assert.equal(invited.status, 202, 'The native owner invites an independent reviewer');
  await invited.body?.cancel();
  const message = mail.read({limit: 20}).findLast(row => /\/auth\/confirm\?token=/.test(row.text));
  const link = message?.text.match(/https:\/\/[^\s<>]+\/auth\/confirm\?token=[A-Za-z0-9_-]+/)?.[0];
  assert.ok(link, 'Only the declared reviewer mailbox supplies its native invitation');
  assert.equal(new URL(link).origin, origin);
  const confirmed = await request(new URL('/auth/confirm', origin).href, {
    method: 'POST', redirect: 'manual',
    headers: {Origin: origin, 'Content-Type': 'application/json'},
    body: JSON.stringify({token: new URL(link).searchParams.get('token')}),
  });
  assert.equal(confirmed.status, 303, 'The reviewer completes the ordinary one-use native invitation');
  return confirmed;
}
