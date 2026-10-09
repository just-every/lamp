/** The compiler removes development access from the emitted production Worker.
 * A runtime binding, request header or localhost URL cannot turn it back on. */
export interface DevelopmentMailBindings {
  LAMP_APP_HOST: string;
  LAMP_PAGE_HOST: string;
  LAMP_DEV_OUTBOX?: R2Bucket;
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

export function canUseDevelopmentMail(bindings: DevelopmentMailBindings, request?: Request): boolean {
  if (import.meta.env?.DEV !== true || !bindings.LAMP_DEV_OUTBOX) return false;
  if (!isLoopbackHostname(bindings.LAMP_APP_HOST) || !isLoopbackHostname(bindings.LAMP_PAGE_HOST)) return false;
  // Scheduled/queue work has no client authority. Its configuration must still
  // belong to the real local development runtime and its separate local store.
  if (!request) return true;
  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !localAuthority(url.host)) return false;
  if (![bindings.LAMP_APP_HOST.toLowerCase(), bindings.LAMP_PAGE_HOST.toLowerCase()].includes(url.hostname.toLowerCase())) return false;
  for (const name of request.headers.keys()) {
    if (name === 'forwarded' || name.startsWith('x-forwarded-') || name === 'x-original-host' || name.startsWith('x-lamp-dev-')) return false;
  }
  const host = request.headers.get('host');
  if (host !== null && (!localAuthority(host) || new URL(`${url.protocol}//${host}`).host !== url.host)) return false;
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== url.origin) return false;
  return true;
}
