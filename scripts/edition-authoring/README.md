# Edition-owned source authoring 1.1.0

Seeds pin the published `@runeditrun/rer` package and use `rer adopt-edition`
and `rer refresh-base --ref FULL_COMMIT`; do not vendor authoring CLI files.
See [EDITION-AUTHORING.md](../export/EDITION-AUTHORING.md) for adoption, acquisition,
offline use and JSON output. Node 22+ and Git are the authoring dependencies.
Builds and integration remain ordinary edition code. This tool never runs
source-provided scripts. Existing local authoring scripts remain supported.

The recommended path is a maintained complete edition with tested component
choices, UI, infrastructure and commands that save implementation and adaptation
work. All source remains editable: core domain, schema, UI, framework and
infrastructure changes are ordinary use, alongside configuration and hooks.
Agents may merge, reapply, adapt or rewrite upstream improvements; preserve
recorded owner requirements, applicable guarantees and applied migration history.
Deep divergence does not prevent later adoption of useful upstream changes.

Shared implementations may be substantial and optional. A module can be exported
from an edition, family, Base or independent repository. During product work,
roll useful mechanisms and tests back into maintained shared source, then verify
adoption in another edition with its own requirements. This is deliberate reuse,
not automatic synchronization or a requirement that every fork converge.

`edition.json` is authoritative:

```json
{
  "schemaVersion": 1,
  "id": "runeditrun/orbit",
  "toolchain": {"id": "runeditrun/edition-authoring", "version": "1.1.0"},
  "parent": null,
  "components": [
    {"id":"runeditrun/base","role":"foundation","source":{"kind":"local","paths":["src/base"],"origin":{"repository":"BASE_SOURCE_REPOSITORY","revision":"FULL_40_HEX_COMMIT","path":"default-seed/src"}}},
    {"id":"runeditrun/orbit","role":"edition","source":{"kind":"local","paths":["src/routes","package.json"]}},
    {"id":"acme/approvals","role":"module","source":{"kind":"git","repository":"/absolute/local/repo-or-https-url","revision":"FULL_40_HEX_COMMIT","path":"exports/approvals","destination":"src/modules/approvals"}}
  ]
}
```

Local `paths` identify files or directories already owned and edited in this
edition; do not list overlapping paths. All other tracked edition files remain
authoritative and ship, including integration, requirements, migration history,
intent and build configuration. `origin` records a comparison baseline, never a
claim that edited local source equals upstream. `parent`, when present, is
`{repository, revision}`. There may be at most one foundation. Semantic
compatibility, route/resource conflicts and migration transitions require product
tests; unique paths alone do not establish compatibility.

Commands below use the historical local-script form. Package adopters run
`node node_modules/@runeditrun/rer/edition-authoring/cli.mjs` in its place; Base
authors can run `node /absolute/base/edition-authoring/cli.mjs` from the seed root.
The public adoption and refresh verbs call these same implementation helpers.
For release adoption, a copied CLI predating 0.2.82 must use the updated
installed package: run `rer refresh-base --ref FULL_40_HEX_COMMIT --base
/absolute/base-checkout`, or invoke that installed package's
`edition-authoring/cli.mjs refresh-base` directly. The older copied CLI does not
gain the release's refresh behavior until the package refresh delivers it.

Commands, run at the edition root:

- `node scripts/edition-authoring/cli.mjs inspect`: validate and describe selections.
- `... lock`: resolve exact source bytes and retain comparison snapshots under
  `.edition/sources/`; writes `sources.lock.json`. Commit both with the recipe.
- `... check`: verify recipe, tool version, retained baselines and selected bytes
  match the lock. Re-lock after intentional edits; no command silently updates pins.
- `... changes`: report added, removed and modified effective file identities,
  manifest/selection metadata and tool changes since the lock. It does not write
  or accept a new lock. Stage new files to include them in authoring inputs.
- `... extract publisher/component /absolute/new-directory`: validate the selected
  baseline against its lock and extract retained source without overwriting any
  existing destination. Use `parent` for the parent edition. Works offline when
  snapshots have been retained.
- `... compare publisher/component /absolute/candidate-checkout`: compare the
  baseline with the same export path at a clean candidate checkout HEAD; report
  current edition source identities and local differences for explicit mappings.
  Unmapped local source remains visible without guessing correspondence. Candidate
  reads do not update source pins or retain archives.
