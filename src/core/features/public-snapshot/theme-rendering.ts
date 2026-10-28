import type { PageTheme } from "../../shared/page-theme";
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
  const palette = theme.palette;
  const colors = palette ? `body.lamp-public,body.lamp-public .tpl{--paper:${palette.background};--card:${palette.surface};--card-tint:${palette.surface};--stage:${palette.surface};--frame:${palette.surface};--chip:${palette.surface};--ink:${palette.text};--ink-2:${palette.text};--ink-3:${palette.text};--on-ink:${palette.surface};--theme-link:${palette.link};--ok:${palette.operational};--ok-mark:${palette.operational};--ok-ink:${palette.operational};--cell-ok:${palette.operational};--degraded:${palette.degraded};--amber:${palette.degraded};--amber-ink:${palette.degraded};--cell-partial:${palette.partial};--down:${palette.major};--maint:${palette.maintenance}}body.lamp-public{background:${palette.background}}body.lamp-public a{color:var(--theme-link)}body.lamp-public .status-banner #status-live{background:var(--card)}body.lamp-public .up-band{background:var(--card);color:var(--ink)}body.lamp-public .up-band a{color:var(--theme-link)}body.lamp-public .up-band .tpl-tagline{color:var(--ink-2)}body.lamp-public .up-band .up-band-subscribe{background:var(--ink);color:var(--on-ink)}body.lamp-public .state-partially-unavailable::before{background:${palette.partial}}body.lamp-public .tone-partial{color:${palette.partial}}body.lamp-public .tone-degraded{color:${palette.degraded}}` : "";
  const families = { default: "", system: "system-ui,sans-serif", serif: "Georgia,serif", mono: 'ui-monospace,"Courier New",monospace', uploaded: '"Owner Font",sans-serif' };
  const font = theme.font === "uploaded" ? '@font-face{font-family:"Owner Font";src:url("/assets/theme-font") format("woff2");font-display:swap}' : "";
  const face = families[theme.font] ? `body.lamp-public{--public-font:${families[theme.font]}}` : "";
  return `${colors}${font}${face}body.lamp-public .theme-header-image{display:block;max-width:100%;max-height:320px;object-fit:contain;margin:16px auto}body.lamp-public .theme-header,body.lamp-public .theme-footer{overflow-wrap:anywhere;font-size:15px}body.lamp-public .theme-header nav,body.lamp-public .theme-footer nav{display:flex;flex-wrap:wrap;gap:16px;padding-block:12px}body.lamp-public .theme-header img,body.lamp-public .theme-footer img{max-width:100%}body.lamp-public .component-group>summary,body.lamp-public .theme-component-group>summary{padding:12px 0;color:var(--ink-2);font-size:14px;font-weight:600;cursor:pointer}${scopedThemeCss(theme.customCss, origin)}`;
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
