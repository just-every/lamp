# Lamp adoption and migration guide

Lamp is a self-hosted status page and incident communication desk for one
business. The canonical source repository is `just-every/lamp`. This 1.1.0 source
candidate updates the retained 1.0.0 release record. Its metadata and local tests
do not establish tag publication, deployment, DNS ownership or live provider
acceptance. Apply `ACCEPTANCE.md` to the exact source and your own installation.

## Adopt the source

Read `CONTRACT.md`, `BASELINE.md`, `RELEASE.json`, and the owner's recorded intent
before updating. Back up data and the current source revision. Use ordinary Git
in an isolated candidate, preserve customisations, and verify a restored copy
before applying the update to an active installation. Use `OPERATIONS.md` for
owner-controlled setup, provider inputs, deployment and archive recovery.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm dev
pnpm verify
pnpm run setup
pnpm run deploy -- --dry-run
pnpm run export
pnpm run import
```

Node 26.8.1 and pnpm 8.15.6 are the pinned toolchain. Setup and real deployment
require owner-controlled Cloudflare credentials, hostnames, sender configuration,
and DNS. The dry-run compiles the generated configuration and artifact without
contacting Cloudflare. `pnpm build` produces `dist/server/wrangler.json`; exercise
that generated artifact as well as the development runtime.

## Migrations

Preserve all applied SQL bytes and apply pending migrations in order before
starting the updated Worker. The prior release is retained in
`release-history/1.0.0.json`; `RELEASE.json` records the new migration obligations.

- `0009_historical_claim_ledger.sql` adds immutable source-claim events,
  maintenance transition ledger triggers and `incident_updates.is_retroactive`.
  Existing aggregate history is intentionally not backfilled: it cannot establish
  source-claim provenance.
- `0010_mail_send_ledger.sql` adds the durable SendGrid ledger. Retain it in exports
  to preserve at-most-once submission across retries and restarts.
- `0011_mail_provider_receipt.sql` records an actual nullable provider acceptance
  receipt separately from local correlation. Retain prior claim identities and
  fingerprints and restore the complete updated ledger.
- `0012_resolved_update_time.sql` makes the next-update time nullable without
  dropping the parent table. Retain old published values, corrections, attachments
  and delivery relationships. Resolved updates carry no future update promise;
  active updates retain their existing required fields and validation.
- `0013_reference_allocations.sql` introduces independent durable INC and SCH
  sequences. Retain both counters and reservations, including unused reservations.
  Existing references and URLs stay valid; deletion, restart and failed creation
  never permit reuse. Gaps are valid.
- `0014_local_capture_receipts.sql` adds nullable local capture metadata without
  changing existing provider IDs, errors or outcomes. Captured attempts remain
  excluded from provider retry and reconciliation after restore.

Owner SQL in `migrations/ext/` runs after core through the actual local and
deployment commands, using the unchanged `lamp_ext_migrations` ledger. Preserve
its applied history too. See `migrations/README.md`.

## Native local authentication and mail

`pnpm dev` explicitly selects the loopback-only inbox at `/__dev/outbox`. Follow
captured links through normal token hashing, expiry, operator allow-list and
subscription confirmation. Capture creates no session or confirmed subscription
by itself. Raw development envelopes and local token configuration stay outside
portable product archives and production builds. Durable capture metadata never
means provider acceptance or delivery. Plain unconfigured Vite and production
previews do not select this transport.

Resend remains the default adapter. Select SendGrid explicitly and configure
native signed-event verification or the documented authenticated relay. A 202
response can be accepted without a provider receipt; local correlation is not a
delivery receipt. Timeouts, redirects, server failures and interrupted requests
remain uncertain and must not be automatically resent. Preserve
`global_fetch_strictly_public` for public Worker-hosted webhook destinations.

## Runtime shape

- One Worker dispatches by `LAMP_PAGE_HOST` and `LAMP_APP_HOST`. The page host serves public artifacts and signed intake endpoints; the app host serves sign-in, protected operator routes, Start server-function transport, health, and application assets. Missing required bindings name the exact variable, and unknown or cross-surface hosts return 404.
- Hono remains authoritative for public snapshot artifacts, feeds, widgets, health, native sign-in requests, and `/api/app`. TanStack Start server-renders `/signin` and authenticated `/app` documents and owns only the opaque `/_serverFn/` transport. It does not replace the R2 snapshot renderer or its shared incident/email rendering path.
- Public reads use versioned R2 snapshot artifacts and make no D1 read. Snapshot generation uses a durable retry record and conditional pointer advancement; a retained snapshot can be labelled stale after a failed rebuild.
- The page, history, Atom feed, widget, status payload, favicon and Open Graph artwork, and permanent incident pages share the snapshot renderer. Initial HTML contains complete public incident fields and works without script; the live region refreshes only a bounded current summary.
- The local public-status refinement renders real snapshot data in a pale full-width status band, open component rows with 90-day daily records, and a full-width vertical chronology. Current incidents, scheduled maintenance, and resolved incidents appear once in that chronology; the subscribe form sits below the timeline at every width. Public timestamps retain machine-readable instants for local display.
- The initial public page loads four same-origin artifacts: stylesheet, script, favicon that composites the configured logo and status mark, and cartographic artwork. The stylesheet embeds the bundled Open Sans variable face (normal 400–700), with no third-party font request; CSP narrowly permits `font-src 'self' data:` for that face.
- D1 stores product facts, audit records, and snapshot-build state. R2 stores public artifacts and uploaded originals. Queues carry health and delivery commands; Cron processes due publication, maintenance, delivery recovery, and snapshot retries.
- Development initializes buyer-configured page settings and an empty snapshot only. Test fixtures own their D1 state, sessions, and product records.
- `pnpm build` emits the Start client at `dist/client/` and the generated deployable Worker configuration at `dist/server/wrangler.json`. The generated config carries `nodejs_compat`, points to the client output, and is never edited or committed.
- Outside the explicit development outbox mode, with no configured mail sender, sign-in and subscription confirmation are unavailable; the script-disabled subscription response reports an honest 503. With no AI provider, the composer hides suggestion controls, and a provider failure leaves publication paths intact.
- Removing access and erasing an operator are distinct operations. Erasure revokes access, removes personal values from the operator, magic-link, and target audit records, and retains opaque audit action, actor, target ID, and time facts. The setup-operator guard remains service-side.

## Completion changes

- Setup initializes real resources before the first Worker deployment, supports a fresh restore target, and applies buyer sidecar migrations after core migrations.
- Export reads D1 records consistently and preserves original R2 bytes plus HTTP/custom metadata. Import validates archive and migration hashes before touching its target, refuses populated targets, and leaves a failed restore unpublished for recovery into a fresh target.
- SendGrid uses a durable envelope claim for at-most-once submission, disables tracking, verifies signed events and distinguishes acceptance from recipient delivery.
- Owner instructions use ordinary Git with agent-chosen updates and recorded-intent verification. The accepted public design is unchanged.

## Cold snapshot replica correction

PAGE-006/007 now uses the `SNAPSHOT_CACHE` SQLite Durable Object to retain one
complete published generation independently of R2 and process/edge cache state.
The real-time publication requirement rules out KV negative-cache propagation.
R2 stays authoritative and portable; public reads remain D1-free. Fresh isolates
serve timestamped last-known HTML/feed/widget after R2 failure. The independent
health route still reports failure, and no-snapshot installs remain 503. Neither
the Worker nor replica can serve through their own simultaneous unavailability.

The replica transaction rejects incomplete and older generations. R2 archives
include its input bundle; restored installations prime it, with minute-scheduler
rebuild for legacy archives. Deployment waits for retained readiness. See
OPERATIONS.md. Focused real-workerd tests cover cold restart, first publication
after a missing read, new query variants, malformed R2 pointers, complete version
switching, UTF-8 integrity and restore priming. Exact-candidate verification and hosted acceptance require separate
installation-specific receipts.

Follow-up publication regression closes the first-replica-failure window: retain
the complete R2-persisted generation before changing the R2 selector, and reuse
one prepared version across retries. Real-renderer/R2/SQLite tests now reject the
first and replacement replica PUTs, lose an acknowledgment, and fail selector
writes. They prove prior/no selector remains until retention, matching retry
versions, and visible failed/pending work. OPERATIONS.md states the selector-repair
case explicitly: the newer complete replica may serve last-known state during
R2 failure while the prior R2 selector awaits repair.

## Verification and source authoring

`pnpm verify` runs source and release metadata checks, real Workers behavior,
public/browser checks, the local baseline pack, a generated production-artifact
check, and automated Axe WCAG 2.2 AA checks. Automated accessibility coverage is
separate from a manual evaluation. Run applicable owner-intent tests explicitly;
the upstream verifier does not discover them automatically.

Main and pull-request CI run the credential-free Verify workflow. The release
workflows remain dispatch-only and use the pinned trusted-build workflow; build
jobs receive no production secrets. Retain the exact source, CI and installation
receipts outside the distributed source tree. Local fixtures and screenshots
qualify neither provider delivery nor hosted recovery.

`AUTHORING.md` describes source selection, retained baseline extraction, mapped
comparison and portable adjacent release receipts. Retain the receipt with the
Git source and verify it in a subsequent clone. Comparison origins and shared
components remain bound to their recorded immutable revisions. Authoring checks
establish source integrity; every product and installation obligation remains.
