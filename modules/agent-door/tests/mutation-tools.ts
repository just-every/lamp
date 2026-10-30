import { defineTool, ToolRefusal } from '../index.ts'
import type { JsonSchema, ToolDefinition } from '../index.ts'

/** Native effects whose preparation state is consumed by the first execution. */
export function mutationTools(db: D1Database): ToolDefinition[] {
  const text = { type: 'string', minLength: 1 }
  const object = (properties: Record<string, JsonSchema>) => ({ type: 'object' as const, properties, required: Object.keys(properties), additionalProperties: false })
  const read = async (id: unknown) => {
    const row = await db.prepare('SELECT id,value,version,exposure FROM test_records WHERE id=?').bind(id).first<{ id: string; value: string; version: number; exposure: string }>()
    if (!row) throw new ToolRefusal('not_found')
    return row
  }
  return ['delete', 'schedule', 'restore', 'risk', 'draft'].map(mode => defineTool({
    name: `synthetic.mutation.${mode}`, title: `Native ${mode}`, description: `Apply the native ${mode} effect once.`,
    scope: 'records:write', readOnly: false, inputSchema: object({ id: text, value: text }),
    outputSchema: object({ id: text, consumed_version: { type: 'integer' } }),
    classes: mode === 'restore' ? ['access'] : mode === 'risk' ? ['external', 'standard'] : ['destructive'], clauses: ['BASE-AGENT-012'],
    target: async args => ({ kind: 'record', id: (await read(args.id)).id }),
    revision: async args => (await read(args.id)).version,
    summary: async args => ({ target: { id: (await read(args.id)).id }, items: [String(args.value)] }),
    ...(mode === 'restore' ? { authority: async (args: Record<string, unknown>) => ({ subject: String(args.id), widens: (await read(args.id)).exposure === 'hidden' }) } : {}),
    async classify(args, _ctx, completed) {
      if (completed) return [...completed]
      const row = await read(args.id)
      if (['schedule', 'draft'].includes(mode) && row.version !== 1) throw new ToolRefusal(`${mode}_consumed`)
      if (mode === 'restore') return [{ class: 'access', facts: { measure: 1, direction: row.exposure === 'hidden' ? 'widens' : 'narrows' } }]
      if (mode === 'risk') return row.exposure === 'hidden' ? [{ class: 'external', facts: { measure: 1, counterparty: 'new' } }] : [{ class: 'standard', facts: { measure: 1 } }]
      return [{ class: 'destructive', facts: { measure: 1 } }]
    },
    async run(args, ctx) {
      const row = await read(args.id)
      await db.batch([
        mode === 'delete' ? db.prepare('DELETE FROM test_records WHERE id=?').bind(args.id)
          : db.prepare("UPDATE test_records SET value=?,version=version+1,exposure='internal' WHERE id=?").bind(args.value, args.id),
        db.prepare('INSERT INTO test_sent(id) VALUES(?)').bind(args.id),
      ])
      ctx.emit('record.changed', `synthetic://record/${args.id}`)
      return { result: { id: row.id, consumed_version: row.version } }
    },
  }))
}
