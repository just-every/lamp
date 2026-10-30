import test from 'node:test'
import assert from 'node:assert/strict'
import { runtime } from './runtime.mjs'
import { createAgentDoor, operatorAuthPeople } from '../index.ts'
import type { AgentDoorOptions, ResourceContext, ResourceDefinition, Runtime } from '../types.ts'
import { resourceTool } from '../resource-tool.ts'
import { context } from '../execution.ts'

const uri = 'synthetic://snapshot/one'
type RecordValue = Awaited<ReturnType<ResourceDefinition['read']>>

async function fixture(initial: RecordValue = { json: { value: 'before', nested: { a: 1, b: 2 } }, untrusted: true }) {
  const r = await runtime()
  try {
    await r.adopt()
    let value = initial, reads = 0
    let onRead: (() => Promise<void> | void) | undefined
    const seen: Array<{ stage: string; ctx: ResourceContext }> = []
    const resource: ResourceDefinition = {
      uriTemplate: 'synthetic://snapshot/{id}', name: 'Snapshot', scope: 'records:read', classes: ['standard'],
      async read(_uri, ctx) {
        seen.push({ stage: 'read', ctx }); reads++
        if (reads % 2 === 0) await onRead?.()
        return value
      },
      classify(_record, ctx) { seen.push({ stage: 'classify', ctx }); return [{ class: 'standard', facts: { measure: 1 } }] },
    }
    const options: AgentDoorOptions = {
      seed: 'synthetic', name: 'Synthetic snapshot', specialist: 'operations', origin: r.c.origin, db: r.db,
      trust: { issuer: r.c.signer.issuer, installationId: r.c.signer.installationId, appOrigin: r.c.origin,
        publicKeys: { [r.c.signer.kid]: await crypto.subtle.exportKey('jwk', r.c.ring.publicKey) } },
      people: operatorAuthPeople({ db: r.db, session: async () => null }), tools: [], resources: [resource], now: () => r.c.now,
    }
    const door = createAgentDoor(options), clientId = 'synthetic-snapshot-client'
    const token = await r.token({ client_id: clientId })
    const read = async () => {
      const version = '2026-07-28'
      const response = await door.handle(new Request(`${r.c.origin}/mcp`, { method: 'POST', headers: {
        Authorization: `Bearer ${token}`, Origin: r.c.origin, 'Content-Type': 'application/json',
        'MCP-Protocol-Version': version, 'Mcp-Method': 'resources/read', 'Mcp-Name': uri,
      }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri, _meta: { 'io.modelcontextprotocol/protocolVersion': version } } }) }))
      assert.ok(response)
      return response.json() as Promise<any>
    }
    const audit = async () => (await r.person('/agents/api/audit')).body.rows.at(-1)
    return { r, options, resource, seen, clientId, read, audit, reads: () => reads,
      change: (next: RecordValue) => { value = next }, onRead: (hook: typeof onRead) => { onRead = hook } }
  } catch (error) { await r.close(); throw error }
}

async function refused(f: Awaited<ReturnType<typeof fixture>>, reply: any, code: string) {
  assert.equal(reply.error?.data?.code, code)
  assert.equal(reply.result, undefined)
  assert.equal(reply.contents, undefined)
  const row = await f.audit()
  assert.equal(row.outcome, 'refused'); assert.equal(row.code, code)
}

test('resource reads and classification retain the public call consent and operation identity', async t => {
  const f = await fixture()
  try {
    const reply = await f.read(), row = await f.audit()
    t.diagnostic(`resource contexts: ${JSON.stringify(f.seen.map(({ stage, ctx }) => ({ stage, consent: ctx.consent, operationId: ctx.operationId, idempotencyKey: ctx.idempotencyKey })))}`)
    assert.deepEqual(reply.result.contents, [{ uri, mimeType: 'application/json', text: JSON.stringify({ value: 'before', nested: { a: 1, b: 2 } }), _meta: { 'com.runeditrun/untrusted': true } }])
    assert.deepEqual(f.seen.map(item => item.stage), ['read', 'classify', 'read'])
    assert.equal(f.reads(), 2)
    for (const { ctx } of f.seen) {
      assert.equal(ctx.consent, f.r.c.consent); assert.equal(ctx.operationId, row.operation_id)
      assert.equal(ctx.idempotencyKey, null); assert.equal(ctx.clientId, f.clientId)
      assert.equal(ctx.db, f.r.db)
    }
    assert.equal(reply.result._meta['com.runeditrun/decision'].id, row.id)
    assert.equal(row.outcome, 'done')
  } finally { await f.r.close() }
})

