# Import kit

The import kit plans and applies reviewed, inert data imports. It preserves the
source records, exact available source bytes, and the provenance needed to inspect,
resume, reconcile, or reverse an import. It does not send messages, enqueue work,
activate access, or run application lifecycle hooks.

## Consumer flow

The source entry point is [`src/index.ts`](./src/index.ts). Its main exports are:

- `readFileSource` and `readApiSource` to parse bounded exports while retaining
  exact artifact bytes;
- `planImport` to map records into effects and report omissions or rejections;
- `createImportJob`, `applyImportBatches`, and `resumeImport` for reviewed,
  durable application;
- `undoImport` and `rollbackImport` to reverse completed or partially applied
  work;
- `readImportJob`, `readPersistedImport`, `readImportOriginals`, and
  `reconcileImport` for status, custody, and independent comparison;
- `validateImporters` for registry shape plus evidence-policy validation.

The product supplies the parser, mapping, native target adapter, and a fresh
`ImportContext` for the authenticated actor and destination. A typical flow is:

```ts
import {
  applyImportBatches,
  createImportJob,
  openSqliteImportStorage,
  planImport,
  readFileSource,
  resumeImport,
  undoImport,
} from './src/index.ts';
import type { ImportContext } from './src/index.ts';

// These values and helpers come from the product's parser, mapping, native schema,
// authenticated request, and current permission store.
const storage = openSqliteImportStorage(databasePath, { targets: productTargets });
const context: ImportContext = {
  destination,
  namespace,
  mappingVersion: mapping.version,
  storage,
  authorization: {
    principalId: actor.id,
    assertAuthorized(action, destination, db) {
      requireCurrentImportGrant({ db, principalId: actor.id, action, destination });
    },
  },
};

const source = await readFileSource(fileInput);
const plan = planImport(source, mapping, context);
showPlanForReview(plan); // product-owned review surface
context.reviewedFingerprint = plan.fingerprint; // set only after approval

const job = await createImportJob(plan, context);
const partial = await applyImportBatches(job.id, { ...context, maxBatches: 2 });
if (partial.state === 'completed') {
  await undoImport(partial.id, context);
} else if (partial.state === 'applying') {
  // A later process reopens the same database and rebuilds context for its current actor.
  const currentActor = requireAuthenticatedActor();
  const recoveryContext: ImportContext = {
    destination,
    namespace,
    mappingVersion: mapping.version,
    storage: openSqliteImportStorage(databasePath, { targets: productTargets }),
    authorization: {
      principalId: currentActor.id,
      assertAuthorized(action, destination, db) {
        requireCurrentImportGrant({ db, principalId: currentActor.id, action, destination });
      },
    },
  };
  const completed = await resumeImport(job.id, recoveryContext);
  await undoImport(completed.id, recoveryContext);
}
```

`requireCurrentImportGrant`, `requireAuthenticatedActor`, `showPlanForReview`, and
the sample values above are product-owned. `requireCurrentImportGrant` must
synchronously check the supplied database and throw on denial. The reviewed
fingerprint must be the fingerprint shown to the reviewer. Rebuild the context
after reopening the database with the current actor; do not persist authorization
callbacks, credentials, parser functions, or mapping functions in the import job.
Resume uses the immutable retained plan and needs only the job ID and current
authorized context. Handle failed states through the product's review and
rollback flow instead of retrying them blindly.

`rollbackImport(jobId, context)` reverses applied batches after a partial failure;
`undoImport(jobId, context)` reverses a completed import. Both preserve retained
source and before-image audit data. Reversal is restartable and checks the exact
applied revision and value before changing a target. A native edit is reported as
`NATIVE_EDIT_CONFLICT` and preserved.

## Plan-size cap

New plans and plans submitted for creation are bounded by the inclusive
`PLAN_BYTES_LIMIT` (300,000,000 bytes). This is the UTF-8 length of the canonical
JSON content **without the `fingerprint` property**. The complete stored plan
adds exactly 81 bytes for the comma, property name, colon and quoted 64-character
SHA-256 fingerprint: at the cap it is 300,000,081 bytes. That fixed overhead is
reserved below the encoding limits; the content count is not the stored size.
Keys, separators, escaped controls/quotes/backslashes, Unicode, lone surrogates,
metadata, originals' base64 and every repeated occurrence of source, effect or
diagnostic data count. Shared object references do not save serialized bytes.

