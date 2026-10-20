import type { SearchPage } from '../../../base/site/docs-search/types';
import { headingSections } from '../../../base/site/docs-search/sections';
import type { DocsBody, DocsPageMeta } from '../types';
import { decodeHtml } from './source';

// Adapt only the manifest's published, rendered bodies. The renderer owns these
// h2/h3 ids; introductory text links to the article's existing title heading.
const text = (html: string) => decodeHtml(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
export function searchPages(pages: DocsPageMeta[], bodies: Record<string, DocsBody>): SearchPage[] {
  return pages.map(page => {
    const html = bodies[page.slug].html;
    const nodes = [];
    let offset = 0;
    for (const heading of html.matchAll(/<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g)) {
      nodes.push({ type: 'text', value: html.slice(offset, heading.index).split(/\n\s*\n|<\/(?:p|pre|ul|ol|table)>/).map(text).filter(Boolean).join('\n\n') });
      nodes.push({ type: 'element', tagName: `h${heading[1]}`, properties: { id: heading[2] }, children: [{ type: 'text', value: text(heading[3]) }] });
      offset = heading.index! + heading[0].length;
    }
    nodes.push({ type: 'text', value: html.slice(offset).split(/\n\s*\n|<\/(?:p|pre|ul|ol|table)>/).map(text).filter(Boolean).join('\n\n') });
    return { href: `/docs/${page.slug}`, searchSections: headingSections(nodes, page.title, 'docs-title') };
  });
}
