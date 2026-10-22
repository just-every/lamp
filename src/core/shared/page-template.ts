import type { pageSettings } from "./schema";

/** The layouts an owner can choose for the public page. */
export type PageTemplate = "default" | "calm" | "uptime" | "regions" | "house";

type StoredSettings = typeof pageSettings.$inferSelect;

/** Page settings as Lamp reads them: one chosen template. House style (owner L18) is stored as its own flag beside
 *  Calm headline, the built-in layout a page shows whenever its house style can't (migration 0044). */
export type PageSettingsRecord = Omit<StoredSettings, "template" | "houseStyle"> & { template: PageTemplate };

export function pageSettingsRecord({ houseStyle, ...stored }: StoredSettings): PageSettingsRecord {
  return { ...stored, template: houseStyle ? "house" : stored.template };
}

/** The stored columns for a chosen template. */
export function storedTemplate(template: PageTemplate): Pick<StoredSettings, "template" | "houseStyle"> {
  return template === "house" ? { template: "calm", houseStyle: true } : { template, houseStyle: false };
}
