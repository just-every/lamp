import { badge } from '../badge';
import { contractUrl, docsUrl, licenceUrl, sourceUrl } from '../repository';
import { FooterIndex } from './FooterIndex';
import './footer.css';

// The footer, a sign-off: the lockup of mark 18 and the name over the page's one line, then Docs, GitHub and the licence.
// It never links to sections of the page it sits on: on the docs pages only, an index leads back to the landing page's sections.
export function SiteFooter({ onDocs = false, variant }: { onDocs?: boolean; variant?: 'site' }) {
  return <footer className="lamp-footer">
    <div className="lamp-footer__bar">
      <div className="lamp-footer__sign">
        <span className="lamp-footer__brand">
          <img className="lamp-footer__mark" src={badge} alt="" width="64" height="64" loading="lazy" decoding="async" />
          <span>Lamp</span>
        </span>
        <p className="lamp-footer__tagline">The status page that never leaves your customers in the dark.</p>
      </div>
      <div className="lamp-footer__links">
        {onDocs && <FooterIndex />}
        <nav className="lamp-footer__nav" aria-label="Footer">
          <a href={docsUrl} aria-current={onDocs ? 'page' : undefined}>Docs</a>
          {variant === 'site' && <a href={contractUrl}>Contract</a>}
          <a href={sourceUrl}>GitHub</a>
          <a className="lamp-footer__licence" href={licenceUrl}>MIT licence</a>
        </nav>
      </div>
    </div>
  </footer>;
}
