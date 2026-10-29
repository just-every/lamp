import type { PageSettingsInput } from "../../../shared/schemas";
import type { PageSettingsView } from "../service";

export type SettingsForm = Omit<Required<PageSettingsInput>, "emailBranding" | "theme"> & {
  emailBranding: PageSettingsView["emailBranding"];
  theme: PageSettingsView["theme"];
};
export type ConfirmedField = "mailFromAddress" | "widgetAllowedOrigins";

export function toSettingsForm(settings: PageSettingsView): SettingsForm {
  return {
    pageName: settings.pageName, template: settings.template, tagline: settings.tagline,
    accentColor: settings.accentColor, timezone: settings.timezone, hostname: settings.hostname,
    footerCreditEnabled: settings.footerCreditEnabled, widgetAllowedOrigins: settings.widgetAllowedOrigins,
    widgetAppearance: settings.widgetAppearance, mailFromAddress: settings.mailFromAddress, emailBranding: settings.emailBranding,
    aiToneInstructions: settings.aiToneInstructions, wordingBlockedTerms: settings.wordingBlockedTerms,
    wordingFriendlyLength: settings.wordingFriendlyLength,
    theme: settings.theme,
  };
}
