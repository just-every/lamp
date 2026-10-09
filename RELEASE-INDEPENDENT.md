# Independent Lamp release candidate

This candidate prepares Lamp for independently owned local and RER installations.
It does not deploy, publish a repository/tag, authorize customer mail or replace
any existing company service. The application and included authoring/onboarding
source are MIT; retain LICENSE and vendored notices. Open Sans is distributed
under its included font licence. Package dependencies retain their own licences;
inspect the pinned lockfile and `pnpm licenses list` before distribution.

## Reproduce locally

Use Node26.8.1 and pnpm8.15.6. `node scripts/install.mjs` opens local setup without
application dependencies; Start installs the locked dependencies, builds, migrates
isolated native resources and starts the real Worker. Alternatively run:

```
pnpm install --frozen-lockfile
pnpm run verify
node scripts/build-delivery-artifact.mjs
```

Install the pinned Playwright Chromium assets and libxml2 XML tools first when
running the full verifier. On Node26, install Chromium with Node22 as documented
by `scripts/independent-build-setup.sh`, then run verification with Node26. Linux
CI project setup installs these prerequisites itself. Do not attach deployment
credentials to any candidate build command.

The artifact contains actual emitted Worker modules/assets and a complete
CandidateDeploymentSpec, including exact core/owner SQL hashes, D1/R2/Queue,
SnapshotCache migration `snapshot-cache-v1`, queue consumers and minute scheduler.
Credential files, symlinks, undeclared bindings and undeclared public variables
are refused. Existing migration files and identities are preserved.

## Publication and remote acceptance

Commit the candidate; record `git rev-parse HEAD` and `git rev-parse HEAD^{tree}`,
SHA-256 of `rer-project.json` and the emitted artifact. Supply that source commit
separately during independent registration; the descriptor never embeds its own
revision. Publish source only after owner approval and retain the exact candidate
and workflow SHA. Configure installation and broker repository variables, trust
the full pinned workflow, and run project/full delivery without production secrets.

Register the exact descriptor/revision from the authenticated RER-owned interface.
Select hosting, connect owner-authorized provider/repository accounts, generate and
review the declarative two-surface plan, set its declared runtime secrets through
the separate encrypted secret channel, build, accept the immutable release and
explicitly publish. The local setup page never proxies RER cookies or bypasses its
Origin/CSRF checks. Once the native installation is deployed, local browser setup
can initialize its owner with the separately supplied bootstrap secret. Finish
with ordinary magic-link sign-in. Read OPERATIONS.md for pending/public readiness.

Verify the owner's real sender DNS, native mail delivery, signed delivery receipts,
DKIM unsubscribe-header coverage, absence of tracking, public/operator host
isolation, UI/product workflows and recovery on the actual hosted candidate. Local
test providers prove handling, not real provider delivery. An unconfigured sender
must continue to fail visibly. Public status remains503 until a real snapshot is
published; no synthetic all-clear is substituted.

## Updating and leaving

Record owner customizations before integrating the candidate. Preserve every
applied core/owner migration and existing resource identity. Restore a retained
archive to fresh resources, compare every record and object byte/metadata, verify
owner intent and native login/publication, then decide any traffic change.
`pnpm run export`/`import` are the native D1/R2 recovery path; SnapshotCache is
reconstructed from retained authoritative R2 bytes. Native recovery is separate
from the broker's complete export capability. Do not claim automatic export of
arbitrary DO/KV/Analytics state. No RER account or payment is needed for continued
standalone operation of the source and recovered data.
