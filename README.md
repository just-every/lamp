<p align="center">
  <a href="https://justevery.com/#vol-lamp">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.webp">
      <source media="(prefers-color-scheme: light)" srcset=".github/assets/banner-light.webp">
      <img src=".github/assets/banner-light.webp" width="100%" alt="Lamp: When something breaks, turn the light on.">
    </picture>
  </a>
</p>

<p align="center"><a href="https://justevery.com">Part of Just Every</a> · <a href="LICENSE">MIT licensed</a></p>

# Lamp

Lamp is a self-hosted status page and incident communication desk for one business, with a real Cloudflare Worker, D1, R2, Queue runtime, generated setup configuration, and a schema-validated release record. Source verification, deployment and provider acceptance are separate outcomes; each adopting installation must record its own acceptance evidence.

The canonical source repository is [just-every/run-lamp](https://github.com/just-every/run-lamp). This is Lamp 1.3.0; see [CHANGELOG.md](CHANGELOG.md). A passing `rer verify` proves the source on your computer; a hosted installation, DNS and live mail delivery are proven per installation with [ACCEPTANCE.md](ACCEPTANCE.md).
This is the authoritative edition source for maintainers, owners and community
publishers. See [AUTHORING.md](AUTHORING.md) for source selection, local capability
publication and the shared workflow.

## Run it on your computer

1. Install Node 22.20.0, pnpm 10.12.4 and Git, clone this repository and open its directory.
2. `rer install`.
3. `rer setup --owner-email you@example.com` builds Lamp, applies the local migrations, writes fresh private settings to `.dev.vars` (mode 0600, never printed), creates you as the first owner and stops again. Leave out `--owner-email` to be asked.
4. `rer dev` serves Lamp and prints `RER_READY http://127.0.0.1:8787` and a private local owner entry URL.
5. Open the printed private entry URL to work as the local owner. To exercise email sign-in, sign out, request a link at `/signin`, and open its confirmation page from the development outbox (`rer outbox` prints its address). No email is sent. The first time, Lamp opens first-run setup at `/setup`: confirm your page name, description, time zone and colour, and Lamp opens your Overview with its setup checklist.

No Cloudflare account, mail key or other provider credential is needed. `--port P` picks another port (a busy port fails instead of moving); `rer dev --stop` stops the server.

Locally the app host is `127.0.0.1` and the page host is `localhost`, on one port:

- Lamp landing page, sign-in and the operator app: `http://127.0.0.1:8787/`, `/signin`, `/app`
- Public status page, history, feed and widget: `http://localhost:8787/`, `/history`, `/feed.atom`, `/widget.js`

Then, as you need them:

```sh
rer verify                                  # the complete local verifier
rer dev --stop                              # stop Lamp before a backup, reset or restore
rer export --output exports/lamp.rer        # back up
rer reset --yes                             # remove local data, owner, outbox and private settings
rer import --input exports/lamp.rer --yes   # restore into the emptied installation
rer setup --owner-email you@example.com     # the owner's email again, after an import
rer dev                                     # start Lamp again
rer deploy --dry-run
rer describe                                # every command, flag and local path
```

`node scripts/install.mjs` opens the same setup in a browser, with an option to host Lamp in your own Cloudflare account. See [RUN-LOCALLY.md](RUN-LOCALLY.md) and [SEED-COMMAND-CONTRACT.md](SEED-COMMAND-CONTRACT.md) for the shared command behaviour.

The development outbox shows captured sign-in, subscription and notification mail on loopback hosts only; production builds have no outbox. The landing page at `/`, `/signin`, `/setup`, `/app`, `/api/app` and `/health` belong to the app host; public paths, including the status page at `/`, belong to the page host. Every deployment uses two distinct hostnames.

`/app` and `/api/app/*` always require a server-side operator session.

## Local build

The operator app uses real D1 records for components, incidents, maintenance, subscribers, deliveries, settings, alerts, and operator management. Removing access and irreversible operator erasure are separate operations: erasure revokes access and removes personal values while retaining the opaque audit facts required to explain the action.

Every incident page, including the draft an alert creates, shows a brief built without a model: what is known (accepted alerts with their source, published updates, attached components) and the questions still open. A collapsed panel shows exactly what a suggestion request would send; internal notes are never part of it. With no `ai.provider.v1` configured, the incident composer shows no suggestion control and Lamp makes no AI request. With one, a suggestion fills only the text fields, each with the brief items it cites; text with no real source is flagged for checking. It never proposes a lifecycle or a next-update time, and it publishes nothing. If a configured provider fails or stays silent for 20 seconds, it surfaces the error without changing any other publication path.

Shortly before an incident's committed next-update time (10 minutes by default, policy `incident.update-due.v1`), Overview and the incident list show the update as due with one action to write it, and operators get one email; when the time passes they get one overdue email. Both come from the scheduled trigger, so nobody needs the app open. The public page shows only the committed time.

Public surfaces are versioned R2 snapshot artifacts, so public reads do not query D1. The snapshot renderer produces the status page, history, feed, widget, permanent incident pages, favicon, Open Graph artwork, and bounded refresh payload. Initial HTML retains all public incident fields and remains usable without script.

The public page wears Lamp's own style on the business's name, logo and accent: warm paper, white plates with hairlines, quiet state pills, and the self-hosted Inter embedded in its stylesheet. It leads with the overall status, then component rows with 90-day availability marks, then current incidents and planned maintenance, then recently resolved incidents and the subscribe form. Initial public HTML retains all real content and loads only same-origin assets; it never includes invented status records.

`pnpm run test:accessibility` runs Axe WCAG 2.2 AA checks in an isolated Worker against the real public, operator, and widget surfaces. It is automated local coverage and does not claim a manual accessibility evaluation. `pnpm run test:baseline` runs the local Workers baseline pack and records that Axe execution as `BASE-PUBLIC-003`.

## Visual references

The checked-in [`visual/`](visual/README.md) fixtures are curated from final local browser captures with test-owned data. They document the public status, history, permanent incident, sign-in, and operator surfaces at the listed viewport sizes; they are not deployment or tag proof.

![Atlas Cloud public status page](visual/01-public-status-active-desktop.png)

![Lamp operator overview](visual/04-overview-active.png)

The visual references document the implemented product. Generated design explorations are not runtime assets or evidence of deployment.

## Moving in

Use **Settings → Move in** to bring your components, incident history, maintenance and eligible email subscribers into Lamp. Review a dry run first, then see [the move-in guide](docs/moving-in.md) for source-specific steps and cutover checks.

## Owner-controlled operations

A real deployment needs the inputs below in your environment. Keep credentials outside the repository and terminal output. `rer deploy --dry-run` lists every missing input and where to get it before a deployment is configured; after configuration it compiles the generated Worker and assets without contacting Cloudflare.

| Inputs | Source |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Your Cloudflare account and scoped API token |
| `LAMP_PAGE_HOST`, `LAMP_APP_HOST` | Distinct public and operator hostnames |
| `LAMP_PAGE_NAME`, `LAMP_PAGE_TAGLINE`, `LAMP_PAGE_TIMEZONE`, `LAMP_ACCENT_COLOR` | Your page branding, IANA time zone and six-digit hex colour |
| `SETUP_OPERATOR_EMAIL` | Your first owner email |
| `MAIL_FROM_ADDRESS`, `MAIL_PROVIDER_API_KEY`, `MAIL_DKIM_SELECTOR` | Verified sender, provider API key and sender DNS configuration |
| `SUBSCRIBER_TOKEN_SECRET`, `WEBHOOK_SIGNING_SECRET` | Privately generated random secrets of at least 32 characters; `WEBHOOK_SIGNING_SECRET` also seals Slack and Teams channel addresses (list a new one first and keep the old while rotating) |

`MAIL_PROVIDER` selects `resend` (default) or `sendgrid`. `rer deploy` verifies the source, creates or reuses your Cloudflare resources, checks sender SPF, DKIM and DMARC, writes the generated `wrangler.toml`, applies migrations, initializes ownership, uploads secrets with the Worker and checks live readiness.

For native workers.dev hosting, set `LAMP_HOSTING=workers-dev` and optionally `LAMP_RESOURCE_PREFIX` to your explicit resource namespace. With the prefix `<prefix>` (`lamp-<environment>` when you leave it out; the environment is `production` unless you pass `--environment`) and your account's workers.dev subdomain `<subdomain>`, set `LAMP_APP_HOST` to `<prefix>.<subdomain>.workers.dev` and `LAMP_PAGE_HOST` to `<prefix>-page.<subdomain>.workers.dev`; other names are refused. Lamp deploys separate app and public Workers and preserves their host gates. See [native workers.dev deployment](OPERATIONS.md#native-workersdev-deployment) for exact naming and [remote verification](OPERATIONS.md#remote-verification-evidence) for running the full verifier on a trusted SSH machine.

Stop Lamp with `rer dev --stop`, then `rer export` and `rer import` move a local installation; after an import run `rer setup --owner-email you@example.com` and `rer dev`. For a deployed installation, `pnpm run export:cloudflare` writes every D1 entity as JSON and every R2 object with its original bytes and content type, and `pnpm run import:cloudflare` restores an archive only into an empty deployment after applying migrations. See [OPERATIONS.md](OPERATIONS.md) for provider setup, private backups, owner migrations and recovery into a fresh destination.

### Your own domain

Lamp’s Worker custom domains require the zones for `LAMP_PAGE_HOST` and `LAMP_APP_HOST` to be active in the Cloudflare account used for setup. The hostnames can use one zone or separate zones. If a registrar or DNS provider is elsewhere, add each domain to Cloudflare, review and import its existing DNS records, then point each registrar’s nameservers to the nameservers Cloudflare assigns and wait until each zone is active. Enter two distinct hostnames in your private deployment inputs and run `rer deploy`. Cloudflare creates the Worker DNS records and TLS certificates for those hostnames. DNS hosted outside Cloudflare is unsupported; see [the domain steps in OPERATIONS.md](OPERATIONS.md#your-own-domain) and [Cloudflare’s Workers custom-domain guide](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Verify the source

Run the local verifier with:

```sh
rer verify
```

The coverage gate fails if a `CONTRACT.md` clause lacks a meaningful tagged behavior test. The final tag identity and clean-clone verifier result are recorded externally once the source is frozen. See [TESTING.md](TESTING.md) for verification journeys and [HANDOVER.md](HANDOVER.md) for adoption and migration guidance.

Browser journeys use the pinned Playwright package. Install Chromium once in a fresh clone before running them:

```sh
pnpm exec playwright install chromium
```

## Customise and share improvements

The maintained edition defaults save integration and verification work. Configuration
and hooks are conveniences; editing domain internals, core schema, UI, framework
or infrastructure is ordinary authoring too. Choose the change that serves the
owner's outcome, without a required sequence of extension mechanisms. Complex
merges and adaptation are the agent's work. Preserve the owner's actual requirements
wherever recorded: `CONTRACT.md`, `DIVERGENCE.md`, owner instructions and optional
`.seed/intent.md`; no particular intent file or registry is required.

Feed useful mechanisms, defaults and verification cases back into shared source
when they would save work in another edition. Their natural home may be this
edition, a family, Base or an independent repository; no separate repository per
module or universal compatibility interface is required. Verify adoption against
the receiving product's requirements, including deliberate local differences.

## Shared source refactor

The edition carries editable shared SendGrid transport and authoring1.1 source.
`node scripts/edition-authoring/cli.mjs changes` explains changed inputs;
`extract` and `compare` provide retained source and incoming comparison context.
`release` writes an adjacent `.release.json` receipt; retain that sidecar with
source distribution and use `receipt <path>` to verify another clean clone.
See [AUTHORING.md](AUTHORING.md) for arguments and source-only verification limits.

SendGrid202 is accepted with a nullable actual provider receipt. Local correlation
identifies the command, not remote delivery. Uncertain submissions are reconciled
without automatic repetition; the edition retains its own durable policy.

Owner SQL in `migrations/ext/` runs after core through the actual local and deployment migration commands. Preserve applied histories; `pnpm run test:owner-migrations` tests real isolated D1 execution and recovery. See [migrations/README.md](migrations/README.md).

## Setup readiness

Overview lists eight setup steps from the installation's saved state: branding,
time zone, sender check, first component, first published incident, opening the
public page, checking its subscribe form, and choosing its address. Each step
opens its completion screen. The checklist collapses when all eight are done.
A first incident means a real customer update; do not publish a fictitious outage
just to complete setup.

In Settings, save the From email and select **Check mail sender**. Local mode
captures a check message in the development outbox and labels that result as
local readiness. Production reads the configured provider's domain
authentication status; its key needs domain-read permission in addition to send
permission. This proves the provider reports that domain verified, not inbox
delivery. Changing the sender or provider credential requires another check.
The public checks request the configured page address; the subscribe check
inspects its returned form. It does not subscribe anyone or prove delivery.

Under **Your public address**, read the custom domain guide or keep the current
address, then select **Use this public address**. A workers.dev address is valid.
This records the address choice, not a DNS validation. Public page visits never
write to the database; the protected **Open public page** action records its
successful server check before opening the page.

## Sign in from your terminal

If you cannot receive a sign-in email, use the installation checkout:

```sh
pnpm signin-link --email you@example.com
```

For a running local server on another port, add `--port 4180` (or `--origin
http://127.0.0.1:4180`). `PORT` and `LAMP_WORKERS_STATE_PATH` use the same local
settings as development; `--persist-to` selects an explicit local state folder.

For your deployed installation, with your own Wrangler/Cloudflare credentials
and the installation's `SESSION_SECRET` (the value deploy uploaded) set in the
command's environment:

```sh
pnpm signin-link --remote --email you@example.com
```

Without `SESSION_SECRET` in the environment, the remote command refuses and
says so; it never reads the secret from the deployed Worker.

The remote command reads the operator hostname from setup's `wrangler.toml`.
Use `--config path/to/wrangler.toml` for another installation or `--origin
https://operator.example.com` to specify its operator origin explicitly.
Only an existing active operator can receive a link. Unknown, deactivated and
erased operators are refused; the command never creates an operator or a session.
It prints one link, once, on stdout in your invoking terminal. Open that link
within 20 minutes. It follows the normal one-use sign-in flow and writes an audit
entry saying “sign-in link created from the command line”. The command stores
only a token hash and never writes the link to a file, log, or receipt.
