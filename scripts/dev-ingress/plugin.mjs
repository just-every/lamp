import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isForwardingHeader, proofHeader, proofPayload } from './protocol.mjs';

const virtualId = 'virtual:lamp-dev-ingress';
const resolvedId = `\0${virtualId}`;
const workerPath = fileURLToPath(new URL('./worker.ts', import.meta.url));
const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Inspect the raw socket request before Cloudflare adds forwarding metadata.
 * In particular, Node's normalized headers discard duplicate Host fields. */
export function inspectIngress(request) {
  if (!loopbackAddresses.has(request.socket.remoteAddress)
    || !loopbackAddresses.has(request.socket.localAddress)) return null;
  const headers = new Map();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index].toLowerCase();
    if (isForwardingHeader(name) || name.startsWith(':')) return null;
    if (['host', 'origin', 'sec-fetch-site'].includes(name) && headers.has(name)) return null;
    headers.set(name, request.rawHeaders[index + 1]);
  }
  const host = headers.get('host');
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(host)) return null;
  const protocol = request.socket.encrypted ? 'https:' : 'http:';
  const target = request.originalUrl ?? request.url;
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || /[\\\s#]/.test(target)) return null;
  let url;
  try { url = new URL(target, `${protocol}//${host}`); } catch { return null; }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return null; }
  // These emulator control surfaces bypass the application Worker. Never let
  // a browser initialize its private module runner, inspect keys or read R2
  // configuration through the emulator's storage explorer.
  if (pathname.startsWith('/__vite_plugin_cloudflare_') || pathname.startsWith('/__debug')
    || pathname.startsWith('/__cf_local')
    || (pathname.startsWith('/cdn-cgi') && !['/cdn-cgi/handler/scheduled', '/cdn-cgi/local/scheduled', '/cdn-cgi/mf/scheduled'].includes(pathname))) return null;
  if (Number(url.port || (protocol === 'https:' ? 443 : 80)) !== request.socket.localPort) return null;
  if (headers.has('origin') && headers.get('origin') !== url.origin) return null;
  if (headers.has('sec-fetch-site') && !['none', 'same-origin', 'same-site'].includes(headers.get('sec-fetch-site'))) return null;
  return proofPayload(request.method, url.href, host, headers.get('origin') ?? null, headers.get('sec-fetch-site') ?? null);
}

/** One ephemeral key per Vite instance, never a config/env binding or a file.
 * The virtual module is available only to the Worker SSR environment. Requests
 * for it in the browser environment fail before any source is returned. */
export function developmentIngress(enabled = true, persistStatePath = 'deploy/.wrangler/state') {
  const key = enabled ? randomBytes(32).toString('hex') : undefined;
  const privateStatePath = resolve(persistStatePath).replaceAll('\\', '/');
  if (enabled) {
    // These native plugin switches prevent an alternate emulator API or trace
    // log from exposing private storage, proof headers or module source.
    process.env.X_LOCAL_EXPLORER = 'false';
    process.env.X_LOCAL_OBSERVABILITY = 'false';
  }
  const networkRequests = new WeakSet();
  return {
    name: 'lamp-development-ingress',
    enforce: 'pre',
    apply: 'serve',
    config() {
      // Custom D1/R2 persistence must be as private as .wrangler. Its writes
      // also must not reload the Worker while it is handling a request.
      return { server: {
        fs: { deny: [privateStatePath, `${privateStatePath}/**`] },
        watch: { ignored: [privateStatePath, `${privateStatePath}/**`] },
      } };
    },
    resolveId(id) { if (id === virtualId) return resolvedId; },
    load(id) {
      if (id !== resolvedId) return;
      if (this.environment.name !== 'ssr') throw new Error('Development ingress is private to the Worker.');
      if (!enabled) return 'export const enabled = false; export const authenticate = undefined;';
      return {
        code: `import { createDevelopmentAuthenticator } from ${JSON.stringify(workerPath)};\nconst key = ${JSON.stringify(key)};\nexport const enabled = true;\nexport const authenticate = createDevelopmentAuthenticator(key);`,
        map: { version: 3, names: [], sources: [], mappings: '' },
      };
    },
    configureServer(server) {
      if (!enabled) return;
      if (!server.httpServer) throw new Error('Development ingress requires the native Vite HTTP server.');
      // Only requests arriving on the listening socket are ingress. Cloudflare's
      // ASSETS service re-enters Connect internally; it is not another client.
      const observe = request => networkRequests.add(request);
      server.httpServer.prependListener('request', observe);
      server.httpServer.once('close', () => server.httpServer.removeListener('request', observe));
      const ingress = (request, response, next) => {
        if (!networkRequests.has(request)) return next();
        const payload = inspectIngress(request);
        if (payload === null) {
          response.writeHead(404, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' });
          response.end('Not found.');
          return;
        }
        const stamp = `${Date.now()}.${randomBytes(16).toString('hex')}`;
        const context = JSON.parse(payload);
        context[5] = stamp;
        const signature = createHmac('sha256', Buffer.from(key, 'hex')).update(JSON.stringify(context)).digest('hex');
        const proof = `${stamp}.${signature}`;
        request.headers[proofHeader] = proof;
        // Cloudflare creates Fetch Headers from rawHeaders, not headers.
        request.rawHeaders.push(proofHeader, proof);
        next();
      };
      // Vite 8 installs host/CORS middleware before configureServer hooks. Put
      // this stricter boundary first so every rejected raw request gets the
      // same 404. All native Vite guards and request handlers remain in place.
      server.middlewares.use(ingress);
      const layer = server.middlewares.stack.pop();
      if (layer?.handle !== ingress) throw new Error('Could not install development ingress.');
      server.middlewares.stack.unshift(layer);
      return () => {
        // Upgrade events bypass Connect. Keep Vite's real HMR handlers, but
        // admit only their local endpoint before any Worker runner can see it.
        const listeners = server.httpServer.listeners('upgrade');
        for (const listener of listeners) server.httpServer.removeListener('upgrade', listener);
        server.httpServer.on('upgrade', (request, socket, head) => {
          const protocol = request.headers['sec-websocket-protocol'];
          if (inspectIngress(request) === null || new URL(request.url, 'http://localhost').pathname !== server.config.base
            || !['vite-hmr', 'vite-ping'].includes(protocol)) {
            socket.on('error', () => socket.destroy());
            socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 10\r\n\r\nNot found.', () => socket.destroy());
            return;
          }
          for (const listener of listeners) listener.call(server.httpServer, request, socket, head);
        });
      };
    },
  };
}
