import type { ReactNode } from 'react';
import '../lamp/page.css';
import { SiteHeader } from '../lamp/SiteHeader';
import { SiteFooter } from '../lamp/sections/SiteFooter';
import './styles';

/**
 * Every docs document: the landing page's own paper, header and footer (page.css holds the tokens, SiteHeader and
 * SiteFooter are the landing page's), with Docs marked as where the visitor is. There is no intro and no lamp handoff, so
 * the header is a plain row at the top that scrolls away with the page. The skip link goes past the sidebar to the page.
 * On the run site (`variant="site"`) the header's way in is Run Lamp.
 */
export function DocsLayout({ children, variant }: { children: ReactNode; variant?: 'site' }) {
  return (
    <div className="lamp-home lamp-docs">
      <a className="lamp-skip" href="#docs-content">Skip to content</a>
      <SiteHeader current="docs" variant={variant} />
      <main id="lamp-main" className="docs-shell">{children}</main>
      <SiteFooter onDocs />
    </div>
  );
}
