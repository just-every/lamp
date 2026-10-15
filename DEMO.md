# Lamp demo

Run `rer setup` once, then `rer demo`. Open its private `RER_OPEN` link to
enter as the saved owner. `rer demo --stop` removes the disposable data.
The ordinary installation remains in `.wrangler/state`; demo migrations,
D1, R2, queues and snapshots live under `.rer/demo/<start>/`.

Northstar's components, current and resolved incidents, published updates,
maintenance and subscribers are real editable product records. The first-run
screen is complete. Repeating the seed preserves edits and fixed record IDs.
A new demo starts fresh. Base's marker identifies the demo on every HTML page
and lists captured email and refused outbound requests.

Mail uses Base's durable development outbox in the demo's DB/R2. Subscriber
and webhook signing material is generated inside that disposable state;
there are no provider credentials in `deploy-demo.json`. Webhooks, channels,
heartbeat and API importers use their ordinary network paths and are refused
by Base's guard. AI remains unconfigured. Public snapshots stay in the
instance's disposable R2, including prior generations retained by Lamp.

## Base adoption

Lamp uses the published npm package `@runeditrun/rer@0.2.16`, which includes the
demo CLI, host files, container ingress and egress isolation, build entry
options and the production demo-binding refusal. No CLI package patch is needed.
`modules/demo` is refreshed from Base tag `rer-v0.2.16` (commit `be254d4eb7831b9d6adc4bdff584cf61e2b972ce`), including the top-strip Demo bar. Its HTTP helper import points at the installed package; the CSP helper is copied alongside it. `edition.json` records this adapted runtime origin and mappings, and `sources.lock.json` retains its comparison source. The host package supplies start progress and keeps idle containers alive for the 15-minute idle / 60-minute lifetime.
Base's container boundary admits Lamp's existing HTMLRewriter for the workerd
engine the demo image uses; the Node engine still refuses it.

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
