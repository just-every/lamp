import { eq } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import { pageSettings } from "../../shared/schema";

export type StoredPageSettings = typeof pageSettings.$inferSelect;

export interface PageSettingsRepository {
  get(): Promise<StoredPageSettings | null>;
  getIfMigrated(): Promise<StoredPageSettings | null>;
  insertIfMissing(settings: typeof pageSettings.$inferInsert): Promise<void>;
  update(settings: Pick<StoredPageSettings, "pageName" | "tagline" | "accentColor" | "timezone" | "hostname" | "footerCreditEnabled" | "widgetAllowedOrigins" | "mailFromAddress" | "aiToneInstructions" | "updatedAt">): Promise<void>;
  updateLogo(input: Pick<StoredPageSettings, "logoKey" | "logoContentType" | "updatedAt">): Promise<void>;
}

export function createPageSettingsRepository(binding: D1Database): PageSettingsRepository {
  const database = createDatabase(binding);
  const get = async () => (await database.select().from(pageSettings).where(eq(pageSettings.id, "default")).get()) ?? null;

  return {
    get,
    async getIfMigrated() {
      // The development outbox is available before app migrations. Only that
      // explicit state is absent here; database/query failures still propagate.
      const migrated = await binding.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'page_settings'").first();
      return migrated ? get() : null;
    },
    async insertIfMissing(settings) {
      await database.insert(pageSettings).values(settings).onConflictDoNothing();
    },
    async update(settings) {
      await database.update(pageSettings).set(settings).where(eq(pageSettings.id, "default"));
    },
    async updateLogo(input) {
      await database.update(pageSettings).set(input).where(eq(pageSettings.id, "default"));
    },
  };
}
