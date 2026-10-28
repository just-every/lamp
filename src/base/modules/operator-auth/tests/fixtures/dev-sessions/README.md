# Dev-sessions prior-data fixture

The store is built from the reference seed's own applied migrations
`default-seed/migrations/core/0001`–`0006` (current main before
`0007_dev_sessions.sql`), then `rows.sql` populates it. Applied migrations are
never rewritten, so those files are the schema every existing store has.

`rows.sql` holds literal rows: an owner, admin and member, a deactivated
operator, consumed magic and invitation links, and one session of every kind
the old CHECK allowed (`native`, `review`, `oidc`, `password`) plus revoked,
expired and version-fenced sessions. Session and link hashes are HMAC-SHA256
over `purpose NUL credential` with the public test-only secret in
`../../dev-runtime.mjs`; each credential is one letter repeated 43 times
(`N`, `R`, `O`, `P`, `V`, `E`, `G` for sessions). Unexpired sessions expire on
1 January 2100, so no wall clock ages them out.
