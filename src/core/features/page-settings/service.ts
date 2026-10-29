import { themeSchema, type PageTheme } from "../../shared/page-theme";
import { ThemeValidationError, validatePageTheme } from "./theme-safety";
import { createThemeAssetsService, type ThemeAssetKind } from "./theme-assets";
import { createUlid, nowIso } from "../../shared/ids";
import type { PageSettingsInput } from "../../shared/schemas";
import { parseWidgetAllowedOrigins } from "../../shared/widget-origins";
import { defaultWidgetAppearance, widgetAppearanceSchema, type WidgetAppearance } from "../../shared/widget-appearance";
import { MIN_MAP_REGIONS, regionCount } from "../../shared/regions";
import type { BlobStore } from "../../platform/blobs/store";

import type { PageSettingsRepository, StoredPageSettings } from "./repository";

import { emailBrandingSchema, type EmailBranding } from "../../shared/email-branding";

export class UnsupportedMailIdentityError extends Error {}
export class UnavailablePageTemplateError extends Error {}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type PageSettingsView = Omit<StoredPageSettings, "theme" | "widgetAllowedOrigins" | "widgetAppearance" | "wordingBlockedTerms" | "emailBranding"> & {
  theme: PageTheme;
  themeRemovals?: string[];
  themeAssetAvailability: { font: boolean; header: boolean };
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
  update(settings: PageSettingsInput): Promise<PageSettingsView | null>;
  uploadLogo(input: { bytes: ArrayBuffer; contentType: string }, operatorId: string): Promise<PageSettingsView | null>;
  uploadThemeAsset(kind: ThemeAssetKind, input: { bytes: ArrayBuffer; contentType: string }): Promise<PageSettingsView | null>;
  removeThemeAsset(kind: ThemeAssetKind): Promise<PageSettingsView | null>;
  removeLogo(operatorId: string): Promise<PageSettingsView | null>;
}

function toView(settings: StoredPageSettings, mailIdentityEditable: boolean, regionsAvailable: boolean): PageSettingsView {
  const wordingBlockedTerms: unknown = JSON.parse(settings.wordingBlockedTerms);
  if (!Array.isArray(wordingBlockedTerms) || wordingBlockedTerms.some(term => typeof term !== "string")) throw new Error("Wording check terms are invalid.");
  return { ...settings, themeAssetAvailability: { font: Boolean(JSON.parse(settings.themeAssets).font), header: Boolean(JSON.parse(settings.themeAssets).header) }, theme: themeSchema.parse(JSON.parse(settings.theme)), emailBranding: emailBrandingSchema.parse(JSON.parse(settings.emailBranding)), widgetAppearance: widgetAppearanceSchema.parse(JSON.parse(settings.widgetAppearance)), mailIdentityEditable, regionsAvailable, wordingBlockedTerms, widgetAllowedOrigins: parseWidgetAllowedOrigins(settings.widgetAllowedOrigins) };
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

  const themeAssets = createThemeAssetsService(repository, blobs, rebuildAndRead);
  return {
    uploadThemeAsset: themeAssets.upload,
    removeThemeAsset: themeAssets.remove,
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
        theme: JSON.stringify(validatePageTheme(settings.theme ?? {}, { origin: `https://${settings.hostname}`, imagePaths: [] }).theme),
        template: settings.template ?? "default",
        emailBranding: JSON.stringify(settings.emailBranding ?? {}),
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
      const assets = JSON.parse(existing.themeAssets) as { header?: unknown; font?: unknown };
      const checkedTheme = settings.theme ? validatePageTheme(settings.theme, {
        origin: `https://${settings.hostname}`,
        imagePaths: [...(assets.header ? ["/assets/theme-header"] : []), ...(existing.logoKey ? ["/assets/logo"] : [])],
      }) : null;
      if (checkedTheme?.theme.headerImage && !assets.header) throw new ThemeValidationError("Header image", "Upload a header image before showing it.");
      if (checkedTheme?.theme.font === "uploaded" && !assets.font) throw new ThemeValidationError("Font", "Upload a WOFF2 font before selecting it.");
      const template = settings.template ?? existing.template;
      // Choosing Regions map needs two regions. A page that already chose it keeps that choice while regions change;
      // the public page then shows Calm headline and Settings says why.
      if (template === "regions" && existing.template !== "regions" && !await regionsAvailable()) throw new UnavailablePageTemplateError("Regions map needs public components in at least two regions. Add regions in the component editor, or choose another template.");
      if (!mailIdentityEditable && (settings.emailBranding?.displayName || settings.emailBranding?.replyTo)) throw new UnsupportedMailIdentityError("Managed mail controls From and Reply-To. Clear those fields; subject, logo and message wording remain editable.");
      await repository.update({
        theme: checkedTheme ? JSON.stringify(checkedTheme.theme) : existing.theme,
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
        aiToneInstructions: settings.aiToneInstructions ?? existing.aiToneInstructions,
        wordingBlockedTerms: settings.wordingBlockedTerms ? JSON.stringify(settings.wordingBlockedTerms) : existing.wordingBlockedTerms,
        wordingFriendlyLength: settings.wordingFriendlyLength ?? existing.wordingFriendlyLength,
        updatedAt: nowIso(),
      });
      const view = await rebuildAndRead();
      return view && checkedTheme ? { ...view, themeRemovals: checkedTheme.removals } : view;
    },
    async uploadLogo(input, operatorId) {
      if (!blobs) throw new Error("Logo storage is not configured.");
      if (!LOGO_CONTENT_TYPES.has(input.contentType)) throw new Error("Logo must be a PNG, JPEG, or WebP image.");
      if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_LOGO_BYTES) throw new Error("Logo must be between 1 byte and 2 MB.");
      await readRequired();
      const key = `branding/logos/${createUlid()}`;
      await blobs.putBytes(key, input.bytes, input.contentType);
      await repository.updateLogo({ logoKey: key, logoContentType: input.contentType, updatedAt: nowIso() }, operatorId);
      return rebuildAndRead();
    },
    async removeLogo(operatorId) {
      await readRequired();
      await repository.updateLogo({ logoKey: null, logoContentType: null, updatedAt: nowIso() }, operatorId);
      return rebuildAndRead();
    },
  };
}
