import { cleanText } from "./text.ts";

interface Element { tag: string; attributes: Record<string, string>; children: (Element | string)[] }
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const TOKEN = String.raw`new|beta|alpha|soon|coming soon|preview|updated|\d[\d,.]*\+?`;
/** A badge on its own: NEW, Beta, Soon, a count, bracketed or bare. */
const BADGE = new RegExp(String.raw`^(?:\(\s*(?:${TOKEN})\s*\)|\[\s*(?:${TOKEN})\s*\]|${TOKEN})$`, "i");
// Inside one text, a trailing badge is set off by brackets or a separator ("Search (42)", "Docs · Beta")...
const MARKED = new RegExp(String.raw`\s*(?:\((?:${TOKEN})\)|\[(?:${TOKEN})\]|[·|•]\s*(?:${TOKEN}))$`, "i");
// ...or shouted after a name in mixed case ("Metrics BETA"). "What's New", "Microsoft 365" and "Build Preview" are names.
const SHOUTED = /\s+(?:NEW|BETA|ALPHA|SOON|COMING SOON|PREVIEW|UPDATED)$/;
const EMOJI = /\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*|\p{Regional_Indicator}{2}|[\u200D\uFE0F\u20E3]/gu;
const plain = (value: string) => cleanText(cleanText(value).replace(EMOJI, "")).replace(/[\s›»→↗➔>]+$/u, "");

/** Only decoration is removed lexically; descriptions are separated by markup. */
export function cleanComponentName(value: string) {
  let text = plain(value);
  for (;;) {
    const unmarked = text.replace(MARKED, "").trim();
    const unshouted = text.replace(SHOUTED, "").trim();
    const next = unmarked !== text ? unmarked : /\p{Ll}/u.test(unshouted) ? unshouted : text;
    if (next === text) break;
    text = next;
  }
  return BADGE.test(text) ? "" : text;
}

const role = (element: Element) => {
  const hint = `${element.attributes.class ?? ""} ${element.attributes["data-slot"] ?? ""}`;
  if (element.attributes["aria-hidden"] === "true" || "hidden" in element.attributes || /(?:^|[\s_-])(badge|pill|chip)(?:$|[\s_-])/i.test(hint)) return "decoration";
  if (/^(small|p)$/.test(element.tag) || /(?:^|[\s_-])(description|subtitle|summary|caption|detail)(?:$|[\s_-])/i.test(hint)) return "description";
  if (/^h[1-6]$/.test(element.tag) || /(?:^|[\s_-])(title|name|label)(?:$|[\s_-])/i.test(hint)) return "title";
  return "text";
};

/** The element's text, less trailing segments (a child element or a separate text) that are only a badge. */
function shown(element: Element): string {
  if (["decoration", "description"].includes(role(element))) return "";
  const parts = element.children.map(child => typeof child === "string" ? child : shown(child)).filter(part => plain(part));
  while (parts.length > 1 && BADGE.test(plain(parts.at(-1)!))) parts.pop();
  return parts.join(" ");
}
const visible = (element: Element) => cleanComponentName(shown(element));

function titles(element: Element): string[] {
  if (["decoration", "description"].includes(role(element))) return [];
  if (role(element) === "title") return [visible(element)].filter(Boolean);
  return element.children.flatMap(child => typeof child === "string" ? [] : titles(child));
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
  name(fallback: string) {
    const named = titles(this.root)[0];
    if (named) return named;
    // Separate block siblings express a label followed by supporting text.
    const firstBlock = (element: Element): string => {
      const blocks = element.children.filter((child): child is Element => typeof child !== "string" && /^(div|p|h[1-6])$/.test(child.tag) && Boolean(visible(child)));
      if (blocks.length > 1) return firstBlock(blocks[0]) || visible(blocks[0]);
      if (blocks.length === 1 && !element.children.some(child => typeof child === "string" && cleanComponentName(child))) return firstBlock(blocks[0]);
      return "";
    };
    return firstBlock(this.root) || visible(this.root) || cleanComponentName(this.root.attributes.title ?? fallback);
  }
}
