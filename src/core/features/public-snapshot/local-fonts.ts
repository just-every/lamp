import openSans from "./fonts/OpenSans[wdth,wght].woff2?inline";

/** The one bundled public face remains part of the existing stylesheet artifact. */
export const localPublicPageFonts = `@font-face{font-family:"Open Sans";font-style:normal;font-weight:400 700;font-display:swap;src:url(${openSans}) format("woff2")}`;
