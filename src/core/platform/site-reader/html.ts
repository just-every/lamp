import { LinkText } from "./link-text.ts";
import { cleanText, decodeEntities } from "./text.ts";
export { cleanText, decodeEntities } from "./text.ts";

/** A tolerant text scan with a stack for navigation groups and link labels.
 * No page DOM is created and none of the page's scripts run. */
export interface HtmlTag { name: string; attributes: Record<string, string> }
/** `titled`: the name is a heading, inside the link or around it. `lines`: the shown text as a reader sees it in lines. */
export interface HtmlAnchor { href: string; text: string; name: string; lines: string[]; titled: boolean; groups: string[]; accountNavigation: boolean; region: "nav" | "header" | "footer" | "body" }
/** One step of the navigation in reading order: a menu's or heading's own text, or a link (its index in `anchors`).
 * `footer` says the step sits in the page footer. `describes`: the text sits inside the element that holds the link before
 * it, and that element ends before the next link starts (a card's tagline), so it describes that link (its index). */
export interface HtmlOutlineStep { text?: string; anchor?: number; footer: boolean; describes?: number }
/** `prose` is the page's readable text outside links. `outline` is every header, nav and footer in reading order;
 * `headings` are the page's own h1 and h2 headings outside them. */
export interface HtmlScan { title: string | null; tags: HtmlTag[]; anchors: HtmlAnchor[]; styles: string[]; prose: string; outline: HtmlOutlineStep[]; headings: string[] }

const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const RAW_TEXT = new Set(["script", "style", "template", "noscript", "textarea", "svg"]);
const KEPT = new Set(["meta", "link", "img"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const NAVIGATION = new Set(["nav", "header", "footer"]);
// Elements too wide to be one link's card: a text inside them describes no particular link.
const LANDMARKS = new Set(["html", "body", "main", "nav", "header", "footer"]);

function attributesOf(source: string) {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    if (!(name in attributes)) attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

export function scanHtml(html: string): HtmlScan {
  const tags: HtmlTag[] = [], anchors: HtmlAnchor[] = [], styles: string[] = [], prose: string[] = [], outline: HtmlOutlineStep[] = [], headings: string[] = [];
  const stack: { id: number; tag: string; group: string; accountNavigation: boolean; heading: boolean; label?: string }[] = [];
  // The last link and the elements around it, and the texts after it that sit inside one of them (an element id each).
  let frames = 0, last: { anchor: number; around: number[] } | null = null, after: { step: HtmlOutlineStep; holder: number }[] = [];
  const open = (id: number) => stack.some(frame => frame.id === id);
  const settle = () => { for (const { step, holder } of after) if (!open(holder)) step.describes = last!.anchor; after = []; };
  const lower = html.toLowerCase();
  let title: string | null = null, titleStart = -1;
  let anchor: { href: string; text: string; label: string; parts: LinkText; region: HtmlAnchor["region"]; footer: boolean; groups: string[]; accountNavigation: boolean; heading: boolean } | null = null;
  TAG.lastIndex = 0;
  let previous = 0;
  for (let match = TAG.exec(html); match; match = TAG.exec(html)) {
    const text = html.slice(previous, match.index);
    if (anchor) { anchor.text += ` ${text}`; anchor.parts.text(text); }
    else {
      prose.push(text);
      if (cleanText(text) && stack.some(frame => NAVIGATION.has(frame.tag))) {
        const step: HtmlOutlineStep = { text: cleanText(text), footer: stack.some(frame => frame.tag === "footer") };
        outline.push(step);
        const holder = last?.around.findLast(id => open(id));
        if (holder !== undefined && !LANDMARKS.has(stack.find(frame => frame.id === holder)!.tag)) after.push({ step, holder });
      }
    }
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
        anchors.push({ href: anchor.href, text: cleanText(anchor.text) || cleanText(anchor.label), name: anchor.parts.name(anchor.label), lines: anchor.parts.lines(), titled: anchor.heading || anchor.parts.titled(), region: anchor.region, groups: anchor.groups, accountNavigation: anchor.accountNavigation });
        if (anchor.region !== "body") { outline.push({ anchor: anchors.length - 1, footer: anchor.footer }); last = { anchor: anchors.length - 1, around: [] }; }
        anchor = null;
      } else anchor?.parts.close(name);
      const at = stack.findLastIndex(frame => frame.tag === name);
      if (at >= 0) {
        const label = stack[at].label;
        if (label && /^h[12]$/.test(name) && !stack.slice(0, at).some(frame => NAVIGATION.has(frame.tag)) && cleanText(label)) headings.push(cleanText(label));
        stack.splice(at);
        if (label && stack.length) stack.at(-1)!.group = cleanText(label);
        if (name === "a" && last?.anchor === anchors.length - 1 && !last.around.length) last.around = stack.map(frame => frame.id);
      }
      continue;
    }
    const attributes = attributesOf(match[3]);
    if (name === "a") {
      // A text after the last link describes it only if the element holding both ended before this link.
      if (attributes.href && last) settle();
      const region = (["nav", "header", "footer"] as const).find(kind => stack.some(frame => frame.tag === kind)) ?? "body";
      anchor = attributes.href ? { href: attributes.href, text: "", label: attributes["aria-label"] ?? attributes.title ?? "", parts: new LinkText(attributes), region, footer: stack.some(frame => frame.tag === "footer"), groups: stack.map(frame => frame.group).filter(Boolean), accountNavigation: stack.some(frame => frame.accountNavigation), heading: stack.some(frame => frame.heading) } : null;
    } else anchor?.parts.open(name, attributes);
    if (name === "img" && anchor) anchor.label ||= attributes.alt ?? "";
    else if (KEPT.has(name)) tags.push({ name, attributes });
    if (!VOID.has(name) && !/\/\s*>$/.test(match[0])) stack.push({ id: ++frames, tag: name, group: attributes["aria-label"] ?? "", heading: /^h[1-6]$/.test(name) || attributes.role === "heading",
      accountNavigation: /^(auth|authenticated|isAuthenticated|loggedIn|isLoggedIn|signedIn|isSignedIn)$/i.test(attributes["x-show"] ?? ""),
      ...(!anchor && (/^(button|h[1-6]|summary)$/.test(name) || attributes.role === "heading" || /(?:^|[\s_-])(title|heading)(?:$|[\s_-])/i.test(attributes.class ?? "")) ? { label: "" } : {}) });
  }
  if (last) settle();
  return { title, tags, anchors, styles, prose: cleanText(prose.join(" ")), outline, headings };
}
