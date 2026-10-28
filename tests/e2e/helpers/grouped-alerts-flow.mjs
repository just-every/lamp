import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export const groupedPayload = (key, states = ['firing', 'firing']) => ({ version: '4', receiver: 'lamp', status: states.some(state => state === 'firing') ? 'firing' : 'resolved', groupKey: key, groupLabels: { alertname: 'ServiceUnavailable' }, commonLabels: { region: 'us-east' }, commonAnnotations: {}, externalURL: 'https://monitor.example.test', truncatedAlerts: 0,
  alerts: states.map((status, index) => ({ status, labels: { alertname: 'ServiceUnavailable', service: index ? 'dashboard' : 'api', region: 'us-east' }, annotations: { summary: index ? 'Dashboard requests timing out' : 'API request failures' }, startsAt: '2026-10-18T00:00:00Z', endsAt: status === 'resolved' ? '2026-10-18T00:05:00Z' : '0001-01-01T00:00:00Z', generatorURL: 'https://monitor.example.test/graph', fingerprint: index ? 'b2b2b2' : 'a1a1a1' })) });

// Grafana's own default two-alert example, retained without changing its fields:
// https://grafana.com/docs/grafana/latest/alerting/configure-notifications/manage-contact-points/integrations/webhook-notifier/
const grafanaPayload = JSON.parse(await readFile(new URL('../fixtures/grafana-webhook-v1.json', import.meta.url), 'utf8'));
const recoveredPayload = (body, states) => ({ ...body,
  status: states.includes('firing') ? 'firing' : 'resolved',
  ...(body.version === '1' ? { state: states.includes('firing') ? 'alerting' : 'ok' } : {}),
  alerts: body.alerts.map((alert, index) => ({ ...alert, status: states[index], endsAt: states[index] === 'resolved' ? '2026-10-18T00:05:00Z' : '0001-01-01T00:00:00Z' })),
});

