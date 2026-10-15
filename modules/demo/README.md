# Demo mode

`withDemo(worker, { seed })` makes a seed safe to show: with `RER_DEMO=1` in the
runtime (`rer demo`, or a hosted demo) nothing is sent, the seed's demo data is
in place, and every page says so. Without `RER_DEMO` it returns the worker
unchanged, so the deployed app is exactly as before (`rer deploy` refuses a
declaration or deploy settings that carry `RER_DEMO`).

With `RER_DEMO=1`:

- **Nothing leaves.** When the module is evaluated it replaces global `fetch`
  for the whole isolate (routes, cron, queue consumers, Durable Objects). A
  loopback host is allowed; anything else throws `TypeError: fetch failed`, the
  error a failed delivery already raises. A loopback request goes out with
  `redirect: 'manual'`; when the caller follows redirects, each `Location`
  comes back through the same check (at most 20 hops). `WebSocket`
  and `navigator.sendBeacon` (answers `false` when refused) are guarded the same
  way, and an `EventSource` reads a loopback stream through the guarded fetch
  (so no redirect leaves, and it does not reconnect). `node:net`'s
  `Socket#connect` (`net.connect`, `createConnection`, `tls`) is wrapped the
  same way, and `vite.mjs`'s `demoSockets()` plugin resolves the
  Worker's `cloudflare:sockets` imports to `sockets.mjs`, whose `connect` is
  guarded too (a module namespace cannot be patched at runtime). Each refused
  call is recorded, method (`CONNECT` and `WEBSOCKET` for sockets, `POST` for a
  beacon, `GET` for an event stream) and host only, in `rer_demo_outbound`.
- **Demo data once.** After the owner exists, `seed(env, { ownerEmail, now })`
  runs once (marked in `rer_demo`). It must be idempotent.
- **A visible bar.** Every HTML page opens with a slim strip fixed to the top
  of the viewport, "Demo · nothing is sent · ends HH:MM · N mail captured · N
  sends blocked" on one line (on a narrow screen the counts give way first);
  the page starts below it. Clicking it (or Enter/Space) opens a popover over
  the page, without moving it, listing the captured mail (development outbox
  subject and recipient) and the blocked sends; Escape, a second click or a
  click outside closes it. No script: its one style is allowed in the page's
  CSP by hash, and every rule is scoped to `#rer-demo-bar`, resetting what a
  page sets on its elements.
- Mail stays in the development outbox and AI stays unconfigured: demo settings
  never carry provider keys.

Both tables are created by the guard at runtime, never by a migration, so they
exist only in a demo's own throwaway database. Adopting it is three changes in a
seed; see `export/DEMO.md`.
