import { COMPONENT_STATES } from "../../shared/domain";
import { pageThemeSchema, type PageTheme, type ThemeAsset } from "../../shared/page-theme";
import { InvalidThemeError } from "./theme-assets";
import { normalizeOwnerCss, ownerCssAssetPaths } from "./theme-css";
import { pageLinkAllowed, portablePageLink, sanitizeThemeHtml, themeHtmlAssetPaths } from "./theme-html";

function luminance(hex: string) {
  const channels = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

export function contrastRatio(first: string, second: string) {
  const left = luminance(first), right = luminance(second);
  return (Math.max(left, right) + .05) / (Math.min(left, right) + .05);
}

export function referencedThemeAssetPaths(theme: PageTheme | null, origin?: string) {
  if (!theme) return new Set<string>();
  const paths = new Set([...ownerCssAssetPaths(theme.css, origin), ...themeHtmlAssetPaths(theme.headerHtml), ...themeHtmlAssetPaths(theme.footerHtml)]);
  if (theme.headerImage) paths.add(theme.headerImage);
  if (theme.font === "uploaded" && theme.fontAsset) paths.add(theme.fontAsset);
  return paths;
}

export function validatePageTheme(input: PageTheme | null, assets: ThemeAsset[], origin?: string): { theme: PageTheme | null; removals: string[] } {
  if (input === null) return { theme: null, removals: [] };
  const parsed = pageThemeSchema.safeParse(input);
  if (!parsed.success) throw new InvalidThemeError(`Invalid theme: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  const theme = parsed.data;
  // Every configured foreground is rendered on both the page and its surfaces, so both pairs must pass WCAG AA.
  const foregrounds = [["text", theme.palette.text], ["link", theme.palette.link], ...COMPONENT_STATES.map(state => [state, theme.palette.states[state]])];
  for (const [name, colour] of foregrounds) for (const background of ["background", "surface"] as const) {
    const ratio = contrastRatio(colour, theme.palette[background]);
    if (ratio < 4.5) throw new InvalidThemeError(`Theme contrast ${name} against ${background} is ${ratio.toFixed(2)}:1; at least 4.5:1 is required.`);
  }
  for (const link of [...theme.headerLinks, ...theme.footerLinks]) if (!pageLinkAllowed(link.href, origin)) throw new InvalidThemeError(`Theme link must use https or the page's own path: ${link.href}`);
  function requireAsset(path: string | null, kind: ThemeAsset["kind"]) {
    if (path && !assets.some(asset => asset.path === path && asset.kind === kind)) throw new InvalidThemeError(`Theme ${kind} must be uploaded to this page's own origin.`);
  }
  if (theme.font === "uploaded" && !theme.fontAsset) throw new InvalidThemeError("Choose an uploaded WOFF2 font.");
  requireAsset(theme.fontAsset, "font"); requireAsset(theme.headerImage, "image");
  const css = normalizeOwnerCss(theme.css, origin);
  const header = sanitizeThemeHtml(theme.headerHtml, "headerHtml", assets, origin);
  const footer = sanitizeThemeHtml(theme.footerHtml, "footerHtml", assets, origin);
  for (const [name, html] of [["Header", header.html], ["Footer", footer.html]]) if (new TextEncoder().encode(html).byteLength > 8192) throw new InvalidThemeError(`${name} HTML must be at most 8KB after sanitization.`);
  return { theme: { ...theme, css, headerLinks: theme.headerLinks.map(link => ({ ...link, href: portablePageLink(link.href, origin) })), footerLinks: theme.footerLinks.map(link => ({ ...link, href: portablePageLink(link.href, origin) })), headerHtml: header.html, footerHtml: footer.html }, removals: [...header.removals, ...footer.removals] };
}
