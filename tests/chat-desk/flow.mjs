import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { runtime, origin, page } from './runtime.mjs';
import { waitForWorker } from '../e2e/worker-startup.mjs';
const slackFixture = JSON.parse(await readFile('tests/fixtures/chat-desk/slack.json', 'utf8'));
const teamsFixture = JSON.parse(await readFile('tests/fixtures/chat-desk/teams.json', 'utf8'));
const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 }), kid = randomBytes(12).toString('hex');
const jwk = { ...keyPair.publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' };
const update = () => ({ lifecycle: 'Investigating', affectedAudience: 'Synthetic API customers', customerImpact: 'Synthetic requests fail', whatStillWorks: 'The dashboard works', details: 'Engineers are investigating', nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString() });
async function stop(child) { if (child?.pid && child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); process.kill(-child.pid, 'SIGTERM'); await done; } }
function token(audience, { invalid = false, stale = false } = {}) {
  const now = Math.floor(Date.now() / 1000), encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'RS256', kid })}.${encode({ iss: 'https://api.botframework.com', aud: audience, nbf: now - 60, exp: stale ? now - 1 : now + 300, serviceurl: teamsFixture.serviceUrl })}`;
  return `${body}.${(invalid ? randomBytes(256) : sign('RSA-SHA256', Buffer.from(body), keyPair.privateKey)).toString('base64url')}`;
}
async function response(response) { return { status: response.status, body: await response.json() }; }
export async function chatDeskNativeFlow(t) {
  let r;
  try {
    r = await runtime(t, [jwk]);
    assert.equal((await r.worker.dispatchFetch(origin + '/api/app/chat-links')).status, 401, 'chat-link management requires an operator session');
    const slack = async (action, options = {}) => {
      const payload = structuredClone(slackFixture); payload.user.id = options.unlinked ? 'synthetic-lamp-99' : payload.user.id;
      payload.actions[0].value = JSON.stringify(action);
      if (options.badResponse) payload.response_url = 'https://untrusted.example.test/response';
      const raw = options.code ? new URLSearchParams({ command: '/lamp', team_id: payload.team.id, user_id: payload.user.id, text: `link ${options.code}` }).toString() : new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
      const timestamp = String(Math.floor(Date.now() / 1000) - (options.stale ? 301 : 0));
      const signature = `v0=${createHmac('sha256', r.signingSecret).update(`v0:${timestamp}:${raw}`).digest('hex')}`;
      return response(await r.worker.dispatchFetch(origin + '/api/chat/slack', { method: 'POST', body: options.tampered ? `${raw}&changed=1` : raw, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Slack-Request-Timestamp': timestamp, 'X-Slack-Signature': options.invalid ? `v0=${'0'.repeat(64)}` : signature } }));
    };
    const teams = async (action, options = {}) => {
      const body = structuredClone(teamsFixture);
      if (options.unlinked) body.from.aadObjectId = 'synthetic-lamp-99';
      if (options.code) { body.type = 'message'; body.text = `link ${options.code}`; delete body.name; delete body.value; }
      else if (options.extension) { body.name = 'composeExtension/submitAction'; body.value = { commandId: 'incident', parameters: Object.entries(action).filter(([name]) => name !== 'action').map(([name, value]) => ({ name, value })) }; }
      else body.value.action.data = action;
      return response(await r.worker.dispatchFetch(origin + '/api/chat/teams', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(options.wrongAudience ? 'synthetic-lamp-incorrect' : r.appId, options)}` } }));
    };
    const componentIds = [];
    for (const n of [1, 2, 3]) {
      const created = await r.call('/api/app/components', { groupId: null, name: `synthetic-lamp-${n}`, description: '', internal: false, displayOrder: n, note: '' });
      assert.equal(created.status, 201, JSON.stringify(created.body)); componentIds.push(created.body.component.id);
    }
    const count = async table => (await r.db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;
    for (const [name, send] of [['Slack', slack], ['Teams', teams]]) {
      t.diagnostic(`INCIDENT-012 ${name}: signed identity, private draft, shared preview, explicit attributed publication and state changes`);
      const open = { action: 'open', title: `synthetic-lamp-${name}`, components: [{ componentId: componentIds[0], state: 'Major outage', relationship: 'Primary' }], update: update() };
      const before = await count('incidents');
      assert.equal((await send(open, { unlinked: true })).status, 403); assert.equal(await count('incidents'), before);
      for (const options of [{ invalid: true }, { stale: true }, ...(name === 'Teams' ? [{ wrongAudience: true }] : [{ tampered: true }])]) { assert.equal((await send(open, options)).status, 401); assert.equal(await count('incidents'), before); }
      if (name === 'Slack') { assert.equal((await send(open, { badResponse: true })).status, 409); assert.equal(await count('incidents'), before); }
      let minted = await r.call('/api/app/chat-links', {}); assert.equal(minted.status, 201);
      assert.equal((await send(null, { code: minted.body.code })).status, 200);
      assert.equal((await send(null, { code: minted.body.code })).status, 409, 'a link code is single use');
      const opened = await send(open, { extension: name === 'Teams' }); assert.equal(opened.status, 200, JSON.stringify(opened.body));
      if (name === 'Teams') assert.equal(opened.body.task.value.card.content.type, 'AdaptiveCard');
      let result = opened.body.result, id = result.incidentId;
      assert.equal((await r.call(`/api/app/incidents/${id}`)).body.incident.updates.length, 0);
      assert.equal((await send(open, { extension: name === 'Teams' })).status, 409, 'replayed open creates no second draft');
      assert.equal(await count('incidents'), before + 1);
      if (name === 'Teams') {
        const attached = await send({ action: 'attach', incidentId: id, version: result.version, components: componentIds.slice(1).map(componentId => ({ componentId, state: 'Major outage', relationship: 'Dependent' })) });
        assert.equal(attached.status, 200, JSON.stringify(attached.body)); result = attached.body.result;
      }
      const premature = await send({ action: 'publish', incidentId: id, version: result.version, previewCode: randomBytes(24).toString('hex') }); assert.equal(premature.status, 409);
      const previewed = await send({ action: 'preview', incidentId: id, version: result.version }); assert.equal(previewed.status, 200, JSON.stringify(previewed.body));
      const web = await r.call(`/api/app/incidents/${id}`);
      assert.deepEqual(previewed.body.result.preview, web.body.preview, 'chat preview is UPDATE-004 renderer output');
      assert.ok(JSON.stringify(name === 'Teams' ? previewed.body.value : previewed.body.blocks).includes(open.update.customerImpact));
      const published = await send(previewed.body.result.publish); assert.equal(published.status, 200, JSON.stringify(published.body));
      assert.equal((await r.call(`/api/app/incidents/${id}`)).body.incident.updates[0].authorOperatorId, r.operator);
      const html = await (await r.worker.dispatchFetch(page + '/')).text(); assert.ok(html.includes(open.title)); assert.ok(html.includes(open.update.customerImpact));
      const snapshot = await r.db.prepare('SELECT author_operator_id FROM incident_updates WHERE id=?').bind(published.body.result.updateId).first(); assert.equal(snapshot.author_operator_id, r.operator);
      if (name === 'Teams') {
        const current = (await r.call(`/api/app/incidents/${id}`)).body.incident;
        const historyBefore = (await r.call(`/api/app/components/${componentIds[1]}/history`)).body.history;
        const saved = await send({ action: 'save', incidentId: id, version: `-:${current.updates.length}`, update: { ...update(), lifecycle: 'Monitoring', componentChanges: [{ componentId: componentIds[1], state: 'Degraded performance' }] } });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        const preview = await send({ action: 'preview', incidentId: id, version: saved.body.result.version }); assert.equal(preview.status, 200);
        assert.equal((await send(preview.body.result.publish)).status, 200);
        const historyAfter = (await r.call(`/api/app/components/${componentIds[1]}/history`)).body.history; assert.equal(historyAfter.length, historyBefore.length + 1); assert.equal(historyAfter[0].operatorId, r.operator);
        assert.equal((await r.call('/api/app/components')).body.components.find(component => component.id === componentIds[1]).publicState, 'Degraded performance');
      }
    }
    const expired = await r.call('/api/app/chat-links', {}); await r.db.prepare('UPDATE chat_link_codes SET expires_at=0').run();
    assert.equal((await slack(null, { code: expired.body.code })).status, 409);
    const links = (await r.call('/api/app/chat-links')).body.links; assert.equal(links.length, 2);
    assert.ok(!JSON.stringify((await r.db.prepare('SELECT * FROM chat_link_codes').all()).results).includes(expired.body.code));
    for (const link of links) assert.equal((await r.call(`/api/app/chat-links/${link.id}`, undefined, 'DELETE')).status, 204);
    assert.equal((await r.call('/api/app/chat-links')).body.links.length, 0);
    assert.equal((await r.db.prepare("SELECT count(*) AS n FROM audit_entries WHERE action='chat-desk'").first()).n, 7, 'two links, two removals and three explicit publications are audited');
    assert.equal(r.replies.length, 3, 'Slack draft, preview and publication replies use the declared response endpoint');
    assert.equal(r.requests.length, 2, 'Bot Framework metadata and keys are cached between verified activities');
    const revokeCode = (await r.call('/api/app/chat-links', {})).body.code;
    assert.equal((await slack(null, { code: revokeCode })).status, 200);
    const revokeTeamsCode = (await r.call('/api/app/chat-links', {})).body.code;
    assert.equal((await teams(null, { code: revokeTeamsCode })).status, 200);
    assert.equal(await count('chat_links'), 2, 'both signed chat identities belong to the operator before authority is revoked');
    const revoked = await r.call(`/api/app/operators/${r.operator}/revoke-access`, {}); assert.equal(revoked.status, 204, JSON.stringify(revoked.body));
    assert.equal(await count('chat_links'), 0, 'revoking an operator removes chat identities');
    assert.equal(await count('chat_link_codes'), 0, 'revoking an operator removes pending link authority');
    assert.equal(await count('chat_previews'), 0, 'revoking an operator removes pending preview authority');
    const refusedCounts = await Promise.all(['incidents','incident_updates','incident_drafts','audit_entries'].map(count));
    for (const [name, send] of [['Slack', slack], ['Teams', teams]]) {
      const refused = await send({ action: 'open', title: `synthetic-lamp-revoked-${name}`, components: [{ componentId: componentIds[0], state: 'Major outage', relationship: 'Primary' }], update: update() });
      assert.equal(refused.status, 403, `${name}'s signed door refuses the formerly linked actor after operator authority is revoked`);
      assert.deepEqual(await Promise.all(['incidents','incident_updates','incident_drafts','audit_entries'].map(count)), refusedCounts, `${name}'s refused actor creates no incident, update, draft or audit entry`);
    }
    await r.close(); r = await runtime(t, [jwk], { configured: false });
    for (const endpoint of ['slack', 'teams']) assert.equal((await r.worker.dispatchFetch(`${origin}/api/chat/${endpoint}`, { method: 'POST', body: '{}' })).status, 503);
    assert.equal(await count('incidents'), 0);
  } finally {
    await r?.close();
  }
}

export async function chatDeskFlow({ t, server, appUrl, env }) {
  const spawnArgs = server.spawnargs.slice(1), spawnFile = server.spawnfile;
  await stop(server);
  await chatDeskNativeFlow(t);
  const restarted = spawn(spawnFile, spawnArgs, { cwd: process.cwd(), detached: true, stdio: 'pipe', env });
  let output = ''; restarted.stdout.on('data', chunk => output += chunk); restarted.stderr.on('data', chunk => output += chunk);
  try { await waitForWorker({ origin: appUrl, child: restarted, output: () => output, label: 'API Worker after chat proof' }); }
  catch (error) { await stop(restarted); throw error; }
  return restarted;
}