- `... compare parent /absolute/candidate-checkout [/absolute/current-checkout]`:
  compare the whole retained parent baseline with a clean candidate parent and
  with current tracked source (this edition, or an independent checkout).
- `... verify-base`, `... record-base` and `... refresh-base`: record, verify and
  refresh verbatim copies of Base source; see [Copied Base source](#copied-base-source).
- `... materialize /absolute/new-directory`: copy tracked edition source and
  selected Git ingredients into a new build tree. It never overwrites the edition.
- `... promote publisher/component`: capture the selected Git ingredient into its
  absent destination, switch to local source and retain the immutable origin.
- `... release /absolute/new-local-repository`: require a clean committed edition,
  verify its lock, and create a portable ordinary Git clone with all author inputs.
  Also creates an adjacent `<new-local-repository>.release.json` sidecar. Distribute
  this file with the repository or attach it to the source release; Git clone does
  not copy adjacent files automatically. Both output paths must be absent.
- `... receipt /absolute/release.json`: verify that a sidecar identifies this clean
  checkout, including commit and tree, lock and tool identity. Works in later clones.
  The sidecar avoids changing the source commit it identifies; it is not a signed
  publisher attestation or product acceptance.

For live development, a Git source may add `workspace: '/absolute/checkout'`.
`materialize` reads the actual checkout, including dirty/untracked files under the
selected export path, into the build tree; rerun materialize into a fresh directory
to see subsequent edits. Nothing edits a cache. `promote` captures those edits
before release; release rejects workspace selectors. Commit effective source and
re-lock. Alternatively commit the external checkout and select its immutable
revision, removing `workspace`. Neither build nor release fetches floating refs.

The lock stores effective file hashes and retained source snapshots. Each
comparison reference hashes its complete archive, including ancestry metadata;
ancestor references also bind complete archive contents. Removing comparison
relationships cannot pass a source check merely because application bytes match.
Snapshots make fetched selections and comparison origins available after remote
repositories disappear. Local source with an origin requires that exact origin
at first lock; subsequent locks use the retained snapshot. Publication is the same
local Git operation for first-party and community identities. Network pushing and
deployment are separate explicit owner operations. Release receipts identify source
commit and tree and lock hash, not product verification or reproducible compiled bytes.

For dispersed imported files, local sources may declare
`mappings: [{path: "src/base/file.ts", originPath: "default-seed/src/file.ts"}]`.
Mappings may overlap. The most specific mapping owns a local file, and one origin
file may have several local copies, such as a module's schema file and the
numbered migration made from it. `compare` reports each copy on its own, with
`path` naming the origin file and `localPath` the copy. One local path mapped to
two different origins is ambiguous and refused.
An origin may specify `paths: ["default-seed/src/file.ts", "deployment"]` to
retain only those baseline inputs, relative to its `path` (default `.`).
Retain useful prior composition evidence as explicitly historical material when
needed by an update harness; it does not govern edition source. `requires` and
`conflicts` on each component list publisher-qualified selected component IDs;
validation rejects absent requirements and selected conflicts. Optional assumptions
are ordinary descriptive metadata; product tests establish them.

Initial acquisition honors standard Git URL rewrite configuration, including
`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0=url.<local-repository>.insteadOf` and
`GIT_CONFIG_VALUE_0=<declared-public-repository>`. This lets unpublished exact
local commits retain their intended repository identity without network access.
The parent edition baseline is also retained. Locks independently identify the
exact distributed tool file bytes, separate from foundation source revisions.

Thin editions build from `materialize` output: run their package install/build/dev
commands in that new directory. The author repository remains the original
checkout. Materialized build trees are disposable and exclude `.edition` and the
lock; they are not publication sources. A released thin edition retains the
original recipe, lock and snapshots, so its same materialize command works offline.
Single-file Git exports are placed under the destination using their basename.

Acquisition reads committed Git blobs directly, so checkout attributes, line-ending
conversion and smudge filters cannot change immutable baseline bytes. Live source
selection respects Git ignore rules: tracked and nonignored untracked source edits
are included, while ignored secrets/dependencies are excluded. Parent comparisons
retain ancestor archives once by content address, separately from parent source
bytes, avoiding recursive archive embedding. Mapping targets must exist in both
the local source and retained comparison baseline. Promotion into an existing
directory is allowed when each selected file destination is absent.
Git tree listings and individual blob reads have a 64 MiB output limit and fail
explicitly above it; the tool does not silently omit or truncate large source.

## Copied Base source

Some editions copy Base modules byte for byte, for example the Base mail module into
`src/base/modules/mail`. A copy record makes those copies traceable, so a later
Base change can reach the edition and later accidental edits can be detected
against the recorded snapshots.
`base-copies.json` at the edition root records each copy's local path, Base
origin path, Base commit, and the SHA-256 of every copied file:

```json
{
  "schemaVersion": 1,
  "copies": [
    {"path": "src/base/modules/mail", "originPath": "modules/mail", "revision": "FULL_40_HEX_COMMIT",
     "files": {"src/base/modules/mail/index.mjs": "SHA256_OF_BASE_BYTES"},
     "modes": {"src/base/modules/mail/index.mjs": "100644"}},
    {"path": "migrations/0005_operator_auth.sql", "originPath": "modules/operator-auth/accounts/schema/operator-auth.sql",
     "revision": "FULL_40_HEX_COMMIT", "files": {"migrations/0005_operator_auth.sql": "SHA256_OF_BASE_BYTES"},
     "modes": {"migrations/0005_operator_auth.sql": "100644"}}
  ],
  "ignore": ["docs/coincidental-example.txt"]
}
```

Each copy has its own commit, so modules can move to new pins independently. A
copy may omit Base files, such as upstream tests. Copies must not overlap.
The record names no repository. A full Git commit identifies the same Base
tree wherever Base is hosted, and the file digests and modes bind the copied
bytes, so anyone holding that commit can check the record and a public reader
sees no private address. To read Base, `record-base`, `refresh-base` and
`verify-base` use `--base <checkout>` or the seed's `edition.json` component
runeditrun/base: `source.repository` for Git source or `source.origin.repository`
for local source. Without either, `runeditrun/base` resolves to the public
`https://github.com/runeditrun/base.git` repository. Pass `--offline` to verify
local bytes without acquisition; offline refresh requires `--base <checkout>`
or `--base-archive <directory>` as described below.
Offline checkout reads use a temporary repository sharing only the checkout’s
object store and HEAD, with no remotes or inherited Git configuration. This
prevents lazy fetches on Git 2.43 as well as newer Git. Missing objects require
an online refresh without `--offline`; corrupt objects require checkout repair.
Older records with a `repository` field are still read and verified from it; recording or refreshing drops the field.
`modes` records each file's Git mode in Base, `100644` or `100755`, using the
owner executable bit; a record
without `modes` still verifies, but without mode checks until it is re-recorded.
`ignore` lists edition files that happen to equal Base bytes but are the
edition's own. Discovery excludes root `LICENSE` and `CLAUDE.md` by default;
explicit copy records still verify these files normally.

**Record.** Copy the files from Base at the chosen commit, then run
`node scripts/edition-authoring/cli.mjs record-base src/base/modules/mail modules/mail FULL_40_HEX_COMMIT`.
It writes the SHA-256 of the Base bytes, never of the local bytes, for every
Base file under the origin path that exists in the copy, and the Base mode of each. It reports Base files
the copy leaves out (`notCopied`), local files that differ from Base
(`differs`, bytes or executable bit) and local files with no Base counterpart (`localOnly`). Pass
`--base /absolute/base-checkout` to read a local Base checkout instead of
cloning the recorded repository, and `--record <file>` for another record path.
An explicit acquisition URL or local source checkout can remain in the seed's
own source declaration; the default Base publisher identity uses its public URL.

A plain extracted Base archive can supply the source instead of a checkout:

```sh
node scripts/edition-authoring/cli.mjs record-base src/base/modules/mail modules/mail \
  --base-archive /absolute/extracted-base --ref FULL_40_HEX_COMMIT
rer refresh-base --base-archive /absolute/extracted-base --ref FULL_40_HEX_COMMIT
```

The directory must contain the source files at its root, preserve their executable
bits, and contain only regular files and directories, with no `.git` entry or
symlinks. Choose either `--base` or `--base-archive`. The supplied full commit is
the caller's source identity: an extracted directory cannot independently prove
which Git commit produced its bytes. Both inputs produce the same copy mappings,
file digests and modes for the same source. Archive reads do not acquire source
or execute source-provided code. The direct authoring CLI accepts `--ref` in place
of the positional revision for both commands; positional invocations remain supported.

New records from either input also retain `originFiles`, the sorted complete
regular-file membership under each copy's Base origin, including files the copy
omits. Refresh updates that membership at the new pin. It lets an archive refresh
distinguish omitted older files from new upstream additions without inventing a
historical tree. Older records remain readable; to move one to a different pin
from an archive, first refresh using `--base <checkout>` containing the recorded
and target commits. A same-pin archive refresh can retain membership directly.
Operations needing Git history, including migration ancestry and historical
workflow adoption, refuse before writing and require a checkout. Use
`verify-base --offline` to check local recorded bytes after an archive refresh,
or `verify-base --base <checkout>` to also check Git provenance.

**Verify.** `... verify-base` checks three things and exits nonzero on any finding:

- local bytes against the record: `modified`, `missing`, `unrecorded` (a file
  in a copied path that neither the record nor its ownership exceptions name), `not-a-file` and `mode` (a
  script copied without its executable bit, or the reverse);
- the record against Base at each recorded commit: `origin-missing`,
  `origin-mismatch` and `origin-mode`;
- `unrecordedCopies`: edition files outside every copy whose bytes equal a Base
  file at a recorded commit, or at the `--base` checkout's HEAD. Files under 16 bytes are skipped, so
  empty files and one-line files such as a `CLAUDE.md` containing `@AGENTS.md`
  are not reported. Root `LICENSE` and `CLAUDE.md` are also excluded from
  discovery regardless of size; list other coincidental matches in `ignore`.

Tracked and nonignored untracked files are checked. Without a record the
command stops with a message naming `record-base`. The record path must be a
regular file with no symlink in it; `verify-base` and `record-base` refuse
anything else and never write through a link. `--offline` checks only the
local bytes against the record, without reading Base. Add `verify-base` to the
edition's verify command next to `check`.

**Upgrade to a new pin.** Run Base's export tools first (for example
`node BASE/scripts/export-cli.mjs .`), then use the updated installed package's
`rer refresh-base --ref FULL_40_HEX_COMMIT --base /absolute/base-checkout` to move
every recorded copy to that commit. It
writes Base's bytes and modes for recorded files, preserves tracked unrecorded
files as seed-owned, adopts files Base added under a copied path since the copy's pin (tests
only into copies that already carry tests), drops recorded files that Base or the
export removed, keeps out unrelated files the copy had left out, and re-records each copy.
An absent unadapted singleton is retired from the record entirely and named in
the `retired` output. As with absent files in directory copies, local absence is
the removal signal; refresh does not distinguish accidental deletion from an
intentional removal. Absent files marked `skip-worktree`, `assume-unchanged`
or `fsmonitor-valid`, and recorded children beneath uninitialized submodules,
refuse before writes with the corresponding Git repair command. After submodule
initialization, the child index and recorded bytes are read. Unreadable index
evidence also refuses safely. Offline refresh suppresses promisor lazy fetching;
a missing local object names an online refresh command, preserving the record.
Verify before refreshing to inspect missing copies. Deleted
adaptations still block refresh, and a singleton still present locally whose
Base source disappeared still reports an error.
If a retained runtime module still imports a deleted recorded dependency, refresh
refuses before writes; restore the dependency or adapt the importing module
before refreshing. Required unrecorded siblings are discovered as described below.
Every recorded code module is closed over relative imports and re-exports,
including delivered workflow helpers and adapted modules (read from local bytes).
A delivered `.mjs` also brings its Base declaration sibling. A dependency keeps
its relative destination only when an existing copy mapping witnesses that
namespace. Tracked unrecorded dependencies stay seed-owned and stop traversal;
new imports from refreshed files must find their named, type and default exports.
A JavaScript/TypeScript AST discovers imports, re-exports and literal runtime
calls, including optional calls, templates and JSX. Runtime imports of every
form resolve independently of declaration-only files;
only erased type imports may use declarations. TypeScript sources retain
emitted-filename substitutions and extensionless bundler resolution; JavaScript
runtime imports require an explicit filename, as in Node. Relative `require` directory
lookups use `package.json`'s runtime `main`, never its type metadata. Local package
self-references and `imports` maps use Node's actual resolver and active runtime
conditions; `types` is enabled only for erased edges. Export targets are exact
files for both loaders. Unknown external packages remain package-manager inputs.
Imports already unresolved in that same file before refresh remain untouched,
except for missing authoring-toolkit bootstrap siblings and recorded removals.
Files required elsewhere in the refresh plan may also satisfy these imports,
completing a sparse historical copy; they are delivered and recorded normally.
Unresolved imports without a planned dependency remain unresolved.
When a preserved tracked sibling becomes equal to incoming Base bytes, refresh
adds its path to `ignore` as a discovery exception; it stays unrecorded and keeps
its bytes and mode. Recorded files continue to receive their incoming Base mode.
A newly adopted directory-copy module with no incoming planned import is withheld
when a dependency has no witnessed destination; the result names it in `withheld`.
A required module with that problem refuses the entire refresh.

