# Lamp adoption and migration guide

Lamp is a self-hosted status page and incident communication desk for one
business. The canonical source repository is `just-every/run-lamp`. This is Lamp
1.3.0, an update from 1.2.0 (`RELEASE.json`, `CHANGELOG.md`). Its local tests do
not establish deployment, DNS ownership or live provider acceptance; apply
`ACCEPTANCE.md` to your own installation.

## Adopt the source

Read `CONTRACT.md`, `BASELINE.md`, `RELEASE.json`, and the owner's recorded intent
before updating. Back up data and the current source revision. Use ordinary Git
in an isolated candidate, preserve customisations, and verify a restored copy
before applying the update to an active installation. Use `OPERATIONS.md` for
owner-controlled setup, provider inputs, deployment and archive recovery.

```sh
rer install
pnpm exec playwright install chromium
rer setup --owner-email you@example.com
rer dev
rer verify
rer deploy --dry-run
pnpm run export:cloudflare
pnpm run import:cloudflare
```

Node 22.20.0 and pnpm 10.12.4 are the pinned toolchain. Real deployment
require owner-controlled Cloudflare credentials, hostnames, sender configuration,
and DNS. The dry-run compiles the generated configuration and artifact without
contacting Cloudflare. `rer build` produces `dist/server/wrangler.json`; exercise
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

`rer dev` gives the owner a private one-click entry. Local mail is silently
suppressed and no messages are retained; there is no mail viewer. Exercise
emailed sign-in, subscription confirmation and received subscriber messages on a
hosted installation with its real provider and mailbox. Historical capture
metadata never means provider acceptance or delivery.

Locally the two surfaces have their own loopback names on one port:
`http://127.0.0.1:8787/` is the app host (landing page, `/signin`, `/setup`, `/app`)
and `http://localhost:8787/` is the page host (the status page and its public
paths). Dev requests the status page once at start, so development notification
links have the page origin before anyone opens it. Local data from before the rer
CLI lived under `deploy/`; setup names it and asks you to move or remove it.

Resend remains the default adapter. Select SendGrid explicitly and configure
native signed-event verification or the documented authenticated relay. A 202
response can be accepted without a provider receipt; local correlation is not a
delivery receipt. Timeouts, redirects, server failures and interrupted requests
remain uncertain and must not be automatically resent. Preserve
`global_fetch_strictly_public` for public Worker-hosted webhook destinations.

## Runtime shape

- One Worker dispatches by `LAMP_PAGE_HOST` and `LAMP_APP_HOST`, which must differ. Each host has its own home page: the page host's `/` is the public status page, and the app host's `/` is the Lamp landing page (its former address `/lamp` redirects there for one release). The page host serves public artifacts and signed intake endpoints; the app host serves the landing page, sign-in, protected operator routes, Start server-function transport, health, and application assets. Missing required bindings name the exact variable, equal hosts fail naming both, and unknown or cross-surface hosts return 404. OPERATIONS.md covers the hostnames and DNS.
- Hono remains authoritative for public snapshot artifacts, feeds, widgets, health, native sign-in requests, and `/api/app`. TanStack Start server-renders the landing page, `/signin` and authenticated `/app` documents and owns only the opaque `/_serverFn/` transport. It does not replace the R2 snapshot renderer or its shared incident/email rendering path.
- Public reads use versioned R2 snapshot artifacts and make no D1 read. Snapshot generation uses a durable retry record and conditional pointer advancement; a retained snapshot can be labelled stale after a failed rebuild.
- The page, history, Atom feed, widget, status payload, favicon and Open Graph artwork, and permanent incident pages share the snapshot renderer. Initial HTML contains complete public incident fields and works without script; the live region refreshes only a bounded current summary.
- The public status page renders real snapshot data in Lamp's warm public style (DIVERGENCE.md, "Public status page restyle"): the overall status plate, grouped component plates with 90-day daily records, then one incidents-and-maintenance section in which current incidents and planned maintenance come first and recently resolved incidents follow. The subscribe form sits below it at every width. Public timestamps retain machine-readable instants for local display.
- The initial public page loads three same-origin artifacts: stylesheet, script, and favicon that composites the configured logo and status mark. The stylesheet embeds the bundled Inter variable face (Latin subset, the same file the landing and operator app serve), with no third-party font request; CSP narrowly permits `font-src 'self' data:` for that face.
- D1 stores product facts, audit records, and snapshot-build state. R2 stores public artifacts and uploaded originals. Queues carry health and delivery commands; Cron processes due publication, maintenance, delivery recovery, and snapshot retries.
- Development applies migrations before listening. Fresh page-host reads return neutral 503 and create neither page settings nor an owner; app-host `/` remains the Lamp homepage. `rer dev` prepares the owner and prints the private one-click entry; finish page setup at `/setup`. Test fixtures explicitly own their D1 settings, sessions, and product records.
- `pnpm build` emits the Start client at `dist/client/` and the generated deployable Worker configuration at `dist/server/wrangler.json`. The generated config carries `nodejs_compat`, points to the client output, and is never edited or committed.
- Hosted mail requires a configured provider and authenticated sender. Local one-click owner entry does not depend on mail; local subscriber messages are suppressed. With no AI provider, the composer hides suggestion controls, and a provider failure leaves publication paths intact.
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

