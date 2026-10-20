import type { LinkHTMLAttributes, MetaHTMLAttributes, ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SearchPage } from '../base/site/docs-search/types';
import { searchPages } from './docs/build/search';
import { bodies } from 'virtual:lamp-docs/bodies';
import { contractPageHtml } from '../base/contract-page';
import { runPageHtml, siteNotFoundHtml, type SiteBuild, type SiteContext } from '../base/run-site';
import { identity } from '../identity';
import { run } from './run';
import LampHome from './lamp/LampHome';
import { lampHead } from './lamp/head';
import { DocsArticle } from './docs/DocsArticle';
import { DocsIndex } from './docs/DocsIndex';
import { docsHead, docsPages } from './docs/pages';
// The installed documents' root styles and faces (routes/__root.tsx), so the pages read here as they do there.
import '../core/app/client/styles.css';
import './lamp/fonts.css';

type Head = { meta?: MetaHTMLAttributes<HTMLMetaElement>[]; links?: LinkHTMLAttributes<HTMLLinkElement>[] };

// The run site, run-lamp.com, built by `rer build --site`: the approved landing page with Run Lamp as its way in, the
// Run page, the docs and the 404 page, as static HTML that needs no JavaScript.
export function sitePages({ styles, clients, contract }: SiteContext): SiteBuild & { searchPages: SearchPage[] } {
  const document = (head: Head, body: ReactElement, docs = false) => '<!doctype html>' + renderToStaticMarkup(
    <html lang="en"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
      {(head.meta ?? []).map((row, index) => row.title ? <title key={index}>{row.title}</title> : <meta key={index} {...row} />)}
      {styles.map(href => <link key={href} rel="stylesheet" href={href} />)}
      {(head.links ?? []).map((link, index) => <link key={index} {...link} />)}</head><body>{body}{docs && clients.docsSearch && <script type="module" src={clients.docsSearch} />}</body></html>);
  return {
    pages: [
      { path: '/', html: document(lampHead(), <LampHome />) },
      { path: '/run', html: runPageHtml(identity, run, contract) },
      ...(contract ? [{ path: '/contract', html: contractPageHtml(identity, run, contract) }] : []),
      { path: '/docs', html: document(docsHead(), <DocsIndex variant="site" />, true) },
      ...docsPages.map(page => ({ path: `/docs/${page.slug}`, html: document(docsHead(page.slug), <DocsArticle slug={page.slug} body={bodies[page.slug]} variant="site" />, true) })),
      { path: '/404', html: siteNotFoundHtml(identity, run, contract) },
    ],
    assets: ['rer-theme.css', 'app-assets', 'brand'],
    searchPages: searchPages(docsPages, bodies),
  };
}