Base may declare edition migrations in `foundation/edition-migrations.json` at
the target revision. A recorded, unadapted module crossing a declared introduction
refuses before planning until each applicable id is consented, for example:

```sh
rer refresh-base --ref FULL_40_HEX_COMMIT --base /absolute/base-checkout \
  --edition-migration run-data-paths --edition-migration run-data-pricing
```

The direct package authoring CLI accepts the same repeatable flag. Consent lets
refresh deliver declared Base dependencies; it never writes edition-owned data.
The result lists the ids, guides and edits still owed. Apply the documented
RunData edit and run the edition tests. A repeat refresh needs no flag. An unknown
id or invalid target migration data refuses without writes.

Physical spelling is checked for every destination and dependency refresh relies
on. An unrecorded workflow or guide with a physical case alias is preserved with
one notice; a recorded path or relied-on helper alias refuses before any write.
It refuses undeclared local edits that differ from both the recorded and incoming
Base bytes; declare intentional adaptations as described below. To move one copy,
copy its files from Base at the new commit over the old copy, deleting files
Base removed, and run `record-base` with the new commit. Then run `verify-base`
and the edition's own tests, and commit the copies with the record. To review
what changed upstream first, read `git -C BASE diff OLD NEW -- modules/mail`.

**Keep seed adaptations.** Before refreshing, explicitly declare each adapted file:

