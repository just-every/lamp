import inter from "./fonts/inter-latin.woff2?inline";

/**
 * The one bundled public face travels inside the existing stylesheet artifact, so the page stays within PAGE-003's
 * request budget and makes no third-party font request. The fallback is a local system face sized to Inter's metrics,
 * so the swap moves nothing.
 */
export const localPublicPageFonts = `@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url(${inter}) format("woff2")}@font-face{font-family:"Inter Fallback";src:local("Arial"),local("ArialMT"),local("Liberation Sans");size-adjust:106.03%;ascent-override:91.5%;descent-override:22.6%;line-gap-override:0%}`;
