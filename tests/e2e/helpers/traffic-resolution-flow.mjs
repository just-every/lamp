import assert from 'node:assert/strict';

const MINUTE = 60_000, HOUR = 60 * MINUTE;

/** HIST-006 traffic through AGENT-004's resolution doors, on an incident whose
 * Resolved draft faces elevated public-page traffic at `now`: unknown usual
 * levels, historical and immediate resolutions, an override's reach, and
 * scheduled resolutions checked again when due. Only the fixture clock moves. */
export async function trafficResolutionFlow({ fixture, incident, owner, now, readAt, saveDraft, resolvedImpact, eventually }) {
  const { api, post, runtime, publicOrigin } = fixture;
  const path = `/api/app/incidents/${incident.id}`;
  const check = async () => {
    const response = await api(`${path}/recovery-check`);
    assert.equal(response.status, 200, response.text); return response.body.recovery;
  };
  const traffic = recovery => recovery.items.filter(item => item.kind === 'traffic');
  const pageState = recovery => traffic(recovery).find(item => item.key === 'page')?.state;
  const read = async () => (await api(path)).body.incident;

  // Unknown usual levels are labelled not tracked: never an evidence row, never passing or failing.
  const mixed = await check();
  assert.ok(mixed.trafficLearning.includes('widget'), 'a cold-start surface is listed as not tracked');
  assert.deepEqual(traffic(mixed).map(item => item.key).sort(), ['feed', 'page'], 'only surfaces with a usual level are evidence rows');
  assert.ok(!mixed.trafficLearning.includes('page') && !mixed.trafficLearning.includes('feed'));
  await fixture.clock(Math.floor(now / HOUR) * HOUR + HOUR + 5 * MINUTE);
  const unknown = await check();
  assert.deepEqual(traffic(unknown), [], 'an hour with no same-hour history yields no traffic evidence');
  assert.ok(['page', 'feed', 'widget'].every(surface => unknown.trafficLearning.includes(surface)), 'every surface without a same-hour baseline is not tracked');
  await fixture.clock(now);

  // A historical (backdated) resolution is checked against current traffic, and the refused draft stays.
  const historical = await post(`${path}/publish`, { channels: [], publishedAt: new Date(now - MINUTE).toISOString() });
  assert.equal(historical.status, 409, historical.text);
  assert.equal(pageState(historical.body.recovery), 'firing', 'elevated traffic refuses a historical resolution');
  const refused = await read();
  assert.equal(refused.lifecycle, 'Investigating'); assert.equal(refused.draft?.lifecycle, 'Resolved', 'the refused historical draft is retained');

  // An immediate override publishes now, privately and under its operator's name.
  const reason = 'Synthetic traffic override: the spike is a planned load test.';
  const overridden = await post(`${path}/publish`, { channels: [], overrideReason: reason });
  assert.equal(overridden.status, 200, overridden.text);
  const closed = await read();
  assert.equal(closed.lifecycle, 'Resolved');
  assert.ok(closed.internalNotes.some(note => note.body.includes(reason) && note.authorOperatorId === owner.id), 'the override stays in the private timeline under its operator');
  const audit = (await api('/api/app/audit-log?limit=100')).body.entries;
  assert.ok(audit.some(entry => entry.reason === reason && entry.actorId === owner.id), 'the override is audited with its operator');
  const publicIncident = async () => (await runtime.dispatchFetch(`${publicOrigin}/incidents/${closed.reference}`)).text();
  const resolvedPage = await eventually(publicIncident, html => html.includes(resolvedImpact), 'the overridden resolution is public');
  assert.ok(!resolvedPage.includes(reason), 'the override reason is never public');

  // The override authorizes that publication only: the reopened incident's next resolution is checked again.
  await saveDraft('Monitoring');
  assert.equal((await post(`${path}/publish`, { channels: [] })).status, 200);
  await saveDraft('Resolved');
  const later = await post(`${path}/publish`, { channels: [] });
  assert.equal(later.status, 409, later.text);
  assert.equal(pageState(later.body.recovery), 'firing', 'an earlier override grants no later resolution');

  // A scheduled resolution passes when scheduled, then meets elevated traffic when due: it is retained.
  const scheduledAt = now + 3 * MINUTE, dueAt = scheduledAt + 3 * MINUTE;
  await fixture.clock(scheduledAt);
  assert.equal((await check()).passed, true, 'traffic is near its usual level when the resolution is scheduled');
  const scheduled = await post(`${path}/draft/schedule`, { channels: [], publishAt: new Date(dueAt).toISOString() });
  assert.equal(scheduled.status, 202, scheduled.text);
  await readAt(dueAt - 2 * MINUTE, 10);
  await fixture.clock(dueAt);
  await fixture.tick(dueAt);
  const held = await read();
  assert.equal(held.lifecycle, 'Monitoring', 'elevated traffic at the due time holds the scheduled resolution');
  assert.equal(held.draft?.lifecycle, 'Resolved', 'the failing scheduled draft is retained');
  assert.equal(held.updates.length, closed.updates.length + 1);

  // Traffic back near its usual level: the next due-time check publishes it with no override.
  const nearAt = dueAt + MINUTE;
  await readAt(nearAt, 2);
  await fixture.clock(nearAt + 2 * MINUTE);
  assert.equal(pageState(await check()), 'recovered', 'two requests against a two-per-minute usual level are near baseline');
  await fixture.tick(nearAt + 2 * MINUTE);
  const recovered = await read();
  assert.equal(recovered.lifecycle, 'Resolved', 'near-baseline traffic lets the retained scheduled resolution publish');
  assert.equal(recovered.draft, null);
  assert.equal(recovered.internalNotes.length, closed.internalNotes.length, 'no override was needed or recorded');
}
