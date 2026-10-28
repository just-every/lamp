import { z } from "zod";
import { COMPONENT_STATES } from "./domain";

const colour = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex colour.");
const link = z.object({ label: z.string().trim().min(1), href: z.string().trim().min(1) }).strict();
export const themeAssetPathSchema = z.string().regex(/^\/assets\/theme\/[0-9A-HJKMNP-TV-Z]{26}\.(?:woff2|png|jpg|webp)$/);
export const themeAssetsSchema = z.array(z.object({
  path: themeAssetPathSchema,
  key: z.string().regex(/^branding\/theme\/[0-9A-HJKMNP-TV-Z]{26}\.(?:woff2|png|jpg|webp)$/),
  contentType: z.string(),
  kind: z.enum(["font", "image"]),
}).strict());
export type ThemeAsset = z.infer<typeof themeAssetsSchema>[number];

export const pageThemeSchema = z.object({
  enabled: z.boolean().optional(),
  palette: z.object({
    background: colour, surface: colour, text: colour, link: colour,
    states: z.object(Object.fromEntries(COMPONENT_STATES.map(state => [state, colour])) as Record<typeof COMPONENT_STATES[number], typeof colour>).strict(),
  }).strict(),
  font: z.enum(["inter", "uploaded"]),
  fontAsset: themeAssetPathSchema.nullable(),
  headerImage: themeAssetPathSchema.nullable(),
  headerLinks: z.array(link), footerLinks: z.array(link),
  headerHtml: z.string().refine(value => new TextEncoder().encode(value).byteLength <= 8192, "Header HTML must be at most 8KB."),
  footerHtml: z.string().refine(value => new TextEncoder().encode(value).byteLength <= 8192, "Footer HTML must be at most 8KB."),
  groupsExpanded: z.boolean(),
  hiddenUptimeComponents: z.array(z.string()),
  historyDays: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  css: z.string(),
}).strict();
export type PageTheme = z.infer<typeof pageThemeSchema>;

/** A new custom theme starts with readable pairs; an unset theme uses Lamp's retained default stylesheet. */
export const defaultPageTheme: PageTheme = {
  palette: {
    background: "#f8f6f0", surface: "#ffffff", text: "#182d24", link: "#182d24",
    states: { Operational: "#176641", "Degraded performance": "#865800", "Partially unavailable": "#865800", "Major outage": "#a43727", "Under maintenance": "#3f5d93" },
  },
  font: "inter", fontAsset: null, headerImage: null,
  headerLinks: [], footerLinks: [], headerHtml: "", footerHtml: "",
  groupsExpanded: true, hiddenUptimeComponents: [], historyDays: 90, css: "",
};