test('resource adapters also forward a non-null idempotency key and continuation item', async () => {
  const f = await fixture({ text: 'intact', untrusted: true })
  try {
    const person = (await f.r.db.prepare('SELECT claim_id FROM oa_bootstrap WHERE singleton=1').first()).claim_id
    const nativePerson = await f.options.people.person(person)
    assert.ok(nativePerson)
    const principal = { person: nativePerson, agent: { id: 'synthetic-snapshot', name: 'Snapshot' }, scopes: ['records:read'], clientId: f.clientId,
      consent: f.r.c.consent, operationId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), continuationItemId: crypto.randomUUID() }
    const rt: Runtime = { options: f.options, tools: [], now: () => f.r.c.now }
    const tool = resourceTool(rt, uri)!, ctx = context(rt, principal, 'embedded', [])
    await tool.classify({ uri }, ctx)
    assert.deepEqual((await tool.run({ uri }, ctx)).result, { contents: [{ uri, mimeType: 'application/json', text: 'intact', _meta: { 'com.runeditrun/untrusted': true } }] })
    for (const { ctx: received } of f.seen) for (const field of ['consent', 'operationId', 'idempotencyKey', 'continuationItemId'] as const) assert.equal(received[field], ctx[field])
  } finally { await f.r.close() }
})

for (const [name, changed] of [
  ['json', { json: { value: 'after' }, untrusted: true }],
  ['text', { text: 'after', untrusted: true }],
  ['untrusted marker', { json: { value: 'before', nested: { a: 1, b: 2 } }, untrusted: false }],
] as const) test(`a changed ${name} refuses without serving the classified body`, async t => {
  const f = await fixture()
  try {
    f.onRead(() => f.change(changed))
    const reply = await f.read()
    t.diagnostic(`changed ${name}: code=${reply.error?.data?.code ?? 'none'} contents=${JSON.stringify(reply.result?.contents ?? null)}`)
    await refused(f, reply, 'resource_changed')
    assert.equal(f.reads(), 2)
  } finally { await f.r.close() }
})

test('canonical equality serves the execution snapshot with its own JSON key order', async () => {
  const f = await fixture()
  try {
    const current = { nested: { b: 2, a: 1 }, value: 'before' }
    f.onRead(() => f.change({ json: current, untrusted: true }))
    const reply = await f.read()
    assert.equal(reply.result.contents[0].text, JSON.stringify(current))
    assert.deepEqual(reply.result.contents[0]._meta, { 'com.runeditrun/untrusted': true })
    assert.equal(f.reads(), 2)
  } finally { await f.r.close() }
})

test('an in-place mutation cannot change the retained classified projection', async () => {
  const record = { json: { value: 'before' }, untrusted: true }
  const f = await fixture(record)
  try {
    f.onRead(() => { record.json.value = 'after' })
    await refused(f, await f.read(), 'resource_changed')
  } finally { await f.r.close() }
})

test('a changed JSON serialization refuses without serving the classified body', async t => {
  const record = { json: { at: new Date(0) } }
  const f = await fixture(record)
  try {
    f.onRead(() => { record.json.at.setTime(1) })
    const reply = await f.read()
    t.diagnostic(`changed JSON serialization: code=${reply.error?.data?.code ?? 'none'} contents=${JSON.stringify(reply.result?.contents ?? null)}`)
    await refused(f, reply, 'resource_changed')
    assert.equal(f.reads(), 2)
  } finally { await f.r.close() }
})

test('a resource removed at execution remains unavailable without contents', async () => {
  const f = await fixture()
  try {
    f.onRead(() => f.change(null))
    await refused(f, await f.read(), 'resource_unavailable')
    assert.equal(f.reads(), 2)
  } finally { await f.r.close() }
})

test('consent revoked by the execution read is fenced before contents leave the door', async t => {
  const f = await fixture()
  try {
    f.onRead(async () => { assert.equal((await f.r.adopt(undefined, { revoked: { agents: [], consents: [f.r.c.consent] } })).status, 200) })
    const reply = await f.read()
    t.diagnostic(`consent race: code=${reply.error?.data?.code ?? 'none'} contents=${JSON.stringify(reply.result?.contents ?? null)}`)
    await refused(f, reply, 'consent_revoked')
    assert.equal(f.reads(), 2)
  } finally { await f.r.close() }
})
