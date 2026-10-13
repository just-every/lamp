// Synchronous Wrangler CLI work can outlast the local server's idle connections.
// Keep each Node fixture request on its own connection, including startup probes.
export async function fixtureFetch(input, init) {
  // Native conversion reads every dictionary field once, on its original receiver,
  // in native order. It also retains Node's dispatcher on the resulting Request.
  const request = new Request(input, init);
  request.headers.set("connection", "close");
  // Node resets these fields while copying a Request unless explicitly supplied.
  return globalThis.fetch(request, { referrer: request.referrer, referrerPolicy: request.referrerPolicy });
}
