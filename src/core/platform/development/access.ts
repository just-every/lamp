import { isSameOriginSubscriberPost } from './subscriber-origin.mjs';
import { isLocalPublicRead } from './public-read.mjs';

/** The compiler removes development access from the emitted production Worker.
 * A runtime binding, request header or localhost URL cannot turn it back on. */
export interface DevelopmentBindings {
  LAMP_APP_HOST: string;
  LAMP_PAGE_HOST: string;
}

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLoopbackHostname(hostname: string): boolean {
  return localHosts.has(hostname.toLowerCase());
}

function localAuthority(authority: string): boolean {
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(authority)) return false;
  try {
    const parsed = new URL(`http://${authority}`);
    return isLoopbackHostname(parsed.hostname) && (!parsed.port || Number(parsed.port) <= 65535);
  } catch { return false; }
}

/** Development serves the app host and the page host on one port. They are
 * distinct sites, so following a link from one surface to the other arrives as
 * a cross-site request. Only a top-level GET or HEAD document navigation, with
 * no Origin and a Referer from the other configured surface on this same
 * scheme and port, qualifies; a foreign page cannot produce that Referer. */
function crossSurfaceNavigation(bindings: DevelopmentBindings, request: Request, url: URL): boolean {
  if (!['GET', 'HEAD'].includes(request.method) || request.headers.has('origin')) return false;
  if (request.headers.get('sec-fetch-mode') !== 'navigate' || request.headers.get('sec-fetch-dest') !== 'document') return false;
  let referrer: URL;
  try { referrer = new URL(request.headers.get('referer') ?? ''); } catch { return false; }
  const surfaces = [bindings.LAMP_APP_HOST.toLowerCase(), bindings.LAMP_PAGE_HOST.toLowerCase()];
  return referrer.protocol === url.protocol && referrer.port === url.port && surfaces.includes(referrer.hostname.toLowerCase())
    && referrer.origin !== url.origin && !referrer.username && !referrer.password;
}

function localDevelopmentRequest(bindings: DevelopmentBindings, request: Request, admitCrossSurfaceNavigation: boolean, admitPublicReads = false): boolean {
  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !localAuthority(url.host)) return false;
  if (![bindings.LAMP_APP_HOST.toLowerCase(), bindings.LAMP_PAGE_HOST.toLowerCase()].includes(url.hostname.toLowerCase())) return false;
  for (const name of request.headers.keys()) {
    if (name === 'forwarded' || name.startsWith('x-forwarded-') || name === 'x-original-host' || name.startsWith('x-lamp-dev-')) return false;
  }
  const host = request.headers.get('host');
  if (host !== null && (!localAuthority(host) || new URL(`${url.protocol}//${host}`).host !== url.host)) return false;
  const publicRead = admitPublicReads
    && isLocalPublicRead(request.method, `${url.pathname}${url.search}`, request.headers, url)
    && url.hostname === bindings.LAMP_PAGE_HOST.toLowerCase()
    && new URL(request.headers.get('origin')!).hostname === bindings.LAMP_APP_HOST.toLowerCase();
  if (request.headers.get('sec-fetch-site') === 'cross-site' && !publicRead && !(admitCrossSurfaceNavigation && crossSurfaceNavigation(bindings, request, url))) return false;
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== url.origin && !publicRead
    && !isSameOriginSubscriberPost(request.method, `${url.pathname}${url.search}`, origin, request.headers.get('sec-fetch-site'))) return false;
  return true;
}

function developmentConfigured(bindings: DevelopmentBindings): boolean {
  return isLoopbackHostname(bindings.LAMP_APP_HOST) && isLoopbackHostname(bindings.LAMP_PAGE_HOST);
}

/** Admission for every request the development Worker serves: the same local
 * checks, plus navigation between surfaces and credentialless owner reads of
 * public aliases/permalinks. Both retain the local request boundary. */
export function admitsDevelopmentRequest(bindings: DevelopmentBindings, request: Request): boolean {
  if (import.meta.env?.DEV !== true || !developmentConfigured(bindings)) return false;
  return localDevelopmentRequest(bindings, request, true, true);
}
