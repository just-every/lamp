import assert from 'node:assert/strict';

/** Exercise real operator/public routes. Only deliberately uncredentialed
 * third-party destinations are supplied; Base must refuse their network calls. */
export async function exerciseDemo({ origin, pageOrigin, key, cookie, fetch }) {
  const expected = ['api.statuspage.io', 'api.instatus.com', 'incidents.betterstack.com', 'hooks.slack.com', 'demo.webhook.office.com', 'hooks.example.invalid', 'heartbeat.example.invalid'];
  const witnessed = new Set();
  const headers = { Cookie: cookie, Origin: origin, 'x-rer-dev-key': key };
  async function observe() {
    const html = await (await fetch(origin + '/app', { headers })).text();
    for (const host of expected) if (html.includes(host)) witnessed.add(host);
  }
  async function api(path, data, method = data ? 'POST' : 'GET', extra = {}) {
    const response = await fetch(origin + path, { method, headers: { ...headers, ...(data ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await api('/api/app/session')).status, 200);
  const components = (await api('/api/app/components')).body.components;
  assert.ok(components.length > 0, 'sample components are visible');
  const incidents = (await api('/api/app/incidents')).body.incidents;
  assert.ok(incidents.some(row => row.lifecycle === 'Resolved') && incidents.some(row => row.lifecycle !== 'Resolved'), 'sample history contains a resolved and an active incident');
  assert.ok((await api('/api/app/maintenance')).body.maintenance.some(row => Date.parse(row.startsAt) > Date.now()), 'upcoming maintenance is available');
  const subscribers = (await api('/api/app/subscribers')).body.subscribers;
  assert.ok(['email', 'webhook'].every(channel => subscribers.some(row => row.channel === channel && row.state === 'active')), 'both sample subscriber channels are ready');
  assert.equal((await api('/api/app/ai/status')).body.configured, false);
  const document = await fetch(origin + '/app', { headers, redirect: 'manual' });
  assert.equal(document.status, 200, 'finished first run opens the app');
  assert.match(await document.text(), /id="rer-demo-bar"/);
  const publicPage = await fetch(pageOrigin + '/', { headers: { 'x-rer-dev-key': key } });
  assert.equal(publicPage.status, 200);
  assert.equal(publicPage.headers.get('X-Lamp-Snapshot-Retained'), 'true', 'disposable public snapshot has its retained copy');
  assert.ok((await publicPage.text()).includes(incidents.find(row => row.lifecycle !== 'Resolved').title), 'public snapshot carries the actual active incident');
  for (const source of ['statuspage', 'instatus', 'betterstack']) {
    const refused = await api('/api/app/statuspage-import/preview', { source, pageId: 'demo123', apiKey: 'demonstration-key-with-no-authority', publicAccessAcknowledged: true });
    assert.equal(refused.status, 400, `${source} import refused`);
    await observe();
  }
  assert.equal((await api('/api/app/overview/check-sender', {})).status, 200);
  const subscription = await fetch(pageOrigin + '/subscribe', { method: 'POST', headers: { Origin: pageOrigin, 'x-rer-dev-key': key }, body: new URLSearchParams({ email: 'visitor@example.invalid' }) });
  assert.equal(subscription.status, 202);
  for (const [kind, url] of [['slack', 'https://hooks.slack.com/services/T0DEMO/B0DEMO/demonstration'], ['teams', 'https://demo.webhook.office.com/workflows/demo']]) {
    assert.equal((await api('/api/app/channels', { kind, name: `Demo ${kind}`, url, componentIds: [] })).status, 201);
  }
  const incident = incidents.find(row => row.lifecycle !== 'Resolved');
  const suggestion = await api(`/api/app/incidents/${incident.id}/ai-suggestion`, {});
  assert.equal(suggestion.status, 404, 'AI suggestion refuses an unconfigured provider');
  assert.match(suggestion.body.error, /No AI provider is configured/);
  const detail = (await api(`/api/app/incidents/${incident.id}`)).body.incident;
  assert.ok(detail, 'sample incident is editable through its public API');
  const draft = await api(`/api/app/incidents/${incident.id}/draft`, { lifecycle: 'Monitoring', affectedAudience: 'Customers running background jobs', customerImpact: 'Jobs are now completing normally.', whatStillWorks: 'The dashboard and API remain available.', details: 'We are monitoring queue recovery.', nextUpdateAt: new Date(Date.now() + 3600000).toISOString() }, 'PUT', { 'If-Match': `${detail.draft?.id ?? '-'}:${detail.updates.length}` });
  assert.equal(draft.status, 200);
  assert.equal((await api(`/api/app/incidents/${incident.id}/publish`, { channels: ['email', 'webhook', 'chat'] }, 'POST', { 'If-Match': `${draft.body.draft.id}:${detail.updates.length}` })).status, 200);
  // The scheduled trigger dispatches mail/webhooks and attempts the configured
  // external heartbeat. A failed outbound effect must remain visibly failed.
  for (const deadline = Date.now() + 95000; Date.now() < deadline;) {
    await observe();
    if (witnessed.size === expected.length) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.deepEqual(expected.filter(host => !witnessed.has(host)), [], 'each real outbound effect was recorded as blocked');
  const outbox = await (await fetch(origin + '/__dev/outbox?format=json', { headers })).json();
  assert.ok(outbox.envelopes.some(row => row.message.subject.includes('sender check')));
  assert.ok(outbox.envelopes.some(row => row.message.to === 'visitor@example.invalid'));
  assert.ok(outbox.envelopes.some(row => row.message.to === 'alex@example.invalid'));
  return { witnessed: [...witnessed], expected, incidentId: incident.id, incidentTitle: incident.title, initialLifecycle: incident.lifecycle };
}
