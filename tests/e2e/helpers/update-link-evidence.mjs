import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { parse, serializeOuter } from "parse5";

/** UPDATE-013's surface checks over the UPDATE_LINK_FIELDS input matrix. */
export const LINKED_URL = "https://help.example.com/kb/123";
const LITERALS = ["javascript:alert(1)", "http://example.com/x", "data:text/html,x"];
const anchor = url => `<a href="${url}" rel="nofollow noopener ugc">${url}</a>`;
export const MARKDOWN_LITERAL = '**synthetic-lamp-bold** _synthetic-lamp-emphasis_ `synthetic-lamp-code`';
export const LABELLED_LITERAL = '[synthetic-lamp-guide](https://guide.example.test/markdown) <https://guide.example.test/labelled|synthetic-lamp-label>';

export function literalLinkFields(fields) {
  return { ...fields,
    affectedAudience: `${fields.affectedAudience} See https://help.example.com/audience.`,
    details: `${fields.details} ${MARKDOWN_LITERAL} ${LABELLED_LITERAL}`,
  };
}

function assertLiteralLinks(html, surface) {
  assert.ok(html.includes(MARKDOWN_LITERAL), `${surface}: Markdown delimiters and wording stay literal`);
  assert.ok(html.includes(LABELLED_LITERAL.replaceAll('<', '&lt;').replaceAll('>', '&gt;')), `${surface}: both labelled-link forms stay wholly literal`);
  assert.doesNotMatch(html, /<(?:strong|em|code)\b|href="https:\/\/guide\.example\.test\//, `${surface}: no Markdown or labelled destination is interpreted`);
  assert.ok(html.includes(anchor('https://help.example.com/audience')), `${surface}: the audience field also links a bare HTTPS URL`);
  assert.ok(html.includes(anchor('https://help.example.com/recovery')), `${surface}: the details field also links a bare HTTPS URL`);
}

const descendants = node => (node.childNodes ?? []).flatMap(child => [child, ...descendants(child)]);
const nodeText = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(nodeText).join('');

/** Match the committed update, never another incident or a neighbouring update. */
export function assertPublishedUpdateHtml(html, surface, update) {
  const updates = descendants(parse(html)).filter(node => node.tagName === 'article'
    && node.attrs.some(attr => attr.name === 'class' && attr.value.split(' ').includes('update'))
    && nodeText(node).includes(update.details));
  assert.equal(updates.length, 1, `${surface}: exactly one article contains the distinctive published wording`);
  assert.ok(descendants(updates[0]).some(node => node.tagName === 'time'
    && node.attrs.some(attr => attr.name === 'datetime' && attr.value === update.publishedAt)), `${surface}: the article carries this publication's instant`);
  const rendered = descendants(updates[0]).filter(node => node.tagName === 'dd').map(serializeOuter).join('');
  assertLinkedUpdateHtml(rendered, surface);
  assertLiteralLinks(rendered, surface);
}

/** HTML from the page, history, permalinks, feeds and email: direct links, punctuation outside, everything else literal. */
export function assertLinkedUpdateHtml(html, surface) {
  assert.ok(html.includes(`See ${anchor(LINKED_URL)}.`), `${surface}: the named URL is its own link text with the period outside`);
  assert.ok(html.includes(`at ${anchor(LINKED_URL)}, and the guide (${anchor(LINKED_URL)}) explains`), `${surface}: a comma and a closing parenthesis stay outside the link`);
  for (const internal of ["https://db-prod-3.internal/x", "https://10.0.0.5/x"]) assert.ok(html.includes(anchor(internal)), `${surface}: ${internal} is a bare HTTPS link`);
  assert.ok(nodeText(parse(html)).includes('<a href="https://x.test">x</a>'), `${surface}: markup is escaped literal text`);
  for (const literal of LITERALS) assert.ok(html.includes(literal), `${surface}: ${literal} stays literal`);
  for (const link of descendants(parse(html)).filter(node => node.tagName === 'a')) {
    assert.doesNotMatch(link.attrs.find(attr => attr.name === 'href')?.value ?? '', /^(?:https:\/\/x\.test|javascript:|http:\/\/example\.com|data:)/, `${surface}: no other scheme or markup becomes a link`);
  }
  for (const [, href, text] of html.matchAll(/<a href="([^"]*)" rel="nofollow noopener ugc">([^<]*)<\/a>/g)) assert.equal(text, href, `${surface}: every update link shows its own URL`);
}

function unescapeXml(text) {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}

/** A well-formed Atom or RSS document whose entry HTML carries the same links. */
export function assertLinkedFeed(xml, surface, update) {
  execFileSync("python3", ["-c", "import sys, xml.etree.ElementTree as ET; ET.fromstring(sys.stdin.buffer.read())"], { input: xml });
  assert.match(xml, surface.endsWith(".rss") ? /^<\?xml[^>]*\?><rss version="2\.0"/ : /^<\?xml[^>]*\?><feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/, `${surface}: feed root`);
  const entries = [...xml.matchAll(/<(entry|item)>([\s\S]*?)<\/\1>/g)].map(match => match[2]);
  const linked = entries.filter(entry => entry.includes(`:event:update-${update.id}</`));
  assert.equal(linked.length, 1, `${surface}: the exact published update has one feed entry`);
  assert.ok(linked[0].includes(update.publishedAt), `${surface}: the entry retains its publication instant`);
  const contents = [...linked[0].matchAll(/<(?:content type="html"|summary type="html"|description)>([^<]*)<\/(?:content|summary|description)>/g)];
  assert.ok(contents.length, `${surface}: the identified entry has rendered content`);
  for (const content of contents) {
    const html = unescapeXml(content[1]);
    assertLinkedUpdateHtml(html, surface);
    assertLiteralLinks(html, surface);
    assert.ok(nodeText(parse(html)).includes(update.details), `${surface}: this entry keeps the exact distinctive published wording`);
  }
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
