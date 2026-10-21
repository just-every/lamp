import { LinkText } from "./link-text.ts";
import { cleanText, decodeEntities } from "./text.ts";
export { cleanText, decodeEntities } from "./text.ts";

/** A tolerant text scan with a stack for navigation groups and link labels.
 * No page DOM is created and none of the page's scripts run. */
export interface HtmlTag { name: string; attributes: Record<string, string> }
/** `titleRank`: 2 for a title inside the link, 1 for a heading around it, 0 for plain link text.
 * `shown` says whether the link or its card shows the name; an icon named only by aria-label or alt text does not.
 * `description` is the first text after the link inside its card ("Analyst reports and studies" beside "Reports").
 * `region` is where the link is navigation: any `<nav>`, including one inside the footer, is "nav".
 * `footer` says whether the link sits in the page footer, whose names rank below the header's. */
export interface HtmlAnchor { href: string; text: string; name: string; titleRank: 0 | 1 | 2; described: boolean; shown: boolean; description: string; groups: string[]; accountNavigation: boolean; region: "nav" | "header" | "footer" | "body"; footer: boolean }
/** `prose` is the page's readable text outside links. */
export interface HtmlScan { title: string | null; tags: HtmlTag[]; anchors: HtmlAnchor[]; styles: string[]; prose: string }

