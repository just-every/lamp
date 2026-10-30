import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prepareQueueFixtures from './queue-fixtures.mjs';
import { ownerFixtureState } from './owner.mjs';

export default async function fixtures(context) {
  const { phase, request, origin, cookie, now = Date.now() } = context;
  const queueValues = await prepareQueueFixtures(context);
  const values = {
    ...queueValues,
    clock: {
      nextUpdateAt: new Date(now + 60 * 60_000).toISOString(),
      startsAt: new Date(now + 10 * 60_000).toISOString(),
      endsAt: new Date(now + 70 * 60_000).toISOString(),
    },
    subscriber: { email: `lamp-${phase.replaceAll(/[^a-z0-9]/gi, '-')}-${randomUUID()}@example.com` },
  };
  const state = ownerFixtureState(origin);
  if (phase !== 'negative' || !state?.inactive) return { values };
  const person = state.inactive;
  if (!person.suspended) {
    const response = await request(new URL(`/api/app/operators/${encodeURIComponent(person.id)}/revoke-access`, origin).href, {
      method: 'POST', redirect: 'manual', headers: { Host: new URL(origin).host, Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.77' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 204, `Native sponsor suspension: HTTP ${response.status}`);
    await response.body?.cancel();
    person.suspended = true;
  }
  return { values, sponsors: { inactive: { sub: person.sub, email: person.email } } };
}
