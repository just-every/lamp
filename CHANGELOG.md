# Changelog

## 1.4.0

- Move-in now supports Statuspage, Better Stack and Instatus through their fixed-origin APIs or saved responses. Cutover preview shows the old and native addresses, feed behavior, unavailable paths, unsupported consumers and invitation deadlines; each Opens check follows a credentialless redirect and checks the resulting page, without claiming DNS or inbox delivery.
- Imported email subscribers receive no invitation during preview, apply, resume or Cutover checks. Only the owner's explicit Send invitations action can claim an eligible subscriber; expiry stays fixed at the import review time, expired subscribers cannot be invited, and uncertain claimed sends are not retried automatically.
- Better Stack maintenance messages remain historical updates in the imported maintenance timeline. They do not create native lifecycle notices or replay notifications; migration 0022 adds the history table and refreshes public snapshots when those records change.
- Public snapshots validate the current generation on reuse and cache immutable artifact bytes under that generation. A warmed cache cannot return an earlier generation on a healthy request; published changes stay within the ten-second public freshness bound, while retained responses cover origin errors for one hour.
- Public reads now carry a 10 requests/second estimate from four fresh 30-second local Worker runs: two full-page and two mixed-route runs, each completing 300/300 requests with HTTP 200. Responses were uncompressed and no CDN was involved. The earlier 5,000 requests/second offer failed with widespread transport errors in the populated local Mac Worker run; that does not establish a production CDN limit. Deployment and CDN capacity remain unvalidated, and no runtime rate limiter was added.
- The populated local fixture rendered 200 components across 25 groups, all 25 open-incident titles, and a 200-update public incident timeline. These are representative record counts; arbitrary text and worst-case history or artifact sizes remain unqualified. A local authenticated publish/native scheduled-trigger run persisted 1,000 unique fake-provider acceptances (p95 185.474 seconds, last acceptance 191.362 seconds including 64.488 seconds waiting for the trigger). This does not qualify a live provider account, quota, latency or recipient delivery. Paced intake evidence covers 120 signed requests with durable draft records and HTTP 202 receipts while public status stayed unchanged.
- With 200 components, 25 groups, 25 open incidents at 200 existing updates each, and 1,000 subscribers, a local real-60-second cron run observed 20/20 due-update publications at p95 234.490 seconds (max 238.490), 20/20 public maintenance starts at p95 232.568 seconds (max 236.568), and 20/20 public completions at p95 174.629 seconds (max 178.629). Scheduled publication and automatic transition guarantees are now four minutes. This measures local cron and public visibility, not live-provider or CDN timing; no runtime scheduler fix was made.
- Optional AI suggestions now use an 18-second provider transport budget, reserving two seconds inside the existing 20-second visible error contract. This is an implementation budget; provider timing remains unmeasured.
- The public status-page header now links Sign in to the operator host. Owner documentation has been expanded and reorganized into task guides at the existing app-host /docs route and its /docs/<slug> pages.
- Cloudflare deploy guidance now distinguishes deployment health from full source and browser verification. `rer deploy --dry-run` validates and builds without contacting Cloudflare; a real deploy validates inputs, provisions resources, applies migrations, builds and uploads the Worker with secrets, then checks application health. Run `rer verify` separately, and record hosted readiness and provider delivery for each installation.
- Local backup and restore guidance now uses the canonical RUN-LOCALLY.md sequence: stop the server, export before reset, import only into an empty destination, and restore with the original owner. Deployed archives remain documented in OPERATIONS.md.
- Dependency updates address the reviewed security advisories: Playwright and its test package move to [1.55.1](https://github.com/microsoft/playwright/releases/tag/v1.55.1); the lock and overrides update transitive Sharp to [0.35.5](https://github.com/lovell/sharp/releases/tag/v0.35.5), including its native libraries, Undici to [7.29.1](https://github.com/nodejs/undici/releases/tag/v7.29.1) and source-map-js to [1.2.2](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2). The RER CLI is also pinned to 0.2.1.

Upgrading: back up data and owner source, then apply `0022_import_maintenance_updates.sql` after `0021_update_reminders.sql` before starting this revision. Run `rer verify` and `pnpm run verify:release` before adoption. The release check upgrades a populated installation from the previous published tag and verifies its data, owner access, publication and archive restore.


## 1.3.0

- The operator app wears the landing's style: its paper, green-black ink, the
  self-hosted Inter face and mark 18; ink pills, white plates and dot chips.
  Amber marks only live work (an overdue incident, the open composer and new
  incident panel). The lit lamp hangs over sign-in, first-run setup, the empty
  overview and a page that could not load. At 390 pixels the sections are one
  scrolling row of tabs, the current one kept in view. Labels, routes and
  behaviour are unchanged.
- Settings → Move in from Statuspage: a dry run first, then components, groups, incident history at its original times, maintenance and email subscribers; nobody is notified about history, each subscriber gets one invitation to confirm, a second run changes nothing, and undo keeps what changed since. Guide: docs/moving-in.md.
- Settings → Slack and Teams: channels follow chosen components and receive each published update once when "Slack and Teams" is selected for it; webhook URLs are stored encrypted and never shown again.
- Alerts → Connect a monitoring tool: Datadog, UptimeRobot, Better Stack and Pingdom presets read each tool's own alert, draft an incident on the mapped component, and close a never-published draft on recovery.
- The browser installer wears Lamp's own look (paper, ink, the lamp mark and Inter) through Base's theme hook: public/rer-theme.css, also linked by sign-in and first-run setup.
- Every Base copy is on Base 3d643dd; Lamp no longer carries Base's own tests.
- RER-managed and independent delivery builds use trusted-build bf7a25a.
- The landing page says what Lamp replaces, as the hero's closing line, under the two actions (the hero's proof row of three short facts is gone), with the three names in bold, and in its description: "100% free, open source alternative to Atlassian Statuspage, Instatus and Better Stack"; seed.json `replaces` names the same three.
- Local development: rer dev's scheduled triggers reach the runtime, rer preview starts, and a development server without mail capture says how to start the outbox.
- Docs at `/docs` on the app host, in the landing page's look, cut at build time from the repository's own Markdown (README, RUN-LOCALLY, OPERATIONS, the move-in guide and this changelog) as `docs/site.json` lists; the landing page's Docs links lead there.

