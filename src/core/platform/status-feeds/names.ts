import { cleanComponentName } from "../site-reader/link-text.ts";
import { cleanText } from "../site-reader/text.ts";

const words = (value: string) => (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");

/** A status page names its own components. The site reader's cleaning removes their decoration (spacing, emoji,
 * entities), but never a word: "HTTP (Preview)" stays whole, where a site's navigation would read "(Preview)" as a badge. */
export function pageComponentName(value: string) {
  const text = cleanText(value);
  const cleaned = cleanComponentName(text);
  return cleaned && words(cleaned) === words(text) ? cleaned : text;
}
