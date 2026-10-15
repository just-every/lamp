import assert from 'node:assert/strict';

/** Exercise real operator/public routes and successful demo effects. */
export async function exerciseDemo({ origin, pageOrigin, key, cookie, fetch }) {
  const headers = { Cookie: cookie, Origin: origin, 'x-rer-dev-key': key };
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
  assert.equal((await api('/api/app/ai/status')).body.configured, true);
  const document = await fetch(origin + '/app', { headers, redirect: 'manual' });
  assert.equal(document.status, 200, 'finished first run opens the app');
  assert.match(await document.text(), /data-rer-name/);
  const publicPage = await fetch(pageOrigin + '/', { headers: { 'x-rer-dev-key': key } });
  assert.equal(publicPage.status, 200);
  assert.equal(publicPage.headers.get('X-Lamp-Snapshot-Retained'), 'true', 'disposable public snapshot has its retained copy');
  assert.ok((await publicPage.text()).includes(incidents.find(row => row.lifecycle !== 'Resolved').title), 'public snapshot carries the actual active incident');
  assert.equal((await api('/api/app/overview/check-subscribe', {})).status, 200, 'real public subscription-form check completes');
  assert.equal((await api('/api/app/overview/check-sender', {})).status, 200);
  const subscription = await fetch(pageOrigin + '/subscribe', { method: 'POST', headers: { Origin: pageOrigin, 'x-rer-dev-key': key }, body: new URLSearchParams({ email: 'visitor@example.invalid' }) });
  assert.equal(subscription.status, 202);
  for (const [kind, url] of [['slack', 'https://hooks.slack.com/services/T0DEMO/B0DEMO/demonstration'], ['teams', 'https://demo.webhook.office.com/workflows/demo']]) {
    assert.equal((await api('/api/app/channels', { kind, name: `Demo ${kind}`, url, componentIds: [] })).status, 201);
  }
  const incident = incidents.find(row => row.lifecycle !== 'Resolved');
  const suggestion = await api(`/api/app/incidents/${incident.id}/ai-suggestion`, {});
  // The configured provider is an unreachable .invalid host: success means the demo effect answered.
  assert.equal(suggestion.status, 200, 'AI suggestion completes as a demo effect');
  assert.ok(suggestion.body.suggestion.customerImpact.text && suggestion.body.suggestion.customerImpact.sources.length, 'suggestion cites the brief');
  const detail = (await api(`/api/app/incidents/${incident.id}`)).body.incident;
  assert.ok(detail, 'sample incident is editable through its public API');
  const draft = await api(`/api/app/incidents/${incident.id}/draft`, { lifecycle: 'Monitoring', affectedAudience: 'Customers running background jobs', customerImpact: 'Jobs are now completing normally.', whatStillWorks: 'The dashboard and API remain available.', details: 'We are monitoring queue recovery.', nextUpdateAt: new Date(Date.now() + 3600000).toISOString() }, 'PUT', { 'If-Match': `${detail.draft?.id ?? '-'}:${detail.updates.length}` });
  assert.equal(draft.status, 200);
  assert.equal((await api(`/api/app/incidents/${incident.id}/publish`, { channels: ['email', 'webhook', 'chat'] }, 'POST', { 'If-Match': `${draft.body.draft.id}:${detail.updates.length}` })).status, 200);
  let deliveries;
  for (const deadline = Date.now() + 30000; ; ) {
    deliveries = (await api('/api/app/deliveries')).body.deliveries;
    if (deliveries.some(row => row.channel === 'webhook' && row.outcome === 'delivered') && deliveries.some(row => row.channel === 'email' && row.providerAcceptedAt) || Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(deliveries.some(row => row.channel === 'webhook' && row.outcome === 'delivered'), 'mocked webhook completes successfully: ' + JSON.stringify(deliveries.map(row => ({ channel: row.channel, outcome: row.outcome, error: row.latestError }))));
  assert.ok(deliveries.some(row => row.channel === 'email' && row.providerAcceptedAt), 'mocked email has provider-shaped success');
  return { incidentId: incident.id, incidentTitle: incident.title, initialLifecycle: incident.lifecycle };
}