`planContentBytes(plan)` measures content without building its encoding. The
planner admits its initial source/metadata envelope before copying it, then
reserves the second source occurrence before hashing or cloning mapper input,
then counts each mapping, diagnostic, artifact change and count lexeme in a
running total. It checks mapper expansions and the cumulative retained plan
before cloning or encoding effects, validating attachments or encoding target
identities. Unsupported durable JSON, cycles, nesting beyond 256 containers and
sizes beyond safe-integer arithmetic, including cumulative reservations and
signed replacement/count deltas, are rejected as `INVALID_JSON` before the
recursive serializer runs. Existing valid stored jobs keep their resume contract;
the cap does not replace their fingerprint, custody or inventory integrity checks.

`planImport`, `planD1Import`, `createImportJob`, `preflightD1ImportJob` and
`createD1ImportJob` refuse oversized input with `PlanTooLargeError`, code and
message prefix `IMPORT_PLAN_TOO_LARGE`, numeric `bytes` and `limit`, and `subject`.
A `source` size is the source alone, a lower bound on the eventual plan. A `plan`
size is the measured content constructed so far, including the pending source
entry or mapping that crossed the bound; later mappings are not invoked. Creation checks the complete
submitted plan. Show the measured count and limit in the product's preview,
before writes. D1 creation rechecks after awaited lookup on both fresh and replay
paths, and after stored-plan, custody and inventory reads before replay's atomic
boundary. Pure preflight confers no authority; transactions still check current
authority and the original reviewed fingerprint.

The cap follows the second 8 October 2026 ruling. Historical boundary probes on
Node 26.8.1 showed that fresh input reaches V8's 536,870,888-character string
bound or the module runner's 4 GiB heap limit before exhausting the 1,000-request
D1 budget. At the earlier encoding boundary, one `JSON.stringify` output buffer
can abort at 256 MiB; `canonicalJson` therefore escapes strings longer than 1 MiB
in slices without splitting surrogate pairs. The byte cap is about 56% of V8's
string bound, with room for the fingerprint overhead.

Fresh 9 October checks of this guard implementation, on Node 26.8.1 with
`--max-old-space-size=4096`, measured:

- A 55,570,000-byte original: 56 actual create executions, equal to preflight,
  exact original bytes/hash/size, chunked plan, and every public request <=1,000.
- Quote-heavy mapped content: 299,899,168 content bytes, 342 preflight executions,
  2,660,488,040 bytes heap used at observation, 3,791,683,584 bytes peak RSS.
- Three-byte UTF-8 mapped content: 299,881,168 content bytes, 179 preflight
  executions, 1,487,613,656 bytes heap used at observation, 3,000,123,392 bytes
  peak RSS.
- The real-D1 inclusive 300,000,000-byte admission and 300,000,001-byte refusal
  pass. Refusal leaves every `ik_*` table empty. The combined original-based
  boundary/55.57 MB test peaks at 5,776,048,128 bytes RSS: a 4 GiB **heap** limit
  is not a 4 GiB total-memory promise, especially with buffers, input copies and
  the native runtime. Allocate process capacity accordingly.

The twenty distinct 10 MiB original-custody lifecycle case retains exact bytes
through undo. It does **not** prove every twenty-file maximum-content CSV import
fits. A representative valid twenty-table CSV shape (105 rows/table, two fields,
10 MiB/file, cells <=100,000 characters) requires 910,382,498 canonical plan
content bytes: originals alone contribute 279,620,320 base64 bytes, and parsed
source is retained both in the source and entries before effects are counted.
The kit cap is an additional storage bound. A product must name it honestly
without reducing its separate 20-table, 80-field, 10 MiB/file, 10,000-row/file or
100,000-character/cell limits, or dropping original/parsed data to fit.

These are local Node/Miniflare checks. Hosted Worker memory, CPU, upload and
provider storage capacity are not established; the adopting product must check
those independently. `tests/plan-size*.test.ts`, `tests/plan-mapping-size.test.ts`
and the SQLite/D1 cap tests cover exact measurement, pre-encoding mapper growth,
awaited changes, and inclusive/refusal boundaries. The untouched
`creation-remaining-budget.test.ts` still refuses a 1,001-execution invocation.

