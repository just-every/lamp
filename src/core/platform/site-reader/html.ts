import { LinkText } from "./link-text.ts";
import { cleanText, decodeEntities } from "./text.ts";
export { cleanText, decodeEntities } from "./text.ts";

/** A tolerant text scan with a stack for navigation groups and link labels.
 * No page DOM is created and none of the page's scripts run. */
export interface HtmlTag { name: string; attributes: Record<string, string> }
export interface HtmlAnchor { href: string; text: string; name: string; groups: string[]; accountNavigation: boolean; region: "nav" | "header" | "footer" | "body" }
/** `prose` is the page's readable text outside links. */
export interface HtmlScan { title: string | null; tags: HtmlTag[]; anchors: HtmlAnchor[]; styles: string[]; prose: string }

const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const RAW_TEXT = new Set(["script", "style", "template", "noscript", "textarea", "svg"]);
const KEPT = new Set(["meta", "link", "img"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

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
  const stack: { tag: string; group: string; accountNavigation: boolean; label?: string }[] = [];
  const lower = html.toLowerCase();
  let title: string | null = null, titleStart = -1;
  let anchor: { href: string; text: string; label: string; parts: LinkText; region: HtmlAnchor["region"]; groups: string[]; accountNavigation: boolean } | null = null;
  TAG.lastIndex = 0;
  let previous = 0;
  for (let match = TAG.exec(html); match; match = TAG.exec(html)) {
    const text = html.slice(previous, match.index);
    if (anchor) { anchor.text += ` ${text}`; anchor.parts.text(text); }
    else prose.push(text);
    for (const frame of stack) if (frame.label !== undefined) frame.label += ` ${text}`;
    previous = TAG.lastIndex;
    if (match[0].startsWith("<!--")) continue;
    const closing = match[1] === "/", name = match[2].toLowerCase();
    if (!closing && RAW_TEXT.has(name)) {
      const end = lower.indexOf(`</${name}`, TAG.lastIndex);
      if (name === "style") styles.push(html.slice(TAG.lastIndex, end < 0 ? html.length : end));
      if (name === "svg" && anchor) anchor.label ||= attributesOf(match[3])["aria-label"] ?? "";
      TAG.lastIndex = end < 0 ? html.length : end;
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
        anchors.push({ href: anchor.href, text: cleanText(anchor.text) || cleanText(anchor.label), name: anchor.parts.name(anchor.label), region: anchor.region, groups: anchor.groups, accountNavigation: anchor.accountNavigation });
        anchor = null;
      } else anchor?.parts.close(name);
      const at = stack.findLastIndex(frame => frame.tag === name);
      if (at >= 0) {
        const label = stack[at].label;
        stack.splice(at);
        if (label && stack.length) stack.at(-1)!.group = cleanText(label);
      }
      continue;
    }
    const attributes = attributesOf(match[3]);
    if (name === "a") {
      const region = (["nav", "header", "footer"] as const).find(kind => stack.some(frame => frame.tag === kind)) ?? "body";
      anchor = attributes.href ? { href: attributes.href, text: "", label: attributes["aria-label"] ?? attributes.title ?? "", parts: new LinkText(attributes), region, groups: stack.map(frame => frame.group).filter(Boolean), accountNavigation: stack.some(frame => frame.accountNavigation) } : null;
    } else anchor?.parts.open(name, attributes);
    if (name === "img" && anchor) anchor.label ||= attributes.alt ?? "";
    else if (KEPT.has(name)) tags.push({ name, attributes });
    if (!VOID.has(name) && !/\/\s*>$/.test(match[0])) stack.push({ tag: name, group: attributes["aria-label"] ?? "",
      accountNavigation: /^(auth|authenticated|isAuthenticated|loggedIn|isLoggedIn|signedIn|isSignedIn)$/i.test(attributes["x-show"] ?? ""),
      ...(!anchor && (/^(button|h[1-6]|summary)$/.test(name) || attributes.role === "heading" || /(?:^|[\s_-])(title|heading)(?:$|[\s_-])/i.test(attributes.class ?? "")) ? { label: "" } : {}) });
  }
  return { title, tags, anchors, styles, prose: cleanText(prose.join(" ")) };
}
