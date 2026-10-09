# Public comparison projections

These four retained archives are derived public comparisons, not relabelled Git
snapshots. `plan.json` pins the complete private originals by SHA-256 and every
changed member and edit by SHA-256. `receipt.json` binds every retained and omitted
member, its mode, the original archive, upstream commit and new public identity.
The original upstream revision is provenance only. It does not claim a commit in
the public repository. The projection identity has no Git revision: its identity
is the declared identity URI plus original archive digest and exact recipe digest.
The three shared-component projections use the reserved, non-fetchable
`https://example.test/source.git` identity URI. It makes no claim that the private
originals have a public Git repository. The parent keeps its declared Lamp public
destination. Original archive keys, digests and upstream revisions remain provenance.

Run `node scripts/public-projections/generate.mjs PRIVATE_ORIGINALS NEW_OUTPUT`
with both directories outside this source tree. The private store contains the
four exact original filenames named in the plan, with no additional entries.
Before creating the output directory, the generator checks this complete inventory
and validates every input. It rejects missing files, unexpected or malformed names,
non-file entries, symlink files and directory components (including
dangling links), preserves scoped npm dependency identifiers, performs only
pinned byte edits, and emits deterministic
archives and a receipt. It does not read environment secrets, contact a service,
or depend on the private store during normal public verification. Review and
copy the resulting archives and receipt into this tree; update selectors and their
reviewed key, digest and archive SHA-256 bindings in `sources.lock.json`, then run
`node scripts/edition-authoring/cli.mjs lock` after staging intentional changes.

The parent presentation screenshots under `visual/` are expressly excluded from
whole-parent comparison presentation. These are historical operator screenshots,
not product assets or executable comparison fixtures. No selected component or
application test imports them. Their paths, hashes and omission reasons remain
in the plan and receipt; the private originals retain them. Parent extraction
therefore yields the public comparison source, not a byte-identical private tree.
The product's cartographic PNG is retained with ancillary metadata stripped;
its pixel stream and rendering chunks are unchanged. Licences, source, migrations,
tests and executable modes are retained. Email and synthetic credential fixture
edits preserve equality relationships; application logic is not rewritten.
The operator-erasure identifier and its SQL predicate retain their exact original
`operator.invalid` machine sentinel. This identifier contains an opaque operator
ID, not a person's email address. Ordinary display and fixture emails still use
`example.test`. The three deployment credential fixtures retain their original
32-character boundary and original equality relationships with two distinct,
explicitly synthetic values; the actual
configuration validator and archived test assertions are unchanged. Public controls
execute that archived validator at 31, 32 and 33 characters for every field.
`fixture-reviews.json` records exact archive Git blobs and decoded member hashes
with the owner's review reason. It grants no scanner waiver; the transformed
values themselves are explicitly synthetic.

The source authoring reader fails closed when a selected projection is missing,
invalid or differs from the lock. It never fetches an original to repair a public
projection. Component comparison still uses the clean candidate's actual Git
source; the projection identity is never inherited by that incoming source.
Direct `snapshot` and `source` calls require the selected origin and exact raw
archive SHA-256 from `sources.lock.json`, including when retention or development
flags are supplied. Recomputing an archive's internal member digest cannot authorize
changed bytes, modes, membership, metadata or serialization. A projected reference
cannot switch to a development workspace. New projection adoption must carry the
reviewed artifact bindings into the source lock before its normal refresh; readers
never bootstrap that authority from an archive's own claims.

Consumers are `snapshot` / `source`, CLI lock/check/changes, `extract` (parent and
all three components), `compare` (parent and all three components), and release/receipt.
Materialization consumes local authoritative files; these components are already
local, so no archive source is injected. Promotion applies only to Git components
and is inapplicable to these selections. The public projection suite exercises
real extraction and comparison, mapped and unmapped input changes, whole-parent independent current and incoming source, executable
modes, missing and corrupt sources, plus all-member receipt completeness.

Private equivalence uses the same production consumers with each authentic
original and public projection. Only exact original member hashes in the receipt
can be mapped to approved projected hashes; arbitrary hashes and mode changes
are preserved. A difference disappears only if both complete normalized
identities become equal. Historical screenshot omissions apply only to the exact
pinned original bytes; changed screenshot bytes remain a difference. The private
harness records source checks, change reports, extraction identities, component
and whole-parent comparisons and portable release receipts. Parent comparison
uses independent incoming and current source trees. Its private controls compare
both baselines against the same independently read inputs, including authentic
original and public incoming trees, all 14 exact image omissions, adjacent source
edits, executable modes, additions, removals and changed image bytes. This proves comparison semantics,
not the original product's provider or browser acceptance.
The private harness authenticates originals against the exact plan pins before
seeding their isolated lock bindings. Its public copy carries the verified public
bindings. Both then use ordinary consumers and lock commands, without a public
unpinned-read option.


Run private checks sequentially with the pinned Node runtime and a private report
location outside the public source tree:

```
node scripts/public-projections/private-equivalence.mjs PRIVATE_ORIGINALS NEW_PRIVATE_REPORT
node scripts/public-projections/private-generation.mjs PRIVATE_ORIGINALS NEW_PRIVATE_DIRECTORY
node scripts/public-projections/private-tests.mjs PRIVATE_ORIGINALS NEW_PRIVATE_DIRECTORY
node --expose-internals scripts/public-projections/private-syntax.mjs PRIVATE_ORIGINALS NEW_PRIVATE_REPORT
```

The private generation harness invokes the real batch CLI with authentic inputs,
checks three byte-identical generations including different input creation orders,
and proves missing, extra, malformed, non-file, linked and corrupt inputs leave no
output directory. All mutations use temporary copies; the original names, modes
and bytes are checked again after the controls. Logs and reports remain private.

The archived component tests execute all 42 genuine cases on each variant.
Parent tests need the product dependencies and Worker/browser runtime. The syntax
proof uses the Acorn parser supplied by pinned Node, compares every nonliteral
syntax node/operator and test name, and checks exact construction from approved
edits. Literal and template payloads may differ only through the independently
pinned construction. This does not claim runtime equivalence for those parent
cases. Run the original and projected parent suites in isolated, dependency-ready
private trees before claiming that additional runtime acceptance. A plain parent
`deployment-secrets` test also dynamically imports Vite; it is not fully
standalone. No existing product test is skipped or changed in public verification.
