import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { themeSchema } from '../../src/core/shared/page-theme.ts';
import { QUEUE_ORIGIN } from './queue-provider.mjs';

const endpoint = '/api/app/overview/follow-ups';
const dispatches = new Map();
const healthy = new Set();
async function eventually(read, predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('The native failed notification dispatch did not become visible.');
}

/** Prepare actual failed deliveries through the authenticated operator doors.
 * The disposable network refuses the webhook; no failure or success rows are
 * inserted. This does not simulate an unavailable JOBS producer. */
export default async function prepareQueueFixtures({ phase, request, origin, cookie, database, queues, fixtures, now = Date.now() }) {
  const call = async (path, method = 'GET', body, extraHeaders = {}) => {
    const response = await request(new URL(path, origin).href, {
      method, redirect: 'manual', headers: { Host: new URL(origin).host, Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...extraHeaders },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, `Native queue preparation ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
  const db = await database('DB');
  // A disposable hosted installation has ordinary deployment page settings
  // before the owner creates records. The mandatory configure step still edits
  // these settings through the real agent/native service.
  const timestamp = new Date(now).toISOString();
  await db.prepare("INSERT INTO page_settings(id,page_name,tagline,accent_color,timezone,hostname,mail_from_address,theme,feed_id,created_at,updated_at) VALUES ('default',?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
    .bind('Synthetic Lamp', 'Disposable incident status', '#2563eb', 'UTC', 'status.rer-hosted-check.invalid', 'synthetic-lamp@rer-hosted-check.invalid', JSON.stringify(themeSchema.parse({})), '0' + randomUUID().replaceAll('-', '').slice(0,25).toUpperCase(), timestamp, timestamp).run();
  const values = {};
  await fixtures.set(QUEUE_ORIGIN, { healthy: [...healthy] });
  for (const purpose of ['retry', 'dismiss']) {
    const suffix = randomUUID();
    const { component } = await call('/api/app/components', 'POST', {
      groupId: null, name: `Synthetic Lamp queue ${purpose} ${phase}`, description: 'Disposable notification Queue journey',
      internal: false, displayOrder: 0, note: '',
    });
    const { subscriber } = await call('/api/app/subscribers/webhook', 'POST', {
      destination: `${QUEUE_ORIGIN}/synthetic-lamp-${suffix}`,
      contactEmail: `synthetic-lamp-${suffix}@example.com`, componentIds: [component.id],
      eventKinds: ['incidents'],
    });
    assert.equal(subscriber.state, 'active', 'A native webhook subscription is active before publication');
    const created = await call('/api/app/incidents', 'POST', {
      title: `Synthetic Lamp failed dispatch ${purpose}`,
      components: [{ componentId: component.id, state: 'Degraded performance', relationship: 'Primary' }],
      update: {
        lifecycle: 'Investigating', affectedAudience: 'Synthetic API customers', customerImpact: 'Synthetic responses are delayed.',
        whatStillWorks: 'The synthetic dashboard remains available.', details: 'The operator is investigating the synthetic failed delivery.',
        nextUpdateAt: new Date(now + 60 * 60_000).toISOString(),
      },
    });
    const current = await call(`/api/app/incidents/${created.incident.id}`);
    const published = await call(`/api/app/incidents/${created.incident.id}/publish`, 'POST', { channels: ['webhook'] }, {
      'If-Match': `${current.incident.draft.id}:${current.incident.updates.length}`,
    });
    const outbox = await db.prepare("SELECT id FROM notification_outbox WHERE kind='delivery-dispatch' AND aggregate_id=?").bind(published.update.id).first();
    assert.ok(outbox?.id, 'Publication retained real native dispatch work');
    const id = `notification-dispatch:${outbox.id}`;
    const failed = await eventually(async () => (await call(endpoint)).followUps.find(row => row.id === id), row => row?.failure?.state === 'failed');
    assert.ok(failed.failure.message && Number.isFinite(Date.parse(failed.failure.occurredAt)), 'The failed provider request has retained native failure evidence');
    values[purpose === 'retry' ? 'queueRetry' : 'queueDismiss'] = { id: failed.id, occurrence: failed.occurrence };
    dispatches.set(failed.id, { subscriberId: subscriber.id, occurrence: failed.occurrence, path: `/synthetic-lamp-${suffix}` });
  }
  // Keep the consumer behind native approval and the mandatory retry assertion.
  // This gate never rejects JOBS.send and is not a producer-outage claim.
  queues.hold();
  return values;
}

export async function afterQueueStep({ step, args, result, request, origin, cookie, queues, fixtures }) {
  if (step.tool === 'lamp.followups.retry') {
    assert.equal(result?.queued, true, 'The native Queue accepted one exact unfinished dispatch');
    const prepared = dispatches.get(args.id);
    assert.ok(prepared, 'The retry targets a native prepared failed dispatch');
    healthy.add(prepared.path);
    await fixtures.set(QUEUE_ORIGIN, { healthy: [...healthy] });
    queues.release();
    await eventually(async () => {
      const response = await request(new URL(endpoint, origin).href, { headers: { Host: new URL(origin).host, Cookie: cookie } });
      assert.equal(response.status, 200);
      return (await response.json()).followUps;
    }, followUps => !followUps.some(row => row.id === args.id));
    const deliveries = await request(new URL('/api/app/deliveries?channel=webhook&limit=100', origin).href, { headers: { Host: new URL(origin).host, Cookie: cookie } });
    assert.equal(deliveries.status, 200);
    assert.ok((await deliveries.json()).deliveries.some(row => row.subscriberId === prepared.subscriberId && row.outcome === 'delivered'), 'The real recovered Queue consumer completed the original native delivery');
  }
  if (step.tool !== 'lamp.followups.dismiss') return;
  assert.equal(result?.dismissed, true);
  const response = await request(new URL(endpoint, origin).href, { headers: { Host: new URL(origin).host, Cookie: cookie } });
  assert.equal(response.status, 200);
  const { followUps } = await response.json();
  assert.ok(!followUps.some(row => row.id === args.id && row.occurrence === args.occurrence), 'The exact dismissed failure is absent through the native read door');
  assert.ok(dispatches.has(args.id), 'The dismissed occurrence belongs to a natively prepared failed dispatch');
}

