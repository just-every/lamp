import test from 'node:test'
import assert from 'node:assert/strict'
import { runtime } from './runtime.mjs'
import { autonomousPolicy } from '../conformance/crypto.mjs'
import { createProtocol } from '../conformance/protocol.mjs'
import { runJourney } from '../conformance/journey.mjs'

const meta = (reply: any) => reply.result?._meta ?? {}
const code = (reply: any) => meta(reply)['com.runeditrun/error']?.code ?? reply.error?.data?.code
const decision = (reply: any) => meta(reply)['com.runeditrun/decision']
const receipt = (reply: any) => meta(reply)['com.runeditrun/receipt']
const heldPolicy = () => {
  const policy = autonomousPolicy()
  policy.rules = [
    { id: 'ordinary', class: 'standard', do: 'review' },
    { id: 'held', class: '*', do: 'approval', approver: ['sponsor'], wait: 'PT1H' },
  ]
  return policy
}
async function decide(r: any, pending: any, action = 'approve') {
  const id = meta(pending)['com.runeditrun/approval'].id
  const view = (await r.person(`/agents/api/approvals/${id}`)).body.approval
  return (await r.person(`/agents/api/approvals/${id}/${action}`, { revision: view.revision, summary_sha256: view.summary_sha256 })).body.approval
}

for (const [item, mode] of [[1, 'delete'], [3, 'schedule'], [4, 'risk'], [5, 'restore'], [6, 'draft']] as const) {
  test(`item ${item}: approved ${mode} replay retains its effect under current admission`, async t => {
    const r = await runtime({ mutationReplay: true })
    try {
      const id = crypto.randomUUID(), args = { id, value: 'completed native work', expected_revision: 1, idempotency_key: crypto.randomUUID() }
      await r.db.prepare('INSERT INTO test_records VALUES(?,?,1,?)').bind(id, 'prepared', 'hidden').run()
      await r.adopt(heldPolicy())
      const call = (input = args, token?: string) => r.tool(`mutation.${mode}`, input, token ? { token } : {})
      const pending = await call(), original = decision(pending)
      assert.equal(pending.result.resultType, 'input_required')
      assert.equal(receipt(await call()), undefined, 'a pending call has no completed receipt')
      assert.equal((await decide(r, pending)).state, 'executed')
      const effect = (await r.person('/agents/api/audit')).body.rows.findLast((row: any) => row.decision_id === original.id)
      assert.deepEqual(effect.classes, original.classes.map(({ class: cls, facts }: any) => ({ class: cls, facts })))
      const first = await call()
      t.diagnostic(`item ${item} ${mode}: approved retry=${code(first) ?? first.result.resultType}`)
      assert.equal(code(first), undefined)
      assert.deepEqual(first.result.structuredContent, { id, consumed_version: 1 })
      assert.deepEqual(receipt(first).decision, original, 'receipt preserves pre-effect classes, facts and approval disposition')
      assert.equal(decision(first).revision, r.c.revision)
      const repeated = await call()
      assert.deepEqual(repeated.result.structuredContent, first.result.structuredContent)
      assert.deepEqual(receipt(repeated), receipt(first))
      assert.equal(code(await call({ ...args, value: 'different' })), 'idempotency_conflict')
      assert.equal(code(await call({ ...args, expected_revision: 2 })), 'idempotency_conflict')
      const denied = async (expected: string, token?: string) => {
        const reply = await call(args, token)
        assert.equal(code(reply), expected)
        assert.equal(reply.result?.structuredContent, undefined)
        assert.equal(receipt(reply), undefined)
      }
      await denied('insufficient_scope', await r.token({ scope: 'records:read' }))
      await r.db.prepare('INSERT INTO test_grants VALUES(?,?)').bind(r.c.agentId, JSON.stringify(['records:read'])).run()
      await denied('insufficient_scope')
      await r.db.prepare('DELETE FROM test_grants WHERE agent=?').bind(r.c.agentId).run()
      await r.person('/agents/api/pause', { paused: true })
      await denied('agents_paused')
      await r.person('/agents/api/pause', { paused: false })
      const blocked = autonomousPolicy(); blocked.rules = [{ id: 'block', class: '*', do: 'blocked' }]
      await r.adopt(blocked); await denied('policy_blocked')
      await r.adopt(heldPolicy()); await denied('approval_required')
      await r.adopt(autonomousPolicy(), { revoked: { agents: [], consents: [r.c.consent] } })
      await denied('unauthenticated')
      await r.adopt(autonomousPolicy(), { revoked: { agents: [], consents: [] } })
      const relaxed = await call()
      assert.equal(code(relaxed), undefined)
      assert.equal(decision(relaxed).disposition, 'autonomous')
      assert.deepEqual(receipt(relaxed), receipt(first))
      const audit = (await r.person('/agents/api/audit')).body
      assert.equal(audit.rows.at(-1).decision, 'autonomous')
      assert.equal(audit.rows.at(-1).revision, r.c.revision)
      assert.equal(audit.differs_from_policy, 0)
      // Pending/rejected keys never borrow the completed call's authority or result.
      await r.adopt(heldPolicy())
      const other = { ...args, id: crypto.randomUUID(), idempotency_key: crypto.randomUUID() }
      await r.db.prepare('INSERT INTO test_records VALUES(?,?,1,?)').bind(other.id, 'prepared', 'hidden').run()
      const unapproved = await call(other)
      assert.equal((await decide(r, unapproved, 'reject')).state, 'rejected')
      const rejected = await call(other)
      assert.equal(code(rejected), 'approval_rejected'); assert.equal(receipt(rejected), undefined)
      const stale = { ...other, idempotency_key: crypto.randomUUID() }
      const stalePending = await call(stale)
      await r.db.prepare('UPDATE test_records SET version=2 WHERE id=?').bind(stale.id).run()
      assert.equal((await decide(r, stalePending)).code, 'revision_conflict')
      assert.equal(receipt(await call(stale)), undefined)
      await r.person(`/agents/api/agents/${r.c.agentId}/revoke`, {})
      await denied('unauthenticated')
      assert.equal((await r.db.prepare('SELECT COUNT(*) AS n FROM test_sent').first()).n, 1)
      assert.equal((await r.person('/agents/api/reviews')).body.reviews.length, 0)
      t.diagnostic(`item ${item} ${mode}: one effect; changed args/revision conflict; pending/rejected/stale, paused, revoked, scope and current-policy refusals preserved`)
    } finally { await r.close() }
  })
}