Upgrading: apply migrations 0017 and 0018 after 0016.

## 1.2.0

For a new operator:
- A first-run page at `/setup` names the page, its tagline, time zone and colour; the Overview then shows an eight-step setup checklist built from saved server state, each open step linking to the screen that completes it.
- The composer opens a fresh empty draft for each next update, with lifecycle prompts; the published wording never reappears, and drafts autosave per incident and next update.
- Plain words in the operator app: Set status, Status history, move up and down.
- Every time shows in the page's configured time zone, with its label; a next-update time more than 24 hours ahead warns.
- At 390 pixels Preview comes before Publish, and the operator navigation wraps.
- `pnpm signin-link --email <operator>` issues one ordinary single-use sign-in link from the terminal, printed once and audited.
- Local work runs through `rer` (setup, dev, verify, reset, export, import, deploy) on Node 22.20.0 and pnpm 10.12.4, with mail captured in the development outbox.

For visitors and subscribers:
- Each component appears once; there is no invented "Other services" heading on a page without groups.
- New components show "Tracking since" instead of a percentage over less than a day; the 90-day method sits behind a disclosure.
- A resolved incident shows its resolved time and duration once; subscriber pages share the page's styling, with and without script.
- The footer credit reads "Powered by Lamp", still hidden by the owner's toggle.

Upgrading: apply migrations 0015 and 0016 after 0014. Local state moves to `.wrangler/state` and `.dev.vars` at the repository root; earlier local data under `deploy/` is left for you to move. RER-managed delivery builds with trusted-build 6d77ec1.

## 1.1.0

- Resolved incident updates omit the next-update promise. Active updates retain
  all publication requirements; migration 0012 preserves prior records.
- New incidents and maintenance use independent durable INC and SCH reference
  sequences. Migration 0013 retains permanent reservations, including unused
  ones, while preserving all legacy references and URLs.
- Local development provides an explicit loopback-only mail inbox for native
  sign-in, confirmation and notification journeys. Migration 0014 records local
  capture separately from provider acceptance; production builds and portable
  product archives exclude raw development envelopes.
- SendGrid submission uses a durable at-most-once ledger and a nullable actual
  acceptance receipt (migrations 0010 and 0011). Uncertain submissions remain
  visible and are not automatically repeated. Resend remains the default.
- Owner migrations run after core with a permanent ledger. Export and restore
  preserve database records and original R2 bytes and metadata; import requires
  an empty target and a failed restore remains unpublished.
- Public snapshots retain a complete generation in a SQLite Durable Object before
  advancing the R2 selector. Retained last-known data and dependency health remain
  distinct; simultaneous Worker and replica unavailability cannot be covered.
- The Alerts screen shows each source's intake URL on the public page host,
  which is the only host that routes `/api/intake/*`. The operator API derives
  it from the configured page hostname; single-host and local development
  installations keep their one origin.
- Source authoring supports changed-input diagnostics, retained source extraction,
  mapped comparisons and portable adjacent release receipts.
- Public documentation and current source descriptors use the canonical
  `just-every/lamp` identity. Immutable comparison origins remain recorded.

Before adoption, back up data and source, apply migrations in order, preserve
owner customisations, verify a restored copy, and run exact-candidate checks.
See `RELEASE.json`, `HANDOVER.md` and `ACCEPTANCE.md` for requirements and limits.
