import { cleanText } from "./text.ts";

interface Element { tag: string; attributes: Record<string, string>; children: (Element | string)[] }
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const WORD = String.raw`new|beta|alpha|soon|coming soon|preview|updated`;
const TOKEN = String.raw`${WORD}|\d[\d,.]*\+?`;
/** A badge on its own: NEW, Beta, Soon, a count, bracketed or bare. */
const BADGE = new RegExp(String.raw`^(?:\(\s*(?:${TOKEN})\s*\)|\[\s*(?:${TOKEN})\s*\]|${TOKEN})$`, "i");
// A trailing part leaves as a badge when it is a badge word or a bracketed count. A bare number in its own
// element is part of the name ("Microsoft <b>365</b>"); a counter is recognised by its styling instead.
const TRAILING = new RegExp(String.raw`^(?:\(\s*(?:${TOKEN})\s*\)|\[\s*(?:${TOKEN})\s*\]|${WORD})$`, "i");
// Inside one text, a trailing badge is set off by brackets or a separator ("Search (42)", "Docs · Beta")...
const MARKED = new RegExp(String.raw`\s*(?:\((?:${TOKEN})\)|\[(?:${TOKEN})\]|[·|•]\s*(?:${TOKEN}))$`, "i");
// ...or shouted after a name in mixed case ("Metrics BETA"). "What's New", "Microsoft 365" and "Build Preview" are names.
const SHOUTED = /\s+(?:NEW|BETA|ALPHA|SOON|COMING SOON|PREVIEW|UPDATED)$/;
// A leading badge is set off by punctuation ("New! App Hosting"); "New Horizons" is a name.
const LEADING = new RegExp(String.raw`^(?:${WORD})\s*[!:–—]\s*(?=\S)`, "i");
const EMOJI = /\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*|\p{Regional_Indicator}{2}|[\u200D\uFE0F\u20E3]/gu;
// Icon fonts draw their glyphs from the private use area; they are pictures, not letters.
const ICON = /\p{Co}/gu;
// A list marker the menu writes before each item ("- vs Google Analytics") is not part of the name.
const plain = (value: string) => cleanText(cleanText(value).replace(EMOJI, "").replace(ICON, "")).replace(/^[-–—•·*▪◦‣⁃]\s+/u, "").replace(/[\s›»→↗➔>]+$/u, "");

/** Only decoration is removed lexically; descriptions are separated by markup. */
export function cleanComponentName(value: string) {
  let text = plain(value).replace(LEADING, "");
  for (;;) {
    const unmarked = text.replace(MARKED, "").trim();
    const unshouted = text.replace(SHOUTED, "").trim();
    const next = unmarked !== text ? unmarked : /\p{Ll}/u.test(unshouted) ? unshouted : text;
    if (next === text) break;
    text = next;
  }
  return BADGE.test(text) ? "" : text;
}

/** The words of each class name. Utility values in brackets ("text-[var(--header-text)]") and generated hashes
 * ("Nav_title__fMMCy", "sc-71cbd675") are not words; "productTitle" and "product-title" are the same two words.
 * A BEM modifier names a variant, so a class is read with and without it: "card__title--large" and "link--label". */
const classNames = (element: Element) => `${element.attributes.class ?? ""} ${element.attributes["data-slot"] ?? ""}`.split(/\s+/).filter(Boolean)
  .map(name => name.replace(/\[[^\]]*\]/g, " ").replace(/__(?=[\w-]*[A-Z0-9])[\w-]{5,8}$/, ""))
  .flatMap(name => [name, name.replace(/(?<=\w)--[\w-]*$/, "")])
  .map(name => name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(word => word && !/\d/.test(word)));
const hidden = (element: Element) => element.attributes["aria-hidden"] === "true" || "hidden" in element.attributes;
/** A class that marks its element as supporting text: "product-description", "card__subtitle". */
const classDescribed = (element: Element) => classNames(element).some(words => words.some(word => /^(description|subtitle|summary|caption|details?)$/.test(word)));

const role = (element: Element): "decoration" | "description" | "title" | "text" => {
  const names = classNames(element);
  // Badges, counters and text kept for screen readers only are not part of the shown name.
  if (hidden(element) || names.some(words => words.some(word => /^(badge|pill|chip|count|counter)$/.test(word)))
    || /(?:^|\s)(sr-only|visually-?hidden|screen-reader-text)(?:$|\s)/i.test(element.attributes.class ?? "")) return "decoration";
  // A class names the element by its last word: "product-header" is a title, while "header-platform-card__link"
  // and "title-card-link" are links inside a header card or title card, not titles themselves.
  if (names.some(words => /^(title|name|label|heading|header)$/.test(words.at(-1) ?? "")) || /^h[1-6]$/.test(element.tag)) return "title";
  if (classDescribed(element) || /^(small|p)$/.test(element.tag)) return "description";
  return "text";
};

/** The element's text, less trailing segments (a child element or a separate text) that are only a badge word or bracketed count. */
function shown(element: Element): string {
  if (role(element) === "decoration") return "";
  if (role(element) === "description") return titles(element).join(" ");
  const parts = element.children.map(child => typeof child === "string" ? child : shown(child)).filter(part => plain(part));
  while (parts.length > 1 && TRAILING.test(plain(parts.at(-1)!))) parts.pop();
  return parts.join(" ");
}
const visible = (element: Element) => cleanComponentName(shown(element));

