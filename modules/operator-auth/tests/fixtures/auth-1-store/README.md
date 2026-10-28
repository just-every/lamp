# auth-1 store prior-data fixture

A populated store written by the auth-1 main (Base `d6080a2`) through that
code's own public API, not by hand. The generator is
`generate.mjs` in Base's auth-3 evidence folder, run against a Git worktree of
`d6080a2` itself, on the reference seed's applied migrations listed in
`credentials.json` (`migrations`). It replaces only `crypto.randomUUID` with a
counter, so row ids are deterministic UUID-shaped values; every token, hash and
timestamp is what that code wrote.

`rows.sql` holds every `oa_` row it wrote: a bootstrapped owner, an admin and a
member who accepted invitations, a pending invitation, a cancelled invitation
(with its ledger row), a deactivated operator, a pending email link, a review
session, a password session, the admin's provider binding and OIDC session, a
dev session and an invitation minted while using it, a signed-out session, a
pending provider transaction, and the rate-limit rows those calls left.

`credentials.json` holds the public, test-only values the later test needs:
the session secret and dev key as ordered parts, the plaintext session and link
credentials, and `generatedAt`. Links last 15 minutes and sessions a week, so
`tests/prior-data.test.mjs` runs its clock one minute after `generatedAt`.
