import { themeSchema, ThemeValidationError, type PageTheme } from "../../shared/page-theme";
import { sanitizeThemeHtml, validThemeHref } from "./theme-html";
import { validateThemeCss } from "./theme-css";
import { cardColour, contrastRatio, THEME_CARDS } from "../../shared/theme-card-contrast";

export { ThemeValidationError } from "../../shared/page-theme";
export { scopedThemeCss } from "./theme-css";

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
  if (theme.paletteEnabled && theme.palette) {
    for (const card of THEME_CARDS) {
      for (const pair of card.pairs) {
        const contrast = contrastRatio(cardColour(pair.foreground, theme.palette), cardColour(pair.background, theme.palette));
        if (contrast < 4.5) {
          throw new ThemeValidationError(`${card.name}: Palette ${pair.foreground} against ${pair.background} contrast`, `WCAG AA needs at least 4.5:1; this pair is ${contrast.toFixed(2)}:1.`);
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