export async function groupedAlertsFlow({ api, post, component, sql, origin, publicOrigin, cookie }) {
  const targets = [await component('US application services'), await component('EU application services')];
  const matchers = targets.map((target, index) => ({ componentId: target.id, labels: { service: index ? 'dashboard' : 'api', region: 'us-east' } }));
  const grafanaMatchers = targets.map((target, index) => ({ componentId: target.id, labels: { team: 'blue', zone: index ? 'eu-1' : 'us-1' } }));
  const send = async (source, body, token = source.token) => {
    const response = await fetch(source.endpointUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  let alertmanagerNotice;
  for (const preset of ['alertmanager', 'grafana']) {
    const created = await post('/api/app/intake/sources', { name: `${preset} production grouped alerts`, preset, credentialKind: 'bearer-token', labelMatchers: preset === 'grafana' ? grafanaMatchers : matchers });
    assert.equal(created.status, 201, created.text);
    const source = created.body.source;
    const body = preset === 'grafana' ? structuredClone(grafanaPayload) : groupedPayload(`${preset}-service-group`);
    assert.equal((await send(source, body, 'invalid')).status, 401);
    for (const invalid of [
      { arbitrary: 'not a documented group' },
      ...[undefined, null, 1, 4, '2', '5', preset === 'grafana' ? '4' : '1'].map(version => ({ ...body, version })),
      { ...body, status: 'unknown' }, { ...body, alerts: [] },
      { ...body, alerts: [{ ...body.alerts[0], fingerprint: '' }] },
      { ...body, alerts: [{ ...body.alerts[0], annotations: 'invalid' }] },
      { ...body, alerts: [body.alerts[0], body.alerts[0]] },
      { ...body, truncatedAlerts: 1 },
    ]) {
      const refused = await send(source, invalid);
      assert.equal(refused.status, 400, `${preset} rejects unsupported or malformed payloads`);
      assert.equal(refused.body.incidentId, null);
      const receipt = (await api('/api/app/intake/receipts')).body.receipts.find(row => row.id === refused.body.receiptId);
      assert.equal(receipt.state, 'invalid');
      assert.ok(receipt.error, 'refusal gives the operator a plain reason');
    }
    assert.equal((await send(source, { ...body, alerts: [{ ...body.alerts[0], labels: { service: 'not-mapped' } }] })).status, 400);
    const unmapped = (await api('/api/app/intake/receipts')).body.receipts.find(row => row.sourceId === source.id && row.error?.includes('Unmapped'));
    assert.ok(unmapped && !unmapped.incidentId);
    const results = await Promise.all([send(source, body), send(source, body)]);
    assert.ok(results.every(result => result.status === 202), JSON.stringify(results));
    assert.equal(results[0].body.incidentId, results[1].body.incidentId, 'concurrent duplicate group has one incident');
    const id = results[0].body.incidentId;
    let incident = (await api(`/api/app/incidents/${id}`)).body.incident;
    assert.deepEqual(incident.components.map(row => row.componentId).sort(), targets.map(row => row.id).sort());
    assert.equal(incident.updates.length, 0);
    assert.equal(incident.title, preset === 'grafana' ? body.title : body.alerts[0].annotations.summary);
    const retained = sql(`SELECT deduplication_key,payload_json FROM alert_receipts WHERE id='${results[0].body.receiptId}'`)[0];
    assert.equal(retained.deduplication_key, body.groupKey);
    assert.deepEqual(JSON.parse(retained.payload_json), body, 'all documented fields remain in the private receipt');
    assert.deepEqual(sql(`SELECT fingerprint,state FROM alert_group_members WHERE incident_id='${id}' ORDER BY fingerprint`), body.alerts.map(alert => ({ fingerprint: alert.fingerprint, state: alert.status })).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)));
    const notices = sql(`SELECT payload_json FROM notification_outbox WHERE kind='operator-alert' AND aggregate_id='intake-draft/${id}'`);
    assert.equal(notices.length, 1, 'one operator notice for the grouped draft, including concurrent replay');
    const notice = JSON.parse(notices[0].payload_json);
    assert.ok(notice.text.includes(id));
    const normalizedNotice = { ...notice, text: notice.text.replaceAll(id, '<incident>') };
    if (preset === 'alertmanager') alertmanagerNotice = normalizedNotice;
    else assert.deepEqual(normalizedNotice, alertmanagerNotice, 'Grafana queues the same operator notice as Alertmanager');
    assert.equal(sql(`SELECT count(*) AS n FROM alert_group_members WHERE incident_id='${id}'`)[0].n, 2);
    const mixed = recoveredPayload(body, ['resolved', 'firing']);
    await send(source, mixed);
    incident = (await api(`/api/app/incidents/${id}`)).body.incident;
    assert.equal(incident.lifecycle, 'Investigating', 'partial recovery keeps the group open');
    assert.equal(sql(`SELECT count(*) AS n FROM alert_group_members WHERE incident_id='${id}' AND state='resolved'`)[0].n, 1);
    const resolved = recoveredPayload(body, ['resolved', 'resolved']);
    const singleRecovery = { ...body, alerts: [resolved.alerts[0]], status: 'resolved' };
    await send(source, singleRecovery);
    assert.equal((await api(`/api/app/incidents/${id}`)).body.incident.lifecycle, 'Investigating', 'an omitted firing fingerprint is still active');
    await send(source, resolved);
    assert.equal((await api(`/api/app/incidents/${id}`)).body.incident.lifecycle, 'Resolved');
    assert.equal((await api(`/api/app/incidents/${id}`)).body.incident.updates.length, 0);
    const refired = await send(source, { ...body, firingCycle: 2 });
    assert.notEqual(refired.body.incidentId, id, 'a new firing after recovery starts a new group incident');
    const publishedId = refired.body.incidentId;
    await api(`/api/app/incidents/${publishedId}/draft`, { method: 'PUT', body: JSON.stringify({ lifecycle: 'Investigating', affectedAudience: 'US customers', customerImpact: 'Requests are timing out.', nextUpdateAt: new Date(Date.now() + 3600000).toISOString(), whatStillWorks: '', details: '' }) });
    assert.equal((await post(`/api/app/incidents/${publishedId}/publish`, { channels: [] })).status, 200);
    await send(source, { ...resolved, firingCycle: 2 });
    assert.equal((await api(`/api/app/incidents/${publishedId}`)).body.incident.lifecycle, 'Investigating', 'monitor recovery cannot resolve a public incident');
    assert.equal((await api('/api/app/intake/sources')).text.includes(source.token), false, 'token remains write-only');
  }

}
