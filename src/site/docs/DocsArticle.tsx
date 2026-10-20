import { HydrationUnit } from '../../base/hydration/unit';
import { notFound } from '@tanstack/react-router';
import { DocsLayout } from './DocsLayout';
import { DocsMenu, DocsSidebar } from './DocsNav';
import { DocsPager } from './DocsPager';
import { DocsToc, DocsTocCompact } from './DocsToc';
import { docsNeighbours, docsSourceUrl, getDocsMeta } from './pages';
import type { DocsBody } from './types';
import { useCopyButtons } from './useCopyButtons';

/**
 * One docs page: the section sidebar, the article rendered from the repository's Markdown at build time, and "On this
 * page". Previous and next cards close the article. An unknown slug is a 404 (the route checks hasDocsPage first).
 */
export function DocsArticle({ slug, body, variant }: { slug: string; body: DocsBody; variant?: 'site' }) {
  const meta = getDocsMeta(slug);
  const copyButtons = useCopyButtons();
  if (!meta) throw notFound();
  const page = { ...meta, ...body };
  const { previous, next } = docsNeighbours(slug);
  return (
    <DocsLayout variant={variant}>
      <DocsSidebar current={slug} variant={variant} />
      <div id="docs-content" className="docs-content" tabIndex={-1}>
        <DocsMenu current={slug} label={page.title} variant={variant} />
        <HydrationUnit>
          <article className="docs-article" aria-labelledby="docs-title">
            <header className="docs-head">
              <p className="docs-eyebrow">{page.section}</p>
              <h1 id="docs-title" className="docs-title">{page.title}</h1>
              <p className="docs-lead">{page.summary}</p>
            </header>
            <DocsTocCompact toc={page.toc} />
            <div className="docs-prose" ref={copyButtons} dangerouslySetInnerHTML={{ __html: page.html }} />
            <p className="docs-source">This page is drawn from <code>{page.source}</code> in the repository. <a href={docsSourceUrl(page)}>Edit it on GitHub</a>.</p>
          </article>
        </HydrationUnit>
        <DocsPager previous={previous} next={next} />
      </div>
      <DocsToc toc={page.toc} />
    </DocsLayout>
  );
}
