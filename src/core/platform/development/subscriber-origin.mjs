/** SUB-005's no-referrer documents submit native forms with Origin: null.
 * Fetch Metadata establishes the browser initiator, not subscriber authority
 * or authentication against local programs. The service still validates tokens.
 * At ingress, target must be the raw path/query before URL normalization. */
export function isSameOriginSubscriberPost(method, target, origin, fetchSite) {
  if (origin !== 'null' || fetchSite !== 'same-origin' || method !== 'POST') return false;
  if (/[\x00-\x20\x7f\\#]/.test(target)) return false;
  const pathname = target.split('?', 1)[0];
  const match = /^\/(?:manage|unsubscribe)\/([A-Za-z0-9._~-]+)$/.exec(pathname);
  return match !== null && match[1] !== '.' && match[1] !== '..';
}
