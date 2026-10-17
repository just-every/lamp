import { marked } from "marked";
import entities from "./html-entities.json";

const namedEntities: Record<string, string> = entities;
function decode(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z\d]+);/giu, (original, entity: string) => {
    if (!entity.startsWith("#")) return namedEntities[`${entity};`] ?? original;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : original;
  });
}

function attribute(tag: string, name: string) {
  const match = new RegExp(`(?:\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "iu").exec(tag);
  return match ? decode(match[1] ?? match[2] ?? match[3]) : "";
}

/** Convert Markdown and source HTML into text before it reaches any renderer.
 * All image references become literal descriptions; no media is requested.
 * Decode text only after recognizing tags, so escaped markup stays wording. */
export function richTextToPlain(source: string): string {
  const html = marked.parse(source, { async: false, gfm: true });
  const tags = /<!--[\s\S]*?-->|<\/?[a-z][a-z\d:-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>/giu;
  let output = "", offset = 0;
  const links: Array<{ href: string; title: string; start: number }> = [];
  for (const match of html.matchAll(tags)) {
    output += decode(html.slice(offset, match.index));
    offset = match.index + match[0].length;
    const tag = match[0];
    if (tag.startsWith("<!--")) continue;
    const name = /^<\/?([a-z\d:-]+)/iu.exec(tag)![1].toLowerCase();
    const closing = tag.startsWith("</");
    if (name === "a") {
      if (!closing) links.push({ href: attribute(tag, "href"), title: attribute(tag, "title"), start: output.length });
      else {
        const link = links.pop();
        if (link?.href && output.slice(link.start).trim() !== link.href) output += ` (${link.href})`;
        if (link?.title) output += ` [${link.title}]`;
      }
    } else if (name === "img") {
      const alt = attribute(tag, "alt"), url = attribute(tag, "src"), title = attribute(tag, "title"), sources = attribute(tag, "srcset");
      output += `[Image${alt ? `: ${alt}` : ""}${title ? ` — ${title}` : ""}${url ? ` (${url})` : ""}${sources ? `; sources: ${sources}` : ""}]`;
    } else if (name === "br" || name === "li" || name === "tr") output += "\n";
    else if (name === "td" || name === "th") output += closing ? "\t" : "";
    else if (/^(?:p|h[1-6]|div|section|article|blockquote|pre|ul|ol|table|hr)$/u.test(name)) output += "\n\n";
  }
  output += decode(html.slice(offset));
  for (const link of links) if (link.href) output += ` (${link.href})`;
  return output.replace(/\r\n?/gu, "\n").replace(/[ \t]+\n/gu, "\n").replace(/\n[ \t]+/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
}
