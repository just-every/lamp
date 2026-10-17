import { renderUpdateHtml } from "../../shared/update-links";
import { escapeXml } from "./format";

/** Both Atom text constructs contain escaped HTML; author markup stays literal. */
export function renderAtomContent(text: string) {
  const html = `<pre>${renderUpdateHtml(text)}</pre>`;
  return `<summary type="html">${escapeXml(html)}</summary><content type="html">${escapeXml(html)}</content>`;
}

/** RSS descriptions are HTML encoded inside XML, including their literal prose. */
export function renderRssDescription(text: string) {
  return `<description>${escapeXml(`<pre>${renderUpdateHtml(text)}</pre>`)}</description>`;
}
