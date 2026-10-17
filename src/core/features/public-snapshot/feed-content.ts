import { renderUpdateHtml } from "../../shared/update-links";
import { escapeXml } from "./format";

/** Keep a text representation as well as HTML; neither interprets author markup. */
export function renderAtomContent(text: string) {
  const html = `<pre>${renderUpdateHtml(text)}</pre>`;
  return `<summary type="text">${escapeXml(text)}</summary><content type="html">${escapeXml(html)}</content>`;
}

/** RSS descriptions are HTML encoded inside XML, including their literal prose. */
export function renderRssDescription(text: string) {
  return `<description>${escapeXml(`<pre>${renderUpdateHtml(text)}</pre>`)}</description>`;
}
