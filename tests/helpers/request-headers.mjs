// RequestInit accepts any HeadersInit shape. Apply caller values with Headers.set
// so a differently cased name replaces its default instead of combining values.
export function requestHeaders(defaults, overrides) {
  const headers = new Headers(defaults);
  new Headers(overrides).forEach((value, name) => headers.set(name, value));
  return headers;
}
