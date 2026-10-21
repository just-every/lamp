import { siteDomain } from "./domain.ts";
import type { HtmlAnchor, HtmlScan } from "./html.ts";
import { cleanComponentName } from "./link-text.ts";
import { nonProductLabel, nonProductPath } from "./navigation.ts";
import type { SiteComponent } from "./types.ts";

const GENERIC = /^(home|pricing|plans? and pricing|blog|about( us)?|company|careers|jobs|contact( us| sales)?|talk to (sales|us)|sales|(book|request|get|watch) a demo|demo|get started( free| for free)?|start (your )?free trial|start for free|try (it )?(for )?free|free trial|sign ?up( free)?|register|learn more|read more|resources|customers|case studies|(customer )?stories|partners|press|news(room)?|events|webinars|community|help( cent(er|re))?|support|faq|privacy( policy)?|terms( of (service|use))?|legal|cookies?( policy| settings)?|menu|close|skip to (main )?content|english|language|products?|features?( and benefits)?|benefits|solutions|platform|overview|explore( more| all)?|enterprise|compare|why .+|see all.*|view all.*|all .+|more|status|system status|log ?out|sign ?out|download|apps?|guides?|templates|integrations? directory|changelog|release notes|what['’]?s new|security|trust|accessibility|sitemap|investors|affiliates?|refer a friend|gift cards?)$/i;
// Calls to action, sentences, plan and pricing wording, catalogue links and menu chrome are not product areas.
const CHROME = /^(pricing|sign ?up|get started|try|book|request|register|start|navigate|go to|back to|skip|open app|download|see|view|learn|read|watch|join|contact|help|explore|discover)\b|\b(overview|home|homepage|more|plans|pricing|prices)$|\s(now|today)$|\ball (products|services|apps|tools|solutions|features)$|\b(for|at)\b|\b(is|are|was|our|your|we|you|to the|of the)\b/i;
// A comparison names the competitor ("vs Matomo", "Acme vs Matomo", "Google Analytics alternative").
const NON_SERVICE_NAME = /^(docs?|documentation|developers?|developer docs|api (docs|reference)|integrations?|now|log[ -]?in|sign[ -]?in|accounts?|dashboard login|e-?commerce|saas|agencies|creators?( and publishers?)?|publishers?|public sector|industries|use cases)$|^(vs\.?|versus|compare|migrat\w*|switch|white[ -]label)\b|\s(vs\.?|versus)\s|\balternatives?$/i;
const NON_SERVICE_PATH = /\/(docs?|documentation|developers?|reference|learn|guides?|help|support|blog|news|now|changelog|releases?|release-notes|whats-new|downloads?|explore|resources|integrations?|customers?|stories|case-studies|partners|templates|for|use-cases|industries|enterprise|solutions?|compare|comparisons?|alternatives?|vs|migrat\w*|log-?in|sign-?in|sign-?up|auth|accounts?|pricing|about|company|careers|jobs|contact|legal|privacy|terms|cookies|benefits|press|events|(?:security|trust)(?:-cent(?:er|re))?|compliance)(\/|$)/i;
const NON_SERVICE_HOST = /^(docs?|developers?|help|support|learn|accounts?|auth|id|sso|login|trust)\./i;
// A /tools/ directory holds free generators and calculators far more often than products, so it is no product evidence.
const PRODUCT_PATH = /^\/(products?|apps?)\/[^/]+/i;
// A feature menu alone is weak evidence: keep only names of usable service areas,
// rather than benefits such as "Zero downtime deploys" or "Granular routing".
const SERVICE_NAME = /^(api|dashboard|console|web app|mobile app|website|storage|databases?|compute|cdn|authentication|payments|invoices|invoicing( and payments)?|timesheets|time tracking|reports|reporting|analytics|messaging|email|search|hosting)$/i;
const STATUS_HOST = /(^|\.)(statuspage\.io|status\.io|instatus\.com|betteruptime\.com|statuspal\.io|hund\.io|status\.[a-z0-9-]+\.[a-z.]+)$|^status\./i;

const PRODUCT_GROUP = /^(products?( and pricing)?|platform|(?:featured )?apps?)$/i;
// Use-case, industry and comparison groups, and labels that ask the reader a question ("Why Acme", "Who it's for",
// "What you can do in Acme"), hold pages about a market rather than product areas. Some sites call their product
// menu "Solutions", so that is only another kind of group.
const MARKET_GROUP = /^(industries|use cases|compare|comparisons?|alternatives?|(what|why|who|how) .+)$/i;
const OTHER_GROUP = /^(company|community|social|resources?|developers?|support|solutions?|integrations?( and custom solutions)?|programs?)$/i;
// Feature navigation alone needs an operational area, not just a named benefit.
const SERVICE_ENDING = /\b(hosting|analytics|monitoring|messaging|storage|payments|invoicing|reporting|analysis|builders?|players?|transcription|time tracking)$/i;
const MARKETING_INDEX = /^\/(features?|benefits)(?:\/|$)$/i;
// A trailing arrow marks a call to action ("Explore more →"); ↗ only marks an outside link.
const ARROWED = /[→➔➜⟶›»]\s*$/u;

const CAP = 8;

interface Candidate extends SiteComponent { primary: boolean; titleRank: HtmlAnchor["titleRank"]; menu: boolean; groups: string[] }

const inHeader = (anchor: HtmlAnchor) => !anchor.footer && (anchor.region === "nav" || anchor.region === "header");
/** A menu's accessible name without its role suffix: "Products: Dropdown Content" is "Products". */
const roleless = (label: string) => label.replace(/\s*[:–—-]\s*(dropdown|menu|navigation)( content)?$/i, "");
/** The innermost group label that says what a menu holds: products, or pages of another kind. */
const recognised = (groups: string[]) => groups.findLast(label => PRODUCT_GROUP.test(label) || MARKET_GROUP.test(label) || OTHER_GROUP.test(label) || nonProductLabel(label));

const destination = (url: string) => url.replace(/[#?].*$/, "").replace(/\/$/, "");
const key = (name: string) => name.toLowerCase().replace(/\s*&\s*/g, " and ");
const words = (value: string) => value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Prefer the site's product-menu name and title over a footer category that happens to spell the URL. */
function fit(candidate: Candidate, links: Candidate[]) {
  const name = key(candidate.name);
  const slug = words(new URL(candidate.url).pathname.split("/").filter(Boolean).at(-1) ?? "");
  const group = links.some(link => link.groups.some(label => key(cleanComponentName(label)) === name));
  const spelled = slug.length > 0 && slug.every(word => words(candidate.name).includes(word));
  return 32 * Number(candidate.menu) + 16 * Number(group) + 8 * Number(candidate.titleRank === 2) + 4 * Number(spelled) + Number(candidate.titleRank === 1);
}

/** Text that links to several addresses is boilerplate and leaves every one of them: at three or more
 * ("Free and premium plans" on each product card), or at two when another link names one of them. Text that
 * is the only name of two pages ("Analytics") stays once. Each address keeps its best name, where the site first links to it. */
function unique(candidates: Candidate[]) {
  const group = <T>(by: (candidate: Candidate) => string, value: (candidate: Candidate) => T) => {
    const map = new Map<string, Set<T>>();
    for (const candidate of candidates) map.set(by(candidate), (map.get(by(candidate)) ?? new Set<T>()).add(value(candidate)));
    return map;
  };
  const addressesOf = group(candidate => key(candidate.name), candidate => destination(candidate.url));
  const namesAt = group(candidate => destination(candidate.url), candidate => key(candidate.name));
  const boilerplate = (name: string) => {
    const addresses = [...addressesOf.get(name)!];
    return addresses.length >= 3 || addresses.length === 2 && addresses.some(address => namesAt.get(address)!.size > 1);
  };
  const byAddress = new Map<string, Candidate[]>(), named = new Set<string>();
  for (const candidate of candidates) {
    const name = key(candidate.name), address = destination(candidate.url);
    if (boilerplate(name) || named.has(name) && !byAddress.get(address)?.some(link => key(link.name) === name)) continue;
    named.add(name);
    byAddress.set(address, [...byAddress.get(address) ?? [], candidate]);
  }
  return [...byAddress.values()].map(links => {
    const best = links.reduce((chosen, link) => fit(link, links) > fit(chosen, links) ? link : chosen);
    return { ...best, primary: links.some(link => link.primary) };
  });
}

/** A catalogue index ("Browse all products" at /products) is not an area: the one candidate at its level
 * whose address is the parent of two or more others. A main area beside other areas keeps its sub-pages. */
function catalogueIndexes(candidates: Candidate[]) {
  const addresses = candidates.map(candidate => destination(candidate.url));
  const parent = (address: string) => address.replace(/\/[^/]*$/, "");
  return new Set(addresses.filter(address => addresses.filter(other => other.startsWith(`${address}/`)).length >= 2
    && !addresses.some(other => other !== address && parent(other) === parent(address))));
}

/** Over the cap, keep the site's main areas: the ones its header navigation links to before those only its footer
 * lists, then the ones it links to (counting the pages beneath them) and names in its own text most often, before
 * any page that sits beneath another area. The chosen areas keep the site's order. */
function prominent(candidates: Candidate[], links: string[], header: Set<string>, prose: string) {
  if (candidates.length <= CAP) return candidates;
  const addresses = candidates.map(candidate => destination(candidate.url));
  const mentions = (name: string) => prose.match(new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "gu"))?.length ?? 0;
  return addresses.map((address, index) => ({
    index,
    footerOnly: !header.has(address),
    // A page the header presents is beneath another area only when the header presents that area too, and a page
    // named after the area it sits beneath ("Jira Service Management" under "Jira") is an area of its own.
    nested: addresses.some((other, at) => address.startsWith(`${other}/`) && (header.has(other) || !header.has(address))
      && !key(candidates[index].name).startsWith(`${key(candidates[at].name)} `)),
    weight: links.filter(link => link === address || link.startsWith(`${address}/`)).length + mentions(candidates[index].name),
  }))
    .sort((a, b) => Number(a.footerOnly) - Number(b.footerOnly) || Number(a.nested) - Number(b.nested) || b.weight - a.weight || a.index - b.index)
    .slice(0, CAP).sort((a, b) => a.index - b.index).map(({ index }) => candidates[index]);
}

/** Choose supported product areas, then retain their order on the site. */
export function siteComponents(scan: HtmlScan, base: URL): SiteComponent[] {
  const domain = siteDomain(base.hostname);
  // `plausible` keeps a link that names an area without product evidence of its own.
  const consider = (anchors: HtmlAnchor[], plausible = false): Candidate[] => anchors.flatMap(anchor => {
    let url: URL;
    try { url = new URL(anchor.href, base); } catch { return []; }
    if (!/^https?:$/.test(url.protocol) || !(url.hostname === domain || url.hostname.endsWith(`.${domain}`)) || STATUS_HOST.test(url.hostname)) return [];
    if (anchor.accountNavigation) return [];
    const text = anchor.name;
    if (nonProductLabel(text) || nonProductPath(url.pathname) || anchor.groups.some(label => !PRODUCT_GROUP.test(label) && nonProductLabel(label))) return [];
    // The link's whole text is checked too, so a cleaned name never hides a generic link ("What's New").
    const whole = anchor.text.replace(/[\s›»→↗➔>]+$/u, "");
    if (ARROWED.test(anchor.text) || GENERIC.test(whole)) return [];
    const groups = anchor.groups.map(roleless);
    const productGroup = recognised(groups);
    const roleMenu = groups.some((label, index) => label !== anchor.groups[index]);
    const productMenu = Boolean(productGroup && PRODUCT_GROUP.test(productGroup)) && (!roleMenu || anchor.titleRank > 0 || !anchor.described);
    const product = productMenu || PRODUCT_PATH.test(url.pathname);
    if (/^(plans?|search)$/i.test(text) && !product) return [];
    if (text.length < 2 || text.length > 40 || text.split(" ").length > 5 || GENERIC.test(text) || CHROME.test(text) || NON_SERVICE_NAME.test(text)) return [];
    if ((NON_SERVICE_PATH.test(url.pathname) && !(product && /^\/auth\/?$/.test(url.pathname))) || MARKETING_INDEX.test(url.pathname) || NON_SERVICE_HOST.test(url.hostname) || (url.pathname === "/" && url.hostname === base.hostname)) return [];
    if (productGroup && !PRODUCT_GROUP.test(productGroup)) return [];
    const service = SERVICE_NAME.test(text) || SERVICE_ENDING.test(text);
    const primary = product || service && url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "");
    if (!primary && !service && !plausible) return [];
    return [{ name: text, url: url.href, primary, titleRank: anchor.titleRank, menu: !anchor.footer && productMenu, groups: anchor.groups }];
  });
  const address = (anchor: HtmlAnchor) => { try { return [destination(new URL(anchor.href, base).href)]; } catch { return []; } };
  const headerAnchors = scan.anchors.filter(inHeader);
  const header = new Set(consider(headerAnchors, true).map(candidate => destination(candidate.url)));
  // The header's menus sort pages more finely than a footer's list: a page the header files only under a use-case,
  // industry, audience or comparison group ("What you can do in Acme") is no product area because the footer lists it under Product.
  const market = new Set(headerAnchors.filter(anchor => MARKET_GROUP.test(recognised(anchor.groups.map(roleless)) ?? "")).flatMap(address));
  const filed = (candidate: Candidate) => header.has(destination(candidate.url)) || !market.has(destination(candidate.url));
  let candidates = unique(consider(scan.anchors.filter(anchor => anchor.region === "nav" || anchor.region === "header"))).filter(filed);
  if (candidates.length < 2) candidates = unique([...candidates, ...consider(scan.anchors.filter(anchor => anchor.region === "footer"))]).filter(filed);
  const preferred = candidates.filter(candidate => candidate.primary);
  if (preferred.length >= 2) candidates = preferred;
  const indexes = catalogueIndexes(candidates);
  candidates = candidates.filter(candidate => !indexes.has(destination(candidate.url)));
  if (candidates.length < 2) return [];
  return prominent(candidates, scan.anchors.flatMap(address), header, scan.prose).map(({ name, url }) => ({ name, url }));
}
