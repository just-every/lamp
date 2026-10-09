import { eq } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import { pageSettings } from "../../shared/schema";

export type StoredPageSettings = typeof pageSettings.$inferSelect;

export interface PageSettingsRepository {
  get(): Promise<StoredPageSettings | null>;
  insertIfMissing(settings: typeof pageSettings.$inferInsert): Promise<void>;
  update(settings: Pick<StoredPageSettings, "pageName" | "tagline" | "accentColor" | "timezone" | "hostname" | "footerCreditEnabled" | "widgetAllowedOrigins" | "mailFromAddress" | "aiToneInstructions" | "updatedAt">): Promise<void>;
  updateLogo(input: Pick<StoredPageSettings, "logoKey" | "logoContentType" | "updatedAt">): Promise<void>;
}

export function createPageSettingsRepository(binding: D1Database): PageSettingsRepository {
  const database = createDatabase(binding);

  return {
    async get() {
      const settings = await database.select().from(pageSettings).where(eq(pageSettings.id, "default")).get();
      return settings ?? null;
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