```sh
node scripts/edition-authoring/cli.mjs adapt-base .github/workflows/run-demo.yml
node scripts/edition-authoring/cli.mjs adapt-base public/fonts/fonts.css
node scripts/edition-authoring/cli.mjs adapt-base src/base/dispatch.ts
node scripts/edition-authoring/cli.mjs adapt-base src/base/font-head.ts
rer refresh-base --ref FULL_40_HEX_COMMIT --base /absolute/base-checkout
```

`adapt-base <file> [--record <file>]` only accepts an existing regular recorded
file. It keeps local bytes and mode unchanged, and adds `adapted: {"local/path":
"ORIGINAL_FULL_BASE_COMMIT"}` and `acknowledged: {"local/path":
{"sha256": "SHA256_OF_LOCAL_BYTES", "mode": "100644"}}` to that copy (`100755`
for an executable file). The existing `files` digest and
`modes` entry remain the Base baseline at this per-file commit, even when the
copy's other files move to a newer revision. Repeating the declaration does not
advance that baseline. Commit the record alongside the adaptation.

The acknowledgement records those local bytes and mode. With that snapshot
unchanged, a later change to either makes `refresh-base` refuse the entire refresh
before writing any file or record. `verify-base` exits nonzero and
reports `adaptation-modified` or `adaptation-mode` with the file and a runnable
`acknowledge` command, including `--record` when needed. Review the change, then
run `adapt-base <file>` again to update the local snapshot. This keeps the original
Base baseline and upstream conflict notes. Older declarations without an
`acknowledged` snapshot remain readable, but report `adaptation-unacknowledged`
and block refresh until the same explicit re-acknowledgement; neither command
automatically accepts the current bytes.

