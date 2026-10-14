import { HydrationUnit } from '../../base/hydration/unit';
import type { DocsPageMeta } from './types';

/** The previous and next pages in reading order, as two cards. */
export function DocsPager({ previous, next }: { previous?: DocsPageMeta; next?: DocsPageMeta }) {
  if (!previous && !next) return null;
  return (
    <HydrationUnit>
      <nav className="docs-pager" aria-label="Previous and next pages">
        {previous && (
          <a className="docs-pager-card docs-pager-card--previous" href={`/docs/${previous.slug}`} rel="prev">
            <span className="docs-pager-label">Previous</span>
            <span className="docs-pager-title">{previous.title}</span>
          </a>
        )}
        {next && (
          <a className="docs-pager-card docs-pager-card--next" href={`/docs/${next.slug}`} rel="next">
            <span className="docs-pager-label">Next</span>
            <span className="docs-pager-title">{next.title}</span>
          </a>
        )}
      </nav>
    </HydrationUnit>
  );
}
