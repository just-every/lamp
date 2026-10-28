# AGENTS.md

## Run it locally

Use [RUN-LOCALLY.md](RUN-LOCALLY.md) for the canonical launch, backup and restore
sequences. It stops a running `rer dev` or `rer preview` before data transfer or
reset, exports before reset, imports only into an empty destination, and runs
`rer setup` with the original owner after import. `rer describe` lists every
command, flag and local path. Stop a running `rer dev` or `rer preview` before
`rer build`, `rer verify` or another command that builds the checkout; resume
with `rer dev` after it completes. Node 22.20.0 and pnpm 10.12.4 are pinned.

You are working on **Lamp**, an authoritative, self-hostable edition. First-party authors, owners and community publishers use this same repository workflow. Launch it, make it exactly what the owner needs, keep it working, keep it updatable. Never make the product worse to avoid touching core code.

Read first:

1. `CONTRACT.md` — what the product does, as numbered clauses. `BASELINE.md` holds the security and data guarantees every seed makes.
2. `DIVERGENCE.md`, owner instructions and `.seed/intent.md` where present — recorded requirements and intentional differences. No particular intent file is required.
3. `seed.json` — capabilities, non-goals, externals, env, limits, extension points.
4. `src/ext/` — customisations already made.

The integration branch is `main`; open pull requests against it and rebase contribution
branches onto its merged changes. On a fresh Ubuntu/Debian Linux agent with root or
passwordless sudo, put `/usr/local/bin` first on the calling shell PATH, then run
`bash scripts/agent-bootstrap.sh && rer verify`. The bootstrap installs pinned
Node 22.20.0 and pnpm 10.12.4, frozen dependencies, Chromium and system libraries,
and probes the locked workerd runtime. PR verification runs the full verifier
and every existing browser suite in `.github/workflows/verify.yml`. Pushes to `main` automatically run the same credential-free Verify workflow
to record the default-branch result. It retains verifier and browser logs, including the
documented visual edit probes; failed checks remain failed.

## About this product

Lamp is a status-page product for one business.

## Launch

Locally: follow [RUN-LOCALLY.md](RUN-LOCALLY.md). Local database, storage and queues start without accounts; the page starts empty, and mail is silently suppressed. Sign in with the one-click owner entry. No messages are retained.

To Cloudflare: `rer deploy` with the owner inputs in `OPERATIONS.md`. It validates owner inputs, creates or reuses resources, builds and uploads the Worker with secrets, then checks health; `--dry-run` builds and validates locally with no provider request.

From GitHub: `.github/workflows/deploy.yml` verifies and builds a credential-free
Worker artifact. The independent delivery service validates retained bytes and
source identity before using its separately held deployment authority. Application
build jobs must never receive production environment secrets.

Live check: `GET <url>/health` returns 200. Public surfaces are at `deploy.publicPaths` in `seed.json`.

If anything is missing the tooling names it. Do not substitute services or invent config.

## Ownership

All tracked application source, integration, recipe, tests and deployment definitions
belong to this edition. `src/core/` and `src/ext/` retain useful integration conventions;
they are not ownership restrictions. Edit any source needed to preserve the owner's
requirements. Preserve already-applied migration history; new migrations may change core schema. `edition.json` selects source,
`sources.lock.json` records comparison origins, and `AUTHORING.md` describes local
build and source publication. No build replaces this instruction file or local edits.

`src/ext/config.ts` and every file under `src/ext/local/` have a header comment with a worked example.

## Modify

Use configuration and extensions when they save work. Direct core, schema, UI or infrastructure changes are equally ordinary choices; no sequence of mechanisms is required. The table describes existing conveniences.

| Owner wants to | Do this |
|---|---|
| Use the unified import door | Built for Statuspage, Sorry, Better Stack and Instatus: owner opt-in (or Business first-owner-claim healing), permanent key revocation, uploads, saved-response plan, reviewed silent apply with Business subscribers held, native reconcile, preserve-conflicts undo and bounded catch-up grants. See `docs/moving-in.md` and CONTRACT.md’s unified import-door status. `tests/e2e/sorry-import.test.mjs` covers the seeded lifecycle and catch-up; this is synthetic test-install proof, not real-export verification. |
| Rename things, toggle features, change copy, branding | `src/ext/config.ts`; tokens in `src/core/app/theme` |
| Add a field to a record | Use existing custom fields (`seed.json`), a sidecar table, or a new core schema migration as appropriate. |
| Add a page, route, nav entry, settings section, job, cron, queue consumer | `src/ext/local/<name>/`, registered from `index.server.ts` / `index.client.tsx` |
| Add UI to an existing screen | Contribute to a slot. IDs in `seed.json`. |
| Change a product decision (assignment, permissions, AI instructions) | Override the policy if one exists; otherwise edit the feature's `service.ts` |
| React to something that happened (Slack, webhook, sync) | Subscribe to the event in `server.ts`. Events cannot alter the operation that emitted them. |
| Run something async the owner triggers (export, report) | Dispatch a job |
| Swap email, AI, calendar, storage provider | Override the adapter |
| Inbound webhook | Route in `server.ts` under `/api/ext/`. Idempotent. |
| Redesign a core screen beyond what slots allow | Edit `src/core/features/<name>/ui/` |

