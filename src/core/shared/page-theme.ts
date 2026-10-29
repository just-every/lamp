import { z } from "zod";

const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Theme colours must use #RRGGBB.");
const link = z.object({ label: z.string(), href: z.string() }).strict();

export const themeSchema = z.object({
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
  }).strict().nullable().default(null),
  font: z.enum(["default", "system", "serif", "mono", "uploaded"]).default("default"),
  headerImage: z.boolean().default(false),
  headerLinks: z.array(link).default([]),
  footerLinks: z.array(link).default([]),
  headerHtml: z.string().default(""),
  footerHtml: z.string().default(""),
  groupsCollapsed: z.boolean().default(false),
  hiddenUptimeComponentIds: z.array(z.string()).default([]),
  historyDays: z.number().int().min(1).max(90).default(90),
  customCss: z.string().max(16_000).default(""),
}).strict();

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
