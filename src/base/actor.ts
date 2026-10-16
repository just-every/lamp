// Who did something, when, and what they recorded, for people to read: a name
// (never a UUID), a time in the business's time zone (never a bare UTC string)
// and labelled fields (never raw JSON or [object Object]). Shared by the
// default seed and every edition; both exporters copy it to src/base.

/** Actor id → display name, for the people this installation knows. */
export type ActorDirectory = ReadonlyMap<string, string> | Record<string, string>

/** Shown for an actor the directory no longer holds: erased, removed or not restored. */
export const formerMember = 'Former member'

export interface EvidenceOptions {
  /** Resolves actor-shaped fields (actor, by, operatorId, approvedBy…) to names. */
  directory?: ActorDirectory
  /** The business's IANA time zone; timestamps render in it with its abbreviation. */
  timeZone: string
  /** Field key → label, where the automatic label ("approvedBy" → "Approved by") reads poorly. */
  labels?: Record<string, string>
  /** Field keys never shown (internal revisions, hashes). */
  omit?: readonly string[]
  locale?: string
}

export interface EvidenceField { label: string; value: string }

const lookup = (directory: ActorDirectory | undefined, id: string) =>
  directory instanceof Map ? directory.get(id) : (directory as Record<string, string> | undefined)?.[id]

/** The actor's display name, or "Former member" for an id the directory does not hold. */
export function actorName(directory: ActorDirectory | undefined, id: string | null | undefined): string {
  const name = id ? lookup(directory, id)?.trim() : undefined
  return name || formerMember
}

/** "16 Oct 2026, 3:04 pm AEDT": epoch milliseconds, ISO text or a Date, in the business time zone. */
export function readableTime(at: string | number | Date, timeZone: string, locale = 'en-AU'): string {
  const date = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(date.getTime())) return String(at)
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short' }).format(date)
}

/** "<display name> · <time in the business time zone>". */
export function actorLine(directory: ActorDirectory | undefined, id: string | null | undefined, at: string | number | Date, timeZone: string, locale?: string): string {
  return `${actorName(directory, id)} · ${readableTime(at, timeZone, locale)}`
}

const actorKey = /^(actor|by|owner|operator|user|member|staff|approver|reviewer|requester|creator|assignee)(_?id)?$|(By|_by)$|(Actor|_actor)(_?[Ii]d)?$/
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/
const epochKey = /(At|_at)$/

/** "approvedBy" and "approved_by" → "Approved by"; "sourceUserId" → "Source user ID". */
export function fieldLabel(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  const label = words.replace(/\bid\b/g, 'ID').replace(/\burl\b/g, 'URL')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function parsed(value: unknown): unknown {
  if (typeof value !== 'string' || !/^\s*[[{]/.test(value)) return value
  try { return JSON.parse(value) } catch { return value }
}

function scalar(key: string, value: unknown, options: EvidenceOptions): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return epochKey.test(key) && value > 1e11 ? readableTime(value, options.timeZone, options.locale) : value.toLocaleString(options.locale ?? 'en-AU')
  const text = String(value)
  if (actorKey.test(key)) return actorName(options.directory, text)
  if (timestamp.test(text)) return readableTime(text, options.timeZone, options.locale)
  return text
}

/** Evidence or details (an object, or its JSON text) as labelled fields; nested values are labelled "Parent › Child". */
export function evidenceFields(value: unknown, options: EvidenceOptions): EvidenceField[] {
  const fields: EvidenceField[] = [], omit = new Set(options.omit ?? [])
  const walk = (item: unknown, key: string, label: string, depth: number) => {
    item = parsed(item)
    if (Array.isArray(item)) {
      if (item.every(entry => entry === null || typeof entry !== 'object')) fields.push({ label, value: item.length ? item.map(entry => scalar(key, entry, options)).join(', ') : '—' })
      else item.forEach((entry, index) => walk(entry, key, `${label} ${index + 1}`, depth + 1))
    } else if (item && typeof item === 'object') {
      const entries = Object.entries(item).filter(([name]) => !omit.has(name))
      if (depth >= 4 || !entries.length) { fields.push({ label, value: entries.length ? `${entries.length} more fields` : '—' }); return }
      for (const [name, entry] of entries) walk(entry, name, (label ? `${label} › ` : '') + (options.labels?.[name] ?? fieldLabel(name)), depth + 1)
    } else fields.push({ label: label || 'Value', value: scalar(key, item, options) })
  }
  walk(value, '', '', 0)
  return fields
}

const escape = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)

/** Evidence as an HTML description list, every label and value escaped. */
export function evidenceHtml(value: unknown, options: EvidenceOptions): string {
  const fields = evidenceFields(value, options)
  if (!fields.length || (fields.length === 1 && fields[0].value === '—')) return '<p class="rer-evidence-empty">No details recorded.</p>'
  return `<dl class="rer-evidence">${fields.map(field => `<div><dt>${escape(field.label)}</dt><dd>${escape(field.value)}</dd></div>`).join('')}</dl>`
}

/** Display names for operator-auth's people (oa_operators), for actorName and the evidence renderers. */
export async function operatorDirectory(db: D1Database): Promise<Map<string, string>> {
  const rows = (await db.prepare('SELECT id,display_name AS name FROM oa_operators').all<{ id: string; name: string }>()).results
  return new Map(rows.map(row => [row.id, row.name]))
}