test('item 2: held restore journey checks original widening evidence separately from current admission', async t => {
  const r = await runtime({ mutationReplay: true })
  try {
    const id = crypto.randomUUID()
    await r.db.prepare('INSERT INTO test_records VALUES(?,?,1,?)').bind(id, 'prepared', 'hidden').run()
    await r.adopt(heldPolicy())
    const step = { id: 'restore', tool: 'synthetic.mutation.restore', args: { id, value: 'restored', expected_revision: 1 }, expect: [{ class: 'access', facts: { measure: 1, direction: 'widens' } }] }
    const c: any = { ...r.c, fetch: r.fetch, points: [], clients: new Map(), fixtureValues: {},
      surface: { seed: 'synthetic', capabilities: ['tools', 'policy', 'pause', 'audit', 'idempotency'], tools: [{ name: step.tool, scope: 'records:write', classes: ['access'], readOnly: false }, { name: 'synthetic.records.list', scope: 'records:read', classes: ['standard'], readOnly: true }], journey: [step], witness: { tool: 'synthetic.records.list', args: {} } } }
    createProtocol(c)
    c.listed = new Map([[step.tool, { outputSchema: { type: 'object', required: ['id', 'consumed_version'], properties: { id: { type: 'string' }, consumed_version: { type: 'integer' } }, additionalProperties: false } }]])
    c.stepTool = (step: any, args: any, options: any) => c.tool(step.tool, args, options)
    await runJourney(c, 'held', { held: true, replay: true })
    const failures = c.points.filter((point: any) => !point.ok)
    t.diagnostic(`item 2 restore journey: ${c.points.length - failures.length}/${c.points.length}; ${JSON.stringify(failures)}`)
    assert.deepEqual(failures, [])
    assert.ok(c.points.some((point: any) => point.id === 'BASE-AGENT-007.5.receipt.restore' && point.ok))
    assert.equal((await r.db.prepare('SELECT COUNT(*) AS n FROM test_sent').first()).n, 1)
  } finally { await r.close() }
})

