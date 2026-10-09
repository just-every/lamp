# Lamp migration commands

Local migration, setup and import apply core SQL before `migrations/ext/` SQL.
Deployment runs setup before upload. The owner wrapper selects the shared Base
mechanism with Lamp's permanent `lamp_ext_migrations` ledger; adopting the helper
does not rename or recreate that ledger or rewrite applied SQL.

Preserve applied filenames and bytes. Add new migrations for later schema work;
a failed migration stops the command and can be corrected while still unapplied.
Existing core and owner data and previously applied entries remain in place.
The current directory is a convenience, not an ownership restriction.

Lamp's existing archive manifest validates owner migration filenames and hashes.
Restore still requires the archive's matching migration inventory and an empty
target; it restores owner rows and ledger history. A failed restore remains
unpublished and its migration-created target must be abandoned for a fresh target.
See `OPERATIONS.md` for the full archive recovery procedure. Shared migration
code does not change that archive policy or imply another edition has it.

`node scripts/test-owner-migrations.mjs` exercises actual local commands against
isolated D1 state. `node --test --test-name-pattern='owner sidecar'
tests/e2e/export-import.test.mjs` verifies owner archive equality and failed-restore
recovery against real local D1/R2 bindings.
