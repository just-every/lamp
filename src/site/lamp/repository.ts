// The only links the landing page makes outside itself, besides its own docs at /docs. The source URL comes from package.json, so the page never
// carries a repository address of its own. Only the `repository` field is imported: the rest of package.json (its
// dependency names among it) must stay out of the browser bundle.
import { repository } from '../../../package.json';
export const sourceUrl = repository.url.replace(/\.git$/, '');
// The docs are the site's own pages, drawn from the repository's Markdown at build time (src/site/docs).
export const docsUrl = '/docs';
export const licenceUrl = `${sourceUrl}/blob/main/LICENSE`;
// The landing page's way in, on the run site (run-lamp.com) where it lives: the Run page's two commands.
export const runAction = { label: 'Run Lamp', href: '/run' };
