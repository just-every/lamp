/** Navigation intent is independent of nesting, punctuation and slug spelling. */
const wording = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// These describe help around a product or site administration, rather than a product area.
// "Data Services" can name a product; "Professional Services" and a /services/ directory cannot.
const NON_PRODUCT = /\b(training|academy|certifications?|consulting|consultancy|onboarding|customer success|success plans?|professional services?|release notes?|change ?logs?|whats new|early access)\b|\b(releases?|updates?|careers|pricing|legal|privacy|terms|cookies)$|\bsupport(?: (plans?|programs?|portal|cent(er|re)))?$|^partners?$/;
// A category in a compound slug is still chrome. Singular partner names can describe real access products.
// Comparison, alternative, audience and "why us" pages measure the site against others or address a reader, at any
// depth: /features/vs-google-analytics, /acme-vs-matomo, /compare-plans, /matomo-alternative, /for-agencies, /why-acme.
const NON_PRODUCT_SEGMENT = /^(services|enterprise|partners?)$|^partner-program(?:-|$)|(?:^|-)(training|academy|certifications?|consulting|support|releases?|change-?logs?|updates?|careers?|partners|pricing|legal|privacy|terms|cookies)(?:-|$)|^whats-new$|(?:^|-)(vs|versus|comparisons?|alternatives?)(?:-|$)|^(compare|for|why)(?:-|$)/;

const supporting = (value: string) => NON_PRODUCT.test(wording(value)) || /^services$/.test(wording(value));
// A compliance page ("GDPR Compliance") is not a product area; an area that pairs it with another ("Security & Compliance") can be.
const compliancePage = (value: string) => /\bcompliance$/i.test(value.trim()) && !/(?:&|\band)\s+compliance$/i.test(value.trim());

export const nonProductLabel = (value: string) => supporting(value) || compliancePage(value);

export function nonProductPath(pathname: string) {
  return pathname.split("/").some(segment => {
    // An encoded word has the same intent as its readable spelling.
    try { segment = decodeURIComponent(segment); } catch { /* Keep a malformed segment as written. */ }
    return supporting(segment) || NON_PRODUCT_SEGMENT.test(wording(segment).replace(/ /g, "-"));
  });
}
