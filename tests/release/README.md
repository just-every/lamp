Release verification is separate from ordinary application verification:

```sh
node tests/release/verify.mjs
node tests/release/verify.mjs --from v1.4.0 --evidence /absolute/evidence/directory
```

The default previous tag comes from `RELEASE.json.previousVersion`. Fetch that
release tag before running (CI must retain Git history and tags). The test builds
isolated previous and current checkouts; it never builds the caller's `dist`.
The current checkout includes tracked working edits. No local installation
configuration, credentials, emitted artifacts or saved state are copied.

One native Worker flow creates populated release state, stops the old runtime,
exports its backup, applies only pending core and owner migrations, then starts
the new emitted Worker against the same D1 and R2 state. It checks the retained
entity graph and blob bytes before exercising sessions, publishing, subscriptions,
import history and a supported full archive restore. Only the outgoing mail
provider is simulated; other network requests fail closed. The application,
Worker runtime, SQL, R2, queues, session/token authority and renderers are real.
Each runtime open lets Miniflare bind port 0. Native HTTP requests use that
listener while Miniflare’s proxy transport restores the stable logical Host
and installation origin before application admission. Upgrade and restore
exercise the original session cookie unchanged; no runtime reuses a port
reserved when the helper was imported. Other native journeys keep each opened
fixture’s transport bindings when pausing and resuming around another fixture.
Initial deployed page settings and an uncertain provider receipt are explicit
test fixtures; ordinary product records and credentials use application doors.
For v1.4.0 and later, import apply/resume is checked to send no mail, and the
fixture explicitly sends its imported subscriber invitations before upgrading.
Earlier releases retain their shipped apply/resume behavior.

With `--evidence`, success retains before/after inventories, full before/after
archives, the restored archive, build logs and the source receipt. These contain
synthetic fixture credentials only. Temporary checkouts and runtimes are removed
on success. Failure retains its isolated directory for diagnosis and disposes its
runtimes. Provider delivery, deployed infrastructure and browser interaction are
outside this release upgrade check.

`.github/workflows/release.yml` runs three independent jobs on release tags,
nightly and manual dispatch. The upgrade job fetches full tag history and runs
`verify:release` with the exact `RELEASE.json.previousVersion` tag. The other jobs
run the actual standalone browser installer and the README's canonical local
launch journey. They stay outside the ordinary push/PR verification plan.

To run either installation journey after installing the pinned dependencies and
Playwright Chromium:

```sh
LAMP_RELEASE_JOURNEY=installer node tests/release/installation-journey.mjs
LAMP_RELEASE_JOURNEY=readme node tests/release/installation-journey.mjs
```

Both fetch the public installer declared by the Run page, install rer into a
temporary home, clone the public repository and select the candidate revision.
The exact candidate commit is fetched from the calling checkout after the public
clone, so unpublished commits work too. Tracked working changes are copied into
that candidate. They install real
frozen dependencies without sharing node_modules or copying private state.
The README journey follows README → RUN-LOCALLY and runs its initial `rer dev`
command with an isolated free port. The installer journey launches
`node scripts/install.mjs --no-open --no-prefill` and approves local installation
in Chromium, opens its exact private entry in a separate app tab, and submits
the native sign-in confirmation. Both consume their private owner entry in memory, create a component,
check authenticated and public pages at 1440 and 390, and verify sign-out.
No mail viewer or captured mailbox is used; native local mail stays suppressed.

`LAMP_RELEASE_EVIDENCE` selects the output directory (default:
`test-results/release-<journey>`). Only failure diagnostics and page screenshots
are saved; outcomes appear in workflow logs. Credential-bearing command output and owner entry
URLs are never printed or saved by these harnesses. All fixture-owned runtimes,
checkouts, installation state and temporary homes are removed on exit. These
journeys require network access to the public repository, installer and package
registries; they do not establish hosted deployment or provider delivery.
