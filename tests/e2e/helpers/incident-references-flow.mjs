import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { parse } from 'parse5';
import { visibleText } from './status-journey.mjs';

const nodes = node => [node, ...(node.childNodes ?? []).flatMap(nodes)];
const attribute = (node, name) => node.attrs?.find(attr => attr.name === name)?.value;
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(text).join('');

/** One installed database, ordinary creation and publication doors, and a full
 * Worker restart against the same durable storage. Legacy rows and a failing
 * database trigger are prerequisites; no allocator implementation is imported. */
export async function assertIncidentReferences(j) {
  const actor = await j.db.prepare('SELECT id FROM oa_operators WHERE role = ?').bind('owner').first();
  const legacy = {
    id: '01J00000000000000000000080', reference: 'INC-1790000000000',
    title: 'Synthetic Lamp legacy incident', details: 'Synthetic Lamp original legacy publication.',
  };
  const at = '2026-10-01T00:00:00.000Z';
  // An existing installation can contain timestamp-sized references. Its first
  // new native allocation must still start the short sequence at one.
  await j.db.prepare(`INSERT INTO incidents
    (id,reference,title,lifecycle,opened_at,created_by_operator_id,created_at,updated_at)
    VALUES (?,?,?,'Investigating',?,?,?,?)`)
    .bind(legacy.id, legacy.reference, legacy.title, at, actor.id, at, at).run();
  const component = await j.component('Synthetic Lamp reference service');
  await j.json(`/api/app/incidents/${legacy.id}/components`, 'POST', {
    componentId: component.id, state: 'Major outage', relationship: 'Primary',
  }, 201);
  const publish = async (incident, details, lifecycle = 'Identified') => {
    await j.save(incident.id, { lifecycle, details });
    await j.publish(incident.id);
    await j.visible(`/incidents/${incident.reference}`, details);
  };
  await publish(legacy, legacy.details);

  const retained = [];
  const retain = async (incident, details) => {
    assert.match(incident.reference, /^INC-[0-9]+$/);
    const html = await j.visible('/', incident.title);
    const articles = nodes(parse(html)).filter(node => node.tagName === 'article'
      && attribute(node, 'class')?.split(' ').includes('incident')
      && nodes(node).some(child => /^h[1-6]$/.test(child.tagName) && text(child) === incident.title));
    assert.equal(articles.length, 1, 'the public catalogue identifies this incident');
    const links = nodes(articles[0]).filter(node => node.tagName === 'a'
      && attribute(node, 'href')?.startsWith('/incidents/'));
    assert.equal(links.length, 1, 'one canonical incident link is published');
    const address = new URL(attribute(links[0], 'href'), j.publicOrigin).href;
    assert.equal(new URL(address).pathname, `/incidents/${incident.reference}`);
    const record = { id: incident.id, reference: incident.reference, title: incident.title, address, details: [details] };
    retained.push(record);
    return record;
  };
  const reread = async () => {
    for (const record of retained) {
      assert.equal((await j.read(record.id)).reference, record.reference, 'the saved reference is permanent');
      const response = await j.raw(record.address);
      assert.equal(response.status, 200, 'the retained canonical address still serves without a redirect');
      assert.equal(response.headers.get('location'), null);
      const html = await response.text();
      const headings = nodes(parse(html)).filter(node => node.tagName === 'h1');
      assert.deepEqual(headings.map(text), [record.title], 'the retained address still identifies the same incident');
      for (const details of record.details) assert.ok(visibleText(html).includes(details), 'the old address retains every publication');
    }
  };
  await retain(legacy, legacy.details);
  const first = await j.incident('Synthetic Lamp first manual incident', [component]);
  assert.equal(first.reference, 'INC-1', 'legacy timestamp references do not seed the new sequence');
  const firstDetails = 'Synthetic Lamp first manual publication.';
  await publish(first, firstDetails);
  const firstRetained = await retain(first, firstDetails);

  const secret = 'synthetic-lamp-reference-1';
  const source = (await j.json('/api/app/intake/sources', 'POST', {
    name: 'Synthetic Lamp reference alerts', credentialKind: 'hmac-sha256', signingSecret: secret,
    deduplicationPath: '$.id', titlePath: '$.title', statePath: '$.state', recoveredValue: 'recovered',
  }, 201)).source;
  const alert = async (id, title, status = 202) => {
    const body = JSON.stringify({ id, title, state: 'firing' }), timestamp = new Date().toISOString();
    const response = await j.raw(new URL(source.endpointPath, j.publicOrigin).href, {
      method: 'POST', body, headers: {
        'Content-Type': 'application/json', 'x-lamp-timestamp': timestamp,
        'x-lamp-signature': createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('base64url'),
      },
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  };
  const intakeReceipt = await alert('synthetic-lamp-1', 'Synthetic Lamp intake incident');
  const intake = await j.read(intakeReceipt.incidentId);
  const third = await j.incident('Synthetic Lamp second manual incident', [component]);
  assert.deepEqual([first.reference, intake.reference, third.reference], ['INC-1', 'INC-2', 'INC-3'],
    'manual, authenticated intake and manual creation advance the same sequence');
  assert.equal(intake.updates.length, 0, 'intake creation is private until the operator publishes');
  await j.json(`/api/app/incidents/${intake.id}/components`, 'POST', {
    componentId: component.id, state: 'Major outage', relationship: 'Primary',
  }, 201);
  const intakeDetails = 'Synthetic Lamp operator publication of accepted intake.';
  await publish(intake, intakeDetails);
  const intakeRetained = await retain(intake, intakeDetails);
  await reread();

  await j.json(`/api/app/incidents/${third.id}`, 'DELETE', { reason: 'Synthetic Lamp duplicate investigation' });
  await j.json(`/api/app/incidents/${third.id}`, 'GET', undefined, 404);
  await j.restart();
  const afterRestart = await j.incident('Synthetic Lamp manual after restart', [component]);
  assert.equal(afterRestart.reference, 'INC-4', 'deletion and a restarted Worker cannot reuse the last reference');
  await reread();

  const inventory = async () => {
    const tables = ['incidents', 'incident_drafts', 'alert_receipts'];
    const results = await j.db.batch(tables.map(table => j.db.prepare(`SELECT * FROM ${table} ORDER BY id`)));
    return results.map(result => result.results);
  };
  // Fail the product insert after the real allocator commits its reservation.
  // Both public creation doors must leave only a gap, never a reusable number.
  await j.execute(`CREATE TRIGGER synthetic_lamp_fail_creation BEFORE INSERT ON incidents
    WHEN NEW.title = 'Synthetic Lamp failed creation'
    BEGIN SELECT RAISE(FAIL, 'Synthetic Lamp creation refused after reservation'); END;`);
  const beforeFailure = await inventory();
  const failed = await j.api('/api/app/incidents', { method: 'POST', body: JSON.stringify({
    title: 'Synthetic Lamp failed creation', components: [{ componentId: component.id, state: 'Major outage', relationship: 'Primary' }],
  }) });
  assert.equal(failed.status, 409);
  assert.match(failed.body.error, /Synthetic Lamp creation refused after reservation/);
  assert.deepEqual(await inventory(), beforeFailure, 'failed manual creation stores no partial product records');
  await j.execute('DROP TRIGGER synthetic_lamp_fail_creation;');
  const afterFailure = await j.incident('Synthetic Lamp after failed manual creation', [component]);
  assert.equal(afterFailure.reference, 'INC-6', 'the failed manual reservation is not reused');
  await j.execute(`CREATE TRIGGER synthetic_lamp_fail_creation BEFORE INSERT ON incidents
    WHEN NEW.title = 'Synthetic Lamp failed creation'
    BEGIN SELECT RAISE(FAIL, 'Synthetic Lamp creation refused after reservation'); END;`);
  const beforeIntakeFailure = await inventory();
  const failedIntake = await alert('synthetic-lamp-2', 'Synthetic Lamp failed creation', 500);
  assert.match(failedIntake.error, /Synthetic Lamp creation refused after reservation/);
  assert.deepEqual(await inventory(), beforeIntakeFailure, 'failed intake creation stores no incident, draft or receipt');
  await j.execute('DROP TRIGGER synthetic_lamp_fail_creation;');
  const laterIntake = await alert('synthetic-lamp-3', 'Synthetic Lamp after failed intake creation');
  assert.equal((await j.read(laterIntake.incidentId)).reference, 'INC-8', 'the failed intake reservation is not reused');
  await j.restart();
  const later = await j.incident('Synthetic Lamp later manual incident', [component]);
  assert.equal(later.reference, 'INC-9', 'the shared counter and failed reservations survive another restart');
  const allocations = await j.db.prepare("SELECT reference FROM reference_allocations WHERE namespace = 'INC' ORDER BY reference").all();
  assert.deepEqual(allocations.results.map(row => row.reference).sort(),
    [legacy.reference, ...Array.from({ length: 9 }, (_, index) => `INC-${index + 1}`)].sort());

  for (const [record, details] of [
    [firstRetained, 'Synthetic Lamp later manual progress.'],
    [intakeRetained, 'Synthetic Lamp later intake progress.'],
  ]) {
    await publish(record, details, 'Monitoring');
    record.details.push(details);
  }
  await reread();
  return retained;
}
