# Standalone seed onboarding

A dependency-free Node loopback installer and browser journey, maintained in Base.
Copy this directory byte-for-byte to an edition's `scripts/base-onboarding/` and
select that local source in `edition.json`. The edition owns its adapter, branding,
operations and subsequent changes. A working-tree adoption is not an upstream
publication: record a comparison revision only after those bytes are committed.
Foundation exports include the same source and a minimal real local adapter.

This onboarding path is optional Base convenience. RER can manage independently
authored software with a different installer, runtime or provider target; the
product declares its supported effects and the checks that establish them.

## Edition contract

`launch(root, seed)` starts the CLI; `fill(seed)` fills the existing session.
`startInstaller(root, {seed, ...options})` is the programmatic entrypoint.
A seed provides `product` (display name), `browserModule` and `background`
(checkout-relative paths), `model: {fields, safeKeys, secretScopes}`, optional
`features: {hosting,email,github,artwork}`, `defaults(info,{root,env})`,
`validateInput(input,env,providers)`, and `install(root,input,store,onApp,signal)`.
Defaults may be asynchronous. Fields provide validation functions; safeKeys is
an explicit nonsecret persistence allowlist. secretScopes maps each secret name
to the answer fields whose changes invalidate it. No feature is enabled implicitly.

The browser module exports `fields`, `safeKeys`, `product: {name,slugPrefix}`,
`features`, `setupGroups: [{id,title,keys}]`, and optional `requiredKeys`,
`initialValues`, `installInput`, `readySummary`. `kind:'hosting'` selects the
shared Cloudflare/email group; ordinary groups render their own fields. Browser
validation and required keys must agree with the server adapter. Source modules
are served directly; the browser module must use browser-resolvable imports.

Install callbacks call `store.step(label)`, retain a spawned app with `onApp(child)`,
respect cancellation, set `store.state.appUrl`, then call `store.phase('complete')`.
Register each detached app child immediately after spawning it, before awaiting
readiness or bootstrap, and finish all registrations before `install` settles.
The installer owns every registered live child: failed attempts stop their children
and await their exit before exposing retry; successful children stay running until
installer shutdown. Shutdown cancels the adapter and also stops children registered
while cancellation settles. Already-exited child handles are never signalled again.
Adapters must cooperate with cancellation and children must honour SIGTERM.
They own actual seed commands and bootstrap policy. Callback failures become a
visible failed installation; do not put secrets in labels/errors or command args.
Optional `resolveAddress`, `artwork` and `handoff` callbacks integrate supported
edition capabilities. Artwork returns `{workspaceArt,artworkBridge,imageLimit}`;
HappyToHelp owns its private owner-bootstrap/artwork transfer implementation.
`inference` adds seed facts to the common connected-agent instructions.

The core requires exact loopback Host, same-origin writes, an HttpOnly session
cookie and a separate CSRF token. Secret values stay in memory and are scoped to
identity answers. Saved drafts carry product identity. Agent prefill preserves
browser-sourced choices; explicit launcher `--answers` supplies intentional
replacement answers. Groups advance only through the owner's Continue action.
A known complete draft opens review rather than asking for its values again.

Run `node --test onboarding/*.test.mjs onboarding/ui/*.test.mjs` in Base.
Edition integration tests must separately prove actual install and running output.

Private installer directories are tightened to owner-only access on resume;
credential, local environment and state files are tightened before reading or
updating them. Storage must belong to the current user, and files must be regular
files. Permissive hard-linked files are refused before changing their shared
inode; already-private links can be read and atomically replaced without
changing their other links. Symlinked private paths are refused before touching
their targets. Receipt updates preserve the original token and additional saved
fields; only the explicit deployment acknowledgement marks a receipt deployed.
This protects ordinary owner checkouts, not concurrent hostile replacement of
ancestor directories. POSIX mode assertions run on the supported local filesystem.

HappyToHelp adopted this private-storage implementation and regression tests
byte-for-byte on 20 September 2026. Both shared and copied onboarding suites were
run locally; this is working-tree adoption evidence, not publication or hosted
installation acceptance.

Start reserves its session before awaiting draft persistence or artwork transfer.
Concurrent Start, answer edits and provider connection are refused during this
reservation; the running phase is persisted before calling the adapter. On resume,
a completed session opens review so the product can explicitly restart its local
runtime. Adapters must preserve existing owner data and bind any private receipt
to the acquired source and selected target. The core nonsecret draft is product
bound; it is not a deployment or native authentication receipt.
Answer, credential, activity, address and connection requests reserve their work
before reading a request body. Start refuses while any such request is pending,
so a previously admitted slow request cannot mutate setup across the Start
boundary. The reservation is released on success, refusal or request failure.

### Safe installation failures

The UI starts before dependency or runtime checks. Perform checks only inside
`install` after explicit Start. Import `installationFailure` from the copied
`failures.mjs` and throw one of these canned errors:

- `installationFailure('node_version', {version:'26.8.1'})` for an unmet exact
  Node requirement (the version must contain three numeric components).
- `installationFailure('missing_tool', {tool:'npm'})` when the executable cannot
  be found. Supported tools are `node`, `npm`, `pnpm`, and `git`.
- `installationFailure('command_failed', {step:'dependencies'})` for a real
  unsuccessful command. Supported steps are `dependencies`, `setup`, `build`,
  `verify`, `start`, and `deploy`.

At the command boundary map a spawn `ENOENT` to the known executable's
`missing_tool` failure; map an unsuccessful exit to the corresponding
`command_failed` step. Preserve cancellation behavior. Do not classify every
exception as a missing tool, pass command arguments/output/environment, or add
untrusted error messages to progress labels. Unknown failures remain redacted
and direct the owner to the last displayed step and their agent. The core does
not promise terminal diagnostics that the adapter may not have emitted.
Only errors created by this module instance are approved: matching properties,
subclasses, modified messages and nested causes cannot supply browser text.
Draft answers survive failure and reopening with `--resume`; credentials remain
memory-only and may need to be supplied again. Restarting clears stale failure
text. This contract reports failures; it does not install tools or retry commands.
