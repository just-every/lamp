// Refresh-safe writes. A form that creates something carries a command key (a
// fresh one each time the page renders it); the handler runs the create through
// `runOnce`, then answers 303 to a GET. Refreshing the result page reads it
// again; resubmitting the same form (Back, a retried request, a double click)
// returns the first result instead of creating a second credential, roster
// publication or key. Receipts live in rer_command_receipts (command-receipts.sql), which
// archives leave out. Both exporters copy this file to src/base.

export const commandKeyField = 'commandKey'
const keyShape = /^[A-Za-z0-9_-]{16,64}$/
const KEEP_MS = 7 * 86400_000

export class CommandKeyError extends Error {
  constructor(message: string, readonly status: 400 | 409) { super(message) }
}

/** The hidden input a create form carries: a new key each time the form renders. */
export function commandKeyInput(): string {
  return `<input type="hidden" name="${commandKeyField}" value="${crypto.randomUUID()}">`
}

/** The form's command key, or a CommandKeyError (400) when it is missing or malformed. */
export function commandKey(form: FormData | URLSearchParams | Record<string, unknown>): string {
  const value = form instanceof FormData || form instanceof URLSearchParams ? form.get(commandKeyField) : form[commandKeyField]
  if (typeof value !== 'string' || !keyShape.test(value)) throw new CommandKeyError('This form is out of date. Reload the page and try again.', 400)
  return value
}

export interface Done<T> {
  result: T
  /** True when this key already ran: the first result, nothing created again. */
  replayed: boolean
}

/**
 * Runs `create` at most once for this actor's command key. `create` returns the
 * result to keep, plus anything to show only once (a new credential's secret):
 * `readReceipt` hands that part to the first page that reads it and then drops
 * it. A failed create releases the key so the same form can be sent again; a
 * key still running (a duplicate in flight) answers 409 rather than creating twice.
 */
export async function runOnce<T>(db: D1Database, scope: { actor: string; command: string; key: string },
  create: () => Promise<{ result: T; once?: unknown }>): Promise<Done<T>> {
  const now = Date.now()
  const [, claim] = await db.batch([
    db.prepare('DELETE FROM rer_command_receipts WHERE created_at<?').bind(now - KEEP_MS),
    db.prepare("INSERT INTO rer_command_receipts(actor,command_key,command,state,created_at) VALUES(?,?,?,'running',?) ON CONFLICT DO NOTHING").bind(scope.actor, scope.key, scope.command, now),
  ])
  if (claim.meta.changes !== 1) {
    const row = await db.prepare('SELECT command,state,result FROM rer_command_receipts WHERE actor=? AND command_key=?').bind(scope.actor, scope.key).first<{ command: string; state: string; result: string | null }>()
    if (!row || row.command !== scope.command) throw new CommandKeyError('This form was already used for something else. Reload the page and try again.', 409)
    if (row.state !== 'done') throw new CommandKeyError('This change is still being saved. Reload the page in a moment to see it.', 409)
    return { result: JSON.parse(row.result!) as T, replayed: true }
  }
  let made: { result: T; once?: unknown }
  try { made = await create() }
  catch (error) {
    await db.prepare("DELETE FROM rer_command_receipts WHERE actor=? AND command_key=? AND state='running'").bind(scope.actor, scope.key).run()
    throw error
  }
  await db.prepare("UPDATE rer_command_receipts SET state='done',result=?,once=? WHERE actor=? AND command_key=?")
    .bind(JSON.stringify(made.result ?? null), made.once === undefined ? null : JSON.stringify(made.once), scope.actor, scope.key).run()
  return { result: made.result, replayed: false }
}

/** The receipt a 303 points at, for the actor who made it; its `once` part is returned to the first read only. */
export async function readReceipt<T>(db: D1Database, actor: string, key: string | null): Promise<{ command: string; result: T; once?: unknown } | null> {
  if (!key || !keyShape.test(key)) return null
  const [read] = await db.batch([
    db.prepare("SELECT command,result,once FROM rer_command_receipts WHERE actor=? AND command_key=? AND state='done'").bind(actor, key),
    db.prepare('UPDATE rer_command_receipts SET once=NULL WHERE actor=? AND command_key=?').bind(actor, key),
  ])
  const row = (read.results as Array<{ command: string; result: string; once: string | null }>)[0]
  if (!row) return null
  return { command: row.command, result: JSON.parse(row.result) as T, ...(row.once === null ? {} : { once: JSON.parse(row.once) }) }
}

/** 303 See Other: after a successful POST the browser GETs the result page, so a refresh never resends the form. */
export function seeOther(location: string, headers?: HeadersInit): Response {
  const response = new Headers(headers)
  response.set('location', location)
  response.set('cache-control', 'no-store')
  return new Response(null, { status: 303, headers: response })
}
