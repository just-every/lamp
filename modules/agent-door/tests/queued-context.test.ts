import test from 'node:test'
import assert from 'node:assert/strict'
import { runtime } from './runtime.mjs'
import { autonomousPolicy } from '../conformance/crypto.mjs'

const errorCode = (reply: any) => reply.result?._meta?.['com.runeditrun/error']?.code ?? reply.error?.data?.code
const result = (reply: any) => reply.result?.structuredContent
const job = () => ({ id: crypto.randomUUID(), idempotency_key: crypto.randomUUID() })
const drain = async (r: any, id: string, override?: object) => (await r.post('/__queue', { id, override }, { cookie: r.c.person.cookie })).json()
const saved = async (r: any, table: string, id: string) => {
 const row = await r.db.prepare(`SELECT saved FROM ${table} WHERE id=?`).bind(id).first()
 return row ? JSON.parse(row.saved) : null
}

test('native queue retains admission identity through one effect and replay', async t => {
 const r = await runtime({ queueContext: true })
 try {
  await r.adopt()
  const input = job(), reply = await r.tool('queue.prepare', input), handle = result(reply)
  assert.equal(errorCode(reply), undefined); assert.ok(handle?.operationId, 'queued handle must carry a door-issued operation id')
  const admission = await saved(r, 'test_jobs', input.id)
  assert.equal(admission.operationId, handle.operationId); assert.equal(admission.idempotencyKey, input.idempotency_key)
  assert.equal(admission.consent, r.c.consent); assert.deepEqual(admission.scopes, ['records:read', 'records:write', 'events:read'])
  assert.equal(admission.agent.id, r.c.agentId); assert.ok(admission.person.id); assert.deepEqual(admission.approvers, [])
  assert.deepEqual(result(await r.tool('queue.prepare', input)), handle)
  assert.equal((await drain(r, input.id, { scopes: [...admission.scopes].reverse() })).outcome, 'done')
  assert.deepEqual(await saved(r, 'test_effects', input.id), admission)
  assert.equal((await drain(r, input.id)).outcome, 'done')
  assert.equal((await r.db.prepare('SELECT COUNT(*) AS n FROM test_effects').first()).n, 1)
  const rows = (await r.person('/agents/api/audit')).body.rows
  for (const row of rows) { assert.equal(row.operation_id, admission.operationId); assert.equal(row.idempotency_key, input.idempotency_key); assert.equal(row.consent, admission.consent) }
  assert.ok(rows.some((row: any) => row.tool === 'synthetic.queue.execute' && row.outcome === 'replayed'))
  t.diagnostic('a/b PASS: saved admission equals native effect identity; prepare replay and worker replay retain one effect.')
 } finally { await r.close() }
})

test('same native queue key replays one retained handle and one effect', async t => {
 const r = await runtime({ queueContext: true })
 try {
  await r.adopt(); const input = job()
  const first = result(await r.tool('queue.prepare', input))
  const second = result(await r.tool('queue.prepare', input))
  assert.ok(first?.operationId); assert.deepEqual(second, first)
  assert.equal((await drain(r, input.id)).result.operationId, first.operationId)
  assert.equal((await drain(r, input.id)).result.operationId, first.operationId)
  assert.equal((await r.db.prepare('SELECT COUNT(*) AS n FROM test_jobs').first()).n, 1)
  assert.equal((await r.db.prepare('SELECT COUNT(*) AS n FROM test_effects').first()).n, 1)
  const changed = await r.tool('queue.prepare', { ...input, id: crypto.randomUUID() })
  assert.equal(errorCode(changed), 'idempotency_conflict')
  t.diagnostic('b PASS: one handle, one queue item, one effect; changed arguments with the same key remain idempotency_conflict.')
 } finally { await r.close() }
})

test('revoked native queue consent refuses execution without an effect', async t => {
 const r = await runtime({ queueContext: true })
 try {
  await r.adopt(); const input = job()
  assert.ok(result(await r.tool('queue.prepare', input))?.operationId)
  await r.adopt(autonomousPolicy(), { revoked: { agents: [], consents: [r.c.consent] } })
  const refused = await drain(r, input.id)
  assert.equal(refused.code, 'consent_revoked'); assert.equal(refused.outcome, 'refused')
  assert.equal(await saved(r, 'test_effects', input.id), null)
  const row = (await r.person('/agents/api/audit')).body.rows.at(-1)
  assert.equal(row.code, 'consent_revoked'); assert.equal(row.operation_id, (await saved(r, 'test_jobs', input.id)).operationId)
  t.diagnostic('c PASS: revoked execution remains consent_revoked; native effect absent.')
 } finally { await r.close() }
})

test('tools cannot mutate admission identity or widen scopes; forged queue identity stays refused', async t => {
 const r = await runtime({ queueContext: true })
 try {
  await r.adopt()
  const token = await r.token({ scope: 'records:read' }), attacked = await r.tool('context.attack', {}, { token })
  assert.equal(result(attacked)?.blocked, 9); assert.deepEqual(result(attacked)?.scopes, ['records:read'])
  assert.equal(errorCode(await r.tool('queue.prepare', job(), { token })), 'insufficient_scope')
  const input = job(); assert.ok(result(await r.tool('queue.prepare', input))?.operationId)
  const admission = await saved(r, 'test_jobs', input.id)
  for (const override of [{ agent: { ...admission.agent, name: 'Changed' } }, { agent: { ...admission.agent, specialist: 'Changed' } }, { scopes: ['records:read', 'records:write', 'access:write'] }, { consent: crypto.randomUUID() }, { operationId: crypto.randomUUID() }, { person: { id: crypto.randomUUID() } }, { agent: { id: crypto.randomUUID(), name: 'Other' } }, { clientId: crypto.randomUUID() }]) {
   assert.equal((await drain(r, input.id, override)).outcome, 'refused')
  }
  assert.equal(await saved(r, 'test_effects', input.id), null)
  await r.db.prepare('INSERT INTO test_grants(agent,scopes) VALUES(?,?)').bind(r.c.agentId, JSON.stringify(['records:read'])).run()
  assert.equal((await drain(r, input.id)).code, 'insufficient_scope')
  assert.equal(await saved(r, 'test_effects', input.id), null)
  t.diagnostic('d PASS: nine runtime edits blocked; read-only token, forged identities and narrowed live grant produce no effect.')
 } finally { await r.close() }
})


test('approved native preparation preserves operation identity, key and named approver in the worker', async () => {
 const r = await runtime({ queueContext: true })
 try {
  await r.adopt({ ...autonomousPolicy(), rules: [{ id: 'held', class: 'standard', do: 'approval', approver: ['sponsor'], wait: 'PT1H' }] })
  const input = job(), held = await r.tool('queue.prepare', input)
  const approval = held.result?._meta?.['com.runeditrun/approval'] ?? held.error?.data?.approval
  const view = (await r.person(`/agents/api/approvals/${approval.id}`)).body.approval
  const executed = await r.person(`/agents/api/approvals/${approval.id}/approve`, { revision: view.revision, summary_sha256: view.summary_sha256 })
  assert.equal(executed.body.approval.state, 'executed')
  const admission = await saved(r, 'test_jobs', input.id)
  assert.equal(admission.operationId, view.decision_id); assert.equal(admission.idempotencyKey, input.idempotency_key)
  assert.deepEqual(admission.approvers, [{ id: admission.person.id, name: 'Synthetic Person' }])
  await r.adopt()
  assert.equal((await drain(r, input.id)).outcome, 'done')
  assert.deepEqual(await saved(r, 'test_effects', input.id), admission)
 } finally { await r.close() }
})
