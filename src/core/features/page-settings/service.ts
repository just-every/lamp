import { createUlid, nowIso } from "../../shared/ids";
import type { PageSettingsInput } from "../../shared/schemas";
import { parseWidgetAllowedOrigins } from "../../shared/widget-origins";
import { defaultWidgetAppearance, widgetAppearanceSchema, type WidgetAppearance } from "../../shared/widget-appearance";
import { MIN_MAP_REGIONS, regionCount } from "../../shared/regions";
import type { BlobStore } from "../../platform/blobs/store";
import { pageThemeSchema, themeAssetsSchema, type PageTheme, type ThemeAsset } from "../../shared/page-theme";
import { validatePageTheme } from "./theme-validation";
import { validateThemeAsset } from "./theme-assets";

import type { PageSettingsRepository, StoredPageSettings } from "./repository";

import { emailBrandingSchema, type EmailBranding } from "../../shared/email-branding";

export class UnsupportedMailIdentityError extends Error {}
export class UnavailablePageTemplateError extends Error {}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type PageSettingsView = Omit<StoredPageSettings, "widgetAllowedOrigins" | "widgetAppearance" | "wordingBlockedTerms" | "emailBranding" | "theme" | "themeAssets"> & {
  theme: PageTheme | null;
  emailBranding: EmailBranding;
  mailIdentityEditable: boolean;
  widgetAllowedOrigins: string[];
  widgetAppearance: WidgetAppearance;
  wordingBlockedTerms: string[];
  regionsAvailable: boolean;
};

export interface PageSettingsService {
  get(): Promise<PageSettingsView | null>;
  ensureInitial(settings: PageSettingsInput): Promise<void>;
  update(settings: PageSettingsInput): Promise<{ settings: PageSettingsView | null; removals: string[] }>;
  uploadThemeAsset(input: { bytes: ArrayBuffer; contentType: string; kind: ThemeAsset["kind"] }): Promise<ThemeAsset>;
  uploadLogo(input: { bytes: ArrayBuffer; contentType: string }): Promise<PageSettingsView | null>;
  removeLogo(): Promise<PageSettingsView | null>;
}

function toView(settings: StoredPageSettings, mailIdentityEditable: boolean, regionsAvailable: boolean): PageSettingsView {
  const wordingBlockedTerms: unknown = JSON.parse(settings.wordingBlockedTerms);
  if (!Array.isArray(wordingBlockedTerms) || wordingBlockedTerms.some(term => typeof term !== "string")) throw new Error("Wording check terms are invalid.");
  const rawTheme: unknown = JSON.parse(settings.theme);
  const { themeAssets: _privateAssets, ...view } = settings;
  return { ...view, theme: rawTheme === null ? null : pageThemeSchema.parse(rawTheme), emailBranding: emailBrandingSchema.parse(JSON.parse(settings.emailBranding)), widgetAppearance: widgetAppearanceSchema.parse(JSON.parse(settings.widgetAppearance)), mailIdentityEditable, regionsAvailable, wordingBlockedTerms, widgetAllowedOrigins: parseWidgetAllowedOrigins(settings.widgetAllowedOrigins) };
}

export function createPageSettingsService(
  repository: PageSettingsRepository,
  onPublicDataChanged: () => Promise<void>,
  blobs?: BlobStore,
  initialMailFromAddress?: string,
  mailIdentityEditable = true,
  publicOrigin?: string,
): PageSettingsService {
  async function readRequired() {
    const settings = await repository.get();
    if (!settings) throw new Error("Page settings are not configured.");
    return settings;
  }

  async function regionsAvailable() {
    return regionCount(await repository.visibleRegions()) >= MIN_MAP_REGIONS;
  }

  async function rebuildAndRead() {
    await onPublicDataChanged();
    return readView();
  }

  async function readView() {
    const [settings, available] = await Promise.all([repository.get(), regionsAvailable()]);
    return settings ? toView(settings, mailIdentityEditable, available) : null;
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
        theme: JSON.stringify(validatePageTheme(settings.theme ?? null, [], publicOrigin).theme),
        themeAssets: "[]",
        widgetAllowedOrigins: JSON.stringify(settings.widgetAllowedOrigins ?? []),
        widgetAppearance: JSON.stringify(settings.widgetAppearance ?? defaultWidgetAppearance),
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
      // Choosing Regions map needs two regions. A page that already chose it keeps that choice while regions change;
      // the public page then shows Calm headline and Settings says why.
      if (template === "regions" && existing.template !== "regions" && !await regionsAvailable()) throw new UnavailablePageTemplateError("Regions map needs public components in at least two regions. Add regions in the component editor, or choose another template.");
      if (!mailIdentityEditable && (settings.emailBranding?.displayName || settings.emailBranding?.replyTo)) throw new UnsupportedMailIdentityError("Managed mail controls From and Reply-To. Clear those fields; subject, logo and message wording remain editable.");
      const validated = validatePageTheme(settings.theme === undefined ? JSON.parse(existing.theme) : settings.theme, themeAssetsSchema.parse(JSON.parse(existing.themeAssets)), publicOrigin);
      await repository.update({
        pageName: settings.pageName,
        tagline: settings.tagline,
        accentColor: settings.accentColor,
        timezone: settings.timezone,
        hostname: settings.hostname,
        footerCreditEnabled: settings.footerCreditEnabled,
        template,
        widgetAllowedOrigins: JSON.stringify(settings.widgetAllowedOrigins ?? parseWidgetAllowedOrigins(existing.widgetAllowedOrigins)),
        widgetAppearance: settings.widgetAppearance ? JSON.stringify(settings.widgetAppearance) : existing.widgetAppearance,
        mailFromAddress: settings.mailFromAddress ?? existing.mailFromAddress,
        emailBranding: settings.emailBranding ? JSON.stringify(settings.emailBranding) : existing.emailBranding,
        theme: JSON.stringify(validated.theme),
        aiToneInstructions: settings.aiToneInstructions ?? existing.aiToneInstructions,
        wordingBlockedTerms: settings.wordingBlockedTerms ? JSON.stringify(settings.wordingBlockedTerms) : existing.wordingBlockedTerms,
        wordingFriendlyLength: settings.wordingFriendlyLength ?? existing.wordingFriendlyLength,
        updatedAt: nowIso(),
      });
      return { settings: await rebuildAndRead(), removals: validated.removals };
    },
    async uploadThemeAsset(input) {
      if (!blobs) throw new Error("Theme asset storage is not configured.");
      await readRequired();
      const file = validateThemeAsset(input.bytes, input.contentType, input.kind);
      const id = createUlid();
      const asset: ThemeAsset = { path: `/assets/theme/${id}.${file.extension}`, key: `branding/theme/${id}.${file.extension}`, contentType: file.contentType, kind: input.kind };
      await blobs.putBytes(asset.key, input.bytes, asset.contentType);
      try { await repository.addThemeAsset(asset, nowIso()); }
      catch (cause) { await blobs.delete(asset.key); throw cause; }
      return asset;
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
