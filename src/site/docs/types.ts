// The shapes the docs virtual module exports (build/plugin.ts) and the docs components read.

/** One h2 or h3 of a page, for "On this page". */
export type DocsTocEntry = { depth: 2 | 3; id: string; text: string };

/** One page as docs/site.json lists it, with the title of the section it sits in. `source` is the repository Markdown file it is drawn from. */
export type DocsPageMeta = { slug: string; title: string; summary: string; source: string; section: string; listed?: boolean };

export type DocsSection = { title: string; pages: DocsPageMeta[] };

/** A page's body, rendered from Markdown at build time, and its contents list. */
export type DocsBody = { html: string; toc: DocsTocEntry[] };

export type DocsPage = DocsPageMeta & DocsBody;

/** Where the repository's files are on the web, from package.json. */
export type DocsRepository = { url: string; branch: string };
