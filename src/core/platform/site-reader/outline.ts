import { siteDomain } from "./domain.ts";
import type { HtmlScan } from "./html.ts";
import { cleanComponentName } from "./link-text.ts";

/** A link the model may cite: its address and every text the site shows for it, which a name must come from.
 * The heading right above a link counts when the link's own text repeats it ("Current accounts" over "See all current accounts"). */
export interface OutlineLink { url: string; texts: string[]; position: number }
/** The page's navigation as one compact text for a model, and the links it cites by `ref` (the address as written there).
 * `brand` is the business's own name, squashed: its site name and its domain's first label. */
export interface NavigationOutline { text: string; links: Map<string, OutlineLink>; brand: string[] }

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
// Enough for a large mega-menu and footer while keeping one call small.
const LINK_LIMIT = 400, CHARACTER_LIMIT = 40_000;

const destination = (url: URL) => `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
const shorten = (value: string, limit: number) => value.length <= limit ? value : `${value.slice(0, limit - 1).replace(/\s+\S*$/, "")}…`;

/** Mechanical cleaning only: entities, icon glyphs, list markers, badges and arrows. Words are never judged here. */
export function cleanLabel(value: string) {
  const decoded = value.replace(/&([A-Za-z][A-Za-z0-9]*);/g, (match, name: string) => LATIN1.includes(name) ? String.fromCodePoint(0xa0 + LATIN1.indexOf(name)) : match);
  return cleanComponentName(decoded.replace(INVISIBLE, "").replace(/\s+/g, " ").trim().replace(MARKER, "")).replace(LEADING_BADGE, "").replace(TRAILING_BADGE, "").trim();
}

type Line = { kind: "text"; text: string } | { kind: "link"; text: string; ref: string; url: string; texts: string[] } | { kind: "repeat" };

/** The header, menus and footer in reading order: each menu's own text, then one line per link the site points at
 * itself (its shown name, its description and its address). Repeated links (a mobile copy of the menu) appear once. */
export function navigationOutline(scan: HtmlScan, base: URL, site: { name: string | null; title: string | null; description: string | null }): NavigationOutline {
  const domain = siteDomain(base.hostname);
  const seen = new Set<string>();
  const regions: Record<"menus" | "footer", Line[]> = { menus: [], footer: [] };
  for (const step of scan.outline) {
    const lines = regions[step.footer ? "footer" : "menus"];
    if (step.text !== undefined) {
      const text = cleanLabel(step.text);
      const last = lines.at(-1);
      if (text && text.length <= TEXT_LIMIT && !(last?.kind === "text" && last.text === text)) lines.push({ kind: "text", text });
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
      if (label && label.length <= TEXT_LIMIT) lines.push({ kind: "text", text: label });
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
    const line: Line = { kind: "link", ref, url: url.href.replace(/[#?].*$/, ""), texts: [...new Set([...repeated, label, ...shown, cleanLabel(anchor.name), full].filter(Boolean))],
      text: `- [${shorten(name, LABEL_LIMIT)}](${ref})${detail ? ` ${shorten(detail, DESCRIPTION_LIMIT)}` : ""}` };
    if (family) underHeading(lines, line);
    else {
      // A link beneath the nearest link above it that is not itself indented (a suite's member, a product's variant, past a
      // card's tagline) is indented under it.
      const parent = lines.slice(-12).findLast(above => above.kind === "link" && !above.text.startsWith(" "));
      if (parent?.kind === "link" && line.url.startsWith(`${parent.url.replace(/\/+$/, "")}/`)) line.text = `  ${line.text}`;
      lines.push(line);
    }
  }
  const context = [
    `Website: ${base.href}`,
    site.name ? `Name: ${site.name}` : "",
    site.title ? `Title: ${shorten(site.title, 160)}` : "",
    site.description ? `Description: ${shorten(site.description, 300)}` : "",
    scan.headings.length ? `Headings: ${[...new Set(scan.headings.map(cleanLabel).filter(Boolean))].slice(0, 8).map(heading => shorten(heading, 100)).join(" | ")}` : "",
  ].filter(Boolean);
  for (const lines of Object.values(regions)) cardTitles(lines);
  const links = new Map<string, OutlineLink>();
  let text = context.join("\n"), count = 0;
  for (const [title, lines] of [["Header and menus", regions.menus], ["Footer", regions.footer]] as const) {
    const shown = lines.filter((line, index): line is Exclude<Line, { kind: "repeat" }> => line.kind === "link" || line.kind === "text" && heads(lines, index));
    if (!shown.some(line => line.kind === "link")) continue;
    text += `\n\n${title}:`;
    for (const line of shown) {
      if (text.length + line.text.length + 1 > CHARACTER_LIMIT || line.kind === "link" && count >= LINK_LIMIT) break;
      text += `\n${line.text}`;
      if (line.kind !== "link") continue;
      count++;
      const link = links.get(line.ref) ?? { url: line.url, texts: [], position: links.size };
      for (const shownText of line.texts) if (!link.texts.includes(shownText)) link.texts.push(shownText);
      links.set(line.ref, link);
    }
  }
  const squash = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return { text, links, brand: [...new Set([squash(site.name ?? ""), squash(domain.split(".")[0])].filter(Boolean))] };
}

/** A card's title names its one link: a menu text with exactly one link under it (before the next text) is a text of that link,
 * as "Data Security" is of a card linking "Secure your data anywhere". */
function cardTitles(lines: Line[]) {
  lines.forEach((line, index) => {
    const next = lines[index + 1], after = lines[index + 2];
    if (line.kind === "text" && next?.kind === "link" && (!after || after.kind === "text") && !next.texts.includes(line.text)) next.texts.push(line.text);
  });
}

/** The links listed since the menu's last text. */
function runLinks(lines: Line[]) {
  let start = lines.length;
  while (start > 0 && lines[start - 1].kind !== "text") start--;
  return lines.slice(start).filter((line): line is Extract<Line, { kind: "link" }> => line.kind === "link");
}

/** A heading's own link ("See all current accounts") goes right under the heading, with the links before it, its variants,
 * indented beneath it. */
function underHeading(lines: Line[], line: Line) {
  let start = lines.length;
  while (start > 0 && lines[start - 1].kind !== "text") start--;
  for (const member of lines.slice(start)) if (member.kind === "link") member.text = `  ${member.text}`;
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
  for (; at < lines.length && lines[at].kind !== "text"; at++) if (lines[at].kind === "link") return true;
  return false;
}