const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const RAW_TEXT = new Set(["script", "style", "template", "noscript", "textarea", "svg"]);
const KEPT = new Set(["meta", "link", "img"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const LABEL = /^(button|h[1-6]|summary)$/;
const LIST = /^(ul|ol)$/;

interface Frame { tag: string; group: string; accountNavigation: boolean; heading: boolean; label?: string; start: number; links: number }

/** A menu button or heading, less its disclosure arrow and the copy a responsive layout repeats ("Resources Resources ↓"). */
function groupLabel(text: string) {
  const label = cleanText(text).replace(/[\s↓↑→←›»▾▼▿⌄˅+:]+$/u, "");
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

/** Whether a visible heading spells a link's name. */
const spells = (heading: string, name: string) => Boolean(name) && heading.toLowerCase() === name.toLowerCase();

/** Text that heads a list labels it, like a menu button, even in a plain element: `<li><span>Use Cases</span><ul>`,
 * `<div><div><span>Services</span></div><ul>`. It is the short text, with no link, just before the list inside the
 * list's parent, or inside a wrapper's parent when the wrapper holds nothing else ("<li><span>Use Cases</span><div><ul>"). */
function listLabel(html: string, stack: Frame[], end: number, links: number) {
  for (const frame of stack.slice(-3).reverse()) {
    if (frame.links !== links || end - frame.start > 8000) return "";
    // A button beside the label ("Back" in a mobile menu) is a control, not part of it.
    const text = cleanText(html.slice(frame.start, end).replace(/<!--[\s\S]*?-->|<(svg|script|style|template|noscript|button)\b[\s\S]*?<\/\1\s*>|<[^>]*>/gi, " "));
    if (!text) continue;
    const label = groupLabel(text);
    return label.length <= 60 && label.split(" ").length <= 6 && label !== frame.group ? label : "";
  }
  return "";
}

export function scanHtml(html: string): HtmlScan {
  const tags: HtmlTag[] = [], anchors: HtmlAnchor[] = [], styles: string[] = [], prose: string[] = [];
  const stack: Frame[] = [];
  const lower = html.toLowerCase();
  let title: string | null = null, titleStart = -1;
  let anchor: { href: string; text: string; label: string; parts: LinkText; region: HtmlAnchor["region"]; footer: boolean; groups: string[]; accountNavigation: boolean; heading: boolean } | null = null;
  // The link just closed, until the first text after it inside its card (its description) is read.
  let trailing: { anchor: HtmlAnchor; depth: number } | null = null;
  TAG.lastIndex = 0;
  let previous = 0;
  for (let match = TAG.exec(html); match; match = TAG.exec(html)) {
    const text = html.slice(previous, match.index);
    // The link's text is what it shows; an aria-hidden arrow or icon is decoration.
    if (anchor) { if (!anchor.parts.hidden()) anchor.text += ` ${text}`; anchor.parts.text(text); }
    else prose.push(text);
    for (const frame of stack) if (frame.label !== undefined) frame.label += ` ${text}`;
    // The first text after a link inside its card describes it, unless it is the card's title (read when the title closes).
    if (trailing && cleanText(text) && !stack.some(frame => frame.label !== undefined)) {
      trailing.anchor.description = cleanText(text).slice(0, 200);
      trailing = null;
    }
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
        const { name, shown } = anchor.parts.name(anchor.label);
        // A name the link does not show is shown by a visible card title: the heading just before it or the one after it.
        anchors.push({ href: anchor.href, text: cleanText(anchor.text) || cleanText(anchor.label), name, titleRank: anchor.parts.titled() ? 2 : anchor.heading ? 1 : 0, described: anchor.parts.described(), shown: shown || spells(anchor.groups.at(-1) ?? "", name), description: "", region: anchor.region, footer: anchor.footer, groups: anchor.groups, accountNavigation: anchor.accountNavigation });
        anchor = null;
        // The card is the link's grandparent, open while the stack is at least this deep (the <a> frame is still on it).
        trailing = { anchor: anchors.at(-1)!, depth: Math.max(stack.findLastIndex(frame => frame.tag === "a") - 1, 1) };
      } else anchor?.parts.close(name);
      const at = stack.findLastIndex(frame => frame.tag === name);
      if (at >= 0) {
        const label = stack[at].label;
        stack.splice(at);
        if (label && stack.length) stack.at(-1)!.group = groupLabel(label);
        if (label !== undefined && trailing && !stack.some(frame => frame.label !== undefined)) {
          // A card's visible title names the overlay link before it: <a aria-label="Capture"></a> … <h3>Capture</h3>.
          trailing.anchor.shown ||= spells(groupLabel(label), trailing.anchor.name);
          trailing = null;
        }
        // Text after a list or link no longer heads the next list from the start of their parent.
        if ((name === "a" || LIST.test(name)) && stack.length) Object.assign(stack.at(-1)!, { start: TAG.lastIndex, links: anchors.length });
      }
      if (trailing && stack.length < trailing.depth) trailing = null;
      continue;
    }
    const attributes = attributesOf(match[3]);
    if (name === "a") {
      trailing = null;
      const region = (["nav", "header", "footer"] as const).find(kind => stack.some(frame => frame.tag === kind)) ?? "body";
      anchor = attributes.href ? { href: attributes.href, text: "", label: attributes["aria-label"] ?? attributes.title ?? "", parts: new LinkText(attributes), region, footer: stack.some(frame => frame.tag === "footer"), groups: stack.map(frame => frame.group).filter(Boolean), accountNavigation: stack.some(frame => frame.accountNavigation), heading: stack.some(frame => frame.heading) } : null;
    } else anchor?.parts.open(name, attributes);
    if (name === "img" && anchor) anchor.label ||= attributes.alt ?? "";
    else if (KEPT.has(name)) tags.push({ name, attributes });
    if (!VOID.has(name) && !/\/\s*>$/.test(match[0])) stack.push({ tag: name, start: TAG.lastIndex, links: anchors.length,
      group: attributes["aria-label"] || (!anchor && LIST.test(name) ? listLabel(html, stack, match.index, anchors.length) : ""),
      heading: /^h[1-6]$/.test(name) || attributes.role === "heading",
      accountNavigation: /^(auth|authenticated|isAuthenticated|loggedIn|isLoggedIn|signedIn|isSignedIn)$/i.test(attributes["x-show"] ?? ""),
      ...(!anchor && (LABEL.test(name) || attributes.role === "heading" || /(?:^|[\s_-])(title|heading)(?:$|[\s_-])/i.test(attributes.class ?? "")) ? { label: "" } : {}) });
  }
  return { title, tags, anchors, styles, prose: cleanText(prose.join(" ")) };
}
