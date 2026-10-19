import type { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { DoorError, verifyRerGrant } from '../../../../modules/import-kit/src/door';
import { ownerClaimConfig } from '../../platform/auth/claim';
import type { AppBindings, AppEnv } from '../../app/types';
import { readImportedPublicRecords } from './alias-repository';
import { createImportDoorRepository } from './door.repository';
import { resolvePublicAddresses } from './public-addresses';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
/** As many old addresses as Settings → Cutover lists. */
const SAMPLE = 25;
const HELD = "state='deactivated' AND deactivation_reason IN ('held for Sorry cutover','held for Business cutover')";
/** A record Lamp's own people or tools created, never one an import still holds. */
const native = (kind: string, table: string) => `NOT EXISTS(SELECT 1 FROM ik_provenance p WHERE p.target_kind='${kind}' AND p.target_id=${table}.id AND p.reversed=0)`;

export interface CutoverStatus {
  old_addresses: { total: number; sample: Array<{ path: string; target: string }> };
  counts: { components: number; incidents: number; maintenance: number };
  subscribers: { held: number; pending: number; invited_since: number };
  created_since: { incidents: number; maintenance: number; subscribers: number };
  intake: { sources: Array<{ id: string; kind: string; receipts_since: number }> };
}

/** Counts and ids only: never a record's content, a name, an address or a secret. */
export async function readCutoverStatus(db: D1Database, since: string): Promise<CutoverStatus> {
  const count = async (sql: string, ...params: unknown[]) => (await db.prepare(sql).bind(...params).first<{ n: number }>())?.n ?? 0;
  const [records, targets, counts, subscribers, created, sources] = await Promise.all([
    readImportedPublicRecords(db),
    db.prepare("SELECT id,reference,'incident' AS kind FROM incidents WHERE deleted_at IS NULL UNION ALL SELECT id,reference,'maintenance' AS kind FROM maintenance").all<{ id: string; reference: string; kind: string }>(),
    Promise.all([count('SELECT COUNT(*) AS n FROM components'), count('SELECT COUNT(*) AS n FROM incidents WHERE deleted_at IS NULL'), count('SELECT COUNT(*) AS n FROM maintenance')]),
    Promise.all([count(`SELECT COUNT(*) AS n FROM subscribers WHERE ${HELD}`), count("SELECT COUNT(*) AS n FROM subscribers WHERE state='pending'"),
      count('SELECT COUNT(*) AS n FROM statuspage_import_invites WHERE sent_at IS NOT NULL AND julianday(sent_at)>=julianday(?)', since)]),
    Promise.all([
      count(`SELECT COUNT(*) AS n FROM incidents WHERE deleted_at IS NULL AND julianday(created_at)>=julianday(?) AND ${native('incident', 'incidents')}`, since),
      count(`SELECT COUNT(*) AS n FROM maintenance WHERE julianday(created_at)>=julianday(?) AND ${native('maintenance', 'maintenance')}`, since),
      count(`SELECT COUNT(*) AS n FROM subscribers WHERE julianday(created_at)>=julianday(?) AND ${native('subscriber', 'subscribers')}`, since),
    ]),
    db.prepare(`SELECT s.id,COALESCE(s.uptime_preset,s.grouped_preset,s.preset,'custom') AS kind,
      (SELECT COUNT(*) FROM alert_receipts r WHERE r.source_id=s.id AND julianday(r.received_at)>=julianday(?)) AS receipts_since
      FROM alert_sources s ORDER BY s.created_at,s.id`).bind(since).all<{ id: string; kind: string; receipts_since: number }>(),
  ]);
  // The old addresses the public page redirects, resolved as Settings → Cutover resolves them.
  const references = new Map(targets.results.map(row => [`${row.kind}:${row.id}`, row.reference]));
  const { aliases } = resolvePublicAddresses(records.flatMap(record => {
    const reference = references.get(`${record.targetKind}:${record.targetId}`);
    return reference ? [{ ...record, target: `/${record.targetKind === 'incident' ? 'incidents' : 'maintenance'}/${reference}` }] : [];
  }));
  const rows = [...aliases].sort(([a], [b]) => a.localeCompare(b)).map(([path, { target }]) => ({ path, target }));
  return {
    old_addresses: { total: rows.length, sample: rows.slice(0, SAMPLE) },
    counts: { components: counts[0], incidents: counts[1], maintenance: counts[2] },
    subscribers: { held: subscribers[0], pending: subscribers[1], invited_since: subscribers[2] },
    created_since: { incidents: created[0], maintenance: created[1], subscribers: created[2] },
    intake: { sources: sources.results.map(row => ({ id: row.id, kind: row.kind, receipts_since: row.receipts_since })) },
  };
}

/** `{since}`: one ISO 8601 instant with its time zone, returned normalised. */
function sinceOf(body: unknown) {
  const value = (body as { since?: unknown } | null)?.since;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}

/**
 * POST /api/rer/cutover-status: Run Edit Run's signed read of how a move to this
 * Lamp stands, for Business's status and webhook checks. The grant is an
 * RER-signed `cutover-status` grant for this installation and its owner under the
 * owner-claim key ring; a key the owner revoked in Business imports is refused.
 * It is read-only and answers counts and ids only. Without Run Edit Run's trust
 * (self-host) the route does not exist.
 */
export function registerRerCutoverStatus(app: Hono<AppEnv>, bindings: AppBindings) {
  app.all('/api/rer/cutover-status', async c => {
    if (c.req.method !== 'POST') return c.json({ error: 'method_not_allowed' }, 405, { ...headers, Allow: 'POST' });
    const claim = ownerClaimConfig(bindings);
    if (!claim) return c.json({ error: 'not_found' }, 404, headers);
    try {
      const { kid } = await verifyRerGrant(c.req.raw, claim, 'cutover-status');
      const key = await createImportDoorRepository(bindings.DB).key(bindings);
      if (await bindings.DB.prepare('SELECT 1 FROM ik_door_revoked_keys WHERE installation_id=? AND kid=?').bind(key, kid).first()) return c.json({ error: 'invalid_grant' }, 403, headers);
    } catch (error) {
      if (error instanceof DoorError) return c.json({ error: error.code }, error.status as ContentfulStatusCode, headers);
      throw error;
    }
    const since = sinceOf(await c.req.json().catch(() => null));
    if (!since) return c.json({ error: 'invalid_since' }, 400, headers);
    return c.json(await readCutoverStatus(bindings.DB, since), 200, headers);
  });
}
