# Owner SQL migrations

`owner-migrations.mjs` applies an edition-selected SQL directory through Wrangler's
migration engine after that edition applies core migrations. The edition supplies
its D1 binding and permanent ledger name. It supports the generated single-D1 TOML
used by Lily and Lamp; unsupported configurations fail explicitly. An absent or
empty directory needs no configuration or database action.

Wrangler owns ordering, transaction rollback and applied-file tracking. Preserve
applied SQL filenames and bytes and the selected ledger identity; make later
changes in new migrations. The temporary configuration is beside the original,
retains unrelated relative paths, uses a unique name, and is removed on failure.
This is a migration mechanism, not an archive or backup system.

Base's unit test covers selection and rejection. Each adopter's
`node scripts/test-owner-migrations.mjs` runs its actual local command against
an isolated real Wrangler/D1 database, checking reruns, ledger/data preservation,
SQL failure rollback and repair. It never uses the owner's local persistence.
