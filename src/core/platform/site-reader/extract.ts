import { cleanText, type HtmlScan, type HtmlTag } from "./html.ts";
import { cssBrandColours, isBrandColour, toHex } from "./colour.ts";
import type { SiteComponent } from "./types.ts";

export interface Manifest { name?: string; short_name?: string; description?: string; theme_color?: string; icons?: { src?: string; sizes?: string; type?: string }[] }

const meta = (scan: HtmlScan, key: string) => scan.tags.find((tag) => tag.name === "meta" && [tag.attributes.name, tag.attributes.property].some((value) => value?.toLowerCase() === key))?.attributes.content?.trim() || null;
const rels = (tag: HtmlTag) => (tag.attributes.rel ?? "").toLowerCase().split(/\s+/);
const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The registrable part of a host name, roughly: getharvest.com, example.co.uk. */
export function siteDomain(host: string) {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  const take = labels.length >= 3 && labels.at(-2)!.length <= 3 && labels.at(-1)!.length === 2 ? 3 : 2;
  return labels.slice(-take).join(".");
}

export function siteName(scan: HtmlScan, host: string, manifest: Manifest | null): string | null {
  const label = squash(siteDomain(host).split(".")[0]);
  const titleParts = (scan.title ?? "").split(/\s+[|\-–—:·•»]\s+/).map(cleanText).filter(Boolean);
  const candidates = [meta(scan, "og:site_name"), meta(scan, "application-name"), manifest?.short_name, manifest?.name, ...titleParts]
    .map((value) => cleanText(value ?? "")).filter((value) => value.length > 0 && value.length <= 40);
  // The name the domain itself spells wins: "Harvest" for getharvest.com.
  const matching = candidates.filter((value) => squash(value).length >= 3 && (label.includes(squash(value)) || squash(value).includes(label)));
  if (matching.length) return matching.sort((a, b) => a.length - b.length)[0];
  const named = [meta(scan, "og:site_name"), meta(scan, "application-name"), manifest?.short_name, manifest?.name].map((value) => cleanText(value ?? "")).find((value) => value && value.length <= 40);
  if (named) return named;
  if (titleParts.length > 1) return titleParts.at(-1)!.length <= 40 ? titleParts.at(-1)! : null;
  return titleParts[0] && titleParts[0].split(" ").length <= 3 ? titleParts[0] : null;
}

export function siteDescription(scan: HtmlScan, manifest: Manifest | null) {
  const text = cleanText(meta(scan, "description") ?? meta(scan, "og:description") ?? manifest?.description ?? "");
  if (!text) return null;
  return text.length <= 280 ? text : `${text.slice(0, 277).replace(/\s+\S*$/, "")}…`;
}

export interface IconCandidate { url: string; rank: number }

/** Declared icons, best first: SVG, then the largest raster, then /favicon.ico when nothing is declared. */
export function iconCandidates(scan: HtmlScan, base: URL, manifest: Manifest | null, manifestUrl: URL | null): IconCandidate[] {
  const candidates: IconCandidate[] = [];
  const size = (sizes: string | undefined) => Math.max(0, ...(sizes ?? "").split(/\s+/).map((value) => Number(value.split("x")[0]) || 0));
  const add = (href: string | undefined, against: URL, rank: number) => {
    if (!href || href.startsWith("data:")) return;
    try { candidates.push({ url: new URL(href, against).href, rank }); } catch { /* An unusable href is not a candidate. */ }
  };
  for (const tag of scan.tags.filter((tag) => tag.name === "link")) {
    const kinds = rels(tag);
    const svg = tag.attributes.type === "image/svg+xml" || /\.svg(\?|$)/i.test(tag.attributes.href ?? "");
    if (kinds.includes("icon")) add(tag.attributes.href, base, svg ? 10_000 : size(tag.attributes.sizes) || 16);
    else if (kinds.includes("apple-touch-icon") || kinds.includes("apple-touch-icon-precomposed")) add(tag.attributes.href, base, size(tag.attributes.sizes) || 180);
  }
  for (const icon of manifest?.icons ?? []) add(icon.src, manifestUrl ?? base, icon.type === "image/svg+xml" ? 9_000 : size(icon.sizes));
  if (!candidates.length) add("/favicon.ico", base, 1);
  const seen = new Set<string>();
  return candidates.sort((a, b) => b.rank - a.rank).filter((candidate) => !seen.has(candidate.url) && seen.add(candidate.url));
}

/** Colours the site declares, most confident first: theme colour, the mark's own colours, CSS brand variables, Safari pinned-tab colour, manifest. */
export function siteColours(scan: HtmlScan, iconColours: string[], manifest: Manifest | null) {
  const themes = scan.tags.filter((tag) => tag.name === "meta" && tag.attributes.name?.toLowerCase() === "theme-color" && !/dark/.test(tag.attributes.media ?? "")).map((tag) => tag.attributes.content);
  const pinned = scan.tags.filter((tag) => tag.name === "link" && rels(tag).includes("mask-icon")).map((tag) => tag.attributes.color);
  const ordered = [...themes, ...iconColours, ...cssBrandColours(scan.styles), ...pinned, manifest?.theme_color].map(toHex).filter((hex): hex is string => Boolean(hex));
  const colours = [...new Set(ordered)];
  return { colours, accent: colours.find(isBrandColour) ?? null };
}

