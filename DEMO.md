# Lamp demo

Run `rer setup` once, then `rer demo`. Open its private `RER_OPEN` link to
enter as the saved owner. `rer demo --stop` removes the disposable data.
The ordinary installation remains in `.wrangler/state`; demo migrations,
D1, R2, queues and snapshots live under `.rer/demo/<start>/`.

Northstar's components, current and resolved incidents, published updates,
maintenance and subscribers are real editable product records. The first-run
screen is complete. Repeating the seed preserves edits and fixed record IDs.
A new demo starts fresh. The nav and document title read **Lamp Demo**; local development reads **Lamp Dev**. There is no injected bar or captured-mail viewer.

Public reads and checks use the real network. Demo email, subscriber webhooks,
and Slack/Teams posts return success without contacting recipients. Lamp wraps
its own subscriber mail adapter (including an extension adapter) with Base's
`demoEffect`; Base's operator-auth mail (invitations and sign-in links) completes
as mocked success inside Base; HTTP effects use Base's global fetch guard. Mail in
local dev is silently suppressed. Incident AI suggestions are offered in a demo:
the provider call is wrapped in `demoEffect`, so a visitor gets a suggestion built
from the incident brief, citing the brief's own facts, without any model call.
Public snapshots stay in the instance's disposable R2, including prior generations
retained by Lamp. The demo seed records the setup checks a configured workspace
has passed (sender, public page, subscribe form, public address), so the home
checklist reads complete.

## Base adoption

Lamp pins the published npm package `@runeditrun/rer@0.2.38`.
Every vendored Base copy (`modules/demo`, operator-auth, `modules/mail`,
import-kit, d1-transport, integrations, delivery producer, authoring tools and
the `run-demo.yml`/`run-site.yml` workflows) is a verbatim copy from tag
`rer-v0.2.36` (commit `d320c14`), recorded together in `base-copies.json`; the
owner claim comes from the package. Import-kit's additive custody schemas are
migration `0024`. Vite passes the demo switches, isolates persistence through
`RER_STATE_DIR`, and loads `demoSockets()` first. Base provides one-click owner
sign-in and the Demo/Dev label.

Ordinary deployment continues to use `hosted-check.json`; only `--demo`
reads `deploy.json`'s Worker declaration and `container.hostVariables`.

## Hosted deployment

`rer deploy --demo` publishes `demo.run-lamp.com` on Base's native Worker
Loader host: Turnstile admits each visitor into their own isolate of Lamp's
ordinary Worker bundle, with SQLite facets for `DB` and `SnapshotCache`, the
`SNAPSHOTS` objects in that visitor's own storage, durable `JOBS` queue
batches and the every-minute cron delivered by alarm. Static files are served
at the edge. A copy ends after 60 minutes, 15 idle minutes or sign-out, and its
storage is erased. `rer deploy --demo --dry-run` builds `.rer/demo-host/`
without contacting a provider. `run-demo.yml` is dispatched by hand and deploys
from the `run-demo` environment to the RunEditRun account.

The declared secondary host `page.demo.run-lamp.com`
(`container.hostVariables` in `deploy.json`) is a second custom domain on the
same demo Worker and reaches the same visitor's isolate, so the visitor's
public status page, subscribe form and feeds answer there; an anonymous
request to it returns to the start page.

The dispatch input `test_only` uses Cloudflare's published Turnstile test keys
for a separate `demo-test` Worker at `demo.test.run-lamp.com`; starts there need
the private measurement token. Base's template scopes only the declaration's
`domain`, while Lamp's two host settings must sit under the demo hostname, so a
test host is dispatched from a branch whose `deploy-demo.json` sets
`LAMP_APP_HOST` to `demo.test.run-lamp.com` and `LAMP_PAGE_HOST` to
`page.demo.test.run-lamp.com`. The input `remove` runs
`rer deploy --demo --remove --yes` for the selected host instead of deploying
it.
