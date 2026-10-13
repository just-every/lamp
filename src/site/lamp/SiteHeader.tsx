import { BrandMark } from './BrandMark';
import { docsUrl, runAction, sourceUrl } from './repository';
import './header.css';

// The fixed header: the wordmark (the mark drops in beside it during the handoff), Docs and GitHub, and the way in: on the
// run site (`variant="site"`) Run Lamp, on an installed instance's docs Get the code. On the docs pages (`current="docs"`)
// it is the same header, marking Docs as the page the visitor is on.
export function SiteHeader({ current, variant }: { current?: 'docs'; variant?: 'site' }) {
  const action = variant === 'site' ? runAction : { label: 'Get the code', href: sourceUrl };
  return <header className="lamp-header">
    <div className="lamp-header__bar">
      <a className="lamp-brand" href="/"><BrandMark /><span className="lamp-brand__name">Lamp</span></a>
      <nav className="lamp-nav" aria-label="Main"><a href={docsUrl} aria-current={current === 'docs' ? 'page' : undefined}>Docs</a><a href={sourceUrl}>GitHub</a></nav>
      <a className="lamp-pill lamp-header__cta" href={action.href}>{action.label}</a>
    </div>
  </header>;
}
