# Lamp release acceptance

Lamp's useful outcome is one business operating a public status page and incident
communication desk from its own installation. An operator must be able to sign in,
maintain real components, publish and resolve an incident, schedule maintenance,
manage confirmed subscribers, and inspect actual notification outcomes. Customers
must receive complete, private, script-independent status information and control
their own subscriptions. The accepted public design and every obligation in
`CONTRACT.md` and `BASELINE.md` remain part of this release; no clause is waived by
this document.

A complete release requires an exact committed candidate, a fresh frozen-lockfile
install and full `pnpm verify`, with no skipped or failed requirements, plus:

- Empty owner-account setup and repeat deployment that preserve existing data.
- Native emailed sign-in, confirmation, incident lifecycle, maintenance, subscriber
  management and erasure, alert intake, reports and configured AI in real browser
  journeys, including mobile and script-disabled public access.
- Authorized mail-provider acceptance, signed delivery events and received-message
  evidence for DKIM unsubscribe-header coverage and no tracking. API acceptance
  alone never proves mailbox receipt. A controlled webhook receiver must verify
  the complete signed notification and failure behavior.
- Original-data export, clean restore, equivalent re-export, failed-restore recovery,
  previous-release migration and preserved owner customisations/intent.
- D1, Queue and R2 failure branches: public retained snapshots remain readable,
  `/health` reports dependency failure, failed work is visible, and recovery
  publishes current data. Cached outage proof states whether the edge was warm;
  it must never be represented as independently hosted global outage protection.
- A release record that names the exact source/tag and deployment, provider,
  browser, recovery and verification receipts, separate from source metadata.

## Release evidence boundary

Version 1.2.0 adds first-run setup and the setup checklist, a composer that starts
each update fresh, command-line sign-in links, public page polish and the rer
command line. Its `pnpm verify` covers these locally, in real Workers and browsers;
local suites and provider-shaped test fixtures do not constitute live acceptance.

Record completion evidence outside the distributed source tree, bound to the exact
candidate and adopting installation. Include deployment and verifier identities,
native browser journeys, received-message and signed-event evidence, restore
comparison, and fault/recovery results. Source metadata alone does not prove these
outcomes. An installation's earlier acceptance does not qualify a later source
revision automatically.
