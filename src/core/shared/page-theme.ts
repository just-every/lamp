import { z } from "zod";

const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Theme colours must use #RRGGBB.");
const link = z.object({ label: z.string(), href: z.string() }).strict();

export const themeInputSchema = z.object({
  palette: z.object({
    background: colour,
    surface: colour,
    text: colour,
    link: colour,
    operational: colour,
    degraded: colour,
    partial: colour,
    major: colour,
    maintenance: colour,
  }).strict().nullable(),
  paletteEnabled: z.boolean(),
  font: z.enum(["default", "system", "serif", "mono", "uploaded"]),
  headerImage: z.boolean(),
  headerLinks: z.array(link),
  footerLinks: z.array(link),
  headerHtml: z.string(),
  footerHtml: z.string(),
  groupsCollapsed: z.boolean(),
  hiddenUptimeComponentIds: z.array(z.string()),
  historyDays: z.number().int().min(1).max(90),
  customCss: z.string().max(16_000),
}).strict().partial();

// Keep missing update fields absent until they can be merged with saved settings.
// Stored themes from before paletteEnabled infer it from their palette.
export const themeSchema = themeInputSchema.transform(({
  palette = null, paletteEnabled = palette !== null, font = "default", headerImage = false,
  headerLinks = [], footerLinks = [], headerHtml = "", footerHtml = "", groupsCollapsed = false,
  hiddenUptimeComponentIds = [], historyDays = 90, customCss = "",
}) => ({
  palette, paletteEnabled, font, headerImage, headerLinks, footerLinks, headerHtml, footerHtml,
  groupsCollapsed, hiddenUptimeComponentIds, historyDays, customCss,
}));

export type PageTheme = z.infer<typeof themeSchema>;
export const defaultPageTheme = themeSchema.parse({});

export class ThemeValidationError extends Error {
  readonly rule: string;

  constructor(rule: string, detail: string) {
    super(`${rule}: ${detail}`);
    this.name = "ThemeValidationError";
    this.rule = rule;
  }
}
