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
  "id": "just-every/lamp",
  "toolchain": {"id": "runeditrun/edition-authoring", "version": "1.1.0"},
  "parent": null,
  "components": [
    {"id":"example/foundation","role":"foundation","source":{"kind":"local","paths":["src/base"],"origin":{"repository":"<FOUNDATION_REPOSITORY_URL>","revision":"FULL_40_HEX_COMMIT","path":"default-seed/src"}}},
    {"id":"just-every/lamp","role":"edition","source":{"kind":"local","paths":["src/routes","package.json"]}},
    {"id":"acme/approvals","role":"module","source":{"kind":"git","repository":"<MODULE_REPOSITORY_URL>","revision":"FULL_40_HEX_COMMIT","path":"exports/approvals","destination":"src/modules/approvals"}}
  ]
}
```

Replace each repository URL parameter with the actual public upstream repository or
owner-controlled Git source, and replace each revision parameter with its full
committed revision. The example component IDs are logical names; choose names for
the components you actually select.

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
  reads do not update source pins or retain archives. Use `parent` to compare the
  whole edition, including source locks and other metadata; only retained archive
  storage is excluded. Parent comparisons report current tracked working-tree
  bytes, modes and deletions against the baseline with no component mappings.
  A fourth optional argument selects an independent current Git checkout instead
  of this edition. Exact declared privacy pairs and the 14 pinned historical
  image omissions are normalized in parent comparison; unknown bytes, changed
  image modes, additions and removals remain visible.
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


## Public comparison projections

A retained public comparison may select `{repository, projection}` instead of a
Git revision. `projection` is `{schemaVersion: 1, originalSha256, recipeSha256}`;
both digests are full SHA-256 values. This identity denotes a deterministic
sanitized derivative, never the original immutable Git snapshot. The archive's
`derivation.upstreamRevision` identifies the private upstream commit separately;
it is not claimed to exist in the public repository. Missing projections fail
closed without a fetch. Their member digest and full archive hash remain bound
in `sources.lock.json` like other retained comparisons.
