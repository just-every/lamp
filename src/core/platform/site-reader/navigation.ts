/** Navigation intent is independent of nesting, punctuation and slug spelling. */
const wording = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// These describe help around a product or site administration, rather than a product area.
// "Data Services" can name a product and hosting sites file products under /services/; "Professional Services",
// consulting, implementation and training cannot, whatever directory or menu holds them.
const NON_PRODUCT = /\b(training|academy|certifications?|consulting|consultancy|advisory|implementation|onboarding|customer success|success plans?|professional services?|release notes?|change ?logs?|whats new|early access)\b|\b(releases?|updates?|careers|pricing|legal|privacy|terms|cookies|disclaimers?)$|\bsupport(?: (plans?|programs?|portal|cent(er|re)))?$|^partners?$/;
// A category in a compound slug is still chrome. Singular partner names can describe real access products.
// Comparison, alternative, audience and "why us" pages measure the site against others or address a reader, at any
// depth: /features/vs-google-analytics, /acme-vs-matomo, /compare-plans, /matomo-alternative, /for-agencies, /why-acme.
const NON_PRODUCT_SEGMENT = /^(enterprise|partners?)$|^partner-program(?:-|$)|(?:^|-)(training|academy|certifications?|consulting|support|releases?|change-?logs?|updates?|careers?|partners|pricing|legal|privacy|terms|cookies|disclaimers?)(?:-|$)|^whats-new$|(?:^|-)(vs|versus|comparisons?|alternatives?)(?:-|$)|^(compare|for|why)(?:-|$)/;

const supporting = (value: string) => NON_PRODUCT.test(wording(value));
// A compliance page ("GDPR Compliance") is not a product area; an area that pairs it with another ("Security & Compliance") can be.
const compliancePage = (value: string) => /\bcompliance$/i.test(value.trim()) && !/(?:&|\band)\s+compliance$/i.test(value.trim());

export const nonProductLabel = (value: string) => supporting(value) || compliancePage(value);

// Work done for a client rather than something the client runs: "Web Development", "Product Design", "Cloud Migration",
// "Strategy & Innovation". Only a services directory or menu needs this test; elsewhere "Data Engineering" can be a product.
const PROFESSIONAL_WORK = /\b(development|design|engineering|strategy|innovation|migrations?|moderni[sz]ation|transformation|outsourcing|augmentation|staffing|audits?|assessments?|prototyping|discovery|research|r d|thinking|testing|quality assurance|maintenance|optimi[sz]ation|consulting|advisory|implementation)$/;

export const professionalWork = (value: string) => PROFESSIONAL_WORK.test(wording(value));

export function nonProductPath(pathname: string) {
  return pathname.split("/").some(segment => {
    // An encoded word has the same intent as its readable spelling.
    try { segment = decodeURIComponent(segment); } catch { /* Keep a malformed segment as written. */ }
    return supporting(segment) || NON_PRODUCT_SEGMENT.test(wording(segment).replace(/ /g, "-"));
  });
}
