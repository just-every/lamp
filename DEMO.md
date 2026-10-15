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

Lamp pins the published npm package `@runeditrun/rer@0.2.23`.
Every vendored Base copy (`modules/demo`, the operator-auth HTTP/CSP files,
`modules/mail`, import-kit, d1-transport, integrations, delivery producer and
authoring tools) is a verbatim copy from tag `rer-v0.2.23` (commit `b4b372b`),
recorded together in `base-copies.json`; the owner claim comes from the package.
Import-kit's additive custody schemas are migration `0024`. Vite passes the demo
switches, isolates persistence through `RER_STATE_DIR`, and loads `demoSockets()`
first. Base provides one-click owner sign-in and the Demo/Dev label.

Ordinary deployment continues to use `hosted-check.json`; only `--demo`
selects the existing container-capable `deploy.json` declaration.

## Hosted deployment

`rer deploy --demo --dry-run` builds the real application and prepares its
container image folder and front Worker without contacting a provider. `run-demo.yml` is dispatched by hand and deploys
from the `run-demo` environment to the RunEditRun account.

The dispatch input `test_only` uses Cloudflare's published Turnstile test keys
only for a separate `demo-test` Worker at `demo.test.run-lamp.com`. It does not
change the production demo's widget or secret. Test keys are workflow inputs
to the generated front Worker, never application bindings or source settings.
The input `remove` runs `rer deploy --demo --remove --yes` for the selected
host instead of deploying it. The optional `RER_DEMO_OPERATOR_TOKEN`
environment secret lets the host operator read a failed start's probe record.

rer 0.2.23 routes the declared secondary host `page.demo.run-lamp.com`
(`container.hostVariables` in `deploy.json`) to the same visitor's container;
an anonymous request to it returns to the start page.
