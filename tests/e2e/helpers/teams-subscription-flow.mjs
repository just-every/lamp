import assert from 'node:assert/strict';

export const TEAMS_SUBSCRIBER_URL = 'https://default-test.00.environment.api.powerplatform.com/powerautomate/automations/direct/cu/20/workflows/teams-subscriber/triggers/manual/paths/invoke?api-version=1&sig=teamsSubscriberSecret';
const FAIL_URL = TEAMS_SUBSCRIBER_URL.replace('teams-subscriber/', 'teams-subscriber-failure/');
export function teamsFixtureResponse(path, body) {
  if (!path.includes('/workflows/teams-subscriber-failure/')) return null;
  const card = JSON.parse(body).attachments[0].content;
  return { status: card.actions.some(action => action.title === 'Confirm subscription') ? 202 : 500, body: '' };
}
const pause = () => new Promise(resolve => setTimeout(resolve, 150));
async function until(read, description) {
  for (let step = 0; step < 100; step++) { const value = await read(); if (value) return value; await pause(); }
  throw new Error(`Teams fixture timed out: ${description}`);
}
const card = entry => JSON.parse(entry.body).attachments[0].content;

/** Runs through real Worker routes. Only Microsoft is replaced at the network
 * edge; retry-history rows skip the hour-long retry clock in this fixture. */
