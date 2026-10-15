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
its mail adapter (including an extension adapter) with Base's `demoEffect`;
HTTP effects use Base's global fetch guard. Mail in local dev is silently
suppressed. AI remains unconfigured. Public snapshots stay in the instance's
disposable R2, including prior generations retained by Lamp.

## Base adoption

Lamp pins the published npm package `@runeditrun/rer@0.2.20`.
`modules/demo` and its shared HTTP/CSP dependencies are verbatim Base copies
from `rer-v0.2.20`, recorded in `base-copies.json`. Vite passes the demo
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

Base currently routes only the app apex and fixes container ingress to that
origin. Consequently `page.demo.run-lamp.com` is not yet a working hosted
status surface. Its configured hostname is retained; no header override or
public bypass is installed. Base needs an allowlisted secondary-host route
that preserves the visitor cookie gate and authenticates the container ingress
host. Hosted page acceptance remains pending that repair.
