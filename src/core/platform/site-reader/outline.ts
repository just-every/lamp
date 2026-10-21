import { siteDomain } from "./domain.ts";
import type { HtmlScan } from "./html.ts";
import { cleanComponentName } from "./link-text.ts";

/** A link the model may cite: its address, every text the site shows for it, which a name must come from, and the menu groups
 * that list it. The heading right above a link counts when the link's own text repeats it ("Current accounts" over "See all
 * current accounts"). */
export interface OutlineLink { url: string; texts: string[]; position: number; groups: number[] }
/** A menu group as the outline shows it: its heading (a menu name, a group heading or a card's title; none for links before
 * any) and its lines, links indented beneath the link they lie under. */
export interface OutlineGroup { id: number; footer: boolean; heading: string[]; lines: string[] }
/** The page's navigation for a model: `context` (its address, name, title, description and headings), its menu groups in
 * reading order, and the links they cite by `ref` (the address as written there). `brand` is the business's own name,
 * squashed: its site name and its domain's first label. */
export interface NavigationOutline { context: string; groups: OutlineGroup[]; links: Map<string, OutlineLink>; brand: string[] }

const STATUS_HOST = /(^|\.)(statuspage\.io|status\.io|instatus\.com|betteruptime\.com|statuspal\.io|hund\.io|status\.[a-z0-9-]+\.[a-z.]+)$|^status\./i;
// HTML 4's Latin-1 entity names in code point order from U+00A0; text.ts decodes only the common punctuation.
const LATIN1 = "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml".split(" ");
// Icon fonts draw from the private use area; zero-width characters only join or hide.
const INVISIBLE = /[\p{Co}​‌⁠﻿]/gu;
// A list marker the menu writes before each item ("- Analytics"), and a badge set off before a name ("New! App Hosting").
const MARKER = /^[-–—•·*▪◦‣⁃]\s+/u;
const LEADING_BADGE = /^(?:new|beta|soon|popular|hot)\s*[!:–—]\s*(?=\S)/i;
const TRAILING_BADGE = /\s+(?:new|beta|popular|hot)!$/i;
const LABEL_LIMIT = 120, DESCRIPTION_LIMIT = 90, TEXT_LIMIT = 70;
// Enough for a large mega-menu and footer while keeping one call small. A region's title and a group's id take a few more.
const LINK_LIMIT = 400, CHARACTER_LIMIT = 40_000, REGION_TITLE = 20, GROUP_ID = 7;

