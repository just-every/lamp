import assert from 'node:assert/strict';

const MINUTE = 60_000, HOUR = 60 * MINUTE;

// Observe whole persisted rows independently of the native write responses.
// Include every scoped note and audit so an extra override cannot hide behind
// an unchanged count or an existing override from an earlier publication.
export async function trafficResolutionRecords({ env }, incidentId) {
  const queries = [
    ['incidents', 'SELECT * FROM incidents WHERE id = ? ORDER BY id', [incidentId]],
    ['drafts', 'SELECT * FROM incident_drafts WHERE incident_id = ? ORDER BY id', [incidentId]],
    ['updates', 'SELECT * FROM incident_updates WHERE incident_id = ? ORDER BY id', [incidentId]],
    ['notes', 'SELECT * FROM incident_internal_notes WHERE incident_id = ? ORDER BY id', [incidentId]],
    ['audits', `SELECT * FROM audit_entries WHERE entity_id = ?
      OR entity_id IN (SELECT id FROM incident_updates WHERE incident_id = ?)
      OR json_extract(payload_json, '$.incidentId') = ? ORDER BY id`, [incidentId, incidentId, incidentId]],
  ];
  const results = await env.DB.batch(queries.map(([, sql, values]) => env.DB.prepare(sql).bind(...values)));
  return Object.fromEntries(queries.map(([name], index) => [name, results[index].results]));
}

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
  const beforeHistorical = await trafficResolutionRecords(fixture, incident.id);
  assert.equal(beforeHistorical.incidents.length, 1);
  assert.equal(beforeHistorical.drafts.length, 1);
  assert.equal(beforeHistorical.drafts[0].lifecycle, 'Resolved');
  const historical = await post(`${path}/publish`, { channels: [], publishedAt: new Date(now - MINUTE).toISOString() });
  assert.equal(historical.status, 409, historical.text);
  assert.equal(pageState(historical.body.recovery), 'firing', 'elevated traffic refuses a historical resolution');
  assert.deepEqual(await trafficResolutionRecords(fixture, incident.id), beforeHistorical, 'backdated refusal preserves every incident, draft, update, note and audit field');
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
  const overrideRecords = await trafficResolutionRecords(fixture, incident.id);
  const overrideNotes = records => records.notes.filter(row => row.body.startsWith('Recovery check overridden: '));
  const overrideAudits = records => records.audits.filter(row => row.reason !== null);
  assert.equal(overrideNotes(overrideRecords).length, 1, 'the override-note control is populated');
  assert.equal(overrideAudits(overrideRecords).length, 1, 'the independently read override-audit control is populated');
  assert.equal(overrideNotes(overrideRecords)[0].body, `Recovery check overridden: ${reason}`);
  assert.equal(overrideNotes(overrideRecords)[0].author_operator_id, owner.id);
  assert.equal(overrideAudits(overrideRecords)[0].reason, reason);
  assert.equal(overrideAudits(overrideRecords)[0].operator_id, owner.id);
  const publicIncident = async () => (await runtime.dispatchFetch(`${publicOrigin}/incidents/${closed.reference}`)).text();
  const resolvedPage = await eventually(publicIncident, html => html.includes(resolvedImpact), 'the overridden resolution is public');
  assert.ok(!resolvedPage.includes(reason), 'the override reason is never public');

  // The override authorizes that publication only: the reopened incident's next resolution is checked again.
  // Reopening follows the override within the same elevated minute, so its update is the latest one.
  await fixture.clock(now + 30_000);
  await saveDraft('Monitoring');
  assert.equal((await post(`${path}/publish`, { channels: [] })).status, 200);
  await saveDraft('Resolved');
  const beforeLater = await trafficResolutionRecords(fixture, incident.id);
  const later = await post(`${path}/publish`, { channels: [] });
  assert.equal(later.status, 409, later.text);
  assert.equal(pageState(later.body.recovery), 'firing', 'an earlier override grants no later resolution');
  assert.deepEqual(await trafficResolutionRecords(fixture, incident.id), beforeLater, 'reopened resolution refusal preserves all stored rows');

  // A scheduled resolution passes when scheduled, then meets elevated traffic when due: it is retained.
  const scheduledAt = now + 3 * MINUTE, dueAt = scheduledAt + 3 * MINUTE;
  await fixture.clock(scheduledAt);
  assert.equal((await check()).passed, true, 'traffic is near its usual level when the resolution is scheduled');
  const scheduled = await post(`${path}/draft/schedule`, { channels: ['email', 'webhook'], publishAt: new Date(dueAt).toISOString() });
  assert.equal(scheduled.status, 202, scheduled.text);
  const beforeDue = await trafficResolutionRecords(fixture, incident.id);
  assert.equal(beforeDue.drafts.length, 1);
  const [savedSchedule] = beforeDue.drafts;
  assert.equal(savedSchedule.lifecycle, 'Resolved');
  assert.equal(savedSchedule.scheduled_publish_at, new Date(dueAt).toISOString());
  assert.deepEqual(JSON.parse(savedSchedule.scheduled_channels_json), ['email', 'webhook']);
  assert.equal(savedSchedule.author_operator_id, owner.id);
  assert.equal(savedSchedule.customer_impact, resolvedImpact);
  assert.ok(savedSchedule.affected_audience && savedSchedule.what_still_works && savedSchedule.details, 'the held draft has distinctive saved wording to preserve');
  await readAt(dueAt - 2 * MINUTE, 10);
  await fixture.clock(dueAt);
  await fixture.tick(dueAt);
  const held = await read();
  assert.equal(held.lifecycle, 'Monitoring', 'elevated traffic at the due time holds the scheduled resolution');
  assert.equal(held.draft?.lifecycle, 'Resolved', 'the failing scheduled draft is retained');
  assert.equal(held.updates.length, closed.updates.length + 1);
  assert.deepEqual(await trafficResolutionRecords(fixture, incident.id), beforeDue, 'due-time traffic hold preserves the complete saved schedule and every incident, update, note and audit row');

  // Traffic back near its usual level: the next due-time check publishes it with no override.
  const nearAt = dueAt + MINUTE;
  await readAt(nearAt, 2);
  await fixture.clock(nearAt + 2 * MINUTE);
  assert.equal(pageState(await check()), 'recovered', 'two requests against a two-per-minute usual level are near baseline');
  const beforeRecovery = await trafficResolutionRecords(fixture, incident.id);
  await fixture.tick(nearAt + 2 * MINUTE);
  const recovered = await read();
  assert.equal(recovered.lifecycle, 'Resolved', 'near-baseline traffic lets the retained scheduled resolution publish');
  assert.equal(recovered.draft, null);
  assert.equal(recovered.internalNotes.length, closed.internalNotes.length, 'no override was needed or recorded');
  const recoveredRecords = await trafficResolutionRecords(fixture, incident.id);
  assert.deepEqual(recoveredRecords.notes, beforeRecovery.notes, 'near-baseline publication adds or changes no private note');
  assert.deepEqual(overrideNotes(recoveredRecords), overrideNotes(beforeRecovery), 'the complete scoped override-note inventory is unchanged');
  assert.deepEqual(overrideAudits(recoveredRecords), overrideAudits(beforeRecovery), 'the independent scoped override-audit inventory is unchanged');
  const previousAuditIds = new Set(beforeRecovery.audits.map(row => row.id));
  assert.deepEqual(recoveredRecords.audits.filter(row => previousAuditIds.has(row.id)), beforeRecovery.audits, 'all earlier audit rows retain their full values');
  const addedAudits = recoveredRecords.audits.filter(row => !previousAuditIds.has(row.id));
  assert.equal(addedAudits.length, 1, 'the successful schedule adds only its ordinary publication audit');
  assert.equal(addedAudits[0].entity_type, 'incident-update');
  assert.equal(addedAudits[0].entity_id, savedSchedule.id);
  assert.equal(addedAudits[0].action, 'published');
  assert.equal(addedAudits[0].operator_id, owner.id);
  assert.equal(addedAudits[0].reason, null, 'successful scheduled publication explicitly stores a null override reason');
  assert.equal(JSON.parse(addedAudits[0].payload_json).recovery.passed, true);
  assert.deepEqual(recoveredRecords.drafts, []);
  assert.equal(recoveredRecords.updates.length, beforeRecovery.updates.length + 1);
  const publishedSchedule = recoveredRecords.updates.find(row => row.id === savedSchedule.id);
  assert.equal(publishedSchedule.lifecycle, 'Resolved');
  for (const field of ['affected_audience', 'customer_impact', 'what_still_works', 'details']) {
    assert.equal(publishedSchedule[field], savedSchedule[field], `scheduled publication retains ${field}`);
  }
}
