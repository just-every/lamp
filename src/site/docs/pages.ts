import { repository, sections } from 'virtual:lamp-docs';
import { lampFontPreload, lampIconLinks } from '../lamp/head-shared';
import type { DocsPageMeta, DocsRepository, DocsSection } from './types';

// The published docs' listing, cut at build time from docs/site.json and the repository's Markdown (build/plugin.ts), and
// lookups over it. The page bodies are body.ts's: they are read on the server only.

export const docsSections: DocsSection[] = sections.map(section => ({ ...section, pages: section.pages.filter(page => page.listed !== false) }));
export const docsPages: DocsPageMeta[] = sections.flatMap(section => section.pages);
export const docsRepository: DocsRepository = repository;

export const docsLead = 'Run Lamp on your own computer, put it on your own Cloudflare account, and keep it running. These pages are the repository’s own docs, so the two never differ.';

/** Whether `slug` is a published page; the docs route answers 404 for anything else. */
export const hasDocsPage = (slug: string) => docsPages.some(page => page.slug === slug);

/** The published page's listing (title, summary, source), or undefined for an unknown slug. */
export const getDocsMeta = (slug: string) => docsPages.find(page => page.slug === slug);

/** The pages before and after `slug` in reading order, across sections. */
export function docsNeighbours(slug: string): { previous?: DocsPageMeta; next?: DocsPageMeta } {
  const listed = docsSections.flatMap(section => section.pages);
  const index = listed.findIndex(page => page.slug === slug);
  return index === -1 ? {} : { previous: listed[index - 1], next: listed[index + 1] };
}

/** The page's file on GitHub, where it is edited. */
export const docsSourceUrl = (page: DocsPageMeta) => `${docsRepository.url}/blob/${docsRepository.branch}/${page.source}`;

/** Document title, description, font and icons for a docs route's head(): the docs home without a slug, a page with one. */
export function docsHead(slug?: string) {
  const page = slug === undefined ? undefined : getDocsMeta(slug);
  if (slug !== undefined && !page) return {};
  return {
    meta: page
      ? [{ title: `${page.title} — Lamp docs` }, { name: 'description', content: page.summary }]
      : [{ title: 'Docs — Lamp' }, { name: 'description', content: docsLead }],
    links: [lampFontPreload, ...lampIconLinks],
  };
}
