import { eq } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import { pageSettings } from "../../shared/schema";

export type StoredPageSettings = typeof pageSettings.$inferSelect;

export interface PageSettingsRepository {
  get(): Promise<StoredPageSettings | null>;
  hasVisibleRegion(): Promise<boolean>;
  insertIfMissing(settings: typeof pageSettings.$inferInsert): Promise<void>;
  update(settings: Pick<StoredPageSettings, "pageName" | "tagline" | "accentColor" | "timezone" | "hostname" | "footerCreditEnabled" | "template" | "widgetAllowedOrigins" | "mailFromAddress" | "emailBranding" | "aiToneInstructions" | "wordingBlockedTerms" | "wordingFriendlyLength" | "updatedAt">): Promise<void>;
  updateLogo(input: Pick<StoredPageSettings, "logoKey" | "logoContentType" | "updatedAt">): Promise<void>;
}

export function createPageSettingsRepository(binding: D1Database): PageSettingsRepository {
  const database = createDatabase(binding);
  const get = async () => (await database.select().from(pageSettings).where(eq(pageSettings.id, "default")).get()) ?? null;

  return {
    get,
    async hasVisibleRegion() {
      const row = await binding.prepare(`
        SELECT 1 AS available FROM components AS component
        WHERE component.internal = 0 AND length(trim(component.region)) > 0
          AND (component.only_show_if_degraded = 0
            OR EXISTS (SELECT 1 FROM component_standing_claims AS claim
              WHERE claim.component_id = component.id AND claim.state <> 'Operational')
            OR EXISTS (SELECT 1 FROM incident_components AS claim
              JOIN incidents AS incident ON incident.id = claim.incident_id
              WHERE claim.component_id = component.id AND claim.state <> 'Operational'
                AND claim.published_at IS NOT NULL AND incident.deleted_at IS NULL AND incident.lifecycle <> 'Resolved')
            OR EXISTS (SELECT 1 FROM maintenance_components AS claim
              JOIN maintenance AS window ON window.id = claim.maintenance_id
              WHERE claim.component_id = component.id AND claim.state <> 'Operational' AND window.state = 'In progress'))
        LIMIT 1
      `).first<{ available: number }>();
      return row !== null;
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
