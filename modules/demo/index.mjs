// Demo mode: one guard a seed imports first in its Worker entry. It does nothing
// unless the runtime has RER_DEMO=1 (`rer demo`, or a hosted demo container).
// With it, nothing leaves the machine: global fetch, WebSocket, navigator.sendBeacon,
// EventSource, node:net connect and cloudflare:sockets connect (through vite.mjs)
// answer loopback only for the whole isolate (routes, cron, queue consumers, Durable Objects),
// and every refused call is recorded by method and host. The seed's seedDemo
// hook runs once after the owner exists, and every HTML page carries a "Demo"
// bar listing the captured mail and the blocked sends.
import { env } from 'cloudflare:workers';
import { escapeHtml, isLoopbackHost } from '@runeditrun/rer/internal/modules/operator-auth/http.mjs';
import { allow, sha256 } from './csp.mjs';

const on = env?.RER_DEMO === '1';
let database = 'DB';
const db = () => env[database];

// Refusals are written in the background; withDemo awaits them before a
// handler returns, so a synchronous refusal (a socket) is recorded too.
const writes = new Set();
function record(method, host) {
  const write = (async () => {
    await ready();
    await db().prepare('INSERT INTO rer_demo_outbound(at, method, host) VALUES (?, ?, ?)').bind(Date.now(), method, host).run();
  })().catch(() => { /* The refusal stands even when it cannot be recorded. */ }).finally(() => writes.delete(write));
  writes.add(write);
  return write;
}
const recorded = () => Promise.all(writes);

/** The host:port a socket names, as URL spells it (so `::1` is `[::1]`). */
function socketHost(hostname, port) {
  const name = String(hostname ?? 'localhost');
  return new URL(`http://${name.includes(':') && !name.startsWith('[') ? `[${name}]` : name}:${port}`);
}
/** cloudflare:sockets connect's address: "host:port" or { hostname, port }. */
function connectAddress(address) {
  return typeof address === 'string' ? new URL(`http://${address}`) : socketHost(address?.hostname, address?.port);
}
/** Throws (after starting the record) unless the socket's host is loopback. */
export function guardConnect(address) {
  const url = connectAddress(address);
  if (on && !isLoopbackHost(url.hostname)) {
    void record('CONNECT', url.host);
    throw new TypeError(`connect failed: demo mode sends nothing (CONNECT ${url.host} refused)`);
  }
}

// Evaluated before the rest of the entry's imports, so no module can keep the
// real fetch. A refused call throws the network error fetch itself throws, which
// seeds already treat as a failed delivery.
if (on) {
  const send = globalThis.fetch;
  const refuse = async (method, url) => {
    await record(method, url.host);
    throw new TypeError(`fetch failed: demo mode sends nothing (${method} ${url.host} refused)`);
  };
  // Loopback requests go out with redirect 'manual'. When the caller follows
  // redirects, each Location comes back here (at most 20 hops, as fetch does),
  // so a loopback responder cannot send the request on to another host.
  globalThis.fetch = async function demoFetch(input, init) {
    let request = new Request(input, init);
    const follow = request.redirect === 'follow';
    for (let hops = 0; ; hops++) {
      const url = new URL(request.url);
      if (!isLoopbackHost(url.hostname)) await refuse(request.method, url);
      if (!follow) return send(request);
      const response = await send(request.clone(), { redirect: 'manual' });
      const location = response.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(response.status) || location === null) return response;
      if (hops === 20) throw new TypeError('fetch failed: too many redirects');
      await response.body?.cancel();
      const next = new URL(location, url);
      // Fetch's redirect rules: 303 (and 301/302 after POST) becomes a bodiless
      // GET, and credentials never cross to another origin.
      const get = response.status === 303 && !['GET', 'HEAD'].includes(request.method) || [301, 302].includes(response.status) && request.method === 'POST';
      const headers = new Headers(request.headers);
      if (get) for (const name of ['content-type', 'content-length', 'content-encoding', 'content-language', 'content-location']) headers.delete(name);
      if (next.origin !== url.origin) headers.delete('authorization');
      request = new Request(next, { method: get ? 'GET' : request.method, headers, body: get ? null : request.body, redirect: 'manual', signal: request.signal });
    }
  };
  // A WebSocket opens with a request the fetch guard never sees.
  if (globalThis.WebSocket) globalThis.WebSocket = new Proxy(globalThis.WebSocket, {
    construct(target, args, newTarget) {
      const url = new URL(String(args[0]));
      if (!isLoopbackHost(url.hostname)) {
        void record('WEBSOCKET', url.host);
        throw new TypeError(`WebSocket failed: demo mode sends nothing (WEBSOCKET ${url.host} refused)`);
      }
      return Reflect.construct(target, args, newTarget);
    },
  });
  // navigator.sendBeacon and EventSource send through the runtime's own fetch,
  // not globalThis.fetch. A beacon goes out through the guarded fetch (false when
  // refused, as a browser answers a beacon it will not queue); an EventSource
  // opens only on a loopback host and follows redirects through the guard too.
  const navigator = globalThis.navigator;
  if (typeof navigator?.sendBeacon === 'function') navigator.sendBeacon = function sendBeacon(url, data) {
    const target = new URL(String(url));
    if (!isLoopbackHost(target.hostname)) {
      void record('POST', target.host);
      return false;
    }
    globalThis.fetch(target, { method: 'POST', body: data ?? null, keepalive: true }).catch(() => { /* A beacon never reports a failure. */ });
    return true;
  };
  if (globalThis.EventSource?.from) globalThis.EventSource = new Proxy(globalThis.EventSource, {
    construct(target, args) {
      const url = new URL(String(args[0]));
      if (!isLoopbackHost(url.hostname)) {
        void record('GET', url.host);
        throw new TypeError(`EventSource failed: demo mode sends nothing (GET ${url.host} refused)`);
      }
      // The runtime's own EventSource follows redirects with its internal fetch,
      // so the stream is read through the guarded fetch instead (no reconnection).
      const { readable, writable } = new TransformStream();
      globalThis.fetch(url, { headers: { accept: 'text/event-stream' } }).then(response => response.body.pipeTo(writable), error => writable.abort(error));
      return target.from(readable);
    },
  });
  // node:net (nodejs_compat) connects every socket through Socket#connect:
  // net.connect, net.createConnection and new net.Socket().connect. A refused
  // one fails the way an unreachable host does, with an 'error' event.
  const net = globalThis.process?.getBuiltinModule?.('node:net');
  if (net?.Socket) {
    const open = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function connect(...args) {
      const [first, second] = Array.isArray(args[0]) ? args[0] : args;
      const options = first !== null && typeof first === 'object' ? first : { port: first, host: typeof second === 'string' ? second : undefined };
      if (options.path !== undefined && options.port === undefined) return open.apply(this, args);
      const url = socketHost(options.host, options.port);
      if (isLoopbackHost(url.hostname)) return open.apply(this, args);
      void record('CONNECT', url.host);
      queueMicrotask(() => this.destroy(new Error(`connect ECONNREFUSED: demo mode sends nothing (CONNECT ${url.host} refused)`)));
      return this;
    };
  }
}

