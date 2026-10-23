import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The same owner-door import behavior, applied to documented provider files.
 * Unknown provider fields never stand in for a successful acceptance point. */
export async function providerImportFlow({ moveIn, get, counts, runtime, notificationActivity, assertNoNewNotifications }) {
  for (const source of ['statusio']) {
    const folder = 'tests/fixtures/' + source + '/small';
    const files = readdirSync(folder).map(name => ({ name, text: readFileSync(join(folder, name), 'utf8') }));
    const input = { source, pageId: 'synthetic-lamp-1', publicAccessAcknowledged: true, files };
    const initial = await counts(), notifications = await notificationActivity(runtime);
    const preview = await moveIn.preview(input);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.report.counts.component.imported, 1);
    assert.equal(preview.body.report.counts.group.imported, 1);
    assert.equal(preview.body.report.counts.incident.imported, 1);
    assert.equal(preview.body.report.counts.maintenance.imported, 1);
    assert.deepEqual(await counts(), initial, 'a source dry run writes no page records');
    const applied = await moveIn.apply(preview.body);
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal(applied.body.job.state, 'completed');
    const current = await counts();
    assert.deepEqual(current, { components: initial.components + 1, groups: initial.groups + 1, incidents: initial.incidents + 1, maintenance: initial.maintenance + 1, subscribers: initial.subscribers });
    const incident = (await get('/api/app/incidents')).body.incidents.find(row => row.title === 'Synthetic incident');
    assert.ok(incident);
    assert.deepEqual(incident.updates.map(row => Date.parse(row.publishedAt)).sort(), [Date.parse('2024-01-01T12:00:00Z'), Date.parse('2024-01-01T12:30:00Z')]);
    assert.ok(incident.updates.every(row => row.isRetroactive));
    const maintenance = (await get('/api/app/maintenance')).body.maintenance.find(row => row.title === 'Synthetic maintenance');
    assert.ok(maintenance);
    assert.equal(Date.parse(maintenance.startsAt), Date.parse('2024-01-01T12:00:00Z'));
    assert.equal(Date.parse(maintenance.endsAt), Date.parse('2024-01-01T13:00:00Z'));
    const cutover = (await get('/api/app/statuspage-import/jobs/' + applied.body.job.id)).body.report.cutover;
    assert.equal(cutover.rows.length, 0, 'the API publishes no old-address fields');
    assert.ok(cutover.readerGaps.some(gap => gap.includes('Subscriber')));
    const again = await moveIn.preview(input);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.report.state, 'already imported');
    await assertNoNewNotifications(runtime, notifications);
    const undone = await moveIn.undo(applied.body.door);
    assert.equal(undone.status, 200, JSON.stringify(undone.body));
    assert.equal(undone.body.job.state, 'undone');
    assert.deepEqual(await counts(), initial);
    await assertNoNewNotifications(runtime, notifications);
  }
}
