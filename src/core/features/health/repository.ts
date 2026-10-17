import { sql } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";

const STEP = "dependency-health";

export interface HealthRepository {
  /** Identifies the installation's database, so a remembered result never crosses installations. */
  key: object;
  checkDatabase(): Promise<void>;
  /** When every dependency last answered, or null. */
  lastGood(): Promise<string | null>;
  recordGood(checkedAt: string): Promise<void>;
  forgetGood(): Promise<void>;
}

export function createHealthRepository(binding: D1Database): HealthRepository {
  const database = createDatabase(binding);

  return {
    key: binding,
    async checkDatabase() {
      await database.run(sql`select 1`);
    },
    async lastGood() {
      return (await binding.prepare("SELECT checked_at FROM setup_readiness WHERE step=?").bind(STEP).first<{ checked_at: string }>())?.checked_at ?? null;
    },
    async recordGood(checkedAt) {
      await binding.prepare("INSERT INTO setup_readiness (step,evidence_key,checked_at) VALUES (?,'ok',?) ON CONFLICT(step) DO UPDATE SET evidence_key=excluded.evidence_key, checked_at=excluded.checked_at")
        .bind(STEP, checkedAt).run();
    },
    async forgetGood() {
      await binding.prepare("DELETE FROM setup_readiness WHERE step=?").bind(STEP).run();
    },
  };
}
