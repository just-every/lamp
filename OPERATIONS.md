# Lamp operations

Lamp uses distinct public page and operator application hosts. Its deployment
commands provision a real D1 database, R2 bucket and Queue by environment name,
apply migrations, initialize the first operator and page settings, build the
Worker and publish the emitted artifact. Use `pnpm run setup` (the explicit `run`
avoids pnpm's own shell-setup command).

## Owner inputs

Supply `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` for the intended account.
The token needs Worker deployment, D1, R2, Queues and custom-hostname access,
including Zone Workers Routes read/write permission for both hosts’ zones.
Account Worker access alone can upload the artifact but cannot attach its hosts. Configure `LAMP_PAGE_HOST`, `LAMP_APP_HOST`,
`LAMP_PAGE_NAME`, `LAMP_PAGE_TAGLINE`, `LAMP_PAGE_TIMEZONE`, `LAMP_ACCENT_COLOR`,
`SETUP_OPERATOR_EMAIL`, `MAIL_FROM_ADDRESS`, `MAIL_DKIM_SELECTOR`,
`MAIL_PROVIDER_API_KEY`, `SUBSCRIBER_TOKEN_SECRET` and `WEBHOOK_SIGNING_SECRET`.
The two token secrets must each contain at least 32 characters. Keep their
original values when restoring so existing subscriber tokens and webhook
signatures remain valid. Store owner inputs outside committed source.

`MAIL_PROVIDER` selects `resend` (default, preserving existing deployments) or
`sendgrid`. Both use `MAIL_PROVIDER_API_KEY`; map an existing provider-specific
credential into that environment variable without writing it into source.
Likewise map the verified sender address into `MAIL_FROM_ADDRESS`. The sender
domain must publish SPF, DMARC and a DKIM key at the chosen selector. Setup checks
those records before provisioning. It does not prove DKIM's header coverage or
recipient delivery: verify those against a received message.

For SendGrid set `SENDGRID_WEBHOOK_PUBLIC_KEY` to its base64 P-256 public key and
configure the signed Event Webhook URL as
`https://<LAMP_PAGE_HOST>/api/intake/mail-events`, with delivered, bounce, dropped
and spamreport events enabled. For Resend, set `RESEND_WEBHOOK_SECRET` and use the
same URL. Without the selected provider's verification key this endpoint rejects
callbacks; API acceptance alone does not mark recipient delivery.

SendGrid requests explicitly disable click, open, subscription and analytics
tracking. Verify the received message has no added tracking and that DKIM's `h=`
list covers `List-Unsubscribe` and `List-Unsubscribe-Post` before claiming one-click
mailbox-provider support. A provider setting or received message that fails these
checks is a release blocker, not a reason to claim the behavior locally.

## Deployment and checks

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run deploy -- --dry-run --environment staging
pnpm run deploy -- --environment production
```

Dry run compiles and validates generated configuration without changing Cloudflare.
Real deploy first runs setup and verification. Setup does not create a placeholder
Worker or publish secrets separately. Deploy writes a private temporary secrets
file, publishes the real Worker with it, removes that file even after failure,
then checks the application host's health with a bounded request. It checks real
D1/R2/Queue reachability, not mail delivery. The public host must also be exercised
with actual published content, subscription and signed provider receipts.

The GitHub workflow builds and retains `lamp-worker-<commit>` without deployment
credentials. `node scripts/build-delivery-artifact.mjs` packages a completed
`pnpm build` into `delivery-artifact/lamp-worker-artifact.json`: Worker modules and
static assets only, using the delivery service's `ArtifactBundle` schema. It does
not carry resource authority, secrets, migration instructions or trustworthy source
identity. The independent delivery service validates the run and retained bytes,
then applies the approved resource plan. Its authority must live outside the
editable application build job. Artifact creation alone does not deploy Lamp.
Direct owner deployment remains available with `pnpm run deploy`.

## Provider uncertainty and recovery

SendGrid does not deduplicate a Mail Send request using Lamp's key. Lamp therefore
stores a durable, envelope-hashed send claim before calling it. An accepted replay
returns its original correlation ID without sending again. Explicit HTTP 429
rejections may retry. Network interruption, timeout, an uncertain 5xx or a Worker
crash after claiming cannot safely resend: that notification becomes visibly
failed/unconfirmed and retains correlation for a later signed receipt. The receipt
can reconcile it to delivered, bounced or complained. Inspect provider evidence
before any manual remediation; never clear the send ledger to force a resend.
The ledger contains opaque hashes/IDs and state, not message bodies or credentials.

Resend keeps its existing frozen-envelope idempotency behavior. In either provider,
queued means pending or accepted without a delivery receipt; it does not mean
mailbox delivery. Retain the D1/R2 archive and the private deployment inputs for
recovery. No remote restore or provider acceptance is implied by local verification.

## Portable backups and restore

Export includes every application and owner sidecar table, original R2 bytes,
HTTP metadata and custom metadata. The database reads run in one D1 transaction.
Pause operator writes and scheduled work for a coordinated backup: D1 and R2 do
not share a transaction, so the archive must not be treated as a cross-service
point-in-time backup while data is changing. A failed export leaves no completed
manifest; use a new empty output directory for the next attempt. Archive files
are private because they include subscriber data, sessions and frozen mail.

```sh
pnpm run export -- --remote --environment production --out /private/backups/lamp-first
pnpm run export -- --persist-to /private/local-state --out /private/backups/lamp-local
pnpm run import -- --from /private/backups/lamp-local --persist-to /private/empty-state
```

Keep the owner's exact source revision alongside the backup. Import checks the
archive checksums and core/owner migration hashes before any destination mutation.
Owner migrations in `migrations/ext/` use their own ledger and run after core
migrations in development, setup and restore. Preserve the contents and identity
of already-applied migrations; add and verify forward migrations for later schema
changes, whether they change core or owner-specific data.

Restore into a new empty database and bucket. A partial or interrupted restore
is never published by the import command, and rerunning against a populated
location is rejected. Retain that location for diagnosis and retry into a new
empty location using the unchanged archive. Do not erase an existing deployment
to make it fit the import precondition. Keep the original token/signing secrets
and verify export → import → export equality, native sign-in, public content and
a publication before routing traffic to the restored deployment.

## Dependency failure

Public reads use versioned R2 artifacts without querying D1. The Worker retains
successful responses in its local edge cache for the one-hour outage window and
marks that response as last known state when snapshot storage reads fail. A cold
edge cache with inaccessible storage cannot recover bytes it has never seen;
retain the original data and verify the tested deployment's warmed-cache path.
`/health` checks D1, R2 and Queue reachability separately and must return503 during
a dependency failure. A successful public response is not a healthy-backend proof.
For managed installations (`RER_INSTALLATION_ID`), `/health` also completes pending
public snapshot work before reporting readiness, including the initial migrated
state in previews where cron is disabled. A failed snapshot build returns 503.
This readiness step does not dispatch scheduled incidents, maintenance or mail.
A Cloudflare-wide outage needs separately operated hosting; this release does not
provision an independent standby or make that deployment claim.

For a remote restore, choose a new environment name and replacement host inputs,
then run `pnpm run setup -- --environment recovery --restore-from /private/backups/lamp-first`.
This provisions an empty target and imports before initialization; it never
publishes a Worker. Inspect the restored archive and record equivalence before
`pnpm run deploy -- --environment recovery`. Keep original host routing active
until the replacement has passed its application and provider checks. Passing
`--restore-from` directly to deploy performs the same restore before verification
and publication, and refuses a destination that already contains data.

## Optional shared event relay

A standalone owner may use SendGrid's native signed webhook directly. When an
account shares its limited webhook slots, an owner-operated relay can verify the
original SendGrid signature and forward only events marked `rer_product=lamp`.
Set `RER_MAIL_RELAY_SECRET` to the per-product secret. Lamp verifies
`x-rer-mail-signature: v1=<HMAC-SHA256 hex>` over
`<x-rer-mail-timestamp>.<exact raw body>` and rejects timestamps outside five
minutes. Other-product events and IDs without a local durable send claim are
ignored. A bad relay signature is never retried as native SendGrid authentication.
The relay receives only delivery events; it cannot sign in or publish incidents.

Public HTTPS webhook destinations are fetched with Cloudflare's
`global_fetch_strictly_public` compatibility flag, including destinations hosted
as Workers in the same account. Keep that generated flag when customising the
Worker configuration. Provider and subscriber requests use manual redirect mode;
redirects are rejected so credentials and signed notifications stay at the
configured destination.

## Retained public snapshots

`SNAPSHOT_CACHE` binds the Worker-exported `SnapshotCache` SQLite Durable Object.
Wrangler creates it through migration `snapshot-cache-v1`; no new secret, external
account or manual namespace ID is required. Setup-generated and local configs
carry the binding and migration. The object is a cache of one complete published
R2 generation, replaced atomically and monotonically. It is necessary for
PAGE-006/007: KV can negatively cache a missing value after first publication and
cannot guarantee an immediate cold-edge read. Public serving never reads D1.

R2 remains authoritative during ordinary reads. On R2 failure the replica serves
last-known HTML, Atom, widget and their generated assets with generation timestamps;
`/health` independently reports dependency failures. A never-published page stays
503. A simultaneous Worker/replica outage is not claimed to be served by that
unavailable runtime; the advertised downstream stale-if-error policy still applies.

Each R2 generation includes `retained.json`, so existing portable archives contain
the complete replica input. Restore into a fresh environment as usual; the new
Worker primes its empty replica from the restored R2 bundle. Legacy archives that
predate the bundle are rebuilt by the minute scheduler from restored source.
Deployment waits for `X-Lamp-Snapshot-Retained: true` on the public status response
before declaring its smoke check complete, and fails visibly if readiness does
not arrive within 90 seconds. The cache is derived, not separate owner data; do
not copy a Durable Object namespace across owner installations.

Publication persists every immutable R2 artifact and its bundle, acknowledges the
complete replica, then advances the R2 selector. A rejected replica write cannot
expose a first or replacement R2 selector. Transient retries reuse the exact same
rendered version and bytes, including when a replica acknowledgment is lost.
If replica retention succeeds but the R2 selector write subsequently fails, the
previous selector stays in place and the job remains failed/pending. During an R2
outage the replica may serve that newer complete, already R2-persisted generation
as last-known state; it does not invent or partially compose a status. A later
retry repairs publication. Source work is completed only for its selected version.

## Inspect without deployment

`node scripts/operations.mjs describe` validates the declared commands without
installed dependencies. `node scripts/operations.mjs check` checks local required
input names and the existing deployment configuration parser. It does not call
Cloudflare, validate credentials, check DNS or claim remote health. See
`AUTHORING.md` for source publication, which is separate from deployment.


The artifact producer adds `rer-entry.js` as its entrypoint, preserving named
Worker exports. The wrapper reports the broker-injected release and Cloudflare
version at `/__rer/release`. Preview deployments require a short-lived HMAC grant
bound to that release; the entrypoint exchanges it for a secure, HttpOnly cookie
and checks it on every request, including static assets. Preview queue events
fail explicitly and scheduled events perform no work. The delivery service must
set assets to run the Worker first, omit preview schedules, bind version metadata,
and supply the preview secret; these are deployment responsibilities. The wrapper
is candidate code, so its presence is not an independent authorization boundary.

## Independent release and local browser setup

Start with `node scripts/install.mjs` before installing application dependencies.
The maintained Base loopback browser setup collects your actual owner, page,
timezone and provider choices. Opening or filling it has no provisioning or mail
effects. Start explicitly to install locked tools/dependencies and run the real
local Worker, or to finish native setup at an already approved independent RER
operator address. `--resume` preserves source, data and nonsecret answers; secrets
remain private, and a different owner/target requires a separate checkout.
See `scripts/installer/README.md`. The CI descriptor's tooling setup is separate.

`rer-project.json` is the independent source descriptor. Register it with the
exact external committed source SHA, then use its complete project build
workflow. The caller pins delivery `3bf5463466b68615ff3862a28acbe5cb9d1786ec`;
configure `RER_INSTALLATION_ID` and HTTPS `RER_BROKER_URL` as repository variables
only after the matching workflow revision is trusted by the intended broker.
Project mode installs its own pnpm/browser/XML tools without deployment secrets.
No hosted run, public repository access or provider authorization is implied by
local verification.

The independent candidate declares distinct app/public surfaces. The broker must
support that declarative interface and native pending setup readiness; an older
single-gateway broker is incompatible. Use `/signin` for app readiness. On an
empty owner database `/setup/status` returns409 and the public root correctly
returns503 because no snapshot exists. The approved plan permits that public503
only during explicit pending setup. Once initialized, status returns200 and
public readiness must be200; inconsistent settings or dependency failures fail.
The public host cannot reach setup, sessions, operator APIs or operator assets.

Supply `LAMP_BOOTSTRAP_SECRET` (at least32 random characters),
`MAIL_PROVIDER_API_KEY`, `SUBSCRIBER_TOKEN_SECRET` and `WEBHOOK_SIGNING_SECRET`
through the broker's separate runtime secret channel. Configure a real
`MAIL_FROM_ADDRESS`, the chosen mail provider, and signed receipt verification as
above. The candidate receives none of these secrets while building. Native
`POST /setup` takes a Bearer bootstrap secret and JSON fields `email`,
`displayName`, `pageName`, `tagline`, `timezone`; optional `mailProvider` and
`mailFromAddress` must match the deployed configuration. It atomically initializes
only a database without any owner records, preserves existing settings, and
never emits an operator session. Use the local browser installer for this action,
then ordinary emailed sign-in. Repeated or racing setup is refused. After setup,
remove the bootstrap runtime secret when no longer needed; existing owner rows
keep setup closed even if an owner is deactivated or erased.

Core migration bytes and broker identities `core-<filename>` and owner migration
identities `ext-<filename>` remain unchanged. Existing direct-owner D1 and owner
ledgers keep their historical names. Do not convert an existing edition-managed
installation into a new independent installation without its separately accepted
resource/data migration. Native archives include authoritative D1/R2 data; the
SnapshotCache Durable Object is derived and is rebuilt from retained R2 bundles.
This does not assert complete RER automatic Durable Object export/restore.