export function siteFonts(scan: HtmlScan) {
  const fonts: string[] = [];
  for (const tag of scan.tags.filter((tag) => tag.name === "link" && /fonts\.googleapis\.com/.test(tag.attributes.href ?? ""))) {
    try { for (const family of new URL(tag.attributes.href, "https://fonts.googleapis.com").searchParams.getAll("family")) fonts.push(...family.split("|").map((value) => value.split(":")[0].replace(/\+/g, " "))); } catch { /* Not a usable font link. */ }
  }
  for (const style of scan.styles) for (const match of style.matchAll(/@font-face\s*{[^}]*font-family\s*:\s*["']?([^;"'}]+)/gi)) fonts.push(match[1].trim());
  return [...new Set(fonts.filter(Boolean))].slice(0, 4);
}

const GENERIC = /^(home|pricing|plans?( and pricing)?|blog|about( us)?|company|careers|jobs|contact( us| sales)?|talk to (sales|us)|sales|(book|request|get|watch) a demo|demo|get started( free| for free)?|start (your )?free trial|start for free|try (it )?(for )?free|free trial|sign ?up( free)?|register|learn more|read more|resources|customers|case studies|(customer )?stories|partners|press|news(room)?|events|webinars|community|help( cent(er|re))?|support|faq|privacy( policy)?|terms( of (service|use))?|legal|cookies?( policy| settings)?|menu|search|close|skip to (main )?content|english|language|products?|features|solutions|platform|overview|explore|enterprise|compare|why .+|see all.*|view all.*|all .+|more|status|system status|log ?out|sign ?out|download|apps?|guides?|templates|integrations? directory|changelog|what'?s new|security|trust|accessibility|sitemap|investors|affiliates?|refer a friend|gift cards?)$/i;
// Calls to action, sentences and menu chrome are not product areas.
const CHROME = /^(pricing|sign ?up|get started|try|book|request|start|navigate|go to|back to|skip|open app|download|see|view|learn|read|watch|join|contact|help)\b|\b(overview|home|homepage)$|\bfor\b|\b(is|are|was|our|your|we|you|to the|of the)\b/i;
const LISTING_PATH = /^\/(integrations?|customers?|blog|stories|case-studies|partners|templates|guides|resources)\/[^/]+/i;
const PRODUCT_PATH = /^\/(features?|products?|platform|apps?|integrations?|solutions?|tools?|services?)(\/|$)/i;
const STATUS_HOST = /(^|\.)(statuspage\.io|status\.io|instatus\.com|betteruptime\.com|statuspal\.io|hund\.io|status\.[a-z0-9-]+\.[a-z.]+)$|^status\./i;

/** Product areas from the site's own header and navigation links. */
export function siteComponents(scan: HtmlScan, base: URL): SiteComponent[] {
  const domain = siteDomain(base.hostname);
  type Candidate = SiteComponent & { product: boolean; special: boolean };
  const candidates: Candidate[] = [];
  const consider = (anchors: HtmlScan["anchors"]) => {
    for (const anchor of anchors) {
      let url: URL;
      try { url = new URL(anchor.href, base); } catch { continue; }
      if (!/^https?:$/.test(url.protocol) || !(url.hostname === domain || url.hostname.endsWith(`.${domain}`)) || STATUS_HOST.test(url.hostname)) continue;
      const text = anchor.text.replace(/[\s›»→↗➔>]+$/u, "").replace(/\s+&\s+/g, " and ").trim();
      if (/^(log ?in|sign ?in)$/i.test(text)) { candidates.push({ name: "Sign-in", url: url.href, product: false, special: true }); continue; }
      if (/^(api|developers?|developer docs|api (docs|reference))$/i.test(text) || /^api\./.test(url.hostname)) { candidates.push({ name: "API", url: url.href, product: false, special: true }); continue; }
      // A listing's entries (one integration, one customer story) stand for the listing itself.
      const listing = url.hostname === base.hostname ? url.pathname.match(LISTING_PATH)?.[1] : undefined;
      if (listing) {
        if (/^integrations?$/i.test(listing)) candidates.push({ name: "Integrations", url: new URL(`/${listing}`, url).href, product: true, special: false });
        continue;
      }
      if (text.length < 2 || text.length > 40 || text.split(" ").length > 5 || GENERIC.test(text) || CHROME.test(text) || /^\d+$/.test(text) || (url.pathname === "/" && url.hostname === base.hostname)) continue;
      candidates.push({ name: text[0].toUpperCase() + text.slice(1), url: url.href, product: PRODUCT_PATH.test(url.pathname) || url.hostname !== base.hostname, special: false });
    }
  };
  consider(scan.anchors.filter((anchor) => anchor.region === "nav" || anchor.region === "header"));
  if (candidates.filter((candidate) => !candidate.special).length < 3) consider(scan.anchors.filter((anchor) => anchor.region === "footer" && PRODUCT_PATH.test(safePath(anchor.href, base))));
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    const key = candidate.name.toLowerCase(), address = candidate.url.replace(/[#?].*$/, "");
    if (seen.has(key) || seen.has(address)) return false;
    seen.add(key); seen.add(address);
    return true;
  });
  // A nav with clear product links keeps only those; otherwise every specific link counts.
  const products = unique.filter((candidate) => candidate.product);
  const chosen = products.length >= 3 ? unique.filter((candidate) => candidate.product || candidate.special) : unique;
  const ordered = [...chosen.filter((candidate) => !candidate.special), ...chosen.filter((candidate) => candidate.special)];
  return ordered.slice(0, 8).map(({ name, url }) => ({ name, url }));
}

function safePath(href: string, base: URL) {
  try { return new URL(href, base).pathname; } catch { return ""; }
}

export function siteStatusPage(scan: HtmlScan, base: URL) {
  for (const anchor of scan.anchors) {
    let url: URL;
    try { url = new URL(anchor.href, base); } catch { continue; }
    if (!/^https?:$/.test(url.protocol)) continue;
    if (/^(system )?status( page)?$/i.test(anchor.text) || (STATUS_HOST.test(url.hostname) && url.hostname !== base.hostname)) return { url: url.href };
  }
  return null;
}
