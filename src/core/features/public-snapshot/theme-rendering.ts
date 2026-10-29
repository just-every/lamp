import type { PageTheme } from "../../shared/page-theme";
import { cardColour, THEME_CARDS, type ThemePalette } from "../../shared/theme-card-contrast";
import type { BlobStore } from "../../platform/blobs/store";
import type { ThemeAssets } from "../page-settings/theme-assets";
import { scopedThemeCss } from "../page-settings/theme-safety";
import type { SnapshotArtifact } from "./renderer";
import { escapeHtml } from "./format";

export function themeChrome(theme: PageTheme, position: "header" | "footer") {
  const links = position === "header" ? theme.headerLinks : theme.footerLinks;
  const html = position === "header" ? theme.headerHtml : theme.footerHtml;
  const image = position === "header" && theme.headerImage ? '<img class="theme-header-image" src="/assets/theme-header" alt="">' : "";
  if (!image && !html && !links.length) return "";
  return `<div class="theme-${position}">${image}${html}${links.length ? `<nav aria-label="${position === "header" ? "Header" : "Footer"} links">${links.map(link => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join(" ")}</nav>` : ""}</div>`;
}

export function themeStyles(theme: PageTheme, origin: string) {
  const colors = theme.paletteEnabled && theme.palette ? paletteStyles(theme.palette) : "";
  const families = { default: "", system: "system-ui,sans-serif", serif: "Georgia,serif", mono: 'ui-monospace,"Courier New",monospace', uploaded: '"Owner Font",sans-serif' };
  const font = theme.font === "uploaded" ? '@font-face{font-family:"Owner Font";src:url("/assets/theme-font") format("woff2");font-display:swap}' : "";
  const face = families[theme.font] ? `body.lamp-public{--public-font:${families[theme.font]}}` : "";
  return `${colors}${font}${face}body.lamp-public .theme-header-image{display:block;max-width:100%;max-height:320px;object-fit:contain;margin:16px auto}body.lamp-public .theme-header,body.lamp-public .theme-footer{overflow-wrap:anywhere;font-size:15px}body.lamp-public .theme-header nav,body.lamp-public .theme-footer nav{display:flex;flex-wrap:wrap;gap:16px;padding-block:12px}body.lamp-public .theme-header img,body.lamp-public .theme-footer img{max-width:100%}body.lamp-public .component-group>summary,body.lamp-public .theme-component-group>summary{padding:12px 0;color:var(--ink-2);font-size:14px;font-weight:600;cursor:pointer}${scopedThemeCss(theme.customCss, origin)}`;
}

function paletteStyles(palette: ThemePalette) {
  const tokens: Record<keyof ThemePalette, readonly string[]> = {
    background: ["paper"],
    surface: ["card", "card-tint", "stage", "frame", "chip", "on-ink", "amber-wash", "accent-ink"],
    text: ["ink", "ink-2", "ink-3", "quiet"],
    link: ["theme-link", "accent"],
    operational: ["ok", "ok-mark", "ok-ink", "cell-ok"],
    degraded: ["degraded", "amber", "amber-ink"],
    partial: ["cell-partial"],
    major: ["down"],
    maintenance: ["maint"],
  };
  const variables = Object.entries(tokens).flatMap(([colour, names]) => names.map(name => `--${name}:${palette[colour as keyof ThemePalette]};`)).join("");
  const cards = THEME_CARDS.filter(card => card.audience === "public").flatMap(card => card.pairs.map(pair => {
    const selectors = pair.selectors.map(selector => selector === "&" ? "body.lamp-public" : `body.lamp-public ${selector}`).join(",");
    return `${selectors}{color:${cardColour(pair.foreground, palette)};${pair.fill ? `background:${cardColour(pair.background, palette)};` : ""}}`;
  })).join("");
  // Keep the existing sheets byte-for-byte when the palette is disabled. The
  // enabled palette also raises their small captions to the product's type floor.
  const smallText = [".eyebrow", ".timeline-group > h3", ".subscriber-kicker", ".tpl-kicker", ".tpl-credit", ".tpl-foot-meta", ".tpl-foot .footer-resources", ".calm-group", ".calm-caption", ".hm-legend", ".hm-name", ".hm-state", ".hm-pct", ".hm-axis", ".hm-method", ".hm-callout a", ".up-group-title", ".up-components h2", ".tl-kicker", ".rg-card-state", ".rg-elsewhere", ".rg-key-item b", ".rg-pin b", ".rg-thead", ".rg-everywhere", ".tpl-regions .tpl-meta", ".tpl-regions .maintenance-window", ".tpl-regions .tpl-detail", ".tpl-regions .tl-next", ".tpl-regions .tl-earlier .tpl-said", ".tpl-regions .tl-more", ".rg-past .tpl-quiet", ".rg-uptime-caption"];
  return `body.lamp-public,body.lamp-public .tpl{${variables}--line:color-mix(in srgb,var(--ink) 18%,transparent);--line-strong:color-mix(in srgb,var(--ink) 30%,transparent);--no-data:color-mix(in srgb,var(--ink) 18%,var(--card));}${cards}body.lamp-public .state-partially-unavailable::before{background:${palette.partial}}body.lamp-public .rg-pin b{color:${palette.surface}}body.lamp-public .pin-icon circle{fill:${palette.surface}}body.lamp-public .rg-map .pin-icon path{stroke:${palette.surface}}body.lamp-public :is(${smallText.join(",")}){font-size:13px}body.lamp-public .rg-card .rg-card-state{font-size:13px;line-height:16px}body.lamp-public .rg-key-item b{width:26px;height:26px}body.lamp-public .rg-pin b{line-height:14px}body.lamp-public input::placeholder{opacity:1}body.lamp-public :is(.subscribe button,.subscriber-document button,.tpl-subscribe button,.status-utilities .subscribe-link):hover{filter:none}@container rg-map (width < 620px){body.lamp-public .rg-card{height:44px}body.lamp-public .rg-card strong{font-size:13px;line-height:16px}}`;
}

export async function themeAssetArtifacts(stored: string | undefined, blobs: BlobStore): Promise<SnapshotArtifact[]> {
  const assets = JSON.parse(stored ?? "{}") as ThemeAssets;
  const artifacts: SnapshotArtifact[] = [];
  for (const kind of ["font", "header"] as const) {
    const asset = assets[kind];
    if (!asset) continue;
    const object = await blobs.getBytes(asset.key);
    if (!object) throw new Error(`The uploaded theme ${kind} is missing.`);
    const data = new Uint8Array(object.bytes);
    let binary = "";
    for (let offset = 0; offset < data.length; offset += 0x8000) binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
    artifacts.push({ key: `assets/theme-${kind}`, body: btoa(binary), contentType: asset.contentType, encoding: "base64" });
  }
  return artifacts;
}
