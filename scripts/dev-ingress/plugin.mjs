import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isForwardingHeader, proofHeader, proofPayload } from './protocol.mjs';
import { isSameOriginSubscriberPost } from '../../src/core/platform/development/subscriber-origin.mjs';
import { isLocalPublicRead } from '../../src/core/platform/development/public-read.mjs';

const virtualId = 'virtual:lamp-dev-ingress';
const resolvedId = `\0${virtualId}`;
const workerPath = fileURLToPath(new URL('./worker.ts', import.meta.url));
const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const loopbackAuthority = /^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i;
const scheduledPaths = ['/cdn-cgi/handler/scheduled', '/cdn-cgi/local/scheduled', '/cdn-cgi/mf/scheduled'];

/** The app host and the page host share one listening port but are distinct
 * sites, so following a link from one to the other is a cross-site navigation.
 * Admit only a top-level GET or HEAD document navigation whose Referer is
 * another loopback authority on this same port: a page this server rendered.
 * A foreign site cannot produce that Referer, and fetches still need Origin. */
function crossHostNavigation(request, headers, url) {
  if (!['GET', 'HEAD'].includes(request.method) || headers.has('origin')) return false;
  if (headers.get('sec-fetch-mode') !== 'navigate' || headers.get('sec-fetch-dest') !== 'document') return false;
  let referrer;
  try { referrer = new URL(headers.get('referer')); } catch { return false; }
  return referrer.protocol === url.protocol && loopbackAuthority.test(referrer.host) && referrer.port === url.port
    && referrer.origin !== url.origin && !referrer.username && !referrer.password;
}

function publicPort(listening) {
  const origin = process.env.RER_DEV_ORIGIN;
  if (!origin) return listening;
  const url = new URL(origin);
  return loopbackAuthority.test(url.host) && url.port ? Number(url.port) : listening;
}

/** Inspect the raw socket request before Cloudflare adds forwarding metadata.
 * In particular, Node's normalized headers discard duplicate Host fields. */
export function inspectIngress(request) {
  if (!loopbackAddresses.has(request.socket.remoteAddress)
    || !loopbackAddresses.has(request.socket.localAddress)) return null;
  const headers = new Map();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index].toLowerCase();
    // workerd stamps CF-Worker on the Worker's own subrequests, such as the
    // setup checklist reading the page host. It carries no client identity.
    if (name === 'cf-worker' && !headers.has(name)) { headers.set(name, request.rawHeaders[index + 1]); continue; }
    if (isForwardingHeader(name) || name.startsWith(':')) return null;
    if (['host', 'origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'].includes(name) && headers.has(name)) return null;
    headers.set(name, request.rawHeaders[index + 1]);
  }
  if (headers.has('cf-worker') && (!['GET', 'HEAD'].includes(request.method) || headers.has('origin')
    || [...headers.keys()].some(name => name.startsWith('sec-fetch-')))) return null;
  const host = headers.get('host');
  if (!host || !loopbackAuthority.test(host)) return null;
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
    || (/^\/cdn-cgi(?:\/|$)/i.test(pathname) && !scheduledPaths.includes(pathname))) return null;
  // Behind `rer dev`, the CLI's loopback proxy listens on the public port and
  // forwards the browser's Host unchanged to this listener on an internal port.
  // `rer dev` itself fires the declared Cron Triggers at this listener's own
  // port; only those scheduled paths are admitted there.
  const port = Number(url.port || (protocol === 'https:' ? 443 : 80));
  const scheduledTrigger = scheduledPaths.includes(pathname) && port === request.socket.localPort && ['GET', 'HEAD'].includes(request.method);
  if (port !== publicPort(request.socket.localPort) && !scheduledTrigger) return null;
  const publicRead = isLocalPublicRead(request.method, target, headers, url);
  if (headers.has('origin') && headers.get('origin') !== url.origin && !publicRead
    && !isSameOriginSubscriberPost(request.method, target, headers.get('origin'), headers.get('sec-fetch-site'))) return null;
  const fetchSite = headers.get('sec-fetch-site');
  if (fetchSite !== undefined && !['none', 'same-origin', 'same-site'].includes(fetchSite)
    && !(fetchSite === 'cross-site' && (publicRead || crossHostNavigation(request, headers, url)))) return null;
  return proofPayload(request.method, url.href, host, headers.get('origin') ?? null, headers.get('sec-fetch-site') ?? null);
}

/** One ephemeral key per Vite instance, never a config/env binding or a file.
 * The virtual module is available only to the Worker SSR environment. Requests
 * for it in the browser environment fail before any source is returned. */
export function developmentIngress(enabled = true, persistStatePath = '.wrangler/state') {
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
