# Lamp operations

Lamp uses distinct public page and operator application hosts. Each has its own
home page: the page host's `/` is the company's public status page, and the app
host's `/` is the Lamp landing page beside sign-in and the operator app. Its deployment
commands provision a real D1 database, R2 bucket and Queue by environment name,
apply migrations, initialize the first operator and page settings, build the
Worker and publish the emitted artifact. `rer deploy` runs all of these;
`pnpm run setup:cloudflare` runs the provisioning alone. (`pnpm run setup` is the
local first-owner setup.)

Owner task guides are published at `/docs` on the app host. Use
[`RUN-LOCALLY.md`](RUN-LOCALLY.md) for local launch, export, reset and restore;
it is the canonical local command sequence. This file remains the technical
reference for deployment inputs and Cloudflare archive operations. The
`export:cloudflare` and `import:cloudflare` scripts below are remote archive
tools, not `rer` verbs; `rer export` and `rer import` operate on local state.

## Owner inputs

Supply `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` for the intended account.
The token needs Worker deployment, D1, R2, Queues and custom-hostname access,
including Zone Workers Routes read/write permission for both hosts’ zones.
Account Worker access alone can upload the artifact but cannot attach its hosts.
For workers.dev hosting, custom-domain zone permissions are not needed; the token
must be able to read the account's Workers subdomain.