export async function teamsSubscriptionFlow({ api, post, sql, received, publicOrigin, browserProof, operatorProof }) {
  const send = (destination, componentIds, overrides = {}) => fetch(`${publicOrigin}/subscribe/teams`, { method: 'POST', headers: { Accept: 'text/html', ...overrides }, body: new URLSearchParams([['destination', destination], ['contactEmail', 'teams-contact@example.test'], ...componentIds.map(id => ['componentId', id])]) });
  const list = async () => (await api('/api/app/subscribers')).body.subscribers;
  const makeComponent = async name => {
    const response = await post('/api/app/components', { groupId: null, name, description: '', internal: false, displayOrder: 100, note: '' });
    assert.equal(response.status, 201, response.text); return response.body.component;
  };
  for (const channel of (await api('/api/app/channels')).body.channels) assert.equal((await api(`/api/app/channels/${channel.id}`, { method: 'DELETE' })).status, 200);
  const a = await makeComponent('Teams subscriber payments'), b = await makeComponent('Teams subscriber search');
  const form = await fetch(`${publicOrigin}/subscribe/teams`);
  assert.equal(form.status, 200); assert.match(await form.text(), /Teams Workflows webhook URL/);
  assert.equal((await send(TEAMS_SUBSCRIBER_URL.replace('.environment.api.powerplatform.com', '.evil.test'), [])).status, 400);
  assert.equal((await send('https://tenant.webhook.office.com/webhookb2/a', [])).status, 400);
  // A local harness may omit the limiter; one cross-site request never sends.
  assert.equal((await send(TEAMS_SUBSCRIBER_URL, [], { 'Sec-Fetch-Site': 'cross-site' })).status, 404, 'native development perimeter refuses cross-site writes before app routes');
  const before = received.length;
  const response = await send(TEAMS_SUBSCRIBER_URL, [a.id]);
  assert.equal(response.status, 202, await response.text());
  const verification = await until(() => received.slice(before).find(entry => entry.path.includes('/workflows/teams-subscriber/')), 'verification card');
  assert.equal(card(verification).type, 'AdaptiveCard');
  assert.equal(JSON.parse(verification.body).attachments[0].contentUrl, null, 'documented Workflows attachment envelope');
  assert.equal(card(verification).actions[0].type, 'Action.OpenUrl');
  const confirmationUrl = card(verification).actions.find(action => action.title === 'Confirm subscription').url;
  assert.equal((await send(TEAMS_SUBSCRIBER_URL, [b.id])).status, 202);
  assert.equal(received.slice(before).filter(entry => entry.path.includes('/workflows/teams-subscriber/')).length, 1, 'repeated sign-up sends one card and changes no selection');
  const row = (await list()).find(row => row.deliveryKind === 'teams' && row.contactEmail === 'teams-contact@example.test');
  assert.ok(row); assert.equal(row.state, 'pending'); assert.deepEqual(row.componentSelections.map(selection => selection.componentId), [a.id]);
  assert.equal(row.destination, 'Microsoft Teams channel');
  const stored = sql(`SELECT destination,destination_key AS destinationKey FROM subscribers WHERE id='${row.id}'`)[0];
  assert.ok(stored.destination.startsWith('v1.')); assert.ok(!JSON.stringify(stored).includes('teamsSubscriberSecret'));
  const makeIncident = async (component, title) => {
    const incident = await post('/api/app/incidents', { title, components: [{ componentId: component.id, state: 'Partially unavailable', relationship: 'Primary' }] });
    assert.equal(incident.status, 201, incident.text); return incident.body.incident;
  };
  const publish = async incident => {
    const draft = await api(`/api/app/incidents/${incident.id}/draft`, { method: 'PUT', body: JSON.stringify({ lifecycle: 'Investigating', affectedAudience: 'Customers using card payments', customerImpact: 'Payments take longer', whatStillWorks: 'Search remains available', details: 'We are restoring capacity. https://help.example.test/status', nextUpdateAt: new Date(Date.now() + 3600000).toISOString() }) });
    assert.equal(draft.status, 200, draft.text);
    const response = await post(`/api/app/incidents/${incident.id}/publish`, { channels: ['chat'] });
    assert.equal(response.status, 200, response.text); return response;
  };
  const generic = await post('/api/app/subscribers/webhook', { destination: 'https://teams-selection.example.test/no-network', contactEmail: 'generic@example.test', componentIds: [a.id] });
  assert.equal(generic.status, 201, generic.text);
  const incident = await makeIncident(a, 'Teams payment delays');
  await publish(incident);
  assert.equal(sql(`SELECT COUNT(*) AS n FROM notification_deliveries WHERE subscriber_id='${row.id}'`)[0].n, 0, 'pending Teams subscription receives no updates');
  const preview = await fetch(confirmationUrl); assert.equal(preview.status, 200);
  assert.match(await preview.text(), /Confirm Teams subscription/);
  assert.equal((await list()).find(item => item.id === row.id).state, 'pending', 'opening the card link does not activate');
  assert.equal((await fetch(confirmationUrl, { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 404, 'native development perimeter refuses cross-site confirmation');
  const browserConfirmation = browserProof ? await browserProof({ publicOrigin, confirmationUrl, destination: TEAMS_SUBSCRIBER_URL, selectedComponent: a.name }) : null;
  let manageUrl = browserConfirmation?.manageUrl;
  if (!manageUrl) {
    const confirmed = await fetch(confirmationUrl, { method: 'POST' }); assert.equal(confirmed.status, 200);
    const managePath = (await confirmed.text()).match(/href="(\/manage\/[^" ]+)"/)[1];
    manageUrl = new URL(managePath, publicOrigin).href;
  }
  assert.equal((await fetch(confirmationUrl, { method: 'POST' })).status, 404, 'verification is single-use');
  assert.equal((await list()).find(item => item.id === row.id).state, 'active');
  assert.equal((await api(`/api/app/incidents/${incident.id}`)).body.hasChatChannels, true, 'active Teams subscribers enable the native chat notification default without an operator channel');
  await publish(incident);
  const update = await until(() => received.slice(before).find(entry => entry.path.includes('/workflows/teams-subscriber/') && card(entry).actions.some(action => action.title === 'Open status update')), 'published Adaptive Card');
  const text = card(update).body.map(block => block.text).join('\n');
  for (const field of ['Customers using card payments', 'Payments take longer', 'Search remains available', 'restoring capacity', 'Next update']) assert.ok(text.includes(field), field);
  assert.ok(card(update).actions.some(action => action.title === 'Manage subscription'));
  assert.equal(sql(`SELECT COUNT(*) AS n FROM notification_deliveries WHERE subscriber_id='${generic.body.subscriber.id}'`)[0].n, 0, 'chat selection does not notify generic webhook subscribers');
  const outside = await makeIncident(b, 'Teams unrelated search issue'); await publish(outside);
  assert.equal(sql(`SELECT COUNT(*) AS n FROM notification_deliveries d JOIN incident_updates u ON u.id=d.incident_update_id WHERE d.subscriber_id='${row.id}' AND u.incident_id='${outside.id}'`)[0].n, 0, 'unselected components send nothing');
  const attached = await post(`/api/app/incidents/${outside.id}/components`, { componentId: a.id, state: 'Partially unavailable', relationship: 'Dependent' });
  assert.equal(attached.status, 201, attached.text);
  assert.equal(sql(`SELECT COUNT(*) AS n FROM notification_deliveries d JOIN incident_updates u ON u.id=d.incident_update_id WHERE d.subscriber_id='${row.id}' AND u.incident_id='${outside.id}'`)[0].n, 1, 'attaching a followed component captures one latest-update catch-up');
  assert.equal((await fetch(manageUrl, { method: 'POST', body: new URLSearchParams({ componentId: b.id }) })).status, 200);
  await publish(incident);
  const deliveries = sql(`SELECT COUNT(*) AS n FROM notification_deliveries WHERE subscriber_id='${row.id}'`)[0].n;
  assert.equal(deliveries, 2, 'management selection changes future eligibility');
  const report = await api('/api/app/subscriber-reporting?channel=teams'); assert.equal(report.status, 200); assert.ok(report.body.counts.some(count => count.channel === 'teams' && count.state === 'active' && count.count >= 1));

  // A distinct failing workflow verifies successfully, then rejects updates.
  assert.equal((await send(FAIL_URL, [])).status, 202);
  const failureVerification = await until(() => received.find(entry => entry.path.includes('/workflows/teams-subscriber-failure/')), 'failure fixture verification');
  assert.equal((await fetch(card(failureVerification).actions[0].url, { method: 'POST' })).status, 200);
  const failed = (await list()).find(item => item.deliveryKind === 'teams' && item.id !== row.id);
  assert.ok(failed);
  const future = await makeComponent('Teams future visible component');
  await publish(await makeIncident(future, 'Teams future component issue'));
  assert.equal(sql(`SELECT COUNT(*) AS n FROM notification_deliveries WHERE subscriber_id='${failed.id}'`)[0].n, 1, 'all-component subscription follows components created after confirmation');
  for (let index = 0; index < 9; index++) await publish(incident);
  // Seed only the elapsed retry history, never an app implementation or outcome.
  sql(`INSERT OR IGNORE INTO notification_delivery_attempts(id,delivery_id,attempt_number,attempted_at,error,created_at) SELECT upper(hex(randomblob(13))),d.id,n.value,'2000-01-01T00:00:00.000Z','Recorded Teams 500 network edge','2000-01-01T00:00:00.000Z' FROM notification_deliveries d,json_each('[1,2,3,4,5]') n WHERE d.subscriber_id='${failed.id}'; UPDATE notification_outbox SET available_at='2000-01-01T00:00:00.000Z' WHERE kind='delivery-dispatch' AND aggregate_id IN (SELECT notification_event_id FROM notification_deliveries WHERE subscriber_id='${failed.id}')`);
  await fetch(`${publicOrigin.replace('localhost', '127.0.0.1')}/cdn-cgi/handler/scheduled`);
  await until(async () => (await list()).find(item => item.id === failed.id)?.state === 'deactivated', 'ten consecutive failures deactivate Teams');
  assert.match((await list()).find(item => item.id === failed.id).deactivationReason, /ten consecutive Teams/);
  assert.ok(sql(`SELECT payload_json AS payload FROM notification_outbox WHERE aggregate_id='webhook-deactivated/${failed.id}'`).some(entry => JSON.parse(entry.payload).recipients.includes('teams-contact@example.test')), 'failure notice is queued to contact');
  const finalCount = sql(`SELECT COUNT(*) AS n FROM notification_deliveries WHERE subscriber_id='${failed.id}'`)[0].n;
  await publish(incident);
  assert.equal(sql(`SELECT COUNT(*) AS n FROM notification_deliveries WHERE subscriber_id='${failed.id}'`)[0].n, finalCount, 'deactivated Teams channel receives no later update');
  if (browserProof) await browserProof({ publicOrigin, manageUrl, selectedComponent: b.name });
  const reportIncident = await makeIncident(b, 'Teams completed search incident');
  assert.equal((await api(`/api/app/incidents/${reportIncident.id}/draft`, { method: 'PUT', body: JSON.stringify({ lifecycle: 'Resolved', affectedAudience: 'Search customers', customerImpact: 'Search is restored', whatStillWorks: '', details: '', nextUpdateAt: null }) })).status, 200);
  assert.equal((await post(`/api/app/incidents/${reportIncident.id}/publish`, { channels: [] })).status, 200);
  assert.equal((await api(`/api/app/incidents/${reportIncident.id}/report`, { method: 'PUT', body: JSON.stringify({ summary: 'Search restoration summary', timeline: 'The team restored the index.', cause: 'Index capacity was exhausted.', remediation: 'Capacity was increased.' }) })).status, 200);
  if (operatorProof) await operatorProof({ reportIncidentId: reportIncident.id });
  else assert.equal((await post(`/api/app/incidents/${reportIncident.id}/report/publish`, { channels: ['teams'] })).status, 200);
  assert.equal(sql(`SELECT COUNT(*) AS n FROM notification_deliveries WHERE subscriber_id='${row.id}' AND incident_report_id IS NOT NULL`)[0].n, 1, 'report publication captures the Teams subscriber');
  const cron = await fetch(`${publicOrigin.replace('localhost', '127.0.0.1')}/cdn-cgi/handler/scheduled`);
  assert.equal(cron.status, 200, await cron.text());
  await until(() => received.find(entry => entry.path.includes('/workflows/teams-subscriber/') && card(entry).body.some(block => block.text.includes('Search restoration summary'))), 'post-incident report Adaptive Card');
  const maintenance = await post('/api/app/maintenance', { title: 'Teams scheduled search upgrade', startsAt: new Date(Date.now() + 172800000).toISOString(), endsAt: new Date(Date.now() + 176400000).toISOString(), componentIds: [b.id] });
  assert.equal(maintenance.status, 201, maintenance.text);
  assert.equal((await fetch(`${publicOrigin.replace('localhost', '127.0.0.1')}/cdn-cgi/handler/scheduled`)).status, 200);
  await until(() => received.find(entry => entry.path.includes('/workflows/teams-subscriber/') && card(entry).body.some(block => block.text.includes('Teams scheduled search upgrade'))), 'maintenance Adaptive Card');
  return { confirmationUrl, manageUrl, selectedComponent: b.name };
}
