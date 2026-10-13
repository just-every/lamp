import { isSameOriginSubscriberPost } from './subscriber-origin.mjs';

/** The compiler removes development access from the emitted production Worker.
 * A runtime binding, request header or localhost URL cannot turn it back on. */
export interface DevelopmentMailBindings {
  LAMP_APP_HOST: string;
  LAMP_PAGE_HOST: string;
  LAMP_DEV_OUTBOX?: R2Bucket;
  LAMP_BASE_MAIL?: D1Database;
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
function crossSurfaceNavigation(bindings: DevelopmentMailBindings, request: Request, url: URL): boolean {
  if (!['GET', 'HEAD'].includes(request.method) || request.headers.has('origin')) return false;
  if (request.headers.get('sec-fetch-mode') !== 'navigate' || request.headers.get('sec-fetch-dest') !== 'document') return false;
  let referrer: URL;
  try { referrer = new URL(request.headers.get('referer') ?? ''); } catch { return false; }
  const surfaces = [bindings.LAMP_APP_HOST.toLowerCase(), bindings.LAMP_PAGE_HOST.toLowerCase()];
  return referrer.protocol === url.protocol && referrer.port === url.port && surfaces.includes(referrer.hostname.toLowerCase())
    && referrer.origin !== url.origin && !referrer.username && !referrer.password;
}

function localDevelopmentRequest(bindings: DevelopmentMailBindings, request: Request, admitCrossSurfaceNavigation: boolean): boolean {
  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !localAuthority(url.host)) return false;
  if (![bindings.LAMP_APP_HOST.toLowerCase(), bindings.LAMP_PAGE_HOST.toLowerCase()].includes(url.hostname.toLowerCase())) return false;
  for (const name of request.headers.keys()) {
    if (name === 'forwarded' || name.startsWith('x-forwarded-') || name === 'x-original-host' || name.startsWith('x-lamp-dev-')) return false;
  }
  const host = request.headers.get('host');
  if (host !== null && (!localAuthority(host) || new URL(`${url.protocol}//${host}`).host !== url.host)) return false;
  if (request.headers.get('sec-fetch-site') === 'cross-site' && !(admitCrossSurfaceNavigation && crossSurfaceNavigation(bindings, request, url))) return false;
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== url.origin
    && !isSameOriginSubscriberPost(request.method, `${url.pathname}${url.search}`, origin, request.headers.get('sec-fetch-site'))) return false;
  return true;
}

function developmentConfigured(bindings: DevelopmentMailBindings): boolean {
  return !!bindings.LAMP_DEV_OUTBOX && isLoopbackHostname(bindings.LAMP_APP_HOST) && isLoopbackHostname(bindings.LAMP_PAGE_HOST);
}

/** Mail capture and the outbox never act on a cross-site request. */
export function canUseDevelopmentMail(bindings: DevelopmentMailBindings, request?: Request): boolean {
  if (import.meta.env?.DEV !== true || !developmentConfigured(bindings)) return false;
  // Scheduled/queue work has no client authority. Its configuration must still
  // belong to the real local development runtime and its separate local store.
  if (!request) return true;
  return localDevelopmentRequest(bindings, request, false);
}

/** Admission for every request the development Worker serves: the same local
 * checks, plus a navigation that follows a link between the two surfaces. */
export function admitsDevelopmentRequest(bindings: DevelopmentMailBindings, request: Request): boolean {
  if (import.meta.env?.DEV !== true || !developmentConfigured(bindings)) return false;
  return localDevelopmentRequest(bindings, request, true);
}