function titles(element: Element, inDescription = false): string[] {
  if (role(element) === "decoration") return [];
  inDescription ||= role(element) === "description";
  if (role(element) === "title" || inDescription && element.tag === "strong") return [visible(element)].filter(Boolean);
  // A description-styled wrapper can contain a title; only its supporting text leaves.
  return element.children.flatMap(child => typeof child === "string" ? [] : titles(child, inDescription));
}

const raw = (child: Element | string): string => typeof child === "string" ? child : child.children.map(raw).join("");

/** The text a reader sees as lines, paragraphs included: each block element is a line. Decoration and text a class
 * marks as a description ("product-description") are left out. */
function shownLines(element: Element): string[] {
  const lines = [""];
  const walk = (node: Element | string) => {
    if (typeof node === "string") { lines[lines.length - 1] += node; return; }
    if (role(node) === "decoration" || classDescribed(node)) { lines.push(""); return; }
    const block = /^(div|p|h[1-6]|li)$/.test(node.tag);
    if (block) lines.push("");
    node.children.forEach(walk);
    if (block) lines.push("");
  };
  walk(element);
  return lines.map(cleanComponentName).filter(Boolean);
}

const shownPart = (child: Element | string) => typeof child === "string" ? cleanComponentName(child) : visible(child);

/** Separate lines express a label followed by supporting text: block siblings, the children of a flex column, or
 * siblings that touch with no space between them ("Journeys" then "Understand paths to conversion"), which only
 * reads as two lines unless a flex row lays them side by side. Words split by a space, or one word split by markup,
 * stay one line. Returns the first line when there are several. */
function firstLine(element: Element): string {
  const parts = element.children.flatMap((child, index) => shownPart(child) ? [index] : []);
  const block = (index: number) => typeof element.children[index] !== "string" && /^(div|p|h[1-6])$/.test((element.children[index] as Element).tag);
  const words = classNames(element).flat();
  const row = words.includes("flex") && !words.some(word => /^(col|column)$/.test(word));
  const column = (element.attributes.class ?? "").split(/\s+/).some(name => /^flex-col(umn)?$/.test(name));
  const touching = (before: number, after: number) => !row && element.children.slice(before + 1, after).every(between => !raw(between))
    && /[\p{L}\p{N}.!?)]$/u.test(raw(element.children[before])) && /^\p{L}/u.test(raw(element.children[after]))
    && shownPart(element.children[after]).includes(" ");
  const end = parts.findIndex((index, at) => at > 0 && (column || block(index) || block(parts[at - 1]) || touching(parts[at - 1], index)));
  if (end > 0) {
    const first = element.children.slice(parts[0], parts[end - 1] + 1);
    if (first.length === 1 && typeof first[0] !== "string") return firstLine(first[0]) || visible(first[0]);
    return visible({ tag: "span", attributes: {}, children: first });
  }
  const only = parts.length === 1 ? element.children[parts[0]] : undefined;
  return only && typeof only !== "string" ? firstLine(only) : "";
}

/** A stack of just this link's text elements, discarded when the link closes. */
export class LinkText {
  private root: Element;
  private stack: Element[];
  constructor(attributes: Record<string, string>) {
    this.root = { tag: "a", attributes, children: [] };
    this.stack = [this.root];
  }
  // Adjacent text is one text, even when the page splits it with comments ("Microsoft<!-- --> 365").
  text(value: string) {
    const children = this.stack.at(-1)!.children;
    if (typeof children.at(-1) === "string") children[children.length - 1] += value;
    else children.push(value);
  }
  open(tag: string, attributes: Record<string, string>) {
    const element: Element = { tag, attributes, children: [] };
    this.stack.at(-1)!.children.push(element);
    if (!VOID.has(tag)) this.stack.push(element);
  }
  close(tag: string) {
    const at = this.stack.findLastIndex(element => element.tag === tag);
    if (at > 0) this.stack.splice(at);
  }
  /** Whether the link's name came from a heading or title element inside it. */
  titled() { return Boolean(titles(this.root)[0]); }
  /** Whether the link is inside an element hidden from assistive technology, such as a decorative arrow. */
  hidden() { return this.stack.some(hidden); }
  /** A supporting line supplied a short label rather than an explicit title or plain link name. */
  described() { return Boolean(firstLine(this.root)); }
  /** The link's name, and whether the link shows it: a title inside the link, its first line or its shown text, or
   * its first line when every line is description-styled ("Orbit" over "Content creation and publishing"). A tooltip
   * (title attribute) names a link that shows only a description. An aria-label or image alt alone is never shown. */
  name(fallback: string): { name: string; shown: boolean } {
    const lines = shownLines(this.root);
    const shown = titles(this.root)[0] || firstLine(this.root) || visible(this.root) || (lines.length > 1 ? lines[0] : "");
    if (shown) return { name: shown, shown: true };
    const tooltip = this.root.attributes.title;
    return { name: cleanComponentName(tooltip ?? fallback), shown: tooltip !== undefined && lines.length > 0 };
  }
}
