# Static pre-ledger upgrade fixture

`schema.sql` is a verbatim copy of
`6dffae527784f85d9b33bf9900ea315b3a71bb9b:default-seed/migrations/core/0002_operator_auth.sql`, the retained
pre-ledger migration (including the optional OIDC tables). That commit's module
fresh schema already contained cancellation objects, and its cancellation API
queried the ledger. This fixture does **not** claim that its API successfully
cancelled an invitation without the ledger.

`rows.sql` is a small, synthetic populated old store, committed as literal rows.
Its chronology follows the old schema's version trigger and persisted credential
shape: bootstrap leaves owner version 1; invitation acceptance consumes the
version-1 link and creates a native session at version 2; subsequent deactivation
leaves the operator at version 3 and that older session invalid. Pending and
expired invitations remain version 1. The "cancelled before the ledger" row
represents a state reachable only by a direct database update: an administrative
`invited` to `inactive` SQL transition, yielding version 2 and an
unconsumed old version-1 link, without a cancellation record. A separate pending
row is reserved for witnessing cancellation after migration.

The static credential HMACs use SHA-256 over `purpose + NUL + credential`, with
`link` or `session` purpose and the public test-only secret in `owner-state.mjs`.
The test injects its fixed `NOW` through the production auth factory's clock seam;
no runtime invitations or bootstrap construct this starting state, and no wall
clock can age it out. OIDC rows are opaque preservation sentinels, not a claim of
provider authentication. Every old table is populated and snapshotted exactly.

The default `*.test.mjs` suite needs only this fixture and the locked local test
dependencies; no environment-selected baseline, Git history, other checkout,
network, or provider credentials are used at test runtime. The independent opt-in
`reinvitation-upgrade.mjs` source-snapshot test is retained separately.