The record is plain data in the owner's repository, under the owner's control.
Its acknowledged snapshot guards against accidental later drift in a declared
file's digest or mode; it is not tamper-evident. A hand edit to the record that
supplies a digest and mode matching the current file is treated as acknowledged
by `verify-base` (online or offline) and `refresh-base`, just like running
`adapt-base`. Both are the same owner trust act. Review record diffs in code
review like source diffs, alongside the adaptations they acknowledge.

Refresh never writes or removes declared adaptations, including when Base deletes
the source. It still refreshes every untouched copy. Its `adapted` report lists
each seed-owned file; `conflict: true` means upstream bytes, mode or existence
changed against the original baseline. A conflict note supplies a Git diff hint
for explicit reconciliation. The note remains visible on repeated refreshes until
you reconcile the baseline; it does not prevent other copies from refreshing.
A second refresh to the same commit leaves the record and local file bytes
unchanged. Undeclared local edits that differ from both the recorded and incoming
Base bytes still block before any file is written, with an instruction naming
`adapt-base`.

`verify-base` reports declarations separately: it checks their existence,
regular-file status, acknowledged local bytes and mode, and retained Base
baselines. `--offline` checks the local acknowledgement but cannot
validate the upstream baseline. Run the edition's product tests for adaptations.
For richer source comparisons, use `edition.json` origins and mappings with
`compare` instead.