## Durable storage and native effects

The supported durable adapter is Node's built-in `node:sqlite`, opened with
`openSqliteImportStorage(filename, { targets })`. The targeted acceptance suite
runs on Node v26.8.1. Use a durable database file and pass the same synchronous
`TargetAdapter` for every operation, including recovery.
The adapter's native rows and the import journal, source identity claims,
provenance, originals, and attachment staging share that SQLite database and
transaction. External object-store custody is not claimed. The separately documented D1 port
uses an asynchronous native SQL adapter.

The supplied `sqliteTargets` adapter stores generic JSON target rows. A product
with a native schema should implement its own `TargetAdapter` on the provided
`SqlDatabase`, so each native write and its provenance commit or roll back
together. Adapter methods must be synchronous and must not make HTTP, queue, or
lifecycle-hook calls. This module records data effects; the product owns any
separate external-effect workflow.

Authorization is checked synchronously inside mutation transactions and again at
commit boundaries. The consumer callback must consult current authority using the
database passed to it and throw on denial. A cached permission check performed
before the transaction leaves a time-of-check/time-of-use gap. Jobs are bound to
the creating actor even when the actor is an administrator.

Each apply or reversal batch is one SQLite transaction. A lease claim increments
the fencing token; expired holders cannot publish or clean up a recovered holder's
work. After a process is killed, committed batches remain durable and an
uncommitted transaction is rolled back by SQLite. A new process reopens the same
file and calls `resumeImport(jobId, context)` after the existing lease expires.
It resumes the stored plan without refetching the source or rerunning the parser
and mapping. Repeated resume does not duplicate already committed target rows or
provenance. The same recovery path applies to an interrupted undo or rollback.

`modules/import-kit/tests/core/crash.test.ts` exercises real child-process
`SIGKILL` during apply and reversal, reopen, resume, unique durable attribution,
and completed undo. Its process termination evidence is local SQLite acceptance;
it does not establish a vendor export or provider integration.

## Registry shape and evidence

Consumers supply their own registry to `validateImporters`. The committed
Draft 2020-12 [`schema/importers.schema.json`](./schema/importers.schema.json)
defines its shape. Validation uses this local schema without a network request.

Schema validity does not establish that an importer has been verified.
`validateImporters` also needs a consumer-supplied evidence port and trust policy
to resolve and verify the referenced evidence. A `documented format` row records
`validation: "synthetic-only"` and `realExport: "not-supplied"`; only the required
real-export evidence can establish `verified` status.

Base keeps its edition registry and source-specific guides in its private
authoring tree. They retain exact source identities and evidence pins and are
not part of this reusable module. Review any consumer registry and its source
references before publishing it with an edition.

## Verification and further guidance

From the Base repository root, run `pnpm verify:modules` for the retained module
suites. The targeted crash and evidence-validation checks can be run with:

```sh
TMPDIR="$PWD/../scratch" node --test \
  modules/import-kit/tests/core/crash.test.ts \
  modules/import-kit/tests/status.test.ts
```

Set `TMPDIR` to an existing writable directory inside the work area before
running tests. [`CONTRACT.md`](./CONTRACT.md) defines durable and authorization
invariants, [`FIXTURES.md`](./FIXTURES.md) documents consumer fixture conventions,
and [`src/readers/README.md`](./src/readers/README.md) covers file and API reader
limits and byte custody.

## Cloudflare D1 Workers

The additive asynchronous [D1 port](./src/d1/README.md) is available through
`src/d1/index.ts`. It supports native SQL effects, reviewed jobs, durable bounded
resume, original custody and conflict-safe undo in the same D1 batch as its
journal. Products supply native snapshot predicates and current-session SQL
permission predicates. Use its D1-specific API and numbered schema migration;
existing synchronous APIs continue to require Node SQLite.

D1 consumers can opt new jobs into durable conflict-preserving undo while legacy
and omitted-policy jobs remain strict. The adapter supplies exact native
ownership/dependency snapshots; retained edits keep their original attribution.
See [D1 evolution 0001 and adoption instructions](./src/d1/README.md#adopting-preserved-conflict-undo-evolution-0001)
before updating a deployed D1 schema or adapter.
