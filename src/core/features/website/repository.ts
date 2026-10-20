/** The business's website and when Lamp last read it, kept as a setup_readiness row. */
export interface WebsiteRecord { url: string; readAt: string }
export interface WebsiteRepository {
  get(): Promise<WebsiteRecord | null>;
  record(url: string): Promise<void>;
}
export function createWebsiteRepository(db: D1Database): WebsiteRepository {
  return {
    async get() {
      const row = await db.prepare("SELECT evidence_key, checked_at FROM setup_readiness WHERE step='website'").first<{ evidence_key: string; checked_at: string }>();
      return row ? { url: row.evidence_key, readAt: row.checked_at } : null;
    },
    async record(url) {
      await db.prepare("INSERT INTO setup_readiness (step,evidence_key,checked_at) VALUES ('website',?,?) ON CONFLICT(step) DO UPDATE SET evidence_key=excluded.evidence_key, checked_at=excluded.checked_at")
        .bind(url, new Date().toISOString()).run();
    },
  };
}
