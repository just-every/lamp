import assert from 'node:assert/strict';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import { devKey } from '../../helpers/dev-key.mjs';

export async function channelDeletionFlow({ api, post, origin, nativeRequest, runtime }) {
  const since = new Date().toISOString();
  const creator = (await api('/api/app/session')).body.operator;
  const email = 'channel-deleter@example.test';
  const invited = await post('/api/app/operators/invite', { email, displayName: 'Channel removing operator' });
  assert.equal(invited.status, 202, invited.text);
  const entered = await signInAs({ origin, key: devKey, as: email });
  const asDeleter = async (path, init = {}) => {
    const response = await nativeRequest(path, { ...init, cookie: entered.header });
    return { status: response.status, text: await response.text() };
  };
  const deleter = JSON.parse((await asDeleter('/api/app/session')).text).operator;
  assert.notEqual(deleter.id, creator.id);
  const channels = [];
  for (const [kind, url] of [['slack', 'https://hooks.slack.com/services/T0AUDIT/B0DELETE/syntheticAuditSecret'], ['teams', 'https://example.webhook.office.com/webhookb2/syntheticAuditSecret']]) {
    const created = await post('/api/app/channels', { kind, name: `Audit ${kind} deletion`, url, componentIds: [] });
    assert.equal(created.status, 201, created.text);
    channels.push(created.body.channel);
  }
  assert.equal((await nativeRequest(`/api/app/channels/${channels[0].id}`, { method: 'DELETE' })).status, 401);
  const remove = (channel, request = asDeleter) => request(`/api/app/channels/${channel.id}`, { method: 'DELETE' });
  const slack = await remove(channels[0]);
  assert.equal(slack.status, 200, slack.text);
  const selection = new URLSearchParams({ actorId: deleter.id, action: 'deleted', from: since, limit: '100' });
  const entries = async () => JSON.parse((await asDeleter(`/api/app/audit-log?${selection}`)).text).entries;
  const deleted = (await entries()).filter(row => row.entityId === channels[0].id);
  assert.equal(deleted.length, 1, 'TEAM-007 channel deletion must appear in audit JSON');
  assert.equal(deleted[0].actorId, deleter.id, 'record actual deleter, not channel creator');
  assert.equal(deleted[0].entityType, 'channel');
  assert.ok(Date.parse(deleted[0].createdAt) >= Date.parse(since) && Date.parse(deleted[0].createdAt) <= Date.now());
  assert.equal((await remove(channels[0])).status, 404);
  assert.equal((await asDeleter('/api/app/channels/01J00000000000000000000000', { method: 'DELETE' })).status, 404);
  const race = await Promise.all([remove(channels[1]), remove(channels[1], api)]);
  assert.deepEqual(race.map(row => row.status).sort(), [200, 404], 'two competing authenticated deletes have one winner');
  const winner = race[0].status === 200 ? deleter : creator;
  const all = (await api(`/api/app/audit-log?action=deleted&from=${encodeURIComponent(since)}&limit=100`)).body.entries;
  for (const channel of channels) {
    const rows = all.filter(row => row.entityId === channel.id);
    assert.equal(rows.length, 1, 'repeated/nonexistent/competing deletes never fabricate audit success');
    assert.equal(rows[0].actorId, channel.kind === 'slack' ? deleter.id : winner.id);
  }
  assert.ok(!(await api('/api/app/channels')).body.channels.some(row => channels.some(channel => row.id === channel.id)));
  const filtered = await entries();
  const csv = await asDeleter(`/api/app/audit-log?${selection}&format=csv`);
  assert.equal(csv.status, 200);
  assert.equal(csv.text.trimEnd().split('\r\n').length - 1, filtered.length);
  for (const row of filtered) assert.ok(csv.text.includes(`"${row.id}"`) && csv.text.includes(`"${deleter.id}"`) && csv.text.includes(`"${row.entityId}"`) && csv.text.includes(`"${row.createdAt}"`));
  for (const text of [JSON.stringify(all), csv.text, runtime.output]) assert.doesNotMatch(text, /syntheticAuditSecret|sealed_url|sealedUrl|webhookb2|services\/T0AUDIT/);

  // Restart the owned native Worker, retaining its test database, to prove durability.
  await runtime.stop(); await runtime.start();
  assert.deepEqual(await entries(), filtered);
  await operatorAlertSettingsBrowserFlow({ api, post });
}

// Observe the private choice through the same ordinary Settings HTTP doors;
// the social/Uptime journeys exercise the shared Settings shell in Chromium.
export async function operatorAlertSettingsBrowserFlow({ api, post }) {
  const created = await post('/api/app/channels', { kind: 'slack', name: 'Private operator alerts', url: 'https://hooks.slack.com/services/synthetic-lamp-1/synthetic-lamp-2/synthetic-lamp-alerts', componentIds: [] });
  assert.equal(created.status, 201, created.text);
  const channel = created.body.channel;
  assert.equal(channel.operatorAlerts, false, 'private alerts require an explicit owner choice');
  for (const enabled of [true, false]) {
    const saved = await api(`/api/app/channels/${channel.id}`, { method: 'PATCH', body: JSON.stringify({ operatorAlerts: enabled }) });
    assert.equal(saved.status, 200, saved.text);
    const loaded = (await api('/api/app/channels')).body.channels.find(row => row.id === channel.id);
    assert.equal(loaded.operatorAlerts, enabled, 'a fresh Settings read retains the selected private-alert consent');
  }
  assert.equal((await api(`/api/app/channels/${channel.id}`, { method: 'DELETE' })).status, 200);
}
