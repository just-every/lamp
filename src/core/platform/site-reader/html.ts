import { LinkText } from "./link-text.ts";
import { cleanText, decodeEntities } from "./text.ts";
export { cleanText, decodeEntities } from "./text.ts";

/** A tolerant text scan with a stack for navigation groups and link labels.
 * No page DOM is created and none of the page's scripts run. */
export interface HtmlTag { name: string; attributes: Record<string, string> }
/** `titleRank`: 2 for a title inside the link, 1 for a heading around it, 0 for plain link text.
 * `region` is where the link is navigation: any `<nav>`, including one inside the footer, is "nav".
 * `footer` says whether the link sits in the page footer, whose names rank below the header's. */
export interface HtmlAnchor { href: string; text: string; name: string; titleRank: 0 | 1 | 2; described: boolean; groups: string[]; accountNavigation: boolean; region: "nav" | "header" | "footer" | "body"; footer: boolean }
/** `prose` is the page's readable text outside links. */
export interface HtmlScan { title: string | null; tags: HtmlTag[]; anchors: HtmlAnchor[]; styles: string[]; prose: string }

const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const RAW_TEXT = new Set(["script", "style", "template", "noscript", "textarea", "svg"]);
const KEPT = new Set(["meta", "link", "img"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/** A menu button or heading, less its disclosure arrow and the copy a responsive layout repeats ("Resources Resources ↓"). */
function groupLabel(text: string) {
  const label = cleanText(text).replace(/[\s↓↑→←›»▾▼▿⌄˅+]+$/u, "");
  const words = label.split(" ");
  const half = words.slice(0, words.length / 2).join(" ");
  return words.length % 2 === 0 && half === words.slice(words.length / 2).join(" ") ? half : label;
}

function attributesOf(source: string) {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    if (!(name in attributes)) attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

export function scanHtml(html: string): HtmlScan {
  const tags: HtmlTag[] = [], anchors: HtmlAnchor[] = [], styles: string[] = [], prose: string[] = [];
  const stack: { tag: string; group: string; accountNavigation: boolean; heading: boolean; label?: string }[] = [];
  const lower = html.toLowerCase();
  let title: string | null = null, titleStart = -1;
  let anchor: { href: string; text: string; label: string; parts: LinkText; region: HtmlAnchor["region"]; footer: boolean; groups: string[]; accountNavigation: boolean; heading: boolean } | null = null;
  TAG.lastIndex = 0;
  let previous = 0;
  for (let match = TAG.exec(html); match; match = TAG.exec(html)) {
    const text = html.slice(previous, match.index);
    // The link's text is what it shows; an aria-hidden arrow or icon is decoration.
    if (anchor) { if (!anchor.parts.hidden()) anchor.text += ` ${text}`; anchor.parts.text(text); }
    else prose.push(text);
    for (const frame of stack) if (frame.label !== undefined) frame.label += ` ${text}`;
    previous = TAG.lastIndex;
    if (match[0].startsWith("<!--")) continue;
    const closing = match[1] === "/", name = match[2].toLowerCase();
    if (!closing && RAW_TEXT.has(name)) {
      const end = lower.indexOf(`</${name}`, TAG.lastIndex);
      if (name === "style") styles.push(html.slice(TAG.lastIndex, end < 0 ? html.length : end));
      if (name === "svg" && anchor) anchor.label ||= attributesOf(match[3])["aria-label"] ?? "";
      // The closing tag runs to its ">", as a browser reads it, even when the page leaves it unfinished ("</svg </span>").
      const after = end < 0 ? -1 : html.indexOf(">", end);
      TAG.lastIndex = after < 0 ? html.length : after + 1;
      previous = TAG.lastIndex;
      continue;
    }
    if (name === "title") {
      if (!closing) titleStart = TAG.lastIndex;
      else if (titleStart >= 0 && title === null) title = cleanText(html.slice(titleStart, match.index)) || null;
      continue;
    }
    if (closing) {
      if (name === "a" && anchor) {
        anchors.push({ href: anchor.href, text: cleanText(anchor.text) || cleanText(anchor.label), name: anchor.parts.name(anchor.label), titleRank: anchor.parts.titled() ? 2 : anchor.heading ? 1 : 0, described: anchor.parts.described(), region: anchor.region, footer: anchor.footer, groups: anchor.groups, accountNavigation: anchor.accountNavigation });
        anchor = null;
      } else anchor?.parts.close(name);
      const at = stack.findLastIndex(frame => frame.tag === name);
      if (at >= 0) {
        const label = stack[at].label;
        stack.splice(at);
        if (label && stack.length) stack.at(-1)!.group = groupLabel(label);
      }
      continue;
    }
    const attributes = attributesOf(match[3]);
    if (name === "a") {
      const region = (["nav", "header", "footer"] as const).find(kind => stack.some(frame => frame.tag === kind)) ?? "body";
      anchor = attributes.href ? { href: attributes.href, text: "", label: attributes["aria-label"] ?? attributes.title ?? "", parts: new LinkText(attributes), region, footer: stack.some(frame => frame.tag === "footer"), groups: stack.map(frame => frame.group).filter(Boolean), accountNavigation: stack.some(frame => frame.accountNavigation), heading: stack.some(frame => frame.heading) } : null;
    } else anchor?.parts.open(name, attributes);
    if (name === "img" && anchor) anchor.label ||= attributes.alt ?? "";
    else if (KEPT.has(name)) tags.push({ name, attributes });
    if (!VOID.has(name) && !/\/\s*>$/.test(match[0])) stack.push({ tag: name, group: attributes["aria-label"] ?? "", heading: /^h[1-6]$/.test(name) || attributes.role === "heading",
      accountNavigation: /^(auth|authenticated|isAuthenticated|loggedIn|isLoggedIn|signedIn|isSignedIn)$/i.test(attributes["x-show"] ?? ""),
      ...(!anchor && (/^(button|h[1-6]|summary)$/.test(name) || attributes.role === "heading" || /(?:^|[\s_-])(title|heading)(?:$|[\s_-])/i.test(attributes.class ?? "")) ? { label: "" } : {}) });
  }
  return { title, tags, anchors, styles, prose: cleanText(prose.join(" ")) };
}
