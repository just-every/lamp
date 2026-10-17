import { HydrationUnit } from '../../base/hydration/unit';
import { contractUrl } from '../lamp/repository';
import { docsSections } from './pages';

/** The sections and their pages, the current one marked. `idPrefix` keeps the sidebar's and the phone menu's ids apart. */
export function DocsNavList({ current, idPrefix }: { current?: string; idPrefix: string }) {
  return (
    <>
      {docsSections.map((section, index) => (
        <div className="docs-nav-group" key={section.title}>
          <p className="docs-nav-section" id={`${idPrefix}-${index}`}>{section.title}</p>
          <ul aria-labelledby={`${idPrefix}-${index}`}>
            {section.pages.map(page => (
              <li key={page.slug}>
                <a href={`/docs/${page.slug}`} aria-current={page.slug === current ? 'page' : undefined}>{page.title}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/** The section navigation beside the page from 1024px; it stays in view while the page scrolls. Without a current page it is the docs home's own sidebar, and "All docs" is the current one. */
export function DocsSidebar({ current, variant }: { current?: string; variant?: 'site' }) {
  return (
    <HydrationUnit>
      <nav className="docs-sidebar" aria-label="Docs">
        <a className="docs-sidebar-home" href="/docs" aria-current={current ? undefined : 'page'}>All docs</a>
        <DocsNavList current={current} idPrefix="docs-sidebar" />
        {variant === 'site' && <a className="docs-sidebar-home docs-sidebar-contract" href={contractUrl}>Contract</a>}
      </nav>
    </HydrationUnit>
  );
}

/** The same navigation on phones and narrow windows: one pill that opens the whole list. */
export function DocsMenu({ current, label }: { current: string; label: string }) {
  return (
    <HydrationUnit>
      <nav className="docs-menu" aria-label="Docs menu">
        <details>
          <summary><span>Docs menu</span><span className="docs-menu-current">{label}</span></summary>
          <div className="docs-menu-list"><DocsNavList current={current} idPrefix="docs-menu" /></div>
        </details>
      </nav>
    </HydrationUnit>
  );
}
