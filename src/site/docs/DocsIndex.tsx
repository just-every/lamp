import { HydrationUnit } from '../../base/hydration/unit';
import { DocsLayout } from './DocsLayout';
import { DocsSidebar } from './DocsNav';
import { docsLead, docsSections } from './pages';

/**
 * The docs home at /docs, laid out like every docs page: the section sidebar, then the title, a short lead and each
 * section's pages as even cards in reading order. It has no "On this page" column, and on phones no menu: the page itself
 * is the full list.
 */
export function DocsIndex({ variant }: { variant?: 'site' }) {
  return (
    <DocsLayout variant={variant}>
      <DocsSidebar />
      <div id="docs-content" className="docs-content docs-content--index" tabIndex={-1}>
        <HydrationUnit>
          <header className="docs-head">
            <p className="docs-eyebrow">Lamp</p>
            <h1 className="docs-title">Docs</h1>
            <p className="docs-lead">{docsLead}</p>
          </header>
        </HydrationUnit>
        {docsSections.map((section, index) => (
          <HydrationUnit key={section.title}>
            <section className="docs-index-section" aria-labelledby={`docs-section-${index}`}>
              <h2 className="docs-index-section-title" id={`docs-section-${index}`}>{section.title}</h2>
              <ul className="docs-index-grid">
                {section.pages.map(page => (
                  <li key={page.slug}>
                    <a className="docs-index-card" href={`/docs/${page.slug}`}>
                      <h3>{page.title}</h3>
                      <p>{page.summary}</p>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </HydrationUnit>
        ))}
      </div>
    </DocsLayout>
  );
}
