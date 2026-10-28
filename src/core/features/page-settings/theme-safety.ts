import { themeSchema, ThemeValidationError, type PageTheme } from "../../shared/page-theme";
import { sanitizeThemeHtml, validThemeHref } from "./theme-html";
import { validateThemeCss } from "./theme-css";

export { ThemeValidationError } from "../../shared/page-theme";
export { scopedThemeCss } from "./theme-css";

function luminance(hex: string) {
  const channels = [1, 3, 5].map(offset => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function validatePageTheme(input: unknown, options: { origin: string; imagePaths: string[] }): {
  theme: PageTheme;
  removals: string[];
} {
  const parsed = themeSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ThemeValidationError(`Theme ${issue.path.join(".") || "schema"}`, issue.message);
  }
  const theme = parsed.data;
  if (theme.palette) {
    for (const foreground of ["text", "link", "operational", "degraded", "partial", "major", "maintenance"] as const) {
      for (const background of ["background", "surface"] as const) {
        const a = luminance(theme.palette[foreground]);
        const b = luminance(theme.palette[background]);
        const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (contrast < 4.5) {
          throw new ThemeValidationError(`Palette ${foreground} against ${background} contrast`, `WCAG AA needs at least 4.5:1; this pair is ${contrast.toFixed(2)}:1.`);
        }
      }
    }
  }
  for (const field of ["headerLinks", "footerLinks"] as const) {
    theme[field].forEach((link, index) => {
      if (!validThemeHref(link.href, options.origin)) {
        throw new ThemeValidationError(`${field}[${index}].href`, "Links must use HTTPS or a path on the page's own origin.");
      }
    });
  }
  validateThemeCss(theme.customCss, options.origin);
  const header = sanitizeThemeHtml(theme.headerHtml, "headerHtml", options);
  const footer = sanitizeThemeHtml(theme.footerHtml, "footerHtml", options);
  return {
    theme: { ...theme, headerHtml: header.html, footerHtml: footer.html },
    removals: [...header.removals, ...footer.removals],
  };
}
