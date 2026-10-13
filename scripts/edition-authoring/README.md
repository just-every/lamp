# Edition-owned source authoring 1.1.0

Copy this directory's `.mjs` files into `scripts/edition-authoring/` of any edition.
Node 22+ and Git are the only authoring dependencies. Builds and integration remain
ordinary edition code. This tool never runs source-provided scripts.

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
Base change can reach the edition and an accidental edit cannot hide.
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
for local source. Without either, pass `--base <checkout>`, or `--offline` to
verify local bytes. Older records with a `repository` field are still read and
verified from it; recording or refreshing drops the field.
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
An acquisition URL or local source checkout belongs in the seed's own source
declaration; a publisher-qualified identity alone is not a clone address.

**Verify.** `... verify-base` checks three things and exits nonzero on any finding:

- local bytes against the record: `modified`, `missing`, `unrecorded` (a file
  in a copied path that the record does not name), `not-a-file` and `mode` (a
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
`node BASE/scripts/export-cli.mjs .`), then `... refresh-base FULL_40_HEX_COMMIT
--base /absolute/base-checkout` to move every recorded copy to that commit. It
writes Base's bytes and modes for recorded files and for files already equal to
Base, adopts files Base added under a copied path since the copy's pin (tests
only into copies that already carry tests), drops recorded files that Base or the
export removed, keeps out files the copy had left out, and re-records each copy.
It refuses recorded files with local edits. To move one copy,
copy its files from Base at the new commit over the old copy, deleting files
Base removed, and run `record-base` with the new commit. Then run `verify-base`
and the edition's own tests, and commit the copies with the record. To review
what changed upstream first, read `git -C BASE diff OLD NEW -- modules/mail`.

A copy record claims byte equality. When an edition adapts copied source, move
it out of the record: describe it in `edition.json` with an `origin` and
`mappings`, and use `compare` to see upstream and local changes. Penny's
`base/PROVENANCE.json` and `verify-base-source.mjs` were the model for this
record and command.

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
