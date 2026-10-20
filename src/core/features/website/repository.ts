/** The business's website and when Lamp last read it, kept as a setup_readiness row. */
export interface WebsiteStatusPage {
  url: string;
  source: "statuspage" | "betterstack" | "instatus" | "sorry" | null;
  pageId: string | null;
}
export interface WebsiteRecord { url: string; readAt: string; statusPage: WebsiteStatusPage | null }
export interface WebsiteRepository {
  get(): Promise<WebsiteRecord | null>;
  record(url: string, statusPage: WebsiteStatusPage | null): Promise<void>;
  clear(): Promise<void>;
}
export function createWebsiteRepository(db: D1Database): WebsiteRepository {
  return {
    async get() {
      const rows = await db.prepare("SELECT step, evidence_key, checked_at FROM setup_readiness WHERE step IN ('website','website-status-page')").all<{ step: string; evidence_key: string; checked_at: string }>();
      const row = rows.results.find((entry) => entry.step === "website");
      const status = rows.results.find((entry) => entry.step === "website-status-page");
      return row ? { url: row.evidence_key, readAt: row.checked_at, statusPage: status ? JSON.parse(status.evidence_key) as WebsiteStatusPage : null } : null;
    },
    async record(url, statusPage) {
      const checkedAt = new Date().toISOString();
      await db.batch([
        db.prepare("INSERT INTO setup_readiness (step,evidence_key,checked_at) VALUES ('website',?,?) ON CONFLICT(step) DO UPDATE SET evidence_key=excluded.evidence_key, checked_at=excluded.checked_at").bind(url, checkedAt),
        statusPage
          ? db.prepare("INSERT INTO setup_readiness (step,evidence_key,checked_at) VALUES ('website-status-page',?,?) ON CONFLICT(step) DO UPDATE SET evidence_key=excluded.evidence_key, checked_at=excluded.checked_at").bind(JSON.stringify(statusPage), checkedAt)
          : db.prepare("DELETE FROM setup_readiness WHERE step='website-status-page'"),
      ]);
    },
    async clear() {
      await db.prepare("DELETE FROM setup_readiness WHERE step IN ('website','website-status-page')").run();
    },
  };
}
