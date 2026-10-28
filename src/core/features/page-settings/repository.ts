import { and, eq } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import { pageSettings } from "../../shared/schema";
import { createUlid } from "../../shared/ids";

export type StoredPageSettings = typeof pageSettings.$inferSelect;

export interface PageSettingsRepository {
  get(): Promise<StoredPageSettings | null>;
  /** The regions written on components the public page shows, each as stored. */
  visibleRegions(): Promise<string[]>;
  insertIfMissing(settings: typeof pageSettings.$inferInsert): Promise<void>;
  update(settings: Pick<StoredPageSettings, "pageName" | "tagline" | "accentColor" | "timezone" | "hostname" | "footerCreditEnabled" | "template" | "widgetAllowedOrigins" | "widgetAppearance" | "mailFromAddress" | "emailBranding" | "aiToneInstructions" | "wordingBlockedTerms" | "wordingFriendlyLength" | "updatedAt">, expectedUpdatedAt?: string): Promise<void>;
  updateLogo(input: Pick<StoredPageSettings, "logoKey" | "logoContentType" | "updatedAt">, operatorId: string): Promise<void>;
}

export function createPageSettingsRepository(binding: D1Database): PageSettingsRepository {
  const database = createDatabase(binding);
  const get = async () => (await database.select().from(pageSettings).where(eq(pageSettings.id, "default")).get()) ?? null;

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
      await database.insert(pageSettings).values(settings).onConflictDoNothing();
    },
    async update(settings, expectedUpdatedAt) {
      const rows = await database.update(pageSettings).set(settings).where(and(eq(pageSettings.id, "default"), ...(expectedUpdatedAt === undefined ? [] : [eq(pageSettings.updatedAt, expectedUpdatedAt)]))).returning({ id: pageSettings.id });
      if (expectedUpdatedAt !== undefined && rows.length !== 1) throw new Error("Page settings changed. Reload them before editing.");
    },
    async updateLogo(input, operatorId) {
      // Select the logo being destroyed inside the same transaction as its
      // replacement. First uploads and competing/repeated removals add no entry.
      await binding.batch([
        binding.prepare(`INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, payload_json, created_at, updated_at)
          SELECT ?, 'page-logo', id, ?, ?, json_object('previousContentType', logo_content_type, 'contentType', ?), ?, ?
          FROM page_settings WHERE id = 'default' AND logo_key IS NOT NULL AND logo_key IS NOT ?`)
          .bind(createUlid(), input.logoKey === null ? "deleted" : "replaced", operatorId, input.logoContentType, input.updatedAt, input.updatedAt, input.logoKey),
        binding.prepare("UPDATE page_settings SET logo_key = ?, logo_content_type = ?, updated_at = ? WHERE id = 'default'")
          .bind(input.logoKey, input.logoContentType, input.updatedAt),
      ]);
    },
  };
}
