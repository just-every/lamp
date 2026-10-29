# Lamp operations

Mail dispatch is a required Worker loop. Lamp's configuration module validates
its conditional RER, SendGrid or Resend credentials before deployment; the
Managed relay capability and assigned fields are declared in the generated
deployment specification. Rer 0.2.29's generic mail-loop schema lists only direct
providers, so it does not describe Lamp's relay transport.

Lamp uses distinct public page and operator application hosts. Each has its own
home page: the page host's `/` is the company's public status page, and the app
host's `/` is the Lamp landing page beside sign-in and the operator app. Its deployment
commands provision a real D1 database, R2 bucket and Queue by environment name,
apply migrations, initialize the first operator and page settings, build the
Worker and publish the emitted artifact. `rer deploy` runs all of these;
`node scripts/setup.mjs --environment <name> --env-file <file>` runs the
provisioning alone. (`rer setup` is the local first-owner setup.)

Owner task guides are published at `/docs` on the app host. Use
[`RUN-LOCALLY.md`](RUN-LOCALLY.md) for local launch, export, reset and restore;
it is the canonical local command sequence. This file remains the technical
reference for deployment inputs and Cloudflare archive operations. The
`scripts/export.mjs` and `scripts/import.mjs` commands below are remote archive
tools run with Node 22 or later. `rer export` and `rer import` operate on local
state, except `rer export --target remote --output DIR`, which runs
`node scripts/export.mjs --remote --environment production --out DIR` for the
installation this checkout deployed as `production`.

## Owner inputs

Supply `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` for the intended account.
The token needs Worker deployment, D1, R2, Queues and custom-hostname access,
including Zone Workers Routes read/write permission for both hosts’ zones.
Account Worker access alone can upload the artifact but cannot attach its hosts.
For workers.dev hosting, custom-domain zone permissions are not needed; the token
must be able to read the account's Workers subdomain.

- **Free:** you run Lamp's open source yourself in your own Cloudflare account,
  with no Run Edit Run charge. The commands in this guide are this path.
- **Assisted:** Run Edit Run installs and maintains Lamp for you, while it stays
  in your own Cloudflare account and GitHub repository (early access).
- **Managed:** Run Edit Run hosts and runs Lamp for you (waitlist only).

