# Changelog

## 1.3.0

- Public snapshots validate their generation on reuse, with immutable artifact caching and retained origin-error responses. Incident, component and maintenance changes keep the ten-second publication requirement across every public surface.
- The installed status header includes Sign in to the operator host.
- Local instructions stop the server and export before reset, then resume the restored owner. Run it locally and the owner task guides are included in installed docs hydration checks.
- Active repository descriptors now name `just-every/run-lamp`; local archive product identity remains compatible with existing exports.

- The operator app wears the landing's style: its paper, green-black ink, the
  self-hosted Inter face and mark 18; ink pills, white plates and dot chips.
  Amber marks only live work (an overdue incident, the open composer and new
  incident panel). The lit lamp hangs over sign-in, first-run setup, the empty
  overview and a page that could not load. At 390 pixels the sections are one
  scrolling row of tabs, the current one kept in view. Labels, routes and
  behaviour are unchanged.
- Settings → Move in: a dry run first, then components, groups, incident history at its original times, maintenance and email subscribers; nobody is notified about history, each subscriber gets one invitation to confirm, a second run changes nothing, and undo keeps what changed since. Guide: docs/moving-in.md.
- Settings → Slack and Teams: channels follow chosen components and receive each published update once when "Slack and Teams" is selected for it; webhook URLs are stored encrypted and never shown again.
- Alerts → Connect a monitoring tool: Datadog, UptimeRobot, Better Stack and Pingdom presets read each tool's own alert, draft an incident on the mapped component, and close a never-published draft on recovery.
- The browser installer wears Lamp's own look (paper, ink, the lamp mark and Inter) through Base's theme hook: public/rer-theme.css, also linked by sign-in and first-run setup.
- Every Base copy is on Base 3d643dd; Lamp no longer carries Base's own tests.
- RER-managed and independent delivery builds use trusted-build bf7a25a.
- Landing-page copy and structure were updated for the release.
- Local development: rer dev's scheduled triggers reach the runtime, rer preview starts, and a development server without mail capture says how to start the outbox.
- Docs at `/docs` on the app host, in the landing page's look, cut at build time from the owner guides listed in `docs/site.json`.

Upgrading: apply migrations 0017 and 0018 after 0016.

## 1.2.0

For a new operator:
- A first-run page at `/setup` names the page, its tagline, time zone and colour; the Overview then shows an eight-step setup checklist built from saved server state, each open step linking to the screen that completes it.
- The composer opens a fresh empty draft for each next update, with lifecycle prompts; the published wording never reappears, and drafts autosave per incident and next update.
- Plain words in the operator app: Set status, Status history, move up and down.
- Every time shows in the page's configured time zone, with its label; a next-update time more than 24 hours ahead warns.
- At 390 pixels Preview comes before Publish, and the operator navigation wraps.
- An owner with installation database access can issue a one-use sign-in link from the terminal; see the technical operator-authentication reference in `OPERATIONS.md`.
- Local work runs through `rer` (setup, dev, verify, reset, export, import, deploy) on Node 22.20.0 and pnpm 10.12.4, with mail captured in the development outbox.

For visitors and subscribers:
- Each component appears once; there is no invented "Other services" heading on a page without groups.
- New components show "Tracking since" instead of a percentage over less than a day; the 90-day method sits behind a disclosure.
- A resolved incident shows its resolved time and duration once; subscriber pages share the page's styling, with and without script.
- The footer credit reads "Powered by Lamp", still hidden by the owner's toggle.

Upgrading: apply migrations 0015 and 0016 after 0014. Local state moves to `.wrangler/state` and `.dev.vars` at the repository root; earlier local data under `deploy/` is left for you to move. RER-managed delivery builds with trusted-build 6d77ec1.

## 1.1.0

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
- The Alerts screen shows each source's intake URL on the public page host,
  which is the only host that routes `/api/intake/*`. The operator API derives
  it from the configured page hostname; single-host and local development
  installations keep their one origin.
- Source authoring supports changed-input diagnostics, retained source extraction,
  mapped comparisons and portable adjacent release receipts.
- Public documentation and current source descriptors use the canonical
  `just-every/lamp` identity. Immutable comparison origins remain recorded.

Before adoption, back up data and source, apply migrations in order, preserve
owner customisations, verify a restored copy, and run exact-candidate checks.
See `RELEASE.json`, `HANDOVER.md` and `ACCEPTANCE.md` for requirements and limits.
