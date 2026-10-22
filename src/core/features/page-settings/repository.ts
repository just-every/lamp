import { eq } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import { pageSettings } from "../../shared/schema";
import { pageSettingsRecord, storedTemplate, type PageSettingsRecord, type PageTemplate } from "../../shared/page-template";

export type StoredPageSettings = PageSettingsRecord;

export interface PageSettingsRepository {
  get(): Promise<StoredPageSettings | null>;
  /** The regions written on components the public page shows, each as stored. */
  visibleRegions(): Promise<string[]>;
  insertIfMissing(settings: Omit<typeof pageSettings.$inferInsert, "template" | "houseStyle"> & { template: PageTemplate }): Promise<void>;
  update(settings: Pick<StoredPageSettings, "pageName" | "tagline" | "accentColor" | "timezone" | "hostname" | "footerCreditEnabled" | "template" | "widgetAllowedOrigins" | "mailFromAddress" | "emailBranding" | "aiToneInstructions" | "wordingBlockedTerms" | "wordingFriendlyLength" | "updatedAt">): Promise<void>;
  updateLogo(input: Pick<StoredPageSettings, "logoKey" | "logoContentType" | "updatedAt">): Promise<void>;
  updateTemplate(input: Pick<StoredPageSettings, "template" | "updatedAt">): Promise<void>;
}

export function createPageSettingsRepository(binding: D1Database): PageSettingsRepository {
  const database = createDatabase(binding);
  const get = async () => {
    const stored = await database.select().from(pageSettings).where(eq(pageSettings.id, "default")).get();
    return stored ? pageSettingsRecord(stored) : null;
  };

  return {
    get,
    async visibleRegions() {
      const { results } = await binding.prepare(`
        SELECT DISTINCT trim(component.region) AS region FROM components AS component
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
      `).all<{ region: string }>();
      return results.map((row) => row.region);
    },
    async insertIfMissing(settings) {
      await database.insert(pageSettings).values({ ...settings, ...storedTemplate(settings.template) }).onConflictDoNothing();
    },
    async update(settings) {
      await database.update(pageSettings).set({ ...settings, ...storedTemplate(settings.template) }).where(eq(pageSettings.id, "default"));
    },
    async updateLogo(input) {
      await database.update(pageSettings).set(input).where(eq(pageSettings.id, "default"));
    },
    async updateTemplate(input) {
      await database.update(pageSettings).set({ ...storedTemplate(input.template), updatedAt: input.updatedAt }).where(eq(pageSettings.id, "default"));
    },
  };
}
