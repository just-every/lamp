import { createUlid, nowIso } from "../../shared/ids";
import type { PageSettingsInput } from "../../shared/schemas";
import { parseWidgetAllowedOrigins } from "../../shared/widget-origins";
import type { BlobStore } from "../../platform/blobs/store";

import type { PageSettingsRepository, StoredPageSettings } from "./repository";

import { emailBrandingSchema, type EmailBranding } from "../../shared/email-branding";

export class UnsupportedMailIdentityError extends Error {}
export class UnavailablePageTemplateError extends Error {}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type PageSettingsView = Omit<StoredPageSettings, "widgetAllowedOrigins" | "wordingBlockedTerms" | "emailBranding"> & {
  emailBranding: EmailBranding;
  mailIdentityEditable: boolean;
  widgetAllowedOrigins: string[];
  wordingBlockedTerms: string[];
  regionsAvailable: boolean;
};

export interface PageSettingsService {
  get(): Promise<PageSettingsView | null>;
  ensureInitial(settings: PageSettingsInput): Promise<void>;
  update(settings: PageSettingsInput): Promise<PageSettingsView | null>;
  uploadLogo(input: { bytes: ArrayBuffer; contentType: string }): Promise<PageSettingsView | null>;
  removeLogo(): Promise<PageSettingsView | null>;
}

function toView(settings: StoredPageSettings, mailIdentityEditable: boolean, regionsAvailable: boolean): PageSettingsView {
  const wordingBlockedTerms: unknown = JSON.parse(settings.wordingBlockedTerms);
  if (!Array.isArray(wordingBlockedTerms) || wordingBlockedTerms.some(term => typeof term !== "string")) throw new Error("Wording check terms are invalid.");
  return { ...settings, emailBranding: emailBrandingSchema.parse(JSON.parse(settings.emailBranding)), mailIdentityEditable, regionsAvailable, wordingBlockedTerms, widgetAllowedOrigins: parseWidgetAllowedOrigins(settings.widgetAllowedOrigins) };
}

export function createPageSettingsService(
  repository: PageSettingsRepository,
  onPublicDataChanged: () => Promise<void>,
  blobs?: BlobStore,
  initialMailFromAddress?: string,
  mailIdentityEditable = true,
): PageSettingsService {
  async function readRequired() {
    const settings = await repository.get();
    if (!settings) throw new Error("Page settings are not configured.");
    return settings;
  }

  async function rebuildAndRead() {
    await onPublicDataChanged();
    return readView();
  }

  async function readView() {
    const [settings, regionsAvailable] = await Promise.all([repository.get(), repository.hasVisibleRegion()]);
    return settings ? toView(settings, mailIdentityEditable, regionsAvailable) : null;
  }

  return {
    async get() {
      return readView();
    },
    async ensureInitial(settings) {
      const timestamp = nowIso();
      const mailFromAddress = settings.mailFromAddress ?? initialMailFromAddress;
      if (!mailFromAddress) throw new Error("Lamp requires MAIL_FROM_ADDRESS to initialize the email sender setting.");
      await repository.insertIfMissing({
        id: "default",
        ...settings,
        template: settings.template ?? "default",
        emailBranding: JSON.stringify(settings.emailBranding ?? {}),
        widgetAllowedOrigins: JSON.stringify(settings.widgetAllowedOrigins ?? []),
        mailFromAddress,
        aiToneInstructions: settings.aiToneInstructions ?? "",
        wordingBlockedTerms: JSON.stringify(settings.wordingBlockedTerms ?? []),
        wordingFriendlyLength: settings.wordingFriendlyLength ?? 160,
        feedId: createUlid(),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    },
    async update(settings) {
      const existing = await readRequired();
      const template = settings.template ?? existing.template;
      if (template === "regions" && !await repository.hasVisibleRegion()) throw new UnavailablePageTemplateError("Regions map is unavailable because no visible component has a region. Add a region to a public component or choose another template.");
      if (!mailIdentityEditable && (settings.emailBranding?.displayName || settings.emailBranding?.replyTo)) throw new UnsupportedMailIdentityError("Managed mail controls From and Reply-To. Clear those fields; subject, logo and message wording remain editable.");
      await repository.update({
        pageName: settings.pageName,
        tagline: settings.tagline,
        accentColor: settings.accentColor,
        timezone: settings.timezone,
        hostname: settings.hostname,
        footerCreditEnabled: settings.footerCreditEnabled,
        template,
        widgetAllowedOrigins: JSON.stringify(settings.widgetAllowedOrigins ?? parseWidgetAllowedOrigins(existing.widgetAllowedOrigins)),
        mailFromAddress: settings.mailFromAddress ?? existing.mailFromAddress,
        emailBranding: settings.emailBranding ? JSON.stringify(settings.emailBranding) : existing.emailBranding,
        aiToneInstructions: settings.aiToneInstructions ?? existing.aiToneInstructions,
        wordingBlockedTerms: settings.wordingBlockedTerms ? JSON.stringify(settings.wordingBlockedTerms) : existing.wordingBlockedTerms,
        wordingFriendlyLength: settings.wordingFriendlyLength ?? existing.wordingFriendlyLength,
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
