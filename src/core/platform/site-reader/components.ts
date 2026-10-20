import { siteDomain } from "./domain.ts";
import type { HtmlAnchor, HtmlScan } from "./html.ts";
import type { SiteComponent } from "./types.ts";

const GENERIC = /^(home|pricing|plans? and pricing|blog|about( us)?|company|careers|jobs|contact( us| sales)?|talk to (sales|us)|sales|(book|request|get|watch) a demo|demo|get started( free| for free)?|start (your )?free trial|start for free|try (it )?(for )?free|free trial|sign ?up( free)?|register|learn more|read more|resources|customers|case studies|(customer )?stories|partners|press|news(room)?|events|webinars|community|help( cent(er|re))?|support|faq|privacy( policy)?|terms( of (service|use))?|legal|cookies?( policy| settings)?|menu|close|skip to (main )?content|english|language|products?|features?( and benefits)?|benefits|solutions|platform|overview|explore|enterprise|compare|why .+|see all.*|view all.*|all .+|more|status|system status|log ?out|sign ?out|download|apps?|guides?|templates|integrations? directory|changelog|what'?s new|security|trust|accessibility|sitemap|investors|affiliates?|refer a friend|gift cards?)$/i;
// Calls to action, sentences and menu chrome are not product areas.
const CHROME = /^(pricing|sign ?up|get started|try|book|request|start|navigate|go to|back to|skip|open app|download|see|view|learn|read|watch|join|contact|help)\b|\b(overview|home|homepage)$|\bfor\b|\b(is|are|was|our|your|we|you|to the|of the)\b/i;
const NON_SERVICE_NAME = /^(docs?|documentation|developers?|developer docs|api (docs|reference)|integrations?|now|log[ -]?in|sign[ -]?in|accounts?|dashboard login|e-?commerce|saas|agencies|creators?( and publishers?)?|publishers?|public sector|industries|use cases)$|^(vs\.?|versus|compare|migrat\w*|switch|white[ -]label)\b/i;
const NON_SERVICE_PATH = /\/(docs?|documentation|developers?|reference|learn|guides?|help|support|blog|news|now|changelog|resources|integrations?|customers?|stories|case-studies|partners|templates|for|use-cases|industries|solutions?|compare|comparisons?|alternatives?|vs|migrat\w*|log-?in|sign-?in|sign-?up|auth|accounts?|pricing|about|company|careers|jobs|contact|legal|privacy|terms|cookies|benefits|press|events|security|trust)(\/|$)/i;
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

interface Candidate extends SiteComponent { primary: boolean }

function unique(candidates: Candidate[]) {
  const names = new Set<string>(), addresses = new Set<string>();
  return candidates.filter(candidate => {
    const name = candidate.name.toLowerCase().replace(/\s*&\s*/g, " and ");
    const address = candidate.url.replace(/[#?].*$/, "").replace(/\/$/, "");
    const duplicate = names.has(name) || addresses.has(address);
    names.add(name); addresses.add(address);
    return !duplicate;
  });
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
  return candidates.length >= 2 ? candidates.slice(0, 8).map(({ name, url }) => ({ name, url })) : [];
}
