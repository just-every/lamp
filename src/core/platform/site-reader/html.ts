/** A small, tolerant HTML scan: tags, attributes, anchor text and inline
 * styles. It never builds a DOM and never runs anything the page contains. */
export interface HtmlTag { name: string; attributes: Record<string, string> }
export interface HtmlAnchor { href: string; text: string; region: "nav" | "header" | "footer" | "body" }
export interface HtmlScan { title: string | null; tags: HtmlTag[]; anchors: HtmlAnchor[]; styles: string[] }

const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const RAW_TEXT = new Set(["script", "style", "template", "noscript", "textarea", "svg"]);
const KEPT = new Set(["meta", "link", "a", "img", "title"]);
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", middot: "·", raquo: "»", laquo: "«", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", bull: "•", copy: "©", reg: "®", trade: "™" };

export function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return NAMED[entity.toLowerCase()] ?? match;
  });
}

export const cleanText = (value: string) => decodeEntities(value).replace(/\s+/g, " ").trim();

function attributesOf(source: string) {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    if (!(name in attributes)) attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

export function scanHtml(html: string): HtmlScan {
  const tags: HtmlTag[] = [];
  const anchors: HtmlAnchor[] = [];
  const styles: string[] = [];
  const regions: string[] = [];
  let title: string | null = null;
  let anchor: { href: string; text: string; label: string; region: HtmlAnchor["region"] } | null = null;
  let titleStart = -1;
  TAG.lastIndex = 0;
  let previous = 0;
  for (let match = TAG.exec(html); match; match = TAG.exec(html)) {
    if (anchor) anchor.text += ` ${html.slice(previous, match.index)}`;
    previous = TAG.lastIndex;
    if (match[0].startsWith("<!--")) continue;
    const closing = match[1] === "/";
    const name = match[2].toLowerCase();
    if (!closing && RAW_TEXT.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, TAG.lastIndex);
      const body = html.slice(TAG.lastIndex, end < 0 ? html.length : end);
      if (name === "style") styles.push(body);
      if (name === "svg" && anchor) anchor.label ||= attributesOf(match[3])["aria-label"] ?? "";
      TAG.lastIndex = end < 0 ? html.length : end;
      previous = TAG.lastIndex;
      continue;
    }
    if (name === "nav" || name === "header" || name === "footer") {
      if (closing) { const at = regions.lastIndexOf(name); if (at >= 0) regions.splice(at); }
      else regions.push(name);
      continue;
    }
    if (name === "title") {
      if (!closing) titleStart = TAG.lastIndex;
      else if (titleStart >= 0 && title === null) title = cleanText(html.slice(titleStart, match.index)) || null;
      continue;
    }
    if (name === "a" && closing) {
      if (anchor) {
        const text = cleanText(anchor.text) || cleanText(anchor.label);
        anchors.push({ href: anchor.href, text, region: anchor.region });
      }
      anchor = null;
      continue;
    }
    if (closing || !KEPT.has(name)) continue;
    const attributes = attributesOf(match[3]);
    if (name === "a") {
      const region = (["nav", "header", "footer"] as const).find((kind) => regions.includes(kind)) ?? "body";
      anchor = attributes.href ? { href: attributes.href, text: "", label: attributes["aria-label"] ?? attributes.title ?? "", region } : null;
      continue;
    }
    if (name === "img" && anchor) { anchor.label ||= attributes.alt ?? ""; continue; }
    tags.push({ name, attributes });
  }
  return { title, tags, anchors, styles };
}
