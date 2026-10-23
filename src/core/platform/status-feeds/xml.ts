import { decodeEntities } from "../site-reader/text.ts";

/** One Atom entry or RSS item: the text of each child element (the first of each name) and every <link>'s attributes. */
export interface FeedEntry { fields: Record<string, string>; links: Array<Record<string, string>> }

const ENTRY = /<(entry|item)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
const OPEN = /<([a-zA-Z][\w:.-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTRIBUTE = /([^\s"'>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

function attributes(source: string) {
  const found: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) found[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  return found;
}

/** An element's text: CDATA verbatim, everything else with its entities decoded. */
function elementText(inner: string) {
  let text = "";
  let at = 0;
  for (const match of inner.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    text += decodeEntities(inner.slice(at, match.index)) + match[1];
    at = match.index + match[0].length;
  }
  return (text + decodeEntities(inner.slice(at))).trim();
}

/** A tolerant scan of a feed's entries, without a DOM: each entry's direct children by name. */
export function feedEntries(xml: string): FeedEntry[] {
  return [...xml.matchAll(ENTRY)].map(([, , body]) => {
    const fields: Record<string, string> = {}, links: Array<Record<string, string>> = [];
    OPEN.lastIndex = 0;
    for (let match = OPEN.exec(body); match; match = OPEN.exec(body)) {
      const name = match[1].toLowerCase();
      if (match[3] === "/") {
        if (name === "link") links.push(attributes(match[2]));
        continue;
      }
      const close = body.toLowerCase().indexOf(`</${name}`, OPEN.lastIndex);
      if (close < 0) continue;
      const inner = body.slice(OPEN.lastIndex, close);
      if (name === "link") links.push({ ...attributes(match[2]), text: elementText(inner) });
      if (!(name in fields)) fields[name] = elementText(inner);
      OPEN.lastIndex = body.indexOf(">", close) + 1;
    }
    return { fields, links };
  });
}

/** Markup as plain text, as a browser shows it: source line breaks are spaces, <br> and paragraphs break lines. */
export function htmlText(html: string) {
  return decodeEntities(html.replace(/\s+/g, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p\b[^>]*>/gi, "\n\n").replace(/<[^>]*>/g, ""))
    .replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