let tables;
function ready() {
  return tables ??= db().batch([
    db().prepare('CREATE TABLE IF NOT EXISTS rer_demo (name TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)'),
    db().prepare('CREATE TABLE IF NOT EXISTS rer_demo_outbound (sequence INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, method TEXT NOT NULL, host TEXT NOT NULL)'),
  ]).catch(error => { tables = undefined; throw error; });
}

// Base operator-auth's owner; a seed with its own accounts passes `owner`.
async function operatorOwner(bindings) {
  const row = await bindings[database].prepare("SELECT email FROM oa_operators WHERE role = 'owner' AND status = 'active' ORDER BY created_at LIMIT 1").first();
  return row?.email ?? null;
}

let seeded = false, seeding;
async function seedOnce(bindings, seed, owner) {
  if (seeded) return;
  await ready();
  if (!seed) { seeded = true; return; }
  if (await db().prepare("SELECT 1 FROM rer_demo WHERE name = 'seeded'").first()) { seeded = true; return; }
  const ownerEmail = await owner(bindings);
  if (!ownerEmail) return;
  const now = new Date();
  await seed(bindings, { ownerEmail, now });
  await db().prepare("INSERT OR IGNORE INTO rer_demo(name, value) VALUES ('seeded', ?)").bind(now.toISOString()).run();
  seeded = true;
}

// A slim strip fixed to the top of the viewport; the document starts below it
// (the root's padding, so a full-height layout still fits). Its detail is a
// popover in the top layer: it opens over the page without moving it, and the
// browser closes it on Escape, a second click or a click outside, with no
// script. Every rule is scoped to the bar and resets what a page might set on
// its elements, so neither looks different in any seed.
const STYLE = 'html:has(>body>#rer-demo-bar){box-sizing:border-box;padding-top:34px;scroll-padding-top:34px}#rer-demo-bar,#rer-demo-bar *{all:revert;box-sizing:border-box}#rer-demo-bar{position:fixed;top:0;right:0;left:0;z-index:2147483646;display:block;height:34px;margin:0;padding:0;border-bottom:1px solid #b45309;background:#fef3c7;color:#1c1917;font:13px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:left}#rer-demo-bar>button{display:flex;align-items:center;width:100%;height:100%;margin:0;padding:0 12px;border:0;background:none;color:inherit;font:inherit;text-align:left;white-space:nowrap;cursor:pointer}#rer-demo-bar>button:focus-visible{outline:2px solid #1c1917;outline-offset:-4px}#rer-demo-bar .lead{flex:none;font-weight:700}#rer-demo-bar .rest{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:pre;padding-right:14px}#rer-demo-bar .more{flex:none;width:7px;height:7px;margin:-3px 2px 0 auto;border:solid;border-width:0 2px 2px 0;transform:rotate(45deg)}#rer-demo-bar:has(:popover-open) .more{margin-top:3px;transform:rotate(225deg)}#rer-demo-detail{display:none}#rer-demo-bar #rer-demo-detail:popover-open{position:fixed;inset:38px auto auto 8px;display:block;width:min(440px,calc(100vw - 16px));max-height:calc(100vh - 54px);margin:0;padding:12px 14px;overflow:auto;border:1px solid #a8a29e;border-radius:8px;background:#fff;color:#1c1917;box-shadow:0 8px 24px rgba(0,0,0,.18);font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}#rer-demo-detail h2{margin:10px 0 2px;font:inherit;font-weight:700}#rer-demo-detail h2:first-child{margin-top:0}#rer-demo-detail p{margin:0}#rer-demo-detail p+h2{margin-top:10px}#rer-demo-detail p+p{margin-top:4px}#rer-demo-detail ul{margin:0;padding:0 0 0 18px}';
let styleHash;

