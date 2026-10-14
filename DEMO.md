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

Lamp uses the published npm package `@runeditrun/rer@0.2.6`, which includes the
demo CLI, host files, container ingress and egress isolation, build entry
options and the production demo-binding refusal. No CLI package patch is needed.
`modules/demo` retains the guard from Base revision `a6afad9f4d007bf1b97a75bd67880d1850683e5d`, with its HTTP helper import pointing at the installed package and Base's
new CSP helper copied alongside it. The start and ended pages are unchanged.
A narrow boundary compatibility change permits Lamp’s existing HTMLRewriter
only for the workerd engine; the Node engine still refuses it. All other
boundary restrictions remain active.

Ordinary deployment continues to use `hosted-check.json`; only `--demo`
selects the existing container-capable `deploy.json` declaration.

## Hosted deployment

`rer deploy --demo --dry-run` builds the real application and prepares its
container image folder and front Worker without contacting a provider. `run-demo.yml` dispatch deploys using
the `run-demo` environment. Push deployment additionally requires the
repository variable `RUN_DEMO_DEPLOY=true`; this adoption does not set it.
The workflow accepts only the authorized RunEditRun account.

The optional dispatch `proof=true` uses published Turnstile test keys only
for a separate `demo-proof` Worker at `demo.test.run-lamp.com`. It does not
change the production demo's widget or secret. Test keys are workflow inputs
to the generated front Worker, never application bindings or source settings.

Base currently routes only the app apex and fixes container ingress to that
origin. Consequently `page.demo.run-lamp.com` is not yet a working hosted
status surface. Its configured hostname is retained; no header override or
public bypass is installed. Base needs an allowlisted secondary-host route
that preserves the visitor cookie gate and authenticates the container ingress
host. Hosted page acceptance and the homepage CTA remain pending that repair.
