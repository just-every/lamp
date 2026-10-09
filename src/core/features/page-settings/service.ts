import { createUlid, nowIso } from "../../shared/ids";
import type { PageSettingsInput } from "../../shared/schemas";
import { parseWidgetAllowedOrigins } from "../../shared/widget-origins";
import type { BlobStore } from "../../platform/blobs/store";

import type { PageSettingsRepository, StoredPageSettings } from "./repository";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type PageSettingsView = Omit<StoredPageSettings, "widgetAllowedOrigins"> & {
  widgetAllowedOrigins: string[];
};

export interface PageSettingsService {
  get(): Promise<PageSettingsView | null>;
  ensureInitial(settings: PageSettingsInput): Promise<void>;
  update(settings: PageSettingsInput): Promise<PageSettingsView | null>;
  uploadLogo(input: { bytes: ArrayBuffer; contentType: string }): Promise<PageSettingsView | null>;
  removeLogo(): Promise<PageSettingsView | null>;
}

function toView(settings: StoredPageSettings): PageSettingsView {
  return { ...settings, widgetAllowedOrigins: parseWidgetAllowedOrigins(settings.widgetAllowedOrigins) };
}

export function createPageSettingsService(
  repository: PageSettingsRepository,
  onPublicDataChanged: () => Promise<void>,
  blobs?: BlobStore,
  initialMailFromAddress?: string,
): PageSettingsService {
  async function readRequired() {
    const settings = await repository.get();
    if (!settings) throw new Error("Page settings are not configured.");
    return settings;
  }

  async function rebuildAndRead() {
    await onPublicDataChanged();
    const settings = await repository.get();
    return settings ? toView(settings) : null;
  }

  return {
    async get() {
      const settings = await repository.get();
      return settings ? toView(settings) : null;
    },
    async ensureInitial(settings) {
      const timestamp = nowIso();
      const mailFromAddress = settings.mailFromAddress ?? initialMailFromAddress;
      if (!mailFromAddress) throw new Error("Lamp requires MAIL_FROM_ADDRESS to initialize the email sender setting.");
      await repository.insertIfMissing({
        id: "default",
        ...settings,
        widgetAllowedOrigins: JSON.stringify(settings.widgetAllowedOrigins ?? []),
        mailFromAddress,
        aiToneInstructions: settings.aiToneInstructions ?? "",
        feedId: createUlid(),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    },
    async update(settings) {
      const existing = await readRequired();
      await repository.update({
        pageName: settings.pageName,
        tagline: settings.tagline,
        accentColor: settings.accentColor,
        timezone: settings.timezone,
        hostname: settings.hostname,
        footerCreditEnabled: settings.footerCreditEnabled,
        widgetAllowedOrigins: JSON.stringify(settings.widgetAllowedOrigins ?? parseWidgetAllowedOrigins(existing.widgetAllowedOrigins)),
        mailFromAddress: settings.mailFromAddress ?? existing.mailFromAddress,
        aiToneInstructions: settings.aiToneInstructions ?? existing.aiToneInstructions,
        updatedAt: nowIso(),
      });
      return rebuildAndRead();
    },
    async uploadLogo(input) {
      if (!blobs) throw new Error("Logo storage is not configured.");
      if (!LOGO_CONTENT_TYPES.has(input.contentType)) throw new Error("Logo must be a PNG, JPEG, or WebP image.");
      if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_LOGO_BYTES) throw new Error("Logo must be between 1 byte and 2 MB.");
      await readRequired();
      const key = `branding/logos/${createUlid()}`;
      await blobs.putBytes(key, input.bytes, input.contentType);
      await repository.updateLogo({ logoKey: key, logoContentType: input.contentType, updatedAt: nowIso() });
      return rebuildAndRead();
    },
    async removeLogo() {
      await readRequired();
      await repository.updateLogo({ logoKey: null, logoContentType: null, updatedAt: nowIso() });
      return rebuildAndRead();
    },
  };
}