// The end time as the starter wrote it (local ISO with offset): show its HH:MM.
const ends = value => /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(value ?? '')?.[1];

async function barHtml() {
  const rows = (sql, fallback = []) => db().prepare(sql).all().then(result => result.results).catch(() => fallback);
  const [mail, mailCount, blocked, blockedCount] = await Promise.all([
    rows('SELECT message FROM rer_mail_development_outbox ORDER BY created_at DESC, sequence DESC LIMIT 5').then(list => list.map(row => JSON.parse(row.message))),
    rows('SELECT COUNT(*) AS count FROM rer_mail_development_outbox', [{ count: 0 }]),
    rows('SELECT method, host, COUNT(*) AS times FROM rer_demo_outbound GROUP BY method, host ORDER BY MAX(sequence) DESC LIMIT 5'),
    rows('SELECT COUNT(*) AS count FROM rer_demo_outbound', [{ count: 0 }]),
  ]);
  const until = ends(env.RER_DEMO_EXPIRES);
  // "Demo · nothing is sent" always shows; the rest gives way on a narrow screen.
  const rest = [...(until ? [`ends ${until}`] : []), `${mailCount[0].count} mail captured`, `${blockedCount[0].count} ${blockedCount[0].count === 1 ? 'send' : 'sends'} blocked`].map(part => ` · ${part}`).join('');
  const recipients = to => (Array.isArray(to) ? to : [to]).map(item => typeof item === 'string' ? item : item?.email).filter(Boolean).join(', ');
  const list = items => items.length ? `<ul>${items.join('')}</ul>` : '<p>None yet.</p>';
  const detail = mail.length || blocked.length
    ? `<h2>Captured mail (in the outbox, not sent)</h2>${list(mail.map(message => `<li>${escapeHtml(message.subject ?? '(no subject)')} → ${escapeHtml(recipients(message.to))}</li>`))}<h2>Blocked sends</h2>${list(blocked.map(row => `<li>${escapeHtml(row.method)} ${escapeHtml(row.host)}${row.times > 1 ? ` (${row.times}×)` : ''}</li>`))}`
    : '<p>No mail captured and no sends blocked yet.</p>';
  return `<style>${STYLE}</style><aside id="rer-demo-bar" aria-label="Demo"><button type="button" popovertarget="rer-demo-detail"><span class="lead">Demo · nothing is sent</span><span class="rest">${escapeHtml(rest)}</span><span class="more" aria-hidden="true"></span></button><div id="rer-demo-detail" popover>${until ? `<p>This demo ends at ${until}.</p>` : ''}${detail}</div></aside>`;
}

async function decorate(response) {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/html') || !response.body) return response;
  const headers = new Headers(response.headers);
  const policy = headers.get('content-security-policy');
  if (policy) headers.set('content-security-policy', allow(policy, 'style-src', styleHash ??= await sha256(STYLE)));
  headers.delete('content-length');
  const [html, bar] = await Promise.all([response.text(), barHtml()]);
  const open = /<body\b[^>]*>/i.exec(html), at = open ? open.index + open[0].length : 0;
  return new Response(html.slice(0, at) + bar + html.slice(at), { status: response.status, statusText: response.statusText, headers });
}

/**
 * Wraps a seed's Worker for demo mode; without RER_DEMO=1 it returns the worker
 * unchanged. `seed(env, { ownerEmail, now })` is the seed's idempotent demo data.
 */
export function withDemo(worker, { seed, binding = 'DB', owner = operatorOwner } = {}) {
  if (!on) return worker;
  database = binding;
  const prepared = bindings => seeding ??= seedOnce(bindings, seed, owner).finally(() => { seeding = undefined; });
  return {
    ...worker,
    async fetch(request, bindings, execution) {
      await prepared(bindings);
      const response = await worker.fetch(request, bindings, execution);
      await recorded();
      return decorate(response);
    },
    ...(worker.scheduled ? { async scheduled(controller, bindings, execution) { await prepared(bindings); try { return await worker.scheduled(controller, bindings, execution); } finally { await recorded(); } } } : {}),
    ...(worker.queue ? { async queue(batch, bindings, execution) { await prepared(bindings); try { return await worker.queue(batch, bindings, execution); } finally { await recorded(); } } } : {}),
  };
}
