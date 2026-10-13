import { createServer } from "node:http";

// A real network-edge HTTP cache. The application and Chromium are unmodified;
// implement the response directives that matter to the publication contract.
export async function snapshotProxy(upstream) {
  const entries = new Map();
  const pending = new Set();
  const stats = { hits: 0, validations: 0, notModified: 0, stale: 0 };
  let down = false;
  let origin;
  const seconds = (policy, name) => Number(new RegExp(`(?:^|,)\\s*${name}=(\\d+)`).exec(policy)?.[1] ?? 0);
  async function refresh(path, prior) {
    stats.validations++;
    if (down) throw new Error("Origin disconnected at the network edge");
    const response = await fetch(`${upstream}${path}`, { headers: prior?.headers.etag ? { "If-None-Match": prior.headers.etag } : {}, redirect: "manual" });
    if (response.status >= 500) throw new Error(`Origin returned ${response.status}`);
    const headers = Object.fromEntries(response.headers);
    delete headers["content-length"];
    delete headers["content-encoding"];
    if (headers["content-security-policy"]) headers["content-security-policy"] = headers["content-security-policy"].replaceAll(upstream, origin);
    const item = response.status === 304 && prior
      ? { ...prior, headers: { ...prior.headers, ...headers }, storedAt: Date.now() }
      : { status: response.status, headers, body: Buffer.from(await response.arrayBuffer()), storedAt: Date.now() };
    if (response.status === 304) stats.notModified++;
    if (!/no-store/.test(item.headers["cache-control"] ?? "")) entries.set(path, item);
    return item;
  }
  const server = createServer(async (request, response) => {
    try {
      const prior = entries.get(request.url);
      const policy = prior?.headers["cache-control"] ?? "";
      const age = prior ? (Date.now() - prior.storedAt) / 1000 : Infinity;
      const maxAge = seconds(policy, "s-maxage") || seconds(policy, "max-age");
      let item, stale = false;
      if (prior && !/no-cache/.test(policy) && age < maxAge) { stats.hits++; item = prior; }
      else if (prior && !/no-cache|must-revalidate/.test(policy) && age < maxAge + seconds(policy, "stale-while-revalidate")) {
        stats.hits++; item = prior;
        const work = refresh(request.url, prior).catch(() => {}).finally(() => pending.delete(work));
        pending.add(work);
      } else {
        try { item = await refresh(request.url, prior); }
        catch (error) {
          if (!prior || /no-cache|must-revalidate|s-maxage/.test(policy) || age >= maxAge + seconds(policy, "stale-if-error")) throw error;
          stats.stale++; item = prior; stale = true;
        }
      }
      const headers = { ...item.headers, Age: String(Math.floor((Date.now() - item.storedAt) / 1000)) };
      if (stale) headers.Warning = '110 - "Response is stale"';
      if (!stale && request.headers["if-none-match"] && request.headers["if-none-match"] === item.headers.etag) {
        response.writeHead(304, headers); response.end();
      } else { response.writeHead(item.status, headers); response.end(item.body); }
    } catch (error) { response.writeHead(502); response.end(error.message); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, stats,
    disconnect() { down = true; },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await Promise.allSettled(pending);
    },
  };
}
