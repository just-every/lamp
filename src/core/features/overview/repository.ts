export interface ReadinessEvidence { step: string; evidence_key: string; checked_at: string }
export interface OverviewRepository {
  evidence(): Promise<ReadinessEvidence[]>;
  record(step: string, key: string): Promise<void>;
  checkedAt(step: string): Promise<string | null>;
  clear(step: string): Promise<void>;
  hasPublishedIncident(): Promise<boolean>;
}
export function createOverviewRepository(db: D1Database): OverviewRepository {
  return {
    async evidence() { return (await db.prepare('SELECT step, evidence_key, checked_at FROM setup_readiness').all<ReadinessEvidence>()).results; },
    async record(step, key) {
      await db.prepare('INSERT INTO setup_readiness (step,evidence_key,checked_at) VALUES (?,?,?) ON CONFLICT(step) DO UPDATE SET evidence_key=excluded.evidence_key, checked_at=excluded.checked_at')
        .bind(step, key, new Date().toISOString()).run();
    },
    async checkedAt(step) { return (await db.prepare('SELECT checked_at FROM setup_readiness WHERE step=?').bind(step).first<{ checked_at: string }>())?.checked_at ?? null; },
    async clear(step) { await db.prepare('DELETE FROM setup_readiness WHERE step=?').bind(step).run(); },
    async hasPublishedIncident() { return Boolean(await db.prepare('SELECT id FROM incident_updates LIMIT 1').first()); },
  };
}
