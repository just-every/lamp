import { siteDomain } from "./domain.ts";
import type { HtmlAnchor, HtmlScan } from "./html.ts";
import type { SiteComponent } from "./types.ts";

const GENERIC = /^(home|pricing|plans? and pricing|blog|about( us)?|company|careers|jobs|contact( us| sales)?|talk to (sales|us)|sales|(book|request|get|watch) a demo|demo|get started( free| for free)?|start (your )?free trial|start for free|try (it )?(for )?free|free trial|sign ?up( free)?|register|learn more|read more|resources|customers|case studies|(customer )?stories|partners|press|news(room)?|events|webinars|community|help( cent(er|re))?|support|faq|privacy( policy)?|terms( of (service|use))?|legal|cookies?( policy| settings)?|menu|close|skip to (main )?content|english|language|products?|features?( and benefits)?|benefits|solutions|platform|overview|explore( more| all)?|enterprise|compare|why .+|see all.*|view all.*|all .+|more|status|system status|log ?out|sign ?out|download|apps?|guides?|templates|integrations? directory|changelog|release notes|what['’]?s new|security|trust|accessibility|sitemap|investors|affiliates?|refer a friend|gift cards?)$/i;
// Calls to action, sentences and menu chrome are not product areas.
const CHROME = /^(pricing|sign ?up|get started|try|book|request|start|navigate|go to|back to|skip|open app|download|see|view|learn|read|watch|join|contact|help|explore|discover)\b|\b(overview|home|homepage|more)$|\bfor\b|\b(is|are|was|our|your|we|you|to the|of the)\b/i;
const NON_SERVICE_NAME = /^(docs?|documentation|developers?|developer docs|api (docs|reference)|integrations?|now|log[ -]?in|sign[ -]?in|accounts?|dashboard login|e-?commerce|saas|agencies|creators?( and publishers?)?|publishers?|public sector|industries|use cases)$|^(vs\.?|versus|compare|migrat\w*|switch|white[ -]label)\b/i;
const NON_SERVICE_PATH = /\/(docs?|documentation|developers?|reference|learn|guides?|help|support|blog|news|now|changelog|releases?|release-notes|whats-new|downloads?|explore|resources|integrations?|customers?|stories|case-studies|partners|templates|for|use-cases|industries|solutions?|compare|comparisons?|alternatives?|vs|migrat\w*|log-?in|sign-?in|sign-?up|auth|accounts?|pricing|about|company|careers|jobs|contact|legal|privacy|terms|cookies|benefits|press|events|security|trust)(\/|$)/i;
const NON_SERVICE_HOST = /^(docs?|developers?|help|support|learn|accounts?|auth|id|sso|login)\./i;
const PRODUCT_PATH = /^\/(products?|apps?|tools?|services?)\/[^/]+/i;
// A feature menu alone is weak evidence: keep only names of usable service areas,
// rather than benefits such as "Zero downtime deploys" or "Granular routing".
const SERVICE_NAME = /^(api|dashboard|console|web app|mobile app|website|storage|databases?|compute|cdn|authentication|payments|invoices|invoicing( and payments)?|timesheets|time tracking|reports|reporting|analytics|messaging|email|search|hosting)$/i;
const STATUS_HOST = /(^|\.)(statuspage\.io|status\.io|instatus\.com|betteruptime\.com|statuspal\.io|hund\.io|status\.[a-z0-9-]+\.[a-z.]+)$|^status\./i;

const PRODUCT_GROUP = /^(products?( and pricing)?|platform|apps?|services?)$/i;
const OTHER_GROUP = /^(company|community|social|resources?|developers?|support|solutions?|industries|use cases|integrations?( and custom solutions)?)$/i;
// Feature navigation alone needs an operational area, not just a named benefit.
const SERVICE_ENDING = /\b(hosting|analytics|monitoring|messaging|storage|payments|invoicing|reporting|analysis|builders?|players?|transcription|time tracking)$/i;
const MARKETING_INDEX = /^\/(features?|benefits)(?:\/|$)$/i;
// A trailing arrow marks a call to action ("Explore more →"); ↗ only marks an outside link.
const ARROWED = /[→➔➜⟶›»]\s*$/u;

const CAP = 8;

interface Candidate extends SiteComponent { primary: boolean }

const destination = (url: string) => url.replace(/[#?].*$/, "").replace(/\/$/, "");

function unique(candidates: Candidate[]) {
  const names = new Set<string>(), addresses = new Set<string>();
  return candidates.filter(candidate => {
    const name = candidate.name.toLowerCase().replace(/\s*&\s*/g, " and ");
    const address = destination(candidate.url);
    const duplicate = names.has(name) || addresses.has(address);
    names.add(name); addresses.add(address);
    return !duplicate;
  });
}

/** Over the cap, keep the site's main areas: the ones it links to (counting the pages beneath them) and
 * names in its own text most often, before any page that sits beneath another area. The chosen areas keep the site's order. */
function prominent(candidates: Candidate[], links: string[], prose: string) {
  if (candidates.length <= CAP) return candidates;
  const addresses = candidates.map(candidate => destination(candidate.url));
  const mentions = (name: string) => prose.match(new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "gu"))?.length ?? 0;
  return addresses.map((address, index) => ({
    index,
    nested: addresses.some(other => address.startsWith(`${other}/`)),
    weight: links.filter(link => link === address || link.startsWith(`${address}/`)).length + mentions(candidates[index].name),
  }))
    .sort((a, b) => Number(a.nested) - Number(b.nested) || b.weight - a.weight || a.index - b.index)
    .slice(0, CAP).sort((a, b) => a.index - b.index).map(({ index }) => candidates[index]);
}

/** Choose supported product areas, then retain their order on the site. */
export function siteComponents(scan: HtmlScan, base: URL): SiteComponent[] {
  const domain = siteDomain(base.hostname);
  const consider = (anchors: HtmlAnchor[]): Candidate[] => anchors.flatMap(anchor => {
    let url: URL;
    try { url = new URL(anchor.href, base); } catch { return []; }
    if (!/^https?:$/.test(url.protocol) || !(url.hostname === domain || url.hostname.endsWith(`.${domain}`)) || STATUS_HOST.test(url.hostname)) return [];
    if (anchor.accountNavigation) return [];
    const text = anchor.name;
    // The link's whole text is checked too, so a cleaned name never hides a generic link ("What's New").
    const whole = anchor.text.replace(/[\s›»→↗➔>]+$/u, "");
    if (ARROWED.test(anchor.text) || GENERIC.test(whole)) return [];
    const productGroup = anchor.groups.findLast(label => PRODUCT_GROUP.test(label) || OTHER_GROUP.test(label));
    const product = Boolean(productGroup && PRODUCT_GROUP.test(productGroup)) || PRODUCT_PATH.test(url.pathname);
    if (/^(plans?|search)$/i.test(text) && !product) return [];
    if (text.length < 2 || text.length > 40 || text.split(" ").length > 5 || GENERIC.test(text) || CHROME.test(text) || NON_SERVICE_NAME.test(text)) return [];
    if ((NON_SERVICE_PATH.test(url.pathname) && !(product && /^\/auth\/?$/.test(url.pathname))) || MARKETING_INDEX.test(url.pathname) || NON_SERVICE_HOST.test(url.hostname) || (url.pathname === "/" && url.hostname === base.hostname)) return [];
    if (productGroup && OTHER_GROUP.test(productGroup)) return [];
    const service = SERVICE_NAME.test(text) || SERVICE_ENDING.test(text);
    const primary = product || service && url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "");
    if (!primary && !service) return [];
    return [{ name: text, url: url.href, primary }];
  });
  let candidates = unique(consider(scan.anchors.filter(anchor => anchor.region === "nav" || anchor.region === "header")));
  if (candidates.length < 2) candidates = unique([...candidates, ...consider(scan.anchors.filter(anchor => anchor.region === "footer"))]);
  const preferred = candidates.filter(candidate => candidate.primary);
  if (preferred.length >= 2) candidates = preferred;
  if (candidates.length < 2) return [];
  const links = scan.anchors.flatMap(anchor => { try { return [destination(new URL(anchor.href, base).href)]; } catch { return []; } });
  return prominent(candidates, links, scan.prose).map(({ name, url }) => ({ name, url }));
}
