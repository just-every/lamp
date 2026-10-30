import assert from 'node:assert/strict';
import { openStatusJourney, eventually } from './status-journey.mjs';
import { assertAtomInventory, validateAtomFeed } from './atom-assertions.mjs';

/** Native publications and a persisted Worker restart, with an independent
 * event ledger retained from write responses, never harvested from feed IDs. */
export async function atomHistoryFlow() {
  const j = await openStatusJourney({ workerEntry: 'tests/e2e/helpers/automation-clock-worker.ts' });
  const feedId = 'urn:lamp:synthetic-lamp-feed-1';
  const events = [], allIdentities = new Set();
  let clock;
  const move = async instant => {
    clock = instant;
    assert.equal((await j.raw('/test/clock', { method: 'PUT', body: JSON.stringify({ now: Date.parse(instant) }) })).status, 204);
  };
  const later = async () => move(new Date(Date.parse(clock) + 1000).toISOString());
  const freshSignIn = () => j.signIn(undefined, { fresh: true });
  const retain = event => {
    assert.ok(!allIdentities.has(event.atomId), 'fresh allocation never reuses any earlier event identity');
    allIdentities.add(event.atomId);
    events.push(event);
  };
  const update = async (incident, details, patch = {}) => {
    await j.save(incident.id, { details, nextUpdateAt: new Date(Date.parse(clock) + 3600_000).toISOString(), ...patch });
    const saved = (await j.publish(incident.id)).update;
    assert.equal(saved.publishedAt, clock, 'retain the actual committed publication instant');
    const readback = (await j.read(incident.id)).updates.find(row => row.id === saved.id);
    assert.deepEqual(readback, saved, 'independent native readback identifies the committed update');
    retain({ recordId: incident.id, atomId: `${feedId}:event:update-${saved.id}`, publishedAt: clock,
      href: `${j.publicOrigin}/incidents/${incident.reference}`, title: `${incident.reference}: ${incident.title}`, wording: details });
    return saved;
  };
  const notice = (maintenance, kind) => {
    const candidates = maintenance.notices.filter(row => row.kind === kind && row.publishedAt === clock);
    assert.equal(candidates.length, 1, `the native response committed one ${kind} notice at the chosen instant`);
    const saved = candidates[0];
    retain({ recordId: maintenance.id, noticeId: saved.id, kind, atomId: `${feedId}:event:maintenance-notice-${saved.id}`, publishedAt: clock,
      href: `${j.publicOrigin}/maintenance/${maintenance.reference}`, title: `${maintenance.reference}: ${maintenance.title} — ${kind}`, wording: maintenance.customerImpact });
    return saved;
  };
  const schedule = async (title, components, startsAt = '2032-03-01T12:00:00.000Z') => {
    const made = (await j.json('/api/app/maintenance', 'POST', {
      title, affectedAudience: 'Synthetic Lamp customers', customerImpact: `Service pause for ${title}.`,
      startsAt, endsAt: new Date(Date.parse(startsAt) + 3600_000).toISOString(),
      componentIds: components.map(row => row.id), autoStart: false, autoComplete: false,
    }, 201)).maintenance;
    return made;
  };
  const readFeed = async expected => {
    const response = await eventually(() => j.publicResponse('/feed.atom'), asyncResponse =>
      asyncResponse.status === 200 && asyncResponse.headers.get('x-lamp-snapshot-generated-at') === clock, 'publication reaches Atom at the controlled generation');
    assert.match(response.headers.get('content-type'), /^application\/atom\+xml/);
    // Generation readiness and event readiness are separate: concurrent builds
    // may share the pinned clock. Reconcile the whole event set after settlement.
    const xml = await eventually(() => j.publicText('/feed.atom'), body => {
      const feed = validateAtomFeed(body);
      return feed.entries.length === expected.length && expected.every(event => feed.entries.some(row => row.id === event.atomId));
    }, 'the complete publication inventory reaches the feed');
    const feed = validateAtomFeed(xml);
    assert.equal(feed.id, feedId);
    assert.equal(feed.updated, clock);
    assertAtomInventory(feed, expected);
    return { xml, feed };
  };
  try {
    await move('2031-02-28T11:59:59.999Z'); await freshSignIn();
    const component = await j.component('Synthetic Lamp public service');
    const internal = await j.component('Synthetic Lamp internal service', { internal: true });
    await readFeed([]);
    const boundary = await j.incident('Synthetic Lamp boundary history', [component]);
    await update(boundary, 'Before the twelve-month boundary.');
    const before = await schedule('Synthetic Lamp expired window', [component]); notice(before, 'scheduled');
    await move('2031-02-28T12:00:00.000Z');
    await update(boundary, 'Exactly at the twelve-month boundary.');
    const exact = await schedule('Synthetic Lamp exact boundary window', [component]); notice(exact, 'scheduled');
    await move('2031-02-28T12:00:00.001Z');
    await update(boundary, 'Immediately inside the twelve-month boundary.');
    const inside = await schedule('Synthetic Lamp inside boundary window', [component]); notice(inside, 'scheduled');
    const first = await readFeed(events);
    // These malformed documents remain XML-well-formed. The independent Atom
    // checks must reject missing required constructs and invalid semantic values.
    for (const invalid of [
      first.xml.replace(/<author>.*?<\/author>/, ''),
      first.xml.replace(/<id>[^<]*<\/id>/, ''),
      first.xml.replace(/<updated>[^<]*<\/updated>/, '<updated>not-a-date</updated>'),
      first.xml.replace(/<id>[^<]*<\/id>/, '<id>relative-identity</id>'),
      first.xml.replace('http://www.w3.org/2005/Atom', 'urn:synthetic-lamp:wrong-namespace'),
    ]) assert.throws(() => validateAtomFeed(invalid), 'Atom semantics reject invalid but well-formed XML');

    // The leap-day anniversary clamps to February 28 of the previous year,
    // rather than silently shortening the promised window to 365 days.
    await move('2032-02-29T12:00:00.000Z'); await freshSignIn();
    const current = await j.incident('Synthetic Lamp current incident', [component]);
    await update(current, 'Current customer publication.');
    const eligible = () => events.filter(event => event.recordId !== before.id && event.publishedAt >= '2031-02-28T12:00:00.000Z');
    let expected = eligible();
    await readFeed(expected);
    assert.equal(expected.filter(event => event.publishedAt === '2031-02-28T12:00:00.000Z').length, 2, 'both event kinds at the exact cutoff remain eligible');

    await move('2032-02-29T12:00:00.001Z');
    const active = await schedule('Synthetic Lamp active window', [component], '2032-02-29T13:00:00.000Z'); notice(active, 'scheduled');
    expected = eligible().filter(event => event.publishedAt >= '2031-02-28T12:00:00.001Z');
    await readFeed(expected);
    // Retain a genuine reminder as an exclusion control. The five lifecycle
    // notice kinds are the contractual history, not repeated reminder messages.
    await j.tick(Date.parse(clock));
    const reminded = (await j.json('/api/app/maintenance')).maintenance.find(row => row.id === active.id);
    const reminder = reminded.notices.filter(row => row.kind === 'reminder');
    assert.equal(reminder.length, 1);
    await readFeed(expected);

    await later();
    const rescheduled = (await j.json(`/api/app/maintenance/${active.id}/window`, 'PUT', {
      startsAt: '2032-02-29T14:00:00.000Z', endsAt: '2032-02-29T15:00:00.000Z',
    })).maintenance; notice(rescheduled, 'rescheduled');
    await later();
    notice((await j.json(`/api/app/maintenance/${active.id}/start`, 'POST', {})).maintenance, 'started');
    await later();
    notice((await j.json(`/api/app/maintenance/${active.id}/complete`, 'POST', {})).maintenance, 'completed');
    await j.json(`/api/app/maintenance/${active.id}/complete`, 'POST', {}, 409);
    await later();
    const cancelled = await schedule('Synthetic Lamp cancelled window', [component]); notice(cancelled, 'scheduled');
    await later();
    notice((await j.json(`/api/app/maintenance/${cancelled.id}/cancel`, 'POST', {})).maintenance, 'cancelled');
    await j.json(`/api/app/maintenance/${cancelled.id}/cancel`, 'POST', {}, 409);
    const privateIncident = await j.incident('Synthetic Lamp private incident', [internal]);
    await j.save(privateIncident.id, { details: 'Internal wording never reaches Atom.', nextUpdateAt: new Date(Date.parse(clock) + 3600_000).toISOString() });
    await j.publish(privateIncident.id);
    await schedule('Synthetic Lamp private window', [internal]);
    const draftOnly = await j.incident('Synthetic Lamp unpublished incident', [component]);
    await j.save(draftOnly.id, { details: 'Unpublished wording never reaches Atom.', nextUpdateAt: null });
    const nativeMaintenance = (await j.json('/api/app/maintenance')).maintenance;
    for (const event of events.filter(row => row.noticeId)) {
      const record = nativeMaintenance.find(row => row.id === event.recordId);
      const persisted = record.notices.filter(row => row.id === event.noticeId);
      assert.equal(persisted.length, 1, 'independent native readback retains exactly one committed notice');
      assert.equal(persisted[0].kind, event.kind);
      assert.equal(persisted[0].publishedAt, event.publishedAt, 'the persisted notice retains its original publication instant');
    }
    expected = events.filter(event => event.publishedAt.startsWith('2032-'));
    const settled = await readFeed(expected);
    assert.doesNotMatch(settled.xml, /Internal wording|Unpublished wording|private window|private incident/);
    assert.deepEqual(new Set(events.filter(event => event.recordId === active.id).map(event => event.title.split(' — ')[1])), new Set(['scheduled', 'rescheduled', 'started', 'completed']));

    // Complete process disposal clears in-memory allocators and caches. Reopen
    // the same persisted D1 and R2, then read before making a new publication.
    Object.assign(j, await j.restart());
    await move(clock);
    const reopened = validateAtomFeed(await j.publicText('/feed.atom'));
    assert.deepEqual(reopened, settled.feed, 'every old event mapping and timestamp survives Worker restart');
    await later();
    await update(current, 'A later publication after Worker restart.');
    expected = events.filter(event => event.publishedAt.startsWith('2032-'));
    const laterFeed = await readFeed(expected);
    for (const entry of settled.feed.entries) assert.deepEqual(laterFeed.feed.entries.find(row => row.id === entry.id), entry, 'later publications retain each earlier identity mapping');

    // Delete through the audited operator door, then allocate a different
    // incident and maintenance event at the same instant as the prior write.
    const removed = events.filter(event => event.recordId === current.id).map(event => event.atomId);
    await j.json(`/api/app/incidents/${current.id}`, 'DELETE', { reason: 'Synthetic duplicate replaced after review' });
    expected = expected.filter(event => event.recordId !== current.id);
    const deleted = await readFeed(expected);
    for (const id of removed) assert.ok(!deleted.feed.entries.some(row => row.id === id), 'deleted incident events leave the public feed');
    const replacement = await j.incident(current.title, [component]);
    assert.notEqual(replacement.id, current.id);
    await update(replacement, 'Fresh publication after audited deletion.');
    const newWindow = await schedule('Synthetic Lamp new window after restart', [component]); notice(newWindow, 'scheduled');
    expected = events.filter(event => event.recordId !== current.id && event.publishedAt.startsWith('2032-'));
    const final = await readFeed(expected);
    for (const id of removed) assert.ok(!final.feed.entries.some(row => row.id === id), 'fresh allocation cannot resurrect a deleted event identity');
    for (const entry of deleted.feed.entries) assert.deepEqual(final.feed.entries.find(row => row.id === entry.id), entry, 'all surviving mappings remain stable after fresh allocation');
    console.log(`PROBE PAGE-010 1: GET /feed.atom -> Atom 1.0 namespace, required constructs, IRIs, timestamps, HTML and unique identities valid; ${final.feed.entries.length} entries`);
    console.log('PROBE PAGE-010 2: native publications -> exact incident and five-kind notice inventory, newest first; leap anniversary and adjacent millisecond boundaries reconciled; private, unpublished, expired and reminder events excluded');
    console.log(`PROBE PAGE-010 3: native publication, Worker restart, audited deletion and fresh allocation -> ${allIdentities.size} distinct committed identities; retained mappings unchanged and deleted mappings never reused`);
  } finally { await j.close(); }
}
