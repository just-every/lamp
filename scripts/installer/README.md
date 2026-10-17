# Lamp installer adapter

The root `rer-setup.json` is the single application setup model. The byte-exact
Base onboarding runtime reads it in the browser and on the server. Base owns the
shared local/remote target, Cloudflare connection, resource name and operator
address. Lamp owns its branding, native setup, hosting and sign-in effects.

Install Node 22.20.0, pnpm 10.12.4 and Git on PATH, then run
`node scripts/install.mjs`. The browser opens before application dependencies
are installed. Start installs the locked dependencies through captured commands.

**On this computer** starts Lamp locally without a provider key. Sign-in is
one click, and local mail is silently suppressed.

**Online for your team** uses your own Cloudflare account. In Hosting &
connections choose an API token, resource name and custom operator address.
Before Start, use Edit on **Online page settings** and **Online mail settings**
to complete the public hostname, hosting mode, verified sender, DKIM selector
and provider API key. Missing or invalid inputs stop before dependency,
provisioning or deployment commands and name what to correct. The native
`deploy.mjs` command validates owner inputs, provisions through setup, applies
migrations, builds, deploys and checks health. Full source and browser checks run
separately through `rer verify`. Existing owners and data are preserved.
Hosting may create billable resources in the selected account.

This replaces the earlier separate "finish independent deployment" browser
choice. Existing independent deployments remain operable through Lamp's native
owner deployment commands. Old installer receipts and data are not deleted.
There is no entered bootstrap secret in the browser; native local bootstrap
remains in use and hosted sign-in uses the normal deployed email flow.

All subprocesses use Base's captured store, and generated secrets are registered
before command output. Root manifest generation declarations feed Base's private
settings writer for local and hosted secrets; reruns preserve existing values.
Hosting receipts bind the selected account, hosts, resource namespace, owner and
sender. Entered provider credentials remain private to the attempt.

Native name and description limits are checked before installation work. The
Base readiness model does not implement these native bounds. Lamp adopts Base
14's readiness policy: the old fixed 120-second cutoff is replaced by elapsed
progress and a configurable hard limit that defaults to fifteen minutes. The
Lamp adapter delegates to Base's `store.waitForReady` with owner cancellation
and uses that default; it exposes no separate timeout setting. The Lamp adoption
notes are present in the copied Base README. See [BASE-ADOPTION.md](BASE-ADOPTION.md)
for the source contract and remaining runtime evidence.

Local state remains in the private installer runtime folder. Legacy capture
metadata is never treated as provider delivery or silently resent. Local mail is
suppressed without retaining new messages.
Local checks do not establish provider delivery or hosted acceptance.