## Base components, delivery and the rer CLI

Lamp's Base copies are byte-identical to Base at
`052e5ea88c1e7b73cca10c4813524a5f72580af8` (`rer-v0.2.71`), apart from
`SEED-COMMAND-CONTRACT.md` at `fa38858fa0c686bcb78a7d501ab4b5a547233e98`
(`rer-v0.2.73`, the pinned `@runeditrun/rer`), and recorded in `base-copies.json`:
onboarding (`scripts/base-onboarding/`), the rer CLI (`scripts/base-cli/`), mail
(`modules/mail/`), the delivery producer (`scripts/delivery/base/`), owner
migrations, operations and edition authoring. `pnpm run source:copies` checks the
bytes. Base's own tests stay in Base; Lamp carries the tests of its adoption.
The move-in uses Base's import kit (`modules/import-kit`) and Slack and Teams
channels use Base's integrations core and Slack notifier (`modules/integrations`),
both recorded copies at the same pin. The import door (`modules/import-kit/src/door/`)
is one verbatim recorded copy with no local changes: Lamp's undo policy reaches it
through Base's `reversalPolicy: 'preserve-conflicts'` option, and migration
`0041_import_door_archives.sql` applies Base's `importDoorArchiveMigration` for the
door's `archive` and `restore-check` grant actions.

`POST /api/rer/cutover-status` (`src/core/features/statuspage-import/rer-cutover-status.ts`)
is Run Edit Run Business's signed read of a move: an RER grant of action
`cutover-status` verified with Base's `verifyRerGrant` under the owner-claim key ring,
refused for a key revoked in Settings → Business imports, and 404 without that trust.
It takes `{since}` and answers counts and ids only: the old addresses Cutover lists
(total and up to 25 `{path, target}`), component, incident and maintenance counts,
held and pending subscribers and invitations sent since, incidents, maintenance and
subscribers created in Lamp since (imported records excluded), and each alert
source's receipts since. The Sorry import test (`tests/e2e/sorry-import.test.mjs`)
exercises it through the Worker.

Delivery packages use the Base producer's schema 2 with raw payloads.
`.github/workflows/rer-managed.yml` and `.github/workflows/deploy.yml` build with
`runeditrun/delivery` `trusted-build.yml@86c8b37399c901bffd9a240dbd1148a65ec83b34`,
set in `rer-packaging.json` (and the exported producer's `scripts/delivery/base/packaging.json`)
and regenerated by `node scripts/delivery/base/cli.mjs package`. RER-managed builds
need the stage's `TRUSTED_DELIVERY_WORKFLOW_REF` to name the same revision (an owner
setting). Owner-run `pnpm run deploy` does not depend on that trust.

Local mail is suppressed without capture. Every command runs
through `rer` (seed command contract 1); `DIVERGENCE.md` lists
where Lamp differs: its own Cloudflare deploy pipeline (two hostnames, two
Workers on workers.dev), its own first-owner and sign-in hooks, a preview
without an outbox, and its own archive engine for deployed installations.

Local state now lives in `.wrangler/state` and private settings in `.dev.vars`
at the repository root, beside `wrangler.jsonc`. Data from before this release
under `deploy/.wrangler` and `deploy/.dev.vars` is not moved for you: setup names
it and stops, and you move it to the new place or remove it.

## Setup readiness, first-run setup and terminal sign-in

The Overview checklist (SETUP-001) reads settings, components, published
updates and durable operator-check evidence. Migration `0015_setup_readiness.sql`
adds the evidence table. The sender check reads the configured provider's domain
verification; locally it records the suppressed-mail check. Neither proves
inbox delivery, and accepting an address is not DNS validation.

First-run setup (SETUP-002) lives at `/setup`. Until the owner saves it, every
operator page sends them there. Migration `0016_first_run_setup.sql` marks it
complete for any installation that already has an operator, so existing owners
are not interrupted.

For hosted owner entry, use
`rer signin --environment production --env-file "$HOME/.config/lamp/production.env"`
from the deploying checkout with its original Cloudflare account. The pinned
`@runeditrun/rer` 0.2.22 prints one single-use, 15-minute owner link without mail
when using the default `lamp-<environment>` prefix. Retain the deploying checkout
and its records; the
[operations reference](OPERATIONS.md#shared-operator-authentication) covers the
owner-sign-in migration, credentials and custom-prefix procedure.

The compatibility command `pnpm signin-link --email <operator>` (or `--remote` with your own Wrangler
credentials and the installation's `SESSION_SECRET` in the environment) issues one ordinary single-use, expiring sign-in link for an
existing active operator, records "sign-in link created from the command line"
and prints the link once to that terminal only (ACCESS-001).

## What this release proves, and what it does not

Proven for the source: `pnpm verify` (the complete local verifier: Workers,
browser suites at 1440, 390 and 320 with Axe, the generated artifact, the rer
journey from a clean copy) and CI on `main`. Not proven by the source: a hosted
installation, DNS, live provider delivery or RER-managed delivery; apply
`ACCEPTANCE.md` to your own installation.