Hosted Lamp requires a mail provider and authenticated sender, including when
using terminal recovery links. Supply the Cloudflare credentials, both hostnames,
page branding, first operator email, `MAIL_FROM_ADDRESS`, `MAIL_DKIM_SELECTOR` and
`MAIL_PROVIDER_API_KEY`. The complete [input reference](docs/deployment-reference.md#inputs-you-supply-and-values-rer-generates)
distinguishes owner-supplied values from generated runtime secrets and uses the
same names as the CLI. The required-input source of truth is
`requiredEnvironment` in [OPERATIONS.json](OPERATIONS.json).

Store inputs in an owned `0600` file outside the repository and pass it to every
`rer deploy` invocation with `--env-file`, or export the same names in the calling
shell. The [deployment guide](docs/deploy.md#save-private-deployment-inputs) gives
file creation, contents and secret-generation commands. File values override the
environment; this is a plain `KEY=VALUE` file, not a shell script.

`rer deploy` generates `SETUP_TOKEN`, `SESSION_SECRET`, `SUBSCRIBER_TOKEN_SECRET`
and `WEBHOOK_SIGNING_SECRET` when absent. These are required runtime bindings,
not mandatory manual inputs for a first deploy. The native pipeline uploads the
values for that run: for repeatable redeploys and recovery, supply and keep your
original secrets in the private file. Each must contain at least 32 characters.
Keep the original session, subscriber and webhook secrets on restore. Direct
`setup:cloudflare` and `deploy:cloudflare` scripts require those values exported;
they do not generate them or read `--env-file` themselves.

Optionally set `OWNER_DISPLAY_NAME` to the first owner's name (1–120 characters).
It is used only when setup creates the first operator; existing owners keep their
name and access. Without it, the native command uses `Owner`.

`MAIL_PROVIDER` selects `resend` (default, preserving existing deployments) or
`sendgrid`. Both use `MAIL_PROVIDER_API_KEY`; map an existing provider-specific
credential into that environment variable without writing it into source.
Likewise map the verified sender address into `MAIL_FROM_ADDRESS`. The sender
domain must publish a DMARC policy at `_dmarc.<From-domain>` and a reachable
DKIM key at `<selector>._domainkey.<From-domain>`; provider CNAMEs are supported.
SPF may be published on the provider's return-path domain instead of the From
domain. DMARC alignment through DKIM is sufficient; configure the provider to
sign with an aligned domain. Setup checks DKIM and DMARC before provisioning.
It does not prove message alignment, DKIM's header coverage or recipient
delivery: verify those against a received message.

For SendGrid set `SENDGRID_WEBHOOK_PUBLIC_KEY` to its base64 P-256 public key and
configure the signed Event Webhook URL as
`https://<LAMP_PAGE_HOST>/api/intake/mail-events`, with delivered, bounce, dropped
and spamreport events enabled. For Resend, set `RESEND_WEBHOOK_SECRET` and use the
same URL. Without the selected provider's verification key or the optional signed
SendGrid relay, this endpoint rejects callbacks. The delivery log then shows
**Accepted by SendGrid** (or **Accepted by Resend**) as the final email status
available, with its acceptance time. CSV retains the queued transport outcome
and provider-accepted timestamp. API acceptance alone does not mark recipient
delivery. With the key
and webhook configured, signed receipts can report delivered, bounced or
complained; a delivered report does not prove that a person read the email.

SendGrid requests explicitly disable click, open, subscription and analytics
tracking. Verify the received message has no added tracking and that DKIM's `h=`
list covers `List-Unsubscribe` and `List-Unsubscribe-Post` before claiming one-click
mailbox-provider support. A provider setting or received message that fails these
checks is a release blocker, not a reason to claim the behavior locally.

## Hostnames and DNS

One installation publishes one company's status page. `LAMP_PAGE_HOST` is the name
the company's customers open, such as `status.company.com`; `LAMP_APP_HOST` is the
operator name, such as `lamp.company.com`, whose `/` is the Lamp landing page. The
two must differ: setup rejects equal values, and a Worker started with equal values
fails every request with an error naming `LAMP_PAGE_HOST` and `LAMP_APP_HOST`.
Hosting several companies means one installation per company, each with its own
page host.

The landing page's former address `/lamp` answers 301 to the app host's `/` for one
release. The landing page is a public, indexable document on the operator name.

## Your own domain

Lamp attaches the public page and operator app as Cloudflare Worker custom domains.
Each hostname must be in a domain whose DNS zone is active in the Cloudflare account
used for setup. Cloudflare creates the required DNS records and TLS certificates
when the custom domains are provisioned; do not point a CNAME at a guessed Worker
address. See [Cloudflare's custom-domain documentation](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

1. Add the domain or domains that contain your chosen hostnames to the intended
   Cloudflare account. If another provider currently hosts a domain's DNS, review and
   import its existing records, change that registrar's authoritative nameservers to
   the pair Cloudflare assigned, and wait for that zone to report as active. Keep each
   registration at its current registrar if you prefer; DNS authority must be Cloudflare.
2. Choose two distinct hostnames in one or more active zones in that Cloudflare
   account, such as `status.example.com` for the public page and `ops.example.com` for
   the app. Resolve any current service or DNS record using either exact hostname as
   part of your planned migration before setup attaches the Worker. The deployment
   token needs custom-domain access to both zones when they are separate.
3. Set `LAMP_PAGE_HOST` and `LAMP_APP_HOST` to those hostnames in the private owner
   inputs described above. Run `rer deploy`.
4. After deployment, open `https://<LAMP_PAGE_HOST>/` and check
   `https://<LAMP_APP_HOST>/health`. Verify the public page and operator sign-in on
   their respective hostnames before routing customers to the new setup.

DNS hosted by another provider is unsupported. The registrar can remain elsewhere,
but it must delegate the domain to the active Cloudflare zone before setup.

## Deployment and checks

Before a command that builds or verifies the checkout, stop a running local
development server with `rer dev --stop` or production preview with
`rer preview --stop`; restart local work after the command completes.

```sh
rer install
rer deploy --dry-run --environment production --env-file "$HOME/.config/lamp/production.env"
rer deploy --environment production --env-file "$HOME/.config/lamp/production.env"
```

Dry run compiles and validates generated configuration without changing Cloudflare.
Real deploy validates owner inputs, runs resource setup and migrations, then builds.
Run `rer verify` separately for the full source and browser checks; the GitHub Verify
workflow retains that complete verification chain. Setup does not create a placeholder
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
Direct owner deployment remains available with `rer deploy`.

### Remove a deployment

Back up data before retiring an installation. From its deploying checkout, use
the original account and environment:

```sh
node scripts/remove-deployment.mjs --environment production --env-file "$HOME/.config/lamp/production.env" --yes
```

This removes the public Worker first in `workers-dev` mode, then the app Worker
and resources proven created for that environment, including their data, and
reads back their absence. Custom-domain mode has one Worker. The generic
`rer deploy --remove --yes` alone does not remove Lamp's separate public Worker.
Native deployments retain app creation ownership at
`.rer/deploy/<environment>.json` and public Worker ownership at
`.rer/deploy/<environment>.page.json`. Lamp's
`.seed/deployment/<environment>.json` remains an archive/resource reference; it
does not prove creation ownership. Older installations without ownership records
need the [manual procedure and limits](docs/deployment-reference.md#removal-and-deployment-records).
Do not treat a missing record as proof that Cloudflare has no resources.

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
mailbox delivery. If no receipt verification key is configured, a successful
send retains queued in storage and shows provider acceptance as its final
status in Deliveries. The optional signed SendGrid relay also enables receipts.
Retain the D1/R2 archive and the private deployment inputs for recovery. No remote restore or provider acceptance is implied by local verification.

## Portable backups and restore

This procedure covers a deployed Cloudflare installation. For local data,
follow [`RUN-LOCALLY.md`](RUN-LOCALLY.md#back-up-and-restore-local-data), stop
the running dev or preview server before transferring or resetting, export
before reset, import only into an empty destination, then run setup with the
original or restored owner before restarting Lamp.

Export includes every application and owner sidecar table, original R2 bytes,
HTTP metadata and custom metadata. The database reads run in one D1 transaction.
Pause operator writes and scheduled work for a coordinated backup: D1 and R2 do
not share a transaction, so the archive must not be treated as a cross-service
point-in-time backup while data is changing. A failed export leaves no completed
manifest; use a new empty output directory for the next attempt. Archive files
are private because they include subscriber data, sessions and frozen mail.

```sh
pnpm run export:cloudflare -- --remote --environment production --out /private/backups/lamp-first
pnpm run export:cloudflare -- --persist-to /private/local-state --out /private/backups/lamp-local
pnpm run import:cloudflare -- --from /private/backups/lamp-local --persist-to /private/empty-state
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
then run `pnpm run setup:cloudflare -- --environment recovery --restore-from /private/backups/lamp-first`.
This provisions an empty target and imports before initialization; it never
publishes a Worker. Inspect the restored archive and record equivalence before
`rer deploy --environment recovery`. Keep original host routing active
until the replacement has passed its application and provider checks. Passing
`--restore-from` directly to deploy performs the same restore before building
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

Install Node 22.20.0, pnpm 10.12.4 and Git on PATH, then run
`node scripts/install.mjs` before installing application dependencies.
The maintained Base loopback browser setup collects your actual owner, page,
timezone and provider choices. Opening or filling it has no provisioning or mail
effects. Choose **On this computer** to install locked dependencies and run the
real local Worker. Choose **Online for your team** to use native setup and deploy
in your Cloudflare account. Before Online Start, complete **Online page settings**
and **Online mail settings** through Edit, and use an API token and custom
operator address in **Hosting & connections**. Native setup preserves an existing
owner. `--resume` preserves source, data and nonsecret answers; generated secrets
remain private. Changing a recorded hosted account, destination, owner or sender
requires a separate checkout.
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

Supply independent `SETUP_TOKEN` and `SESSION_SECRET` (at least 32 random characters each),
`MAIL_PROVIDER_API_KEY`, `SUBSCRIBER_TOKEN_SECRET` and `WEBHOOK_SIGNING_SECRET`
through the broker's separate runtime secret channel. Configure a real
`MAIL_FROM_ADDRESS`, the chosen mail provider, and signed receipt verification as
above. The candidate receives none of these secrets while building. Native
`POST /auth/bootstrap` claims the configured `SETUP_OPERATOR_EMAIL` with JSON `token` (the `SETUP_TOKEN`) and `displayName`. Base issues the owner's session and refuses repeated or racing claims. The installer then applies product page settings. Keep the installer-managed `SETUP_TOKEN` for subsequent setup/deploy commands; the durable Base claim prevents reuse against an initialized store. Keep `SESSION_SECRET` stable. Subsequent sign-in uses Base email links and a confirmation POST.

Core migration bytes and broker identities `core-<filename>` and owner migration
identities `ext-<filename>` remain unchanged. Existing direct-owner D1 and owner
ledgers keep their historical names. Do not convert an existing edition-managed
installation into a new independent installation without its separately accepted
resource/data migration. Native archives include authoritative D1/R2 data; the
SnapshotCache Durable Object is derived and is rebuilt from retained R2 bundles.
This does not assert complete RER automatic Durable Object export/restore.

## Native workers.dev deployment

Custom domains remain the default. To use the account's existing Workers subdomain without custom DNS, set `LAMP_HOSTING=workers-dev`. Set `LAMP_RESOURCE_PREFIX` to an explicit lowercase resource namespace (letters, digits and hyphens, at most 47 characters). If omitted, it is `lamp-<environment>`; the environment defaults to `production`.

Both `LAMP_APP_HOST` and `LAMP_PAGE_HOST` remain required in this mode. Find the
registered account subdomain in Cloudflare's Workers & Pages settings or use the
[read-only API lookup](docs/deployment-reference.md#find-your-workersdev-hostnames).
It is not the account name or ID. Lamp validates the configured names against the
authenticated account without changing its subdomain.

The app host is exactly `<prefix>.<subdomain>.workers.dev` and the page host
exactly `<prefix>-page.<subdomain>.workers.dev`; any other names are refused.
For a prefix `my-status` and the Workers subdomain `my-account`, export these
values with the other owner inputs, or put them in the private input file:

```sh
export LAMP_HOSTING=workers-dev
export LAMP_RESOURCE_PREFIX=my-status
export LAMP_APP_HOST=my-status.my-account.workers.dev
export LAMP_PAGE_HOST=my-status-page.my-account.workers.dev
```

Then follow [the deploy commands](docs/deploy.md#validate-and-deploy) with the same
environment and inputs. If using `--env-file`, update the hostname values in that
file too; they override these exports. The app Worker is named exactly the prefix; the public Worker adds `-page`. D1 adds `-db`, R2 adds `-files`, and the queue adds `-jobs`. The generated config records the supplied account ID. Deployment records preserve actual resource names for archive and sign-in commands.

Both Workers serve the same compiled source and retain the configured host checks: operator paths on the public hostname return 404, and operator APIs on the app hostname require a session. The app Worker owns the scheduled jobs, queue consumer and snapshot Durable Object. The public Worker uses that same object and storage without a second scheduler or consumer. The command deploys the app Worker first, then the public Worker. Keep the prefix reserved for this installation, and remove both Workers when retiring it.

This mode is supported by native `rer deploy`. The independent delivery artifact contract describes one Worker; it does not package this two-Worker topology.

### Local operational inspection

Local dev signs the owner in with one click and silently suppresses mail.
Demos mock sends to people and third parties while public reads run for real.
Neither mode retains mail or serves a captured-mail viewer.

In ordinary development, `GET /__dev/outbox` returns HTTP 200 with a plain-text
notice that local mail is suppressed and no messages are retained. It provides
the compatibility path, not a mail viewer. The notice is excluded from demos
and production. Exercise emailed sign-in and subscriber messages through a
hosted installation's actual provider and recipient mailbox.

`node scripts/operations.mjs check` prints the required inputs and their sources,
plus a plain next step. Version 2 of `OPERATIONS.json` describes the real native
mail dispatch and scheduled-update loops. Lamp's chosen provider consumes
`MAIL_PROVIDER_API_KEY`; this check never sends mail, queries provider credentials
or establishes hosted health.

## Independent external heartbeat

Set `LAMP_HEARTBEAT_URL` to the public HTTPS ping URL of the owner's chosen external heartbeat service. It is off when omitted. Keep this capability URL secret. `LAMP_HEARTBEAT_INTERVAL_MINUTES` defaults to 5. Configure the service's expected interval and grace period to match; the service sends the alarm when pings stop. Choose the receiving mailbox and phone on infrastructure independent of this hosting provider.

The minute cron sends an empty GET only on the heartbeat interval grid, after scheduled work completes and `/health` verifies D1, R2 and Queue. Failed dependencies and the hosting-move `EFFECTS_PAUSED=1` hold stop pings. No subscriber, incident, page, visitor or owner data travels. A successful ping establishes the service acknowledged that ping; it does not prove human receipt. This watch does not provide standby hosting.

## Shared operator authentication

The checkout pins `@runeditrun/rer` 0.2.22. For hosted owner entry without email,
run this from the deploying checkout using the original account and environment:

```sh
rer signin --environment production --env-file "$HOME/.config/lamp/production.env"
```

The private `0600` input file or calling shell supplies `CLOUDFLARE_ACCOUNT_ID`
and `CLOUDFLARE_API_TOKEN`. The command uses the deployment's recorded owner and
database; it accepts neither `--email` nor `--remote`. It prints the link once,
does not save it, and sends no mail. Open it privately within 15 minutes. The
grant is single-use and its use is audited. Retain the deploying checkout and its
deployment records. An older installation needs additive migration
`0023_owner_signin.sql` applied by redeployment before this command can issue a
grant. `rer signin` 0.2.22 targets the default `lamp-<environment>` prefix; for a
custom `LAMP_RESOURCE_PREFIX`, use the compatibility command below with that
installation's generated configuration.
Hosted mail remains mandatory for normal email sign-in and subscriber messages.

Lamp adopts Base `aa9b4d4fc6cba60411ef8d24a81323113677c370`. Migration 0019 preserves non-erased operator IDs and active/inactive status, moves setup authority only with the setup operator (when that operator erased itself, no operator gains it and the editor stays closed), retains product attribution and subscriber credentials, and physically removes old sessions and pending links. Every active operator must sign in afresh. On a local in-place upgrade, `rer setup` adds the missing `SESSION_SECRET` and `SETUP_TOKEN` to the kept `.dev.vars` and changes no saved value. The setup operator may remove themselves only while another owner remains. Changing operator access requires a recent native email confirmation; Settings provides the confirmation action.

The installer provisions `SETUP_TOKEN` and `SESSION_SECRET`. Base `/auth/bootstrap` claims the empty store; a changed setup token cannot reopen it. Retain the installer-managed setup token: current setup/deploy tooling requires it and repeats the claim, accepting Base’s already-initialized refusal. The durable claim prevents the token from reopening the store. Never rotate `SESSION_SECRET` inadvertently on a redeploy.

The compatibility command `pnpm signin-link --email <operator>` issues an ordinary
email-flow confirmation link for an existing active operator. It reads
`SESSION_SECRET` from private local settings or the command environment. For a
deployed installation, add `--remote --config wrangler.toml` and export the
original `SESSION_SECRET` and Wrangler credentials; use the generated
configuration for the intended installation. An explicit `--origin` must be the
exact HTTPS operator origin. Capture stdout privately. This command uses Base's
20-minute confirmation flow and records the existing product audit event; it
creates no session until the confirmation POST. Prefer `rer signin` for hosted
owner entry.

Optional Auth installs link through the declared `oidc-provider@1` dependency (`IDENTITY_PROVIDER`). Base settings at `/auth/settings/identity` control admission. A link alone does not enable sign-in on existing installations. Google, Microsoft and Okta may also be configured with Base `AUTH_PROVIDERS` JSON and an independent `OIDC_TRANSACTION_SECRET`; use Base's included identity/oidc documentation for issuer, key and explicit subject association requirements. SCIM and role synchronization remain unsupported. No live identity provider has been exercised by the local adoption checks.

Apply migration 0020 after 0019 before starting the refreshed runtime. It adds
setup-link session provenance and exact approval attempts. Pending provider-link
approvals from the older runtime must be renewed. Native `rer export` archives
now authenticate their manifest and ordered parts; version-1 native archives
must be exported again with the new source before restore.

A native export retains durable operator identities and consumed owner claims.
After restore, sign in with a fresh email link. Old sessions, pending email links
and provider-link approvals do not travel; provider links require fresh approval
and sign-in is disabled until the owner enables it. Subscriber capabilities and
product attribution retain their authority.
