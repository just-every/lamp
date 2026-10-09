# Testing

Run the complete current verifier with:

```sh
pnpm verify
```

It runs TypeScript checking, syntax checks, release and manifest validation, real local Vite/Cloudflare Start Worker journeys, export/import round-trip, a compiled generated Start Worker exercise, a production Vite build, and built-client namespace checks. It deliberately fails while any `CONTRACT.md` clause lacks a meaningful tagged behavior test.

Install the pinned browser once before running the browser journeys locally:

```sh
pnpm exec playwright install chromium
```

## Local Worker journey

`tests/e2e/app-api.test.mjs` uses an isolated Miniflare state directory, applies core D1 migrations, starts Vite with the Cloudflare and Start plugins, and makes real HTTP requests to the Worker. Its test helper inserts a real D1 operator session row only for the test. No development route or boot path creates business fixtures or sessions.

The journey currently proves:

- the first public request persists initial page settings and writes an empty public snapshot to local R2;
- public HTML has no-script status, subscription form, component marks, expected public asset paths, cache headers, and isolation headers;
- feed, widget, incident, history, status payload, and public CSS/JavaScript are snapshot artifacts; the widget is bounded and XSS-safe (`textContent`, never `innerHTML`);
- invalid subscriptions return 400 and a valid form submission truthfully returns 503 while mail is unconfigured;
- a persisted component standing claim changes the rebuilt public state;
- dropping the local `page_settings` table after snapshot creation still serves the last R2 public state, and deleting the R2 pointer produces an honest 503 rather than an all-clear;
- `/app` redirects without a valid session, `/signin` is available, and protected app/API routes work only with the test session;
- draft validation uses canonical ULIDs, one incident retains one atomic D1 draft, and preview uses the common renderer;
- settings persist, rebuild the snapshot, and preserve the static footer-credit toggle without a network action;
- overview, maintenance, subscribers, and deliveries return persisted local records; delivery vocabulary has no fabricated channels or reader-tracking outcome; and
- the Worker rejects known surface paths presented on an unknown host, without returning an app or public shell;
- the development operator shell carries the React refresh preamble required by the Vite React plugin; and
- the responsive operator grid contains its horizontal navigation without widening the mobile document.

## Built deployment artifact

`tests/e2e/deployment-artifact.test.mjs` runs `pnpm deploy -- --dry-run` using typed non-secret test configuration, then starts the exact generated `dist/server/wrangler.json` Start Worker with fresh local D1/R2/Queue persistence. It proves the app host serves `/signin` and its bundled JavaScript, rejects the public root on the app host, the page host reports an honest no-snapshot `503` and rejects `/signin`, and an unknown host is rejected. It performs no Cloudflare API call or deployment.

## Browser verification

Run the declared browser suites against the real local Workers runtime. Exercise
public status and history, sign-in, overview, incident composition and resolution,
components, maintenance, subscribers, deliveries, alerts, and settings. Verify
edited-draft autosave and the shared preview, document overflow, image loading,
and browser errors at desktop and mobile sizes. The long operator navigation
must remain swipeable without widening the mobile document.

The reference screenshots in `visual/` use test-owned data and identify their
routes and viewports. Retain exact candidate browser results separately from the
source tree. Local browser checks do not prove a remote Cloudflare deployment,
owner DNS ownership, provider delivery, or load limits.

## Exact-candidate verification

Use a clean clone of the exact candidate, install dependencies with
`pnpm install --frozen-lockfile`, install the pinned Chromium browser, and run
`pnpm verify`. Record the commit, dependency lock, command results and any failing
requirements. The contract-coverage gate must pass without removing or weakening
assertions. A source release and an installation's acceptance need separate
receipts; see `ACCEPTANCE.md`.

## Development and publication regressions

`test:reference-storage` proves nullable-time upgrades and durable reference allocation on real prior D1 data, including concurrency, rollback, restart, and capture-receipt exclusion from provider retry. `test:local-mail` covers token-bearing local envelopes and strict access predicates. `test:public-snapshots`, `test:intake-references`, and `test:resolve-composer` exercise the native Worker and browser behavior; passing source checks alone does not qualify them. `test:release-identity` checks the current repository descriptors and retained edition provenance. All are part of `verify`.

The ordinary API and accessibility suites run plain Vite with no configured mail sender and retain their unavailable-mail assertions. New outbox journeys explicitly select `LAMP_DEV_OUTBOX_MODE=local` or use `pnpm dev`; they must pass through the real Vite ingress and native authentication, and must separately reject spoofed and non-loopback requests. Production output must exclude the development route, envelope store, binding and transport selection. No provider receipt may be inferred from local capture.
