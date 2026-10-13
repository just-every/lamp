/**
 * The public page origin as seen from a request to this Worker. One Worker
 * serves both surfaces, so the scheme and port are the request's own and only
 * the hostname changes to the configured page host. Dev and single-host
 * deployments, where both hosts are the same, keep the request origin.
 */
export function publicPageOrigin(requestUrl: URL | string, pageHost: string) {
  const origin = new URL(requestUrl);
  origin.hostname = pageHost;
  return origin.origin;
}
