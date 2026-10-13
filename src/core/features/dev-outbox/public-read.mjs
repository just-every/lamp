import { isImportAliasPath, isLampPermalink } from '../statuspage-import/public-paths.mjs';

const loopbackAuthority = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/;

/** A candidate for the owner's credentialless Cutover fetch. Socket ingress
 * checks the raw target; the Worker must additionally check configured hosts.
 * This is public snapshot admission only, never mail or operator authority. */
export function isLocalPublicRead(method, target, headers, url) {
  if (method !== 'GET' || headers.get('sec-fetch-mode') !== 'cors'
    || headers.get('sec-fetch-dest') !== 'empty' || headers.get('sec-fetch-site') !== 'cross-site') return false;
  // No query-driven module transforms, encoding or URL normalization may turn
  // an apparent alias into a Vite/private route before the Worker sees it.
  if (target !== url.pathname || !(isImportAliasPath(target) || isLampPermalink(target))) return false;
  if (/^\/cdn-cgi(?:\/|$)/i.test(target)) return false;
  if (['cookie', 'cookie2', 'authorization', 'proxy-authorization', 'x-rer-dev-key'].some(name => headers.has(name))) return false;
  let origin;
  try { origin = new URL(headers.get('origin')); } catch { return false; }
  return ['http:', 'https:'].includes(url.protocol) && loopbackAuthority.test(url.host)
    && loopbackAuthority.test(origin.host) && origin.origin === headers.get('origin')
    && origin.protocol === url.protocol && origin.port === url.port && origin.origin !== url.origin;
}
