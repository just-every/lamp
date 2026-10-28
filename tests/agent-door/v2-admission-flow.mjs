import assert from 'node:assert/strict';
import { load } from '../operator-readiness/runtime.mjs';
import { lampRuntime } from '../auth-adoption/lamp-runtime.mjs';
import { openSnapshotCacheRuntime } from '../e2e/snapshot-cache-runtime.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** The existing core registration exercises real Lamp services, identity and D1. */
export async function runV2AdmissionFlow(t) {
  const r = await lampRuntime(t);
  const directory = await mkdtemp(join(process.cwd(), '.lamp-v2-admission-'));
  const cache = await openSnapshotCacheRuntime(directory);
  t.after(async () => { await cache.dispose(); await rm(directory, { recursive: true, force: true }); });
  const { createApp } = await load('src/core/app/server.ts');
  const { app, agentDoor } = createApp({ ...r.bindings, SNAPSHOTS: r.bucket, SNAPSHOT_CACHE: cache.namespace, LAMP_PAGE_HOST: 'page.example.test' });
  const configured = await app.fetch(r.request('/api/app/page-settings', { method: 'POST', cookie: r.cookie,
    body: { pageName: 'Native admission status', tagline: 'Incident communication', accentColor: '#163c60', timezone: 'UTC', hostname: 'page.example.test', footerCreditEnabled: true } }), r.bindings);
  assert.equal(configured.status, 201);
  const person = (path, method = 'GET', body) => agentDoor.handle(r.request(path, { method, body, cookie: r.cookie }));
  const policy = async disposition => {
    const rules = [{ id: 'v2', class: '*', do: disposition, ...(disposition === 'approval' ? { approver: ['sponsor'], wait: 'PT1H' } : {}) }];
    assert.equal((await person('/agents/api/policy', 'PUT', { document: { schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1', rules, spend: { none: true } } })).status, 200);
  };
  await policy('autonomous');
  const principal = { person: { id: r.owner.id }, agent: { id: 'lamp-v2-admission', name: 'Native admission probe' }, scopes: ['lamp.components.create', 'lamp.components.update'] };
  const input = { name: 'Private target', description: 'Native target evidence', groupId: null, displayOrder: 2, note: '', internal: true };
  const created = await agentDoor.invoke('lamp.components.create', { ...input, idempotency_key: crypto.randomUUID() }, principal);
  assert.equal(created.outcome, 'done', `Native create: ${created.code}`);
  const id = created.result.component.id;
  const args = { ...input, id, name: 'Updated private target', idempotency_key: crypto.randomUUID() };
  const first = await agentDoor.invoke('lamp.components.update', args, principal);
  assert.equal(first.outcome, 'done');
  assert.deepEqual((await agentDoor.invoke('lamp.components.update', args, principal)).result, first.result);
  const audit = async () => (await (await person('/agents/api/audit?agent=lamp-v2-admission')).json()).rows;
  assert.deepEqual((await audit()).find(row => row.id === first.decision.id).resource, { kind: 'component', id }, 'Native target is resolved from the stored component');
  assert.equal((await person('/agents/api/pause', 'POST', { paused: true })).status, 200);
  const paused = await agentDoor.invoke('lamp.components.update', args, principal);
  assert.equal(paused.code, 'agents_paused', 'Pause is checked before a cached result');
  assert.equal(paused.result, undefined);
  assert.equal((await person('/agents/api/pause', 'POST', { paused: false })).status, 200);
  await policy('blocked');
  const blocked = await agentDoor.invoke('lamp.components.update', args, principal);
  assert.equal(blocked.code, 'policy_blocked', 'Current policy is checked before replay');
  assert.equal(blocked.result, undefined);
  await policy('approval');
  const newlyHeld = await agentDoor.invoke('lamp.components.update', args, principal);
  assert.equal(newlyHeld.code, 'approval_required', 'An old autonomous result cannot satisfy a new approval policy');
  assert.equal(newlyHeld.result, undefined);
  const held = await agentDoor.invoke('lamp.components.update', { ...args, idempotency_key: crypto.randomUUID() }, principal);
  assert.equal(held.outcome, 'pending');
  const view = await (await person(`/agents/api/approvals/${held.approval.id}`)).json();
  assert.deepEqual(view.approval.summary.nativeTarget, { kind: 'component', id }, 'The exact pending summary binds the native target');
  const rows = await audit();
  assert.deepEqual(rows.find(row => row.id === paused.decision?.id)?.resource ?? rows.findLast(row => row.code === 'agents_paused').resource, { kind: 'component', id });

  await policy('autonomous');
  const credential = await app.fetch(r.request('/api/app/management-tokens', { method: 'POST', cookie: r.cookie, body: { name: 'Resource refusal probe', scopes: ['read'], expiresInSeconds: 3600 } }), r.bindings);
  assert.equal(credential.status, 201);
  const { token } = await credential.json();
  assert.equal(typeof token, 'string');
  const resource = async uri => {
    const response = await agentDoor.handle(new Request(new URL('/mcp', r.bindings.AUTH_ORIGIN), {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'resources/read', 'Mcp-Name': uri },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }),
    }));
    return response.json();
  };
  const hidden = await resource(`lamp://components/${id}`), absent = await resource('lamp://components/01AAAAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(hidden.error?.data?.code, 'resource_unavailable', JSON.stringify(hidden));
  assert.deepEqual(hidden, absent, 'Hidden and missing native records have identical machine refusals');
  assert.equal((await resource('unregistered://record')).error.data.code, 'tool_not_found');
  t.diagnostic('v2 nativeTarget, replayAuthority and resourceCode assertions passed through Lamp native services and person/MCP doors.');
}