test('completed reviewed schedule retains the original review and consumed version', async t => {
  const r = await runtime({ mutationReplay: true })
  try {
    const id = crypto.randomUUID(), args = { id, value: 'scheduled', expected_revision: 1, idempotency_key: crypto.randomUUID() }
    await r.db.prepare('INSERT INTO test_records VALUES(?,?,1,?)').bind(id, 'prepared', 'hidden').run()
    const policy = autonomousPolicy(); policy.rules = [{ id: 'review', class: '*', do: 'review' }]; policy.reviewers = ['sponsor']
    await r.adopt(policy)
    const first = await r.tool('mutation.schedule', args), review = meta(first)['com.runeditrun/review']
    assert.equal(code(first), undefined); assert.ok(review?.id)
    const repeated = await r.tool('mutation.schedule', args)
    assert.equal(code(repeated), undefined)
    assert.deepEqual(repeated.result.structuredContent, first.result.structuredContent)
    assert.deepEqual(meta(repeated)['com.runeditrun/review'], review)
    assert.deepEqual(decision(repeated).classes, decision(first).classes)
    assert.equal(decision(repeated).disposition, 'review')
    assert.equal(receipt(repeated), undefined)
    assert.equal((await r.person('/agents/api/reviews')).body.reviews.length, 1)
    assert.equal((await r.db.prepare('SELECT COUNT(*) AS n FROM test_sent').first()).n, 1)
    t.diagnostic('reviewed schedule: retained review, consumed version 1, one effect, one review')
  } finally { await r.close() }
})


test('completed native people creation refuses a demoted sponsor without returning its result or receipt', async t => {
  const r = await runtime({ nativePeople: true, seed: 'base' })
  try {
    const subject = 'native-admin', email = 'native-admin@example.com'
    assert.equal((await r.settings({ team: [{ id: subject, email, name: 'Native admin', role: 'admin', invite: 0 }] })).status, 200)
    const cookie = await r.signIn(email)
    const admin = (await r.person('/auth/operators')).body.find((person: any) => person.email === email)
    assert.equal(admin.role, 'admin'); assert.equal(admin.status, 'active')
    const policy = autonomousPolicy(); policy.rules = [{ id: 'held', class: '*', do: 'approval', approver: ['sponsor'], wait: 'PT1H' }]
    assert.equal((await r.adopt(policy)).status, 200)
    const revision = r.c.revision
    const token = await r.token({ sub: subject, email, act: { sub: 'native-admin-agent', name: 'Native admin agent' }, scope: 'people:write' })
    const args = { name: 'Avery Morgan', email: 'avery.morgan@example.com', idempotency_key: crypto.randomUUID() }
    const call = () => r.mcp('tools/call', { name: 'base.people.create', arguments: args }, { token })
    const pending = await call(), id = meta(pending)['com.runeditrun/approval'].id
    const person = async (path: string, body?: unknown) => {
      const response = body === undefined ? await r.fetch(path, { headers: { cookie } }) : await r.post(path, body, { cookie })
      return { status: response.status, body: await response.json() }
    }
    const view = (await person(`/agents/api/approvals/${id}`)).body.approval
    assert.equal((await person(`/agents/api/approvals/${id}/approve`, { revision: view.revision, summary_sha256: view.summary_sha256 })).body.approval.state, 'executed')
    const first = await call()
    assert.equal(code(first), undefined); assert.ok(first.result.structuredContent.id)
    assert.ok(first.result.content.some((item: any) => item.type === 'resource_link'))
    assert.ok(receipt(first))
    const repeated = await call()
    assert.deepEqual(repeated.result.structuredContent, first.result.structuredContent)
    assert.deepEqual(receipt(repeated), receipt(first))
    const agentBefore = await r.db.prepare('SELECT * FROM agent_door_agents WHERE id=?').bind('native-admin-agent').first()
    const changed = await r.person('/auth/operator/role', { operatorId: admin.id, role: 'member' })
    assert.equal(changed.status, 200)
    assert.equal(changed.body.role, 'member'); assert.equal(changed.body.status, 'active')
    assert.ok(changed.body.version > admin.version)
    assert.deepEqual(await r.db.prepare('SELECT * FROM agent_door_agents WHERE id=?').bind('native-admin-agent').first(), agentBefore)
    // Reuse the same unexpired Business token and policy after a role-only change.
    const replay = await call()
    t.diagnostic(`demoted native sponsor: ${code(replay)}; result=${replay.result?.structuredContent === undefined ? 'absent' : 'present'}; receipt=${receipt(replay) === undefined ? 'absent' : 'present'}`)
    assert.equal(code(replay), 'operator_role_required')
    assert.equal(replay.result?.structuredContent, undefined)
    assert.equal(replay.result?.content?.some((item: any) => item.type === 'resource_link'), false)
    assert.equal(receipt(replay), undefined)
    assert.equal((await r.person('/agents/api/state')).body.policy.revision, revision)
    assert.equal((await r.db.prepare('SELECT COUNT(*) AS n FROM people').first()).n, 1)
    assert.equal((await r.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='person.created'").first()).n, 1)
    // A fresh native attempt under this same role supplies the refusal oracle.
    assert.equal(code(await r.mcp('tools/call', { name: 'base.people.create', arguments: { ...args, idempotency_key: crypto.randomUUID() } }, { token })), 'operator_role_required')
  } finally { await r.close() }
})
