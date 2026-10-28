import themeStyles from "./styles/theme.css?raw";
import type { PageTheme } from "../../shared/page-theme";
import { scopeOwnerCss } from "../page-settings/theme-css";
import { escapeHtml } from "./format";

/** Stable identity for refreshing a stylesheet and its matching static markup together. */
export function themeRevision(theme: PageTheme | null) {
  if (!theme) return null;
  let hash = 0x811c9dc5;
  for (const character of JSON.stringify(theme)) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
  return (hash >>> 0).toString(36);
}

/** Saved markup has already passed the owner-save sanitizer; it travels in the static document. */
export function themeHeader(theme: PageTheme | null) {
  if (!theme) return "";
  const image = theme.headerImage ? `<div class="theme-header-image"><img src="${escapeHtml(theme.headerImage)}" alt=""></div>` : "";
  const links = themeLinks(theme.headerLinks, "header");
  const html = theme.headerHtml ? `<div class="theme-header-html">${theme.headerHtml}</div>` : "";
  return `${image}${links}${html}`;
}

export function themeFooter(theme: PageTheme | null) {
  if (!theme) return "";
  return `${theme.footerHtml ? `<div class="theme-footer-html">${theme.footerHtml}</div>` : ""}${themeLinks(theme.footerLinks, "footer")}`;
}

function themeLinks(links: PageTheme["headerLinks"], position: "header" | "footer") {
  return links.length ? `<nav class="theme-${position}-links" aria-label="Custom ${position} links">${links.map(link => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join("")}</nav>` : "";
}

/** Native disclosure is useful with script disabled too. The original wrapper stays byte-identical without a theme. */
export function themeGroup(theme: PageTheme | null, heading: string, body: string, original: string) {
  return theme ? `<details class="theme-component-group"${theme.groupsExpanded ? " open" : ""}><summary><h3>${escapeHtml(heading)}</h3></summary>${body}</details>` : original;
}

/** Every generated rule is limited to a themed public document. Owner CSS is parsed and scoped separately. */
export function publicThemeStyles(theme: PageTheme | null, origin?: string) {
  if (!theme) return "";
  const { background, surface, text, link, states } = theme.palette;
  const font = theme.font === "uploaded"
    ? '"Lamp Owner", "Inter", Arial, sans-serif'
    : '"Inter", "Inter Fallback", Arial, system-ui, sans-serif';
  const face = theme.font === "uploaded" && theme.fontAsset ? `@font-face{font-family:"Lamp Owner";font-style:normal;font-weight:100 900;font-display:swap;src:url("${theme.fontAsset}") format("woff2")}` : "";
  const scope = "body[data-lamp-theme]";
  const tokens = {
    "paper": background, "card": surface, "card-tint": surface, "chip": surface, "stage": surface,
    "ink": text, "ink-2": text, "ink-3": text, "on-ink": background,
    "ok": states.Operational, "ok-mark": states.Operational, "down": states["Major outage"],
    "degraded": states["Degraded performance"], "amber": states["Degraded performance"], "amber-ink": states["Degraded performance"],
    "partial": states["Partially unavailable"], "maint": states["Under maintenance"],
    "public-font": font, "theme-link": link, "theme-history-days": String(theme.historyDays),
  };
  const declarations = Object.entries(tokens).map(([name, value]) => `--${name}:${value}`).join(";");
  const templateTokens = `--frame:${surface};--ok-ink:${states.Operational};--cell-ok:${states.Operational};--cell-partial:${states["Partially unavailable"]}`;
  return `${face}${scope}{${declarations}}${scope} .tpl{${templateTokens}}${themeStyles}${scopeOwnerCss(theme.css, origin)}`;
}
