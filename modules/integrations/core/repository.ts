import type { SqlDatabase, SqlStatement } from './database.ts';
import type { Attempt, Delivery, Envelope, Outcome } from './types.ts';
import { assertLabel, randomId } from './crypto.ts';

export class IntegrationsRepository {
  readonly namespace: string;
  readonly sql: SqlDatabase;
  constructor(sql: SqlDatabase, namespace: string) { assertLabel(namespace, 'namespace'); this.sql = sql; this.namespace = namespace; }
  async query(sql: string, params: (string | number | null)[] = []) {
    return (await this.sql.batch([{ sql, params: [this.namespace, ...params] }]))[0]!;
  }
  async insert(delivery: Delivery) {
    await this.query(`INSERT INTO integration_deliveries(namespace,id,fingerprint,destination_hash,envelope,state,created_at,next_at,max_attempts,retry_delays)
      VALUES(?,?,?,?,?,'queued',?,?,?,?) ON CONFLICT(namespace,id) DO NOTHING`,
    [delivery.id, delivery.fingerprint, delivery.destinationHash, JSON.stringify(pickEnvelope(delivery)), delivery.createdAt, delivery.nextAt, delivery.maxAttempts, JSON.stringify(delivery.retryDelaysMs)]);
    const current = (await this.get(delivery.id))!;
    if (current.fingerprint !== delivery.fingerprint) throw new Error('Delivery identity conflict');
    return current;
  }
  async get(id: string): Promise<Delivery | null> {
    const row = (await this.query('SELECT * FROM integration_deliveries WHERE namespace=? AND id=?', [id]))[0];
    return row ? { ...JSON.parse(String(row.envelope)), fingerprint: row.fingerprint, destinationHash: row.destination_hash, state: row.state,
      attempts: row.attempts, createdAt: row.created_at, nextAt: row.next_at, claim: row.claim, claimUntil: row.claim_until,
      maxAttempts: row.max_attempts, retryDelaysMs: JSON.parse(String(row.retry_delays)) } as Delivery : null;
  }
  async due(now: number, limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid delivery batch limit');
    return (await this.query("SELECT id FROM integration_deliveries WHERE namespace=? AND state='queued' AND next_at<=? AND attempts<max_attempts ORDER BY next_at,id LIMIT ?", [now, limit])).map(row => String(row.id));
  }
  async claim(id: string, now: number, leaseMs: number) {
    const claim = randomId();
    const statements: SqlStatement[] = [
      { sql: `UPDATE integration_deliveries SET state='sending', attempts=attempts+1,claim=?,claim_until=? WHERE namespace=? AND id=? AND state='queued' AND next_at<=? AND attempts<max_attempts RETURNING id`, params: [claim, now + leaseMs, this.namespace, id, now] },
      { sql: `INSERT INTO integration_attempts(namespace,id,delivery_id,number,started_at) SELECT namespace,claim,id,attempts,? FROM integration_deliveries WHERE namespace=? AND id=? AND claim=?`, params: [now, this.namespace, id, claim] },
    ];
    const result = await this.sql.batch(statements);
    return result[0]!.length ? claim : null;
  }
  async finish(id: string, claim: string, outcome: Outcome, now: number, nextAt: number | null) {
    const state = outcome.kind === 'retryable' ? (nextAt === null ? 'rejected' : 'queued') : outcome.kind;
    const result = await this.sql.batch([
      { sql: `UPDATE integration_attempts SET finished_at=?,outcome=? WHERE namespace=? AND id=? AND finished_at IS NULL AND EXISTS(SELECT 1 FROM integration_deliveries d WHERE d.namespace=? AND d.id=? AND d.state='sending' AND d.claim=? AND d.claim_until>?)`, params: [now, JSON.stringify(outcome), this.namespace, claim, this.namespace, id, claim, now] },
      { sql: `UPDATE integration_deliveries SET state=?,claim=NULL,claim_until=NULL,next_at=? WHERE namespace=? AND id=? AND state='sending' AND claim=? AND claim_until>? RETURNING id`, params: [state, nextAt ?? now, this.namespace, id, claim, now] },
    ]);
    return result[1]!.length > 0;
  }
  async recoverExpired(now: number) {
    const outcome = JSON.stringify({ kind: 'uncertain', code: 'claim_expired' });
    const result = await this.sql.batch([
      { sql: `UPDATE integration_attempts SET finished_at=?,outcome=? WHERE namespace=? AND finished_at IS NULL AND id IN (SELECT claim FROM integration_deliveries WHERE namespace=? AND state='sending' AND claim_until<=?)`, params: [now, outcome, this.namespace, this.namespace, now] },
      { sql: `UPDATE integration_deliveries SET state='uncertain',claim=NULL,claim_until=NULL WHERE namespace=? AND state='sending' AND claim_until<=? RETURNING id`, params: [this.namespace, now] },
    ]);
    return result[1]!.map(row => String(row.id));
  }
  async log(id: string): Promise<Attempt[]> {
    return (await this.query('SELECT * FROM integration_attempts WHERE namespace=? AND delivery_id=? ORDER BY number', [id])).map(r => ({ id: String(r.id), deliveryId: String(r.delivery_id), number: Number(r.number), startedAt: Number(r.started_at), finishedAt: r.finished_at === null ? null : Number(r.finished_at), outcome: r.outcome ? JSON.parse(String(r.outcome)) : null }));
  }
  async resolve(id: string, outcome: Outcome, now: number) {
    const rows = await this.sql.batch([
      { sql: `INSERT INTO integration_resolutions(namespace,id,delivery_id,at,outcome) SELECT namespace,?,id,?,? FROM integration_deliveries WHERE namespace=? AND id=? AND state='uncertain'`, params: [randomId(), now, JSON.stringify(outcome), this.namespace, id] },
      { sql: `UPDATE integration_deliveries SET state=? WHERE namespace=? AND id=? AND state='uncertain' RETURNING id`, params: [outcome.kind, this.namespace, id] },
    ]);
    if (!rows[1]!.length) throw new Error('Delivery is not uncertain');
  }
  async resolutions(id: string) { return this.query('SELECT at,outcome FROM integration_resolutions WHERE namespace=? AND delivery_id=? ORDER BY at', [id]); }
  async acceptReplay(input: { envelope: Envelope; fingerprint: string; receivedAt: number }) {
    if (input.envelope.tenant !== this.namespace) throw new Error('Receiver namespace mismatch');
    const rows = await this.query('INSERT INTO integration_replays(namespace,id,fingerprint,envelope,received_at) VALUES(?,?,?,?,?) ON CONFLICT(namespace,id) DO NOTHING RETURNING id', [input.envelope.id, input.fingerprint, JSON.stringify(input.envelope), input.receivedAt]);
    const existing = (await this.query('SELECT fingerprint FROM integration_replays WHERE namespace=? AND id=?', [input.envelope.id]))[0]!;
    if (existing.fingerprint !== input.fingerprint) throw new Error('Replay identity conflict');
    return rows.length > 0;
  }
}
export function pickEnvelope(e: Envelope): Envelope { return { id: e.id, tenant: e.tenant, destinationId: e.destinationId, event: e.event, protocol: e.protocol, body: e.body }; }
