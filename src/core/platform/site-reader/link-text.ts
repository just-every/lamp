import { cleanText } from "./text.ts";

interface Element { tag: string; attributes: Record<string, string>; children: (Element | string)[] }
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const BADGE = /^(?:new|beta|alpha|soon|coming soon|preview|updated|\(?\d[\d,.]*\+?\)?)$/i;
const SUFFIX = /(?:\s+|\s*[([·|])(?:new|beta|alpha|soon|coming soon|preview|updated|\d[\d,.]*\+?)[)\]]?$/i;

/** Only decoration is removed lexically; descriptions are separated by markup. */
export function cleanComponentName(value: string) {
  let text = cleanText(value).replace(/\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*|\p{Regional_Indicator}{2}|[\u200D\uFE0F\u20E3]/gu, "");
  text = cleanText(text).replace(/[\s›»→↗➔>]+$/u, "");
  while (SUFFIX.test(text)) text = text.replace(SUFFIX, "").trim();
  return BADGE.test(text) ? "" : text;
}

const role = (element: Element) => {
  const hint = `${element.attributes.class ?? ""} ${element.attributes["data-slot"] ?? ""}`;
  if (element.attributes["aria-hidden"] === "true" || "hidden" in element.attributes || /(?:^|[\s_-])(badge|pill|chip)(?:$|[\s_-])/i.test(hint)) return "decoration";
  if (/^(small|p)$/.test(element.tag) || /(?:^|[\s_-])(description|subtitle|summary|caption|detail)(?:$|[\s_-])/i.test(hint)) return "description";
  if (/^h[1-6]$/.test(element.tag) || /(?:^|[\s_-])(title|name|label)(?:$|[\s_-])/i.test(hint)) return "title";
  return "text";
};

function visible(element: Element): string {
  if (["decoration", "description"].includes(role(element))) return "";
  return cleanComponentName(element.children.map(child => typeof child === "string" ? child : visible(child)).join(" "));
}

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
  text(value: string) { this.stack.at(-1)!.children.push(value); }
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
