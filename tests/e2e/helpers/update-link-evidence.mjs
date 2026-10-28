import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/** UPDATE-013's surface checks over the UPDATE_LINK_FIELDS input matrix. */
export const LINKED_URL = "https://help.example.com/kb/123";
const LITERALS = ["javascript:alert(1)", "http://example.com/x", "data:text/html,x"];
const anchor = url => `<a href="${url}" rel="nofollow noopener ugc">${url}</a>`;

/** HTML from the page, history, permalinks, feeds and email: direct links, punctuation outside, everything else literal. */
export function assertLinkedUpdateHtml(html, surface) {
  assert.ok(html.includes(`See ${anchor(LINKED_URL)}.`), `${surface}: the named URL is its own link text with the period outside`);
  assert.ok(html.includes(`at ${anchor(LINKED_URL)}, and the guide (${anchor(LINKED_URL)}) explains`), `${surface}: a comma and a closing parenthesis stay outside the link`);
  for (const internal of ["https://db-prod-3.internal/x", "https://10.0.0.5/x"]) assert.ok(html.includes(anchor(internal)), `${surface}: ${internal} is a bare HTTPS link`);
  assert.ok(html.includes("&lt;a href=&quot;https://x.test&quot;&gt;x&lt;/a&gt;"), `${surface}: markup is escaped literal text`);
  for (const literal of LITERALS) assert.ok(html.includes(literal), `${surface}: ${literal} stays literal`);
  assert.doesNotMatch(html, /href="(?:https:\/\/x\.test|javascript:|http:\/\/example\.com|data:)/, `${surface}: no other scheme or markup becomes a link`);
  for (const [, href, text] of html.matchAll(/<a href="([^"]*)" rel="nofollow noopener ugc">([^<]*)<\/a>/g)) assert.equal(text, href, `${surface}: every update link shows its own URL`);
}

function unescapeXml(text) {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}

/** A well-formed Atom or RSS document whose entry HTML carries the same links. */
export function assertLinkedFeed(xml, surface) {
  execFileSync("python3", ["-c", "import sys, xml.etree.ElementTree as ET; ET.fromstring(sys.stdin.buffer.read())"], { input: xml });
  assert.match(xml, surface.endsWith(".rss") ? /^<\?xml[^>]*\?><rss version="2\.0"/ : /^<\?xml[^>]*\?><feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/, `${surface}: feed root`);
  const entries = [...xml.matchAll(/<(?:content type="html"|description)>([^<]*)<\/(?:content|description)>/g)].map(match => unescapeXml(match[1]));
  const linked = entries.find(html => html.includes(LINKED_URL));
  assert.ok(linked, `${surface}: an entry carries the linked update`);
  assertLinkedUpdateHtml(linked, surface);
}

/** PAGE-013's policy, unchanged by links: no linked host is ever allowed as a source. */
export function assertPublicCsp(headers, origin, surface) {
  assert.equal(headers.get("content-security-policy"), `default-src ${origin}; script-src ${origin}; style-src ${origin}; font-src 'self' data:; img-src ${origin}; connect-src ${origin}; form-action ${origin}; base-uri ${origin}; frame-ancestors 'none'; object-src 'none'`, `${surface}: PAGE-013 CSP`);
}

/** Slack mrkdwn notification text: `<url>` with punctuation outside, never `<url|text>`, everything else escaped. */
export function assertLinkedSlackText(text, surface) {
  assert.ok(text.includes(`See <${LINKED_URL}>.`), `${surface}: the named URL is <url> with the period outside`);
  assert.ok(text.includes(`at <${LINKED_URL}>, and the guide (<${LINKED_URL}>) explains`), `${surface}: a comma and a closing parenthesis stay outside`);
  assert.ok(text.includes('&lt;a href="https://x.test"&gt;x&lt;/a&gt;'), `${surface}: markup arrives Slack-escaped`);
  for (const literal of LITERALS) assert.ok(text.includes(literal), `${surface}: ${literal} stays literal`);
  for (const [, inner] of text.matchAll(/<([^<>]*)>/g)) assert.match(inner, /^https:\/\/[^|\s]+$/, `${surface}: only bare HTTPS links use Slack's link form`);
}