Compare them on [Run Edit Run plans](https://runeditrun.com/pricing).

Hosted Lamp requires working mail, including when using terminal recovery links.
Managed hosting includes it without a provider account or mail key from the owner:
RER fills and hides `MAIL_PROVIDER=rer`, `MAIL_FROM`, `MAIL_RELAY_URL` and the
private installation credential `MAIL_API_KEY`. These values are runtime bindings;
provider credentials never enter the application build.

Free and Assisted hosting retain your own Resend or SendGrid configuration. For
native deployment, supply the Cloudflare credentials, both hostnames,
page branding, first operator email, `MAIL_FROM_ADDRESS`, `MAIL_DKIM_SELECTOR` and
`MAIL_PROVIDER_API_KEY`. The complete [input reference](docs/deployment-reference.md#inputs-you-supply-and-values-rer-generates)
distinguishes owner-supplied values from generated runtime secrets and uses the
same names as the CLI. The required-input source of truth is
`requiredEnvironment` in [OPERATIONS.json](OPERATIONS.json).

Store inputs in an owned `0600` file outside the repository and pass it to every
`rer deploy` invocation with `--env-file`, or export the same names in the calling
shell. The [deployment guide](docs/deploy.md#step-1-make-a-private-input-file) gives
file creation, contents and secret-generation commands. File values override the
environment; this is a plain `KEY=VALUE` file, not a shell script.

`rer deploy` generates `SETUP_TOKEN`, `SESSION_SECRET`, `INSTALLATION_KEY`, `SUBSCRIBER_TOKEN_SECRET`
and `WEBHOOK_SIGNING_SECRET` when absent. These are required runtime bindings,
not mandatory manual inputs for a first deploy. rer keeps the values it generates
in `.rer/deploy/<environment>.secrets.env` (private, ignored by Git) and reuses
them on the next deploy; to deploy from another checkout, copy that file there or
keep the values in your private input file, or rer stops before uploading. A redeploy never replaces a live secret: each Worker
keeps the `SESSION_SECRET`, `SUBSCRIBER_TOKEN_SECRET`, `WEBHOOK_SIGNING_SECRET`
and `OIDC_TRANSACTION_SECRET` it already holds, whatever value the run supplies,
and the deploy names the ones it kept. Values reach only a Worker without them:
a first deploy, or a restore into a new installation. To replace one on purpose,
run `rer deploy … --rotate-secret NAME` for a secret rer generates and you have
not put in the file, or put the new value in the file and add
`LAMP_REPLACE_SECRETS=NAME` (comma-separated) for that one deploy. Replacing
`SESSION_SECRET` signs every operator out, and replacing `SUBSCRIBER_TOKEN_SECRET`
ends every emailed subscriber link. Each must contain at least 32 characters.
For recovery, supply and keep your original secrets in the private file: a
restore into a new installation needs the original session, subscriber and
webhook secrets. Direct
`setup:cloudflare` and `deploy:cloudflare` scripts require those values exported;
they do not generate them or read `--env-file` themselves.

Optionally set `OWNER_DISPLAY_NAME` to the first owner's name (1–120 characters).
It is used only when setup creates the first operator; existing owners keep their
name and access. Without it, the native command uses `Owner`.

For Free, Assisted and native deployment, `MAIL_PROVIDER` selects `resend`
(default, preserving existing deployments) or `sendgrid`. Both use
`MAIL_PROVIDER_API_KEY`; map an existing provider-specific credential into that environment variable without writing it into source.
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

A database Run Edit Run Managed installed carries Platform's own migration
ledger, `rer_migrations`. It is installation history, not owner data: export
and import refuse unless it lists exactly this revision's migration files with
their hashes (plus the installation's page initializer), the archive never
carries it, and restore never writes it. Import restores in place into a new
Managed installation whose owner has not signed in and whose tables match the
archive; Platform has already applied the migrations. Any other table,
including another `rer_` name, still stops the restore.

A local backup (`rer export`) restores into a database Run Edit Run Managed
installed with `rer import`, too. rer places it by Platform's ledger: each
`core-` file by its hash, and the page initializer `setup-initial-page.sql`,
which Lamp declares as data only (`scripts/installer/local.mjs`). It never
writes that ledger, and the archive's page settings replace the row the
initializer wrote. Every other table must be empty.

```sh
node scripts/export.mjs --remote --environment production --env-file "$HOME/.config/lamp/production.env" --out /private/backups/lamp-first
node scripts/export.mjs --persist-to /private/local-state --out /private/backups/lamp-local
node scripts/import.mjs --from /private/backups/lamp-local --persist-to /private/empty-state
```

They need only Node 22 or later and the checkout's installed dependencies
(`rer install`), not a global pnpm. A remote archive reads `CLOUDFLARE_ACCOUNT_ID`
and `CLOUDFLARE_API_TOKEN` from `--env-file` (or the exported shell values) and
the D1 and R2 names from `.seed/deployment/<environment>.json` in the deploying
checkout. The app's **Settings → Export page data** file is separate: it holds
the owner's page data, not this full archive ([Backups and recovery](docs/backups-and-recovery.md)).

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
`/health` checks D1, R2 and Queue reachability separately and returns503 naming
the failed dependency. A good result is recorded and answers later probes without
storage calls; once it is 30 seconds old a probe refreshes it in the background,
and after 10 minutes a probe checks every dependency itself. A failure is never
recorded, so every probe after a failed refresh checks again until it passes: a
dependency failure shows within one 30-second refresh period. A successful public
response is not a healthy-backend proof. `/health` also publishes a configured
page's first snapshot before reporting readiness, including the initial migrated
state in previews where cron is disabled. A failed snapshot build returns 503.
This readiness step does not dispatch scheduled incidents, maintenance or mail.
A Cloudflare-wide outage needs separately operated hosting; this release does not
provision an independent standby or make that deployment claim.

For a remote restore, choose a new environment name and replacement host inputs,
then run `node scripts/setup.mjs --environment recovery --env-file /private/recovery.env --restore-from /private/backups/lamp-first`.
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
single-gateway broker is incompatible. Use `/signin` for app readiness. Until the
owner claims the installation, `/setup/status` returns409 and the public root
returns503, the declared `pendingSetupStatuses`: with the body of the page the
deployment published from its stored settings, or a short not-set-up notice when
none exists. The approved plan permits that public503 only during explicit pending setup. Once initialized, status returns200 and
public readiness must be200; inconsistent settings or dependency failures fail.
The public host cannot reach setup, sessions, operator APIs or operator assets.

Supply independent `SETUP_TOKEN` and `SESSION_SECRET` (at least 32 random characters each),
`SUBSCRIBER_TOKEN_SECRET` and `WEBHOOK_SIGNING_SECRET` through the broker's separate
runtime secret channel. Managed hosting fills and hides `MAIL_PROVIDER=rer`,
`MAIL_FROM`, `MAIL_RELAY_URL` and private `MAIL_API_KEY`; no provider account or mail
key is needed from the owner. Free and Assisted hosting instead use
`MAIL_FROM_ADDRESS`, `MAIL_DKIM_SELECTOR` and private `MAIL_PROVIDER_API_KEY` for
the selected Resend or SendGrid account, with receipt verification as above.
The candidate receives none of these secrets while building. Native
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

Then follow [the deploy commands](docs/deploy.md#step-7-check-then-deploy) with the same
environment and inputs. If using `--env-file`, update the hostname values in that
file too; they override these exports. The app Worker is named exactly the prefix; the public Worker adds `-page`. D1 adds `-db`, R2 adds `-files`, and the queue adds `-jobs`. The generated config records the supplied account ID. Deployment records preserve actual resource names for archive and sign-in commands.

Both Workers serve the same compiled source and retain the configured host checks: operator paths on the public hostname return 404, and operator APIs on the app hostname require a session. The app Worker owns the scheduled jobs, queue consumer and snapshot Durable Object. The public Worker uses that same object and storage without a second scheduler or consumer. The command deploys the app Worker first, then the public Worker. Keep the prefix reserved for this installation, and remove both Workers when retiring it.

This mode is supported by native `rer deploy`. The independent delivery artifact contract describes one Worker; it does not package this two-Worker topology.

### Local operational inspection

Local dev signs the owner in with one click and silently suppresses mail.
Demos mock sends to people and third parties while public reads run for real.
Neither mode retains mail or serves a captured-mail viewer.

Exercise emailed sign-in and subscriber messages through a
hosted installation's actual provider and recipient mailbox.

`node scripts/operations.mjs check` prints the required inputs and their sources,
plus a plain next step. Version 2 of `OPERATIONS.json` describes the real native
mail dispatch and scheduled-update loops. Resend and SendGrid consume
`MAIL_PROVIDER_API_KEY`; Managed mail uses the private `MAIL_API_KEY` relay
credential. This check never sends mail, queries provider credentials
or establishes hosted health.

## Independent external heartbeat

Set `LAMP_HEARTBEAT_URL` to the public HTTPS ping URL of the owner's chosen external heartbeat service. It is off when omitted. Keep this capability URL secret. `LAMP_HEARTBEAT_INTERVAL_MINUTES` defaults to 5. Configure the service's expected interval and grace period to match; the service sends the alarm when pings stop. Choose the receiving mailbox and phone on infrastructure independent of this hosting provider.

The minute cron sends an empty GET only on the heartbeat interval grid, after scheduled work completes and a live check (never `/health`'s recorded result) verifies D1, R2 and Queue. Failed dependencies and the hosting-move `EFFECTS_PAUSED=1` hold stop pings. No subscriber, incident, page, visitor or owner data travels. A successful ping establishes the service acknowledged that ping; it does not prove human receipt. This watch does not provide standby hosting.

## Shared operator authentication

The checkout pins `@runeditrun/rer` 0.2.76. For hosted owner entry without email,
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
grant. The pinned `rer signin` targets the default `lamp-<environment>` prefix; for a
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

Optional provider setup is documented step by step under [Single sign-on](docs/operators-and-sign-in.md#optional-single-sign-on)
and the [technical identity configuration](#identity-provider-configuration) below.
SCIM and role synchronization remain unsupported. A saved setting, discovery
response or local protocol check does not establish a working live identity
provider; verify an invited operator's real sign-in on the installation.

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

## AI provider configuration

The [AI assistance guide](docs/ai-assistance.md) covers account setup, private
inputs, deploy commands and a real suggestion check. Native deployment accepts
`AI_PROVIDER_URL`, `AI_PROVIDER_MODEL` and private `AI_PROVIDER_API_KEY` only as a
complete set. The URL is the full HTTPS Chat Completions endpoint, not a base
URL: Lamp posts to it unchanged with Bearer authentication, the configured
model and `response_format: {"type":"json_object"}`. Select a model supporting
that format. The native deployment writes URL/model as Worker variables and
uploads the API key as a Worker secret; a dry run does not call the AI provider.

For local development, stop `rer dev`, add all three values to private
`.dev.vars` and restart. For a native hosted installation, add all three to the
existing private input file and use the same `rer deploy --environment` and
`--env-file` as the original installation. Removing all three and redeploying
clears the known optional API-key binding. Do not configure them alongside a
custom `ai.provider.v1` adapter; the runtime refuses that conflict. Tone
instructions are page settings and do not provision a provider. A configured
status checks presence of values; a real requested suggestion checks transport
and model access. Provider charges and data handling belong to the chosen
provider. DRAFT-002 limits the request to the incident brief, excluding internal
notes and components.

## Identity provider configuration

### Direct Google, Microsoft and Okta registration

Follow the [owner registration and configuration steps](docs/operators-and-sign-in.md#optional-single-sign-on).
`AUTH_PROVIDERS` is a JSON array uploaded as a Worker secret, alongside a separate
`OIDC_TRANSACTION_SECRET` of at least 32 characters. Preserve that secret across
ordinary deploys. Each provider entry has `id`, `preset`, `clientId` and client
authentication matching its registration: `client_secret_post` or
`client_secret_basic` plus `clientSecret`, or `private_key_jwt` plus a private
JWK in `privateKey` (with `kid`, the private parameters and a supported key
algorithm). Keep private keys and secrets out of source and logs.

Register `https://<LAMP_APP_HOST>/auth/oidc/<id>/callback` exactly. Google fixes
its issuer; Microsoft requires an exact `tenant`; Okta requires its exact HTTPS
`issuer`. Microsoft and Okta require a server-configured `subjectEmails` map
from each application's exact upstream `sub` to an existing invited operator's
email. Provider email alone is insufficient for these presets.

On first use, discovery pins the provider's issuer, client ID and endpoints.
Changing configuration records a pending re-link and keeps the previous pin.
For a change or a provider explicitly unlinked earlier, sign in as the setup
owner, choose **Settings → Operators → Confirm my identity**, complete the
emailed confirmation in that browser, then use the authenticated public API:

- `GET /auth/providers` lists provider pins and pending re-links.
- `POST /auth/providers/relink` with JSON `{"provider":"google"}` approves and
  pins the currently configured Google registration (use its configured ID).
- `POST /auth/providers/unlink` with the same JSON ends that provider link and
  revokes its sessions. Re-linking requires fresh owner approval.

Make these requests from the signed-in operator origin with its session cookie,
exact matching `Origin` header and `Content-Type: application/json`. They are
administrator API operations, not controls supplied by the identity checkbox.
Keep an email session available while checking the next real provider sign-in.

### Link an installed Auth provider

Set `IDENTITY_PROVIDER` to the Auth installation's exact HTTPS origin in the
private input file and redeploy. The provider must serve RER's dependency-link
metadata and advertise `oidc-provider@1.0.0` or newer in OIDC discovery. An
arbitrary OIDC issuer URL does not implement this protocol.

1. Claim Lamp's native owner first. Sign in as that owner, use **Confirm my
   identity** in Settings and complete the emailed confirmation.
2. On Lamp's signed-in operator origin, make the authenticated JSON request
   `POST /auth/dependencies/relink` with
   `{"interface":"oidc-provider@1","issuer":"https://auth.example.com"}`,
   replacing the issuer. This opens Lamp's ten-minute approval for that exact
   origin; a response of `{"pending":true}` is not a completed link.
3. Have the Auth owner approve this Lamp operator origin and the three exact
   addresses `https://<LAMP_APP_HOST>/.well-known/rer-link/callback`,
   `https://<LAMP_APP_HOST>/auth/oidc/auth/callback` and
   `https://<LAMP_APP_HOST>/auth/oidc/auth/logout`. Complete Auth's provider-owned
   link flow within Lamp's approval window. Auth calls back to Lamp, which
   generates its private key and retains the accepted registration. Do not put
   a hand-written Auth entry into `AUTH_PROVIDERS` for this linked-provider path.
4. Read `GET /auth/dependencies/status` and require the matching issuer and
   `oidc-provider@1` entry with `linked:true`. Then enable provider sign-in at
   `/auth/settings/identity` and check an invited operator's real Auth sign-in.

For an unattended provider initiation, Auth can issue a one-use approval JSON
file for those exact addresses. Keep it untracked, owned by you and mode `0600`,
and set `RER_LINK_TOKEN_FILE` to its path when continuing `rer setup` or
`rer deploy`. The CLI validates and consumes it; it deletes the file only after
checking Lamp's accepted link. It does not replace the current owner's fresh
Lamp-side approval on an existing installation. Use the provider's actual
approval flow to obtain the file; do not invent a token or registration.

Disabling provider sign-in revokes provider sessions; enabling it does not
restore them. Existing and restored installations need explicit enablement;
restored links also require fresh approval. Native email access and application
invitations remain authoritative throughout.