To return a copy to verbatim management, save the seed adaptation somewhere safe,
restore its files and modes from the desired Base commit (including deletions),
then run `record-base <copy-path> <origin-path> <commit> --base <checkout>`.
This explicitly replaces that copy's declarations with a fresh verbatim record;
redeclare any other adaptations in the same copy before refreshing. Verify and
run edition tests before committing. To retain a reconciled adaptation against a
new baseline, record that Base baseline first, restore the saved adaptation, and
run `adapt-base <file>` again. Never update a previously applied migration in
place: keep it and add a new seed migration for schema changes.

Penny's `base/PROVENANCE.json` and `verify-base-source.mjs` were the model for
this record and command.

## Public projections

A parent or component baseline can be a reviewed public projection of a private
original, for example with credential fixtures replaced and presentation images
omitted. Its origin carries
`projection: {schemaVersion: 1, originalSha256, recipeSha256}` in place of a
`revision`. A projection cannot be fetched or used with `workspace`; it exists
only as a retained archive under `.edition/sources/`. The source lock must
already bind that archive's key, digest and exact file SHA-256 before the first
`lock` reads it. Readers never take that authority from the archive's own
claims, and changed bytes, even an equivalent reserialization, fail.
`promote` keeps the projection identity.

Whole-parent comparison of a projected parent reads the plan and receipt at
`scripts/public-projections/plan.json` and `scripts/public-projections/receipt.json`.
Both must match the source lock. The plan names every replaced or omitted
member by its original SHA-256, and each omission must state its reason. The
receipt binds each member's original and projected SHA-256 and mode. Comparison
maps only exact original bytes to their projected identity; every other byte,
mode, addition and removal stays visible. Incoming candidate source is always
read as ordinary Git and never inherits the projection identity. Lamp's
`scripts/public-projections/` is the reference producer.


Workflow refresh also supplies and records local scripts invoked in delivered
workflows, deriving the paths from their run steps. Helpers and workflows share
the existing preflight: a refused destination prevents every planned write.
Workflow run scalars are read from the YAML document AST, including folded and
continued scalars; literal shell paths use one quote-and-escape-aware scanner.
Copied, default-seed and preserved seed-authored workflows use the same helper
source search. Tracked unrecorded helpers remain seed-owned; untracked or ignored collisions
refuse even when their bytes match Base. Tracked unrecorded Verify workflows
and `VERIFY-WORKFLOW.md` can be adopted when their exact bytes match a template
in the requested Base commit's history (there are no seed substitutions).
Acknowledged adaptations and divergent workflows stay untouched and receive a
notice with the template changes and explicit merge/record instructions.
An absent workflow is not automatically installed by this adoption step.

Authoring refresh closes relative imports from every recorded authoring module,
including singleton copies and modules whose Base origin is another maintained
authoring mirror. It follows the bytes that will remain in the seed, including
acknowledged local adaptations, and gives newly delivered siblings source records
and digests. Tracked unrecorded siblings remain seed-owned: refresh preserves
them without traversing their imports. Untracked helper collisions, including
ignored files and files matching Base bytes, refuse before writes, as do removed
recorded dependencies still imported, conflicting mappings and symlinks. This
delivery is limited to the authoring toolkit; it does not infer application
dependencies. Use the updated installed package's `rer refresh-base --ref
FULL_40_HEX_COMMIT --base /absolute/base-checkout` to adopt 0.2.82 when the seed's
copied CLI predates it.

Before writing, refresh checks destination types, existing filesystem casing,
ownership and effective permissions with `lstat` and access checks. Overwriting
a copy requires a writable file owned by the current user so its mode can be
set; overwriting the record requires only a writable file. Neither overwrite
requires directory write permission. Creating or removing a file requires a
writable, searchable parent directory; missing directories are checked through
their existing ancestors. The plan accounts for its own removals. These checks
cannot predict races, disk or I/O failures, restrictive umasks on newly created
directories, or collisions between two new case-distinct names on an insensitive
volume.