const destination = (url: URL) => `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
/** Whether an address is a parent's own page or lies beneath it. */
const within = (url: string, parent: string) => url === parent || url.startsWith(`${parent.replace(/\/+$/, "")}/`);
const shorten = (value: string, limit: number) => value.length <= limit ? value : `${value.slice(0, limit - 1).replace(/\s+\S*$/, "")}…`;

/** Mechanical cleaning only: entities, icon glyphs, list markers, badges and arrows. Words are never judged here. */
export function cleanLabel(value: string) {
  const decoded = value.replace(/&([A-Za-z][A-Za-z0-9]*);/g, (match, name: string) => LATIN1.includes(name) ? String.fromCodePoint(0xa0 + LATIN1.indexOf(name)) : match);
  return cleanComponentName(decoded.replace(INVISIBLE, "").replace(/\s+/g, " ").trim().replace(MARKER, "")).replace(LEADING_BADGE, "").replace(TRAILING_BADGE, "").trim();
}

// `note`: a text that describes what is around it (a tagline) rather than titling the links after it. `end`: a named section
// of the menus ends.
type Line = { kind: "text"; text: string; note: boolean } | { kind: "link"; text: string; ref: string; url: string; texts: string[]; name: string; detail: string } | { kind: "end"; text: string } | { kind: "repeat" };
type LinkLine = Extract<Line, { kind: "link" }>;

const linkText = (line: LinkLine) => `- [${shorten(line.name, LABEL_LIMIT)}](${line.ref})${line.detail ? ` ${shorten(line.detail, DESCRIPTION_LIMIT)}` : ""}`;

/** The header, menus and footer in reading order, as menu groups: each menu's own text, then one line per link the site
 * points at itself (its shown name, its description and its address). Repeated links (a mobile copy of the menu) appear once. */
export function navigationOutline(scan: HtmlScan, base: URL, site: { name: string | null; title: string | null; description: string | null }): NavigationOutline {
  const domain = siteDomain(base.hostname);
  const seen = new Set<string>();
  const regions: Record<"menus" | "footer", Line[]> = { menus: [], footer: [] };
  // Each anchor's line, so a card's tagline after it can describe it.
  const byAnchor = new Map<number, LinkLine>();
  for (const step of scan.outline) {
    const lines = regions[step.footer ? "footer" : "menus"];
    if (step.ends !== undefined) {
      const text = cleanLabel(step.ends);
      if (text) lines.push({ kind: "end", text });
      continue;
    }
    if (step.text !== undefined) {
      const text = cleanLabel(step.text);
      if (step.describes !== undefined) {
        const line = byAnchor.get(step.describes);
        if (line && text && !line.texts.includes(text) && !line.detail.includes(text)) {
          line.detail = [line.detail, text].filter(Boolean).join(" · ");
          line.text = linkText(line);
        }
        continue;
      }
      const last = lines.at(-1);
      if (text && text.length <= TEXT_LIMIT && !(last?.kind === "text" && last.text === text)) lines.push({ kind: "text", text, note: Boolean(step.note) });
      continue;
    }
    const headings = menuText(lines);
    const anchor = scan.anchors[step.anchor!];
    let url: URL;
    try { url = new URL(anchor.href, base); } catch { continue; }
    // A link laid out in lines (a name over its description) is labelled by its first line.
    const shown = [...new Set(anchor.lines.map(cleanLabel).filter(Boolean))];
    const label = (shown.length > 1 ? shown[0] : "") || cleanLabel(anchor.name) || cleanLabel(anchor.text);
    // A link back to this page is a menu button ("Products" at "#"): its text heads the links after it.
    if (url.hostname === base.hostname && url.pathname === base.pathname) {
      if (label && label.length <= TEXT_LIMIT) lines.push({ kind: "text", text: label, note: false });
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || !(url.hostname === domain || url.hostname.endsWith(`.${domain}`)) || STATUS_HOST.test(url.hostname) || anchor.accountNavigation || !label) continue;
    const full = cleanLabel(anchor.text);
    const description = shown.length > 1 && shown[0] === label ? shown.slice(1).join(" · ") : full.toLowerCase().startsWith(label.toLowerCase()) ? full.slice(label.length).trim() : full === label ? "" : full;
    const ref = url.hostname === base.hostname ? url.pathname.replace(/\/+$/, "") || "/" : destination(url);
    if (seen.has(`${ref}\n${label}`)) { lines.push({ kind: "repeat" }); continue; }
    seen.add(`${ref}\n${label}`);
    // A link whose text ends by repeating the heading above it ("See all current accounts" under "Current accounts") is shown by that heading.
    const repeated = headings.filter(heading => heading !== label && new RegExp(`(?<![\\p{L}\\p{N}])${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(label));
    // It is the family page when the links already listed under the heading lie beneath its address (its variants).
    const members = runLinks(lines);
    const family = members.length > 0 && members.every(member => member.url.startsWith(`${url.href.replace(/[#?].*$/, "").replace(/\/+$/, "")}/`))
      ? repeated.find(heading => new RegExp(`^(?:\\S+\\s+){1,3}${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "iu").test(label)) : undefined;
    const [name, detail] = family ? [family, [label, description].filter(Boolean).join(" · ")] : [label, description];
    const line: LinkLine = { kind: "link", ref, url: url.href.replace(/[#?].*$/, ""), texts: [...new Set([...repeated, label, ...shown, cleanLabel(anchor.name), full].filter(Boolean))], name, detail, text: "" };
    line.text = linkText(line);
    byAnchor.set(step.anchor!, line);
    if (family) underHeading(lines, line);
    else lines.push(line);
  }
  const context = [
    `Website: ${base.href}`,
    site.name ? `Name: ${site.name}` : "",
    site.title ? `Title: ${shorten(site.title, 160)}` : "",
    site.description ? `Description: ${shorten(site.description, 300)}` : "",
    scan.headings.length ? `Headings: ${[...new Set(scan.headings.map(cleanLabel).filter(Boolean))].slice(0, 8).map(heading => shorten(heading, 100)).join(" | ")}` : "",
  ].filter(Boolean).join("\n");
  for (const lines of Object.values(regions)) cardTitles(lines);
  const links = new Map<string, OutlineLink>(), groups: OutlineGroup[] = [];
  let length = context.length, count = 0;
  regions: for (const [footer, lines] of [[false, regions.menus], [true, regions.footer]] as const) {
    const shown = lines.filter((line, index): line is Exclude<Line, { kind: "repeat" }> => line.kind === "link" || line.kind === "end" || line.kind === "text" && heads(lines, index));
    if (!shown.some(line => line.kind === "link")) continue;
    length += REGION_TITLE;
    // `parent`: the group's last link that is not beneath another, which the links after it may lie beneath.
    let group: OutlineGroup | null = null, linked = false, parent: string | null = null;
    for (const [index, line] of shown.entries()) {
      // The section that headed the group has ended: the links after it start a new one.
      if (line.kind === "end") { if (group && linked && group.heading.includes(line.text)) group = null; continue; }
      if (line.kind === "text") {
        // A note between a family's links, such as a card's tagline, stays in their group; a title or any other text heads a
        // new one, as a mega-menu's section does even when its links lie beneath the menu's own page.
        const next = shown.slice(index + 1).find((after): after is LinkLine => after.kind === "link");
        if (group && linked && !(line.note && parent && next && within(next.url, parent))) group = null;
      }
      if (!group) {
        group = { id: groups.length + 1, footer, heading: [], lines: [] };
        groups.push(group);
        linked = false; parent = null; length += GROUP_ID;
      }
      const indented = line.kind === "link" && parent !== null && within(line.url, parent);
      const text = indented ? `  ${line.text}` : line.text;
      if (length + text.length + 1 > CHARACTER_LIMIT || line.kind === "link" && count >= LINK_LIMIT) break regions;
      length += text.length + 1;
      group.lines.push(text);
      if (line.kind === "text") { if (!linked) group.heading.push(text); continue; }
      count++; linked = true;
      // The page itself and the pages it lies beneath (the site's home, a language's home) are no family.
      if (!indented) parent = within(base.href, line.url) ? null : line.url;
      const link = links.get(line.ref) ?? { url: line.url, texts: [], position: links.size, groups: [] };
      for (const shownText of line.texts) if (!link.texts.includes(shownText)) link.texts.push(shownText);
      if (!link.groups.includes(group.id)) link.groups.push(group.id);
      links.set(line.ref, link);
    }
  }
  // A heading the limits left without links heads nothing.
  if (groups.length && !groups.at(-1)!.lines.some(line => line.trimStart().startsWith("- ["))) groups.pop();
  const squash = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return { context, groups, links, brand: [...new Set([squash(site.name ?? ""), squash(domain.split(".")[0])].filter(Boolean))] };
}

/** The navigation as one text: the context, then the header's and the footer's groups, each led by its id ("[G3]") and, when
 * `note` gives one, a note on it. */
export function outlineText(outline: NavigationOutline, groups = outline.groups, note: (group: OutlineGroup) => string = () => "") {
  let text = outline.context;
  for (const [title, footer] of [["Header and menus", false], ["Footer", true]] as const) {
    const shown = groups.filter(group => group.footer === footer);
    if (!shown.length) continue;
    text += `\n\n${title}:`;
    for (const group of shown) {
      const id = `[G${group.id}]${note(group) ? ` (${note(group)})` : ""}`;
      text += group.heading.length ? `\n${id} ${group.lines.join("\n")}` : `\n${id}\n${group.lines.join("\n")}`;
    }
  }
  return text;
}

/** A card's title names its one link: a menu text with exactly one link under it (before the next text) is a text of that link,
 * as "Data Security" is of a card linking "Secure your data anywhere". */
function cardTitles(lines: Line[]) {
  lines.forEach((line, index) => {
    const next = lines[index + 1], after = lines[index + 2];
    if (line.kind === "text" && next?.kind === "link" && (!after || after.kind === "text" || after.kind === "end") && !next.texts.includes(line.text)) next.texts.push(line.text);
  });
}

/** The links listed since the menu's last text. */
function runLinks(lines: Line[]) {
  let start = lines.length;
  while (start > 0 && lines[start - 1].kind !== "text") start--;
  return lines.slice(start).filter((line): line is LinkLine => line.kind === "link");
}

/** A heading's own link ("See all current accounts") goes right under the heading, before the links listed ahead of it: its
 * variants, which lie beneath its address. */
function underHeading(lines: Line[], line: Line) {
  let start = lines.length;
  while (start > 0 && lines[start - 1].kind !== "text") start--;
  lines.splice(start, 0, line);
}

/** The text lines that head the current run of links: those between the last link before the run and its first link. */
function menuText(lines: Line[]) {
  let end = lines.length;
  while (end > 0 && lines[end - 1].kind !== "text") end--;
  let start = end;
  while (start > 0 && lines[start - 1].kind === "text") start--;
  return lines.slice(start, end).map(line => (line as { text: string }).text);
}

/** A menu's text is kept when a new link follows it, so a repeated mobile copy of the menu leaves no stray headings.
 * Of a long run of text (a cookie notice, a country picker) only the last three lines, the ones nearest the links, head them. */
function heads(lines: Line[], index: number) {
  let at = index + 1;
  while (lines[at]?.kind === "text") at++;
  if (at - index > 3) return false;
  for (; at < lines.length && lines[at].kind !== "text" && lines[at].kind !== "end"; at++) if (lines[at].kind === "link") return true;
  return false;
}
