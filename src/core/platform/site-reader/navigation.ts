/** Navigation intent is independent of nesting, punctuation and slug spelling. */
const wording = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// These describe help around a product or site administration, rather than a product area.
// "Data Services" can name a product; "Professional Services" and a /services/ directory cannot.
const NON_PRODUCT = /\b(training|academy|certifications?|consulting|consultancy|onboarding|customer success|success plans?|support|professional services?|releases?|change\s?logs?|what\s?s new|whats new|updates?|careers?|partners?|pricing|legal|privacy|terms|cookies)\b|\bcompliance$/;

export const nonProductLabel = (value: string) => NON_PRODUCT.test(wording(value)) || /^services$/.test(wording(value));

export function nonProductPath(pathname: string) {
  return pathname.split("/").some(segment => {
    // An encoded word has the same intent as its readable spelling.
    try { segment = decodeURIComponent(segment); } catch { /* Keep a malformed segment as written. */ }
    return nonProductLabel(segment);
  });
}
