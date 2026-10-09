# Changelog

## 1.1.0 source candidate

This record describes source changes since the retained 1.0.0 release. It does
not establish publication of a tag or acceptance of a hosted installation.

- Resolved incident updates omit the next-update promise. Active updates retain
  all publication requirements; migration 0012 preserves prior records.
- New incidents and maintenance use independent durable INC and SCH reference
  sequences. Migration 0013 retains permanent reservations, including unused
  ones, while preserving all legacy references and URLs.
- Local development provides an explicit loopback-only mail inbox for native
  sign-in, confirmation and notification journeys. Migration 0014 records local
  capture separately from provider acceptance; production builds and portable
  product archives exclude raw development envelopes.
- SendGrid submission uses a durable at-most-once ledger and a nullable actual
  acceptance receipt (migrations 0010 and 0011). Uncertain submissions remain
  visible and are not automatically repeated. Resend remains the default.
- Owner migrations run after core with a permanent ledger. Export and restore
  preserve database records and original R2 bytes and metadata; import requires
  an empty target and a failed restore remains unpublished.
- Public snapshots retain a complete generation in a SQLite Durable Object before
  advancing the R2 selector. Retained last-known data and dependency health remain
  distinct; simultaneous Worker and replica unavailability cannot be covered.
- Source authoring supports changed-input diagnostics, retained source extraction,
  mapped comparisons and portable adjacent release receipts.
- Public documentation and current source descriptors use the canonical
  `just-every/lamp` identity. Immutable comparison origins remain recorded.

Before adoption, back up data and source, apply migrations in order, preserve
owner customisations, verify a restored copy, and run exact-candidate checks.
See `RELEASE.json`, `HANDOVER.md` and `ACCEPTANCE.md` for requirements and limits.