- DB access only through a `repository.ts`. Never from a route or component.
- Existing extensions import core via `src/core/api/` and `src/core/shared/`; adapt integration deliberately when changing that boundary.
- New API operation: zod input, typed output, standard error format, test.
- Preserve already-applied migration history; add new migrations for schema changes. Never commit infrastructure IDs or secrets.

## Editing core

Allowed. Understand the whole feature, make the smallest coherent change, verify the affected requirement, and record *why* in the relevant requirements or divergence record (optionally `.seed/intent.md`):

```
## Incident communication
AI may suggest updates but an operator must review and publish customer messages.
```

Intent, not implementation. Never remove an intent unless the owner changes that requirement.

If the owner explicitly requests behavior that conflicts with an upstream clause,
record the clause, the owner's replacement requirement and why in the relevant requirement record.
Add a meaningful test for that requirement, and let the owner's agent decide how
to maintain the fork's source and tests. Preserve the original guarantee and its
history in the update record. Do not describe an intentionally changed clause as
an unchanged upstream pass.

Lamp does not currently interpret `contract-overrides.json` or automatically
report owner replacements. Run the owner's specific tests explicitly and report
their results alongside the upstream verifier. A failing upstream test without a
recorded owner request is a regression to fix.

## Lander-Regenerate

After resolving CONTRACT.md, regenerate the touched clause entries and shared counts:
`node scripts/contract-docs.mjs write INTEG-002`
Then run `node scripts/contract-docs.mjs check INTEG-002`.
This incremental generator preserves the remaining legacy entries for ct's conversion.
Regenerate the source lock last: `node scripts/edition-authoring/cli.mjs lock`,
then `node scripts/edition-authoring/cli.mjs check`.

## Verify

Stop a running development server or production preview before verification or
build commands. Use `rer dev --stop` or `rer preview --stop` as appropriate;
restart local work with `rer dev` after the command completes.

```
rer verify
```

Before saying anything is done. It runs the declared upstream behavior and baseline suites. It does not automatically discover `tests/local/`; the owner's agent runs those tests explicitly and checks every preserved requirement. For user-facing changes, also exercise the journey on `rer dev` or `rer preview`.

## Update

Use ordinary Git to bring an upstream release into the owner's fork. Read `RELEASE.json`, preserve all recorded intent and customisations, and let the owner's agent choose how the update lands. Work in an isolated candidate while the current installation stays available. Back up the data and the owner's source revision before migrations; exercise a restored copy and the owner's affected workflows. A clean merge or a passing upstream suite alone does not prove the owner's requirements survived.

Resolve by answering: what did upstream intend, what does this installation intend, what satisfies both. Never take "ours" or "theirs" wholesale. Preserve every recorded owner requirement unless the owner changes it. Run `rer verify` and all applicable owner intent tests before adopting; explain any intentional upstream divergence against its recorded replacement requirement.

## Leave

`rer export` and `rer import` move a local installation. For a deployed Cloudflare installation, use the technical archive and restore procedure in `OPERATIONS.md`; it documents the owner-side tooling and empty-target requirement. The owner may run this version without the marketplace; the terms are in `LICENSE`.

## Do not

- Conceal a regression by changing or removing its test; preserve the guarantee or record the owner's explicit replacement requirement.
- Rewrite already-applied migration history.
- Add undeclared external effects. Record new externals in `seed.json` and integrate them explicitly.
- Hide failures behind fallbacks.
- Add abstractions without a product need; ordinary source composition remains the recommended default.
- Stop at scaffolding, or claim completion because it compiles.

## Engineering

Use small files with clear responsibilities. Remove obsolete code rather than
hiding it. Diagnose instructions, context, schema and tools when an LLM request
fails. Delegate independent work; keep migrations and ordered writes sequential.
Keep the Hono APIs, TanStack Start operator documents, and R2 public snapshot
renderer architecture unless the owner intentionally changes it. Local proof,
source publication, deployment and provider proof are separate claims. Source
lock integrity and a passing verifier do not establish hosted acceptance; check
`ACCEPTANCE.md` for the outcomes required on each adopting installation.

## Recommended defaults and shared improvements

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
