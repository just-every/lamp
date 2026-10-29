import test from 'node:test'
import assert from 'node:assert/strict'
import { runtime } from './runtime.mjs'
import { autonomousPolicy } from '../conformance/crypto.mjs'

const code = (reply: any) => reply.result?._meta?.['com.runeditrun/error']?.code ?? reply.error?.data?.code
const requestState = (reply: any) => reply.result.requestState
const approvalOf = (reply: any) => reply.result._meta['com.runeditrun/approval']

for (const required of [false, true]) test(`approved aggregate read replay rechecks the native client grant (${required ? 'refusal' : 'empty'})`, async t => {
  const r = await runtime({ aggregateRead: true })
  try {
    const clientId = 'service:aggregate', token = await r.token({ client_id: clientId })
    const grant = async (granted: boolean) => assert.equal((await r.person('/__client-grant', { clientId, granted })).status, 200)
    const read = (state?: string) => r.mcp('tools/call', { name: 'synthetic.context.read', arguments: { required }, ...(state ? { requestState: state } : {}) }, { token })
    const approve = async (pending: any) => {
      const id = approvalOf(pending).id, view = (await r.person(`/agents/api/approvals/${id}`)).body.approval
      assert.equal((await r.person(`/agents/api/approvals/${id}/approve`, { revision: view.revision, summary_sha256: view.summary_sha256 })).body.approval.state, 'executed')
    }
    await grant(true)
    for (const id of ['one', 'two', 'three']) await r.db.prepare('INSERT INTO test_records VALUES(?,?,1,?)').bind(id, id, clientId).run()
    await r.db.prepare('INSERT INTO test_records VALUES(?,?,1,?)').bind('neighbor', 'private', 'service:neighbor').run()
    const policy = autonomousPolicy(); policy.rules = [{ id: 'all', class: '*', do: 'approval', approver: ['sponsor'], wait: 'PT1H' }]
    assert.equal((await r.adopt(policy)).status, 200)
    const pending = await read(), state = requestState(pending)
    assert.equal(pending.result.resultType, 'input_required')
    assert.equal(requestState(await read(state)), state)
    await approve(pending)
    const first = await read(state)
    assert.equal(first.result.structuredContent.records.length, 3)
    const records = (await r.db.prepare('SELECT * FROM test_records ORDER BY id').all()).results
    assert.deepEqual((await read(state)).result.structuredContent, first.result.structuredContent)
    const receipt = first.result._meta['com.runeditrun/receipt']
    assert.deepEqual((await read(state)).result._meta['com.runeditrun/receipt'], receipt)
    await grant(false)
    // A newly approved fresh read is the native refusal/visibility oracle under the same policy.
    const freshPending = await read(), freshId = approvalOf(freshPending).id
    const view = (await r.person(`/agents/api/approvals/${freshId}`)).body.approval
    const freshApproval = (await r.person(`/agents/api/approvals/${freshId}/approve`, { revision: view.revision, summary_sha256: view.summary_sha256 })).body.approval
    assert.equal(freshApproval.state, required ? 'refused' : 'executed')
    const fresh = await read(requestState(freshPending)), replay = await read(state)
    t.diagnostic(`grant removed: fresh=${JSON.stringify(fresh.result?.structuredContent ?? code(fresh))}; replay=${JSON.stringify(replay.result?.structuredContent ?? code(replay))}`)
    assert.deepEqual(replay.result?.structuredContent, fresh.result?.structuredContent)
    assert.equal(code(replay), code(fresh))
    if (required) {
      assert.equal(code(replay), 'native_client_revoked')
      assert.equal(replay.result?.structuredContent, undefined)
      const audit = (await r.person('/agents/api/audit')).body.rows.at(-1)
      assert.equal(audit.outcome, 'refused'); assert.equal(audit.code, 'native_client_revoked')
    } else assert.deepEqual(replay.result.structuredContent, { records: [] })
    // The original approval is a durable receipt, never a replacement for current visibility.
    await grant(true)
    assert.deepEqual((await read(state)).result.structuredContent, first.result.structuredContent)
    assert.equal((await r.person(`/agents/api/approvals/${approvalOf(pending).id}`)).body.approval.state, 'executed')
    assert.deepEqual((await r.db.prepare('SELECT * FROM test_records ORDER BY id').all()).results, records)
    assert.equal((await r.person('/agents/api/audit')).body.differs_from_policy, 0)
  } finally { await r.close() }
})

test('approved mutation replay retains one native effect and the recorded outcome', async () => {
  const r = await runtime()
  try {
    const policy = autonomousPolicy(); policy.rules = [{ id: 'all', class: '*', do: 'approval', approver: ['sponsor'], wait: 'PT1H' }]
    await r.adopt(policy)
    const args = { id: 'once', value: 'approved', idempotency_key: crypto.randomUUID() }
    const pending = await r.tool('records.write', args), id = approvalOf(pending).id
    const view = (await r.person(`/agents/api/approvals/${id}`)).body.approval
    assert.equal((await r.person(`/agents/api/approvals/${id}/approve`, { revision: view.revision, summary_sha256: view.summary_sha256 })).body.approval.state, 'executed')
    const first = await r.tool('records.write', args)
    assert.deepEqual((await r.tool('records.write', args)).result.structuredContent, first.result.structuredContent)
    assert.equal((await r.db.prepare('SELECT version FROM test_records WHERE id=?').bind(args.id).first()).version, 1)
    assert.equal((await r.db.prepare("SELECT COUNT(*) AS n FROM test_contexts WHERE kind='run'").first()).n, 1)
    await r.person('/agents/api/pause', { paused: true })
    assert.equal(code(await r.tool('records.write', args)), 'agents_paused')
    assert.equal((await r.db.prepare('SELECT version FROM test_records WHERE id=?').bind(args.id).first()).version, 1)
  } finally { await r.close() }
})
