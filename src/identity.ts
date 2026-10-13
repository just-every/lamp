import { checkIdentity, type EditionIdentity } from './base/identity';
import { lampConfig } from './ext/config';

// What the installed Lobby and the run site say about Lamp (Base's EditionIdentity). The page host's / stays the live
// status page, so Lamp keeps its own page at / ('page'); the app host's / is the Lobby (installed-home.ts).
// `deployment` is the owner's configured page name; the Lobby reads the stored one on the server.
export const identity: EditionIdentity = checkIdentity({
  product: 'Lamp',
  deployment: lampConfig.pageName,
  purpose: 'Where {deployment} is written, published and kept current.',
  tagline: 'The status page that never leaves your customers in the dark.',
  signInPath: '/signin',
  runSite: 'https://run-lamp.com',
  installedHome: 'page',
  theme: '/rer-theme.css',
  mark: '/app-assets/brand/lamp-mark.svg',
  band: '/brand/band.svg',
});
