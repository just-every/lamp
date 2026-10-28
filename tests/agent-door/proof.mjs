import assert from 'node:assert/strict';
import { nativeFixture } from './fixture-state.mjs';
/** Refresh genuine native email proof when its normal person-session age requires it. */
export default async function prove({ request, origin, agentId, tool, args }) {
  const fixture = nativeFixture();
  if (Date.now() - fixture.proofAt > 9 * 60_000) {
    const asked = await request(new URL('/auth/step-up', origin).href, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'owner:transfer', returnTo: '/app/settings'}) });
    assert.equal(asked.status, 202, 'Person requests normal native recent-email proof');
    await asked.body?.cancel();
    const message = fixture.mail.read({limit: 20}).findLast(row => /\/auth\/confirm\?token=/.test(row.text));
    const url = message?.text.match(/https:\/\/[^\s<>]+\/auth\/confirm\?token=[A-Za-z0-9_-]+/)?.[0];
    assert.ok(url);
    assert.equal(new URL(url).origin, origin);
    const confirmed = await request(new URL('/auth/confirm', origin).href, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token: new URL(url).searchParams.get('token')})});
    assert.equal(confirmed.status, 303, 'Person completes the real current email link');
    await confirmed.body?.cancel();
    fixture.proofAt = Date.now();
  }
  const response = await request(new URL('/api/rer/agent-native-proof', origin).href, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: agentId, tool, arguments: args }),
  });
  assert.equal(response.status, 201, 'Native proof binds the current person, agent and exact arguments');
  const proof = await response.json();
  assert.equal(typeof proof.reference, 'string');
  return proof.reference;
}
