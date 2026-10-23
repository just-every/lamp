# Changelog

## 1.11.0 (unreleased)

Report follow-up preserves MOVE-002 silence across upgrade: retroactive-only imported incidents do not enqueue automatic report reminders. Their owed report remains visible, and a live published update enables the ordinary reminder carrier.

**Follow-ups (AUTO-003, partial).** Overview brings the existing incident, publication, maintenance, report, invitation and notification obligations into one private list with owners, due times, stop conditions and failures. Reasoned dismissals are audited and apply only to the current occurrence, so later failures return. Operators can explicitly retry an unfinished notification dispatch through the queue; a rejected handoff remains a visible failure. Vendor-feed, secondary-origin and SMS-cap entries remain with their unbuilt carriers.

Status badges now use the public page’s amber for Partially unavailable, retaining their labels, 2KB SVG limit and generation caching. Existing public-door journeys cover all states and database-free reads (PAGE-018).

**Maintenance automation per window (MAINT-009, partial).** A window can turn auto-start or auto-complete off; both default on and existing windows retain their behavior. An opted-out start stays Scheduled and sends one operator start-due email until an operator starts it. An opted-out completion stays In progress, keeps its original end and overrun label, raises one overrun alert after fifteen minutes, and sends no Completed notice until an operator completes it. Date-only rescheduling preserves off switches. This slice adds no changed entry for MAINT-001, MAINT-002, MAINT-004 or MAINT-005: their existing-window behavior is unchanged. The remaining MAINT-009 wording, in-window updates, Verifying, import mapping, public API and automation doors, page-wide defaults and operator push remain unbuilt.

**Accessibility reporting (PAGE-020, partial).** This release includes a VPAT® 2.5 Rev 508 report at `/docs/accessibility/vpat` on the app host. The release validator requires its version and Section 508/WCAG conformance tables. The report distinguishes measured browser journeys from unmeasured criteria and surfaces; private pages remain with AUD-002. The public-footer link awaits the owner UI pass.

**The next-update promise (AGENT-002).** Within the update-due lead, Lamp prepares one private “Still working on it” draft when no saved draft exists. Preparation uses the existing brief without a model: it restates the latest published impact and cites newer accepted evidence, or says that nothing has changed. A private composer panel keeps the complete cited evidence. The owner’s due email links to that draft; unowned incidents retain the all-operator reminder rule. Preparation never publishes, replaces an operator draft, changes the promised time or queues subscriber notices. An unpublished draft leaves the commitment overdue.

**Report follow-up (AUTO-004, partial).** Owed reports remind the communication owner by email on the due day and once each following week; an unowned report reminds every active operator. Publishing a report or waiving it with a reason stops reminders. Waivers are recorded atomically in the audit log, remove the report from the owing list and still allow a report to be written later. Operator-chat reminders remain with NOTIFY-016.

**Named incident communication (INCIDENT-011, partial).** An unresolved incident starts with its opener as communication owner. Operators can take over or reassign it to another active operator, with an atomic audit entry. Due and overdue emails go to that owner; an unowned incident is flagged on Overview and reminds every active operator. Ten minutes after the original commitment, one escalation reaches every active operator (all have publish rights until TEAM-004). Ownership is private and cannot be changed on a resolved incident. Push, operator chat and Oncall responder delivery remain with MOBILE-002, NOTIFY-016 and INTAKE-012.

**Built-in page layouts.** Settings → Page can publish one of three layouts without AI, each laid out after the owner's L9 studies: Calm headline (one sentence, then components and history in hairline columns), Uptime-history-led (the overall uptime over one 90-day heatmap with incident callouts) and Regions map (a dotted world with a labelled pin per region, region filters and a components table). Default keeps the existing page and its stylesheet and script byte for byte; a layout publishes its own. Components take an optional region in the component editor. Regions map needs public components in at least two regions; until then the public page shows Calm headline and Settings says why.

Migrations: `0043_page_templates.sql` adds the saved page layout (`page_settings.template`, `default` for every existing page) and an optional `components.region`; `0044_widget_appearance.sql` adds the saved embed tag choices (`page_settings.widget_appearance`, the original embed defaults for every existing page). `0045_incident_communication_owner.sql` adds private communication-owner assignments and extends the reminder kinds with escalation while preserving every existing reminder. Existing incidents default to their opener. `0046_report_followups.sql` adds private report waiver and weekly reminder records. `0047_agent_promise_drafts.sql` adds sidecar-only private draft attribution and retained per-commitment preparation receipts; every existing draft stays unchanged. `0048_maintenance_automation.sql` adds the window-owned automation sidecar; absent rows preserve both original on defaults. `0049_follow_up_dismissals.sql` adds private reasoned Follow-ups dismissals by exact obligation occurrence. `0050_detached_component_visibility.sql` keeps the retained incident and maintenance attachments of a deleted internal component private.

## 1.10.0

**Your status page, from your website.** First run asks for your website, reads it once and fills in the page name, tagline, mark, accent colour and first components from it, with the time zone from your browser; you check it on one card and open Lamp. A site Lamp cannot read leaves plain defaults. Settings → Page can read the site again, and logo upload now takes SVG (stored as a PNG). The website reader (`src/core/platform/site-reader/`) is self-contained for other seeds to adopt.

**Setup that runs itself.** The eight-step checklist is gone. Lamp checks its own public page and subscribe form after every publish and every minute, and a hosted sender when it changes; Overview shows one line, amber only when a check fails. Review page opens Your page (`/app/page`); Settings opens on your page's address, mark and look, with the rest behind tabs. The page after subscribing, and the confirm, manage and unsubscribe pages, are one branded card. Old setup-checklist rows stay in `setup_readiness` and are no longer read.

**PagerDuty incident communication (INTAKE-009, done).** Alerts → Connect PagerDuty accepts signed v3 trigger, acknowledgment, escalation and resolution events with exact service-to-component mapping. Triggers create private drafts; acknowledgment and escalation timestamps enter the brief and the cited report timeline. An optional REST API key sends each publication's text and permalink back as one note request per linked PagerDuty incident. Failures stay visible in source receipts without blocking publication. The key and note author are sealed, never shown and never in a backup: Lamp's hosted archive and a local backup (`rer export`) both leave them out, and a restored source asks you to reconnect. Migration 0042 adds the responder columns and note records. Signed-event and fake REST-edge journeys pass; no live PagerDuty account acceptance is claimed.

**Links in update text (UPDATE-013, done).** A bare `https://` URL in any update field becomes a link; nothing else is interpreted, and `http:`, `javascript:`, `data:` and markup stay literal text. The page, history, permalinks and feeds show a link whose text is the URL itself. Notification email links it directly in the HTML part and carries the bare URL in the text part, with click, open and analytics tracking off. Operator Slack posts carry `<url>`, never `<url|text>`, and Teams cards link the URL. Webhook subscribers have two doors (SUB-009): an endpoint that is a Slack incoming-webhook URL receives Slack's message form, signed the same way, with each URL as `<url>` and every field reassembled unchanged; every other endpoint receives Lamp's format with every update field byte for byte. UPDATE-001, UPDATE-002 and SUB-009 are recorded as changed. The evidence is native Workers, a controlled webhook receiver and recorded provider edges; no live Slack, Teams or mail-provider acceptance is claimed. SMS (SUB-013, NOTIFY-014), Statuspage-format webhooks (SUB-018) and Slack-app and Teams subscriptions (SUB-014, SUB-015) carry the same rule in their own text for when they are built.

**Older backups restore, also into Run Edit Run Managed.** A local backup from any earlier Lamp restores with `rer import`, including one made before Lamp 1.8.0: the restore adds the audit entry migration 0033 writes for each earlier component state change, exactly as updating that installation in place would. `rer import` also restores a local backup into a database Run Edit Run Managed installed: rer places it by Platform's migration ledger, which it never writes (each `core-` file by its hash, and the page initializer `setup-initial-page.sql`, which Lamp declares as data only), and the archive's page settings replace the row the initializer wrote. Every other table must be empty.

**Hosted backups with `rer export`.** `rer export --target remote --output DIR` backs up the hosted installation this checkout deployed as `production`: it runs Lamp's hosted backup, `node scripts/export.mjs --remote --environment production --out DIR`, with the Cloudflare credentials in your shell (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`), and names the folder and exit status when it finishes. rer 0.2.72 and earlier refused it and printed `wrangler d1 export` commands instead. The folder is the same hosted archive as before, restored with `node scripts/import.mjs` ([backups and recovery](docs/backups-and-recovery.md)).

**Business moves you can check.** Lamp's import door is now Base's door exactly as rer 0.2.71 ships it; the local change that undid Business imports while keeping your later edits is gone, because Base's door now does that itself. Business can archive an uploaded source and check that a restore of it would read, with no write to Lamp; a source uploaded again after an undo plans afresh. Deleting a subscriber, or its expiry, also withdraws the Business archives that name them. `POST /api/rer/cutover-status` answers Business's signed read of a move (counts and ids only: old addresses, components, incidents and maintenance, held and pending subscribers and invitations sent since a time, records created in Lamp since then, and each alert source's receipts). It is refused without Run Edit Run trust or with a revoked key.

**The status page host answers `/health`.** It returns the same health response as the app host, so Run Edit Run's cutover check can confirm a repointed status hostname serves Lamp. No other page-host path changed.

**rer 0.2.76.** Lamp pins rer 0.2.76 with no local patch to rer. Lamp's archive policy moves, unchanged apart from leaving out the sealed PagerDuty key, into `scripts/installer/archive-policy.mjs`.

**Contract.** CONTRACT.md and ACCEPTANCE.md use US spelling: PAGE-004, PAGE-006, PAGE-007, PAGE-010, PAGE-012, UPTIME-006, UPDATE-005, MAINT-006 and MOVE-006 are recorded as changed for spelling only, meaning unchanged. SETUP-001 and SETUP-002 change for the website-first setup that runs itself (owner decision, 20 October 2026). SUB-009, UPDATE-001 and UPDATE-002 change with UPDATE-013. Clause IDs, Status values, identifiers, paths, URLs and protocol tokens keep their values. Status: 125 clauses done, 31 partial, 42 missing.

Upgrading from 1.9.0: back up first (`node scripts/export.mjs --remote`, or `rer export --target remote --output DIR`, for a hosted installation, and Settings → Export page data), update the checkout to `v1.10.0`, run `pnpm install --frozen-lockfile` (rer 0.2.76) and `rer deploy` with the same environment and input file. Two additive migrations apply on deploy and no input changes; the deploy keeps your signing secrets, subscriber links and operator sessions. If your fork adapted the import door, take Base's door at rer-v0.2.71 and re-apply only your own changes; if it changed Lamp's archive policy, carry that change into `scripts/installer/archive-policy.mjs`.

Migrations: `0041_import_door_archives.sql` adds the Business import door's archive tables (`ik_door_archives`, `ik_door_archive_chunks`). `0042_responder_sources.sql` adds PagerDuty's responder columns to `alert_sources` (`responder_preset`, `responder_sealed_credentials`, `responder_connected`) and the `alert_responder_posts` note records. Both are additive; no existing row changes.

Not in this release: `pnpm run export -- --remote` (shown on the homepage's Ownership panel) is still refused by rer; use `rer export --target remote --output DIR` or `node scripts/export.mjs --remote`. Status badges (PAGE-018) stay partial: the badge endpoints and shields.io rendering passed on a hosted page, but its public root returned HTTP 503 on check and retry. Roles, audience pages, subscriber languages, SMS and measured uptime are not built.

Known issues: with `LAMP_RESOURCE_PREFIX` set, `rer deploy` uploads and passes its smoke check but stops with `owner-state-target-mismatch` before claiming the owner; the default `lamp-<environment>` names are unaffected. A `rer deploy` of an existing installation run without a terminal may stop with "Deploy needs your owner name"; pass `--owner-name "Your name"`. A drafted post-incident report keeps machine timestamps and `[U1]`-style citations until you edit them. Wrangler may print "Network connection lost" during a hosted export or restore that still completes; check the final "Exported" or "Imported" line. On a new hosted installation the public page shows a published update once its snapshot rebuilds, usually within seconds.

Product screenshot: `.github/assets/release/lamp-1.10.0-status-page-1440.png`.

## 1.9.0

**Managed installations build again.** Lamp 1.8.0 and 1.8.1 patched their pinned rer (0.2.63) so the sign-in page offered your identity providers beside the owner entry. Run Edit Run's trusted build checks that `pnpm-lock.yaml` locks the plain rer release (`rer check --profile first-party`, SC-13) and refused the patched lock, so a new Managed installation of 1.8.1 could not be built. Lamp 1.9.0 pins rer 0.2.69, which offers those sign-in choices itself, and carries no rer patch: the `patches/` directory and the `patchedDependencies` entry are gone and the trusted build's checks pass. The sign-in page looks and works as before.

**Deletions in the audit log.** Deleting a component or a component group, one at a time or in a bulk catalogue edit, writes one audit entry naming the operator, in the same write as the deletion; deleting something already gone writes nothing. Settings → Audit log lists each deletion with its actor and time, in its filters and in CSV (TEAM-007). Every operator is an owner until roles ship (TEAM-004), so every operator sees the log.

**Cutover after Statuspage.** After a Statuspage dry run or import, Cutover lists how operating Lamp differs: a published update is never edited in place (publish a correction that names it, with no channels selected when nobody should be notified again); component states change with each update you publish; components set to show only while degraded keep that setting. It also says what Lamp does not take over yet: Statuspage-format webhook bodies and per-component automation email addresses, so keep those pointed at Statuspage or move them to Lamp's signed webhooks and alert intake ([moving in](docs/moving-in.md)). The old `/embed/script.js` tag keeps rendering the floating notice after import.

The contract records MOVE-009, MOVE-011, HIST-007 and TEAM-007 as done; their audience, language, role, rule and token parts now belong to AUD-004, I18N-001, TEAM-004, AUTO-001, API-001, SUB-018, MOVE-010 and INTAKE-013, which are not built. No released guarantee changed.

Upgrading from 1.8.1: back up first (`node scripts/export.mjs --remote` for a hosted installation, and Settings → Export page data), update the checkout to `v1.9.0`, run `pnpm install --frozen-lockfile` (rer 0.2.69) and `rer deploy` with the same environment and input file. No migration applies and no input changes; the deploy keeps your signing secrets, subscriber links and operator sessions. If your fork kept its own copy of the 1.8.x rer patch, drop it.

Migrations: none.

Not in this release: the import door's newer upload reader from Base (per-record credential removal, named source refusals, retained-source replans); Lamp's door and Move in keep the reader 1.8.1 shipped. `pnpm run export -- --remote` (shown on the homepage's Ownership panel) is still refused by rer; the hosted backup command is `node scripts/export.mjs --remote`. Roles, audience pages, subscriber languages, SMS and measured uptime are not built.

Known issues: a `rer deploy` of an existing installation run without a terminal may stop with "Deploy needs your owner name"; pass `--owner-name "Your name"`. A drafted post-incident report keeps machine timestamps and `[U1]`-style citations until you edit them. Wrangler may print "Network connection lost" during a hosted export or restore that still completes; check the final "Exported" or "Imported" line. On a new hosted installation the public page shows a published update once its snapshot rebuilds, usually within seconds.

Product screenshot: `.github/assets/release/lamp-1.7.0-status-page-1440.png` (the public page is unchanged in 1.9.0).

## 1.8.1

**Backup and restore on Run Edit Run Managed hosting.** Lamp 1.8.0 and earlier could not back up, move or restore a Lamp that Run Edit Run Managed installed. Run Edit Run keeps its own record of the migrations it applied in that database (the `rer_migrations` table), and Lamp's technical backup (`node scripts/export.mjs`) copied it as if it were page data, while restore (`node scripts/import.mjs`) refused every new Managed installation as not empty, and could have overwritten the destination's own record. Lamp 1.8.1 treats `rer_migrations` as installation history, by that exact name:

- A backup checks that it lists exactly this release's migration files with their hashes (plus the installation's page setup), refuses if it does not, and never puts it in the archive.
- A restore into a new Managed installation, before its owner signs in, checks the destination's record the same way and writes your data without running migrations or touching that record. A restore into a self-hosted empty database works as before.
- A backup made by 1.8.0 from a Managed installation, which carried that record, restores: the record is checked and left out.
- Any other unknown table, including another `rer_` name, still stops a restore, and a populated destination is still refused.

**Uptime alerts.** Alerts → Connect Uptime takes the signing secret from Uptime's JSON webhook destination and a mapping from each Uptime monitor ID to a Lamp component. A confirmed failure opens one private draft on the mapped component, with the failing vantages, error category and confirmed start time in the incident brief; a request older than five minutes or with a wrong signature is refused, unmapped monitors are listed in Receipts, and recovery is recorded and closes a draft nothing was published from. Nothing reaches the public page until you publish.

**Availability reports.** Each component's page offers its availability for a UTC calendar month or quarter as CSV or PDF, for operators only, computed with the same state history, corrections and maintenance weighting as the public page's uptime. A period still running counts the time elapsed; a future period or one without history says No data.

**Business import door on Managed installations.** When Run Edit Run provisioned the installation, the Business import door opens at the owner's first sign-in instead of waiting to be switched on in Settings. Self-hosted installations keep it off; the owner's choice in Settings stands.

Who was affected: owners on Managed hosting who tried to back up or restore Lamp with the technical archive. Nothing was lost; the refused restore wrote nothing. Self-hosted installations behave as before.

Upgrading from 1.8.0: back up first, update the checkout to `v1.8.1`, run `pnpm install --frozen-lockfile` (rer 0.2.63, unchanged) and `rer deploy` with the same environment and input file. One migration applies:

- `0040_uptime_preset.sql` Uptime preset identification and monitor-to-component mappings on alert sources; existing sources and credentials are unchanged.

There is no configuration change.

Product screenshot: `.github/assets/release/lamp-1.7.0-status-page-1440.png` (the public page is unchanged in 1.8.1).

## 1.8.0

**Privacy fix: take this release if you moved in from Statuspage.** Lamp 1.3.0 to 1.7.1 did not read a Statuspage page's visibility. A page that was private (viewers must be team members), IP-restricted or audience-specific was imported like a public one, so its components, incident and maintenance history and subscribers appeared on Lamp's public page, feeds, widget and public APIs. Lamp 1.8.0 reads the page record and its page-access groups first (the API-key path fetches them; saved responses must include `page.json` and `page-access-groups.json`) and refuses any private, restricted, audience-specific or unreadable page before writing anything. Who was affected: owners who imported a Statuspage page whose access was restricted. What to check: in Statuspage, open the imported page's access settings; if it required sign-in, had IP restrictions or audience-specific access, review Lamp's public page and history, and undo the import (Settings → Move in) or delete what should not be public. Better Stack, Instatus and Sorry already refused restricted sources. Lamp cannot yet import a private page as a private page.

What you get:

- **Grouped alerts from Prometheus Alertmanager and Grafana Alerting.** Alerts → Connect Alertmanager or Grafana takes each tool's documented webhook (Alertmanager version 4, Grafana version 1) with a bearer token shown once, maps alerts to components by exact label rules, and opens one private draft per alert group. Repeats are deduplicated per alert fingerprint, alerts no rule maps are listed in Receipts, and the draft closes only when every alert in the group has recovered and nothing was published.
- **Recovery check before you resolve.** Resolving shows which linked alerts have recovered and lists, by name, what Lamp does not track (vendor dependencies, traffic, support tickets, continuous monitor samples). A reported recovery is held for five minutes; an override is recorded privately in the audit log.
- **Post-incident report drafted from the record.** On a resolved incident, **Draft report** writes the summary and timeline from published updates and held alerts, each line citing its source, and leaves cause and remediation empty for a person to write; publishing is refused until they are. Drafting never replaces edits you made.
- **Component states change with the update.** The composer stages state changes, new components and releases in the draft; the published update changes them in one step and shows each change on the public page and in mail. Resolving releases every claim.
- **Incident impact set by the operator**, independent of component claims, with its history; public pages, APIs and notifications use it.
- **Wording checks** flag unclear or long update text against six rules and your saved terms; they never block publishing.
- **Communication and reach** on each incident: committed, accepted, delivered, bounced and failed sends per channel, promises kept and time to first update, with CSV. Counts describe delivery, never reading.
- **Subscriber reporting** in Subscribers: current counts by channel, state and component, deactivation reasons and anonymous daily growth from the day tracking starts, with matching CSV.
- **Audit log** in Settings with actor, action and date filters, pagination and CSV; erased operators keep only an anonymised reference.
- **Notification email branding** in Settings with saved previews; messages already queued keep their content.
- **Component catalogues**: edit several components at once with public descriptions, and show a component only while it is affected. Public history is complete and browsable.
- **The operator desk works on a phone**, from sign-in through alert draft, publishing and resolution.
- **Identity providers** you configured are offered beside Lamp's owner entry on the sign-in page.
- **One import path.** Move in now runs every import through the import door that Business uses: the owner's dry run uploads the saved responses to `/api/operator/import/*` and shows the door's plan, **Import** applies exactly the reviewed fingerprint, and Undo and Continue go through the door. The screen looks and reads as before. The old `/api/app/statuspage-import/preview` and `/apply` routes are gone; a key or public page is read into saved responses by `POST /api/app/statuspage-import/fetch`. Imports made before keep their read, Continue and Undo. **Your imports** lists the owner's imports ("approved by") with Business imports ("approved via Business by"). The Sorry preview-only `previewNoticeLimit` sample is gone with the preview route.
- **A dry run imports for 30 minutes, as before.** Through the door, an older dry run answers "This dry run has expired. Run the dry run again." and a new dry run plans the page at the current time, so a maintenance window that ended in between imports as completed. Business plans are bounded the same way.
- **Business imports take every Move in source**: Better Stack and Instatus join Statuspage and Sorry on the door's one allow-list.
- **Deleting a subscriber erases them from import custody**, and so does the expiry of an unconfirmed or held subscriber: their imported records become erased entries and the door's retained uploads and plan snapshots are withdrawn, in the same transaction as the deletion. An export that still holds an erased subscriber is refused instead of failing at apply.
- **The public page answers 503 until the owner sets up the installation**, as its page readiness declaration (`pendingSetupStatuses`) says, so a hosted first publish verifies while `/setup/status` is 409. A page the deployment already published from its stored settings keeps its body, with `Cache-Control: no-store`; after setup it answers 200.
- **`/health` answers from its last good dependency check** in milliseconds, refreshing it in the background once it is 30 seconds old and checking every dependency itself once it is 10 minutes old. A failure is never remembered, so a broken database, R2 or Queue shows within one refresh period and recovery shows at once. The external heartbeat still runs a live check before every ping.
- **A page data restore keeps double opt-in.** An export now carries an integrity value keyed by the installation's `SUBSCRIBER_TOKEN_SECRET`, which never leaves it. Email subscribers keep their state only when the restoring installation can check that value: an unchanged file from the same installation, or from a recovery given its signing secrets. Otherwise (a hand-edited file, one from another installation, or one from 1.7.0 or earlier) subscribed and pending email subscribers are held. **Check file** says how many before anything is written; held subscribers receive nothing until **Send confirmation emails** sends each one confirmation, and are deleted 30 days after the restore if never sent one. The same rule applies hosted and on Managed hosting.
- A restore checks that the page is empty inside its own transaction, so a record added while it runs stops it with nothing written, and a refused restore no longer leaves its logo in storage.
- **Check file** counts scheduled updates and upcoming or running maintenance, which carry on as scheduled after a restore; the card and docs no longer say a restore never leads to mail.
- Moving between incidents while the operator app's loader is still reloading shows that incident's current record, never what an earlier visit loaded.
- `rer deploy --rotate-secret` errors name `--rotate-secret`, not `LAMP_REPLACE_SECRETS`. A deploy whose input file sets `OIDC_TRANSACTION_SECRET` while the Worker keeps its own says so, and the sign-in guide gives the one-time `--rotate-secret OIDC_TRANSACTION_SECRET` step for a page first deployed by 1.6.0 or earlier.
- Undoing a Sorry import after its held subscribers expired reports them as expired and deleted, not as kept. A scheduled run that fails in several steps reports every failure.

Upgrading from 1.7.x: back up first, with `node scripts/export.mjs --remote` for a hosted installation and Settings → Export page data. Then update the checkout to `v1.8.0`, run `pnpm install --frozen-lockfile` (rer 0.2.63) and `rer deploy` with the same environment and input file. These migrations apply in order and keep existing data:

- `0027_update_component_changes.sql` staged component changes in drafts and their published snapshots.
- `0028_wording_checks.sql` wording-check settings with defaults.
- `0029_component_catalogue.sql` conditional component visibility and optional uptime start dates.
- `0030_imported_templates.sql` imported template titles, folders and notification defaults.
- `0031_incident_impact.sql` operator-set incident impact and its history.
- `0032_email_branding.sql` notification email branding.
- `0033_audit_log.sql` audit filtering indexes; copies retained component state history into the audit log.
- `0034_subscriber_reporting.sql` anonymous daily subscriber counts from an explicit baseline.
- `0035_grouped_alerts.sql` label mappings and per-alert fingerprints for grouped alerts.
- `0036_business_import_door.sql` the import door's upload, plan and approval custody, off until enabled in Settings.
- `0037_import_custody_replace.sql` triggers that keep import custody from being dropped or reused.
- `0038_import_door_apply_failures.sql` rebuilds the door's plan tables keeping every plan and approval, and records a failed apply. Apply it as one batch.
- `0039_import_door_scopes.sql` binds each door namespace to Lamp's import destination for erasure. Until 0038 and 0039 are applied, Move in answers 503 `import_door_schema_outdated`.

Not in this release: private and audience pages (AUD-001 to AUD-005), so a private Statuspage page is refused rather than imported privately; SMS; measured uptime and monitor-driven component states (Lamp still reports what operators, alerts and maintenance say). The homepage's Ownership panel shows `pnpm run setup`, `pnpm run deploy` and `pnpm run export -- --remote`; the hosted backup command is `node scripts/export.mjs --remote` (docs/backups-and-recovery.md), because `rer export` saves only a local copy. Signed webhooks, Slack and Teams posts, custom domains and serving a stale page through a database outage are proven by the verifier's tests, not by this release's hosted check.

Known issues: with rer 0.2.63, a `rer deploy` run without a terminal stops with "Deploy needs your owner name" the first time an existing installation redeploys; pass `--owner-name "Your name"` (a terminal asks for it). A drafted post-incident report keeps machine timestamps and `[U1]`-style citations in its summary and timeline until you edit them, and they are published as written. Wrangler may print "Network connection lost" during a hosted export or restore that still completes; check the final "Exported" or "Imported" line.

## 1.7.1

Description only; no product change. The catalogue description became "Keep customers informed with a status page and clear incident updates." The application, contract, migrations and configuration are identical to 1.7.0.

## 1.7.0

- **Feeds, public APIs, badges and embeds.** The public page serves `/feed.rss` beside `/feed.atom`, `/history.atom` and `/history.rss` on every installation, and per-component Atom and RSS feeds and status and uptime badges under `/components/<id>/`, addressed by immutable ID so they survive renaming. `/badge.svg` and `/badge.json` (Shields endpoint) give the page's state. Statuspage's public API answers at `/api/v2/` (summary, status, components, incidents and scheduled maintenances, keeping imported Statuspage IDs where the import journal retained them), and a native paginated API at `/api/public/v1/`. Every one reads only the published snapshot: internal components, operator names, notes and subscriber data are excluded. Settings → Public resources and embeds builds a banner, floating incident notice or status-dot embed (`/embed/script.js`) for your listed widget origins. docs/public-resources.md describes them.
- **Export page data from the app.** Settings → Export page data downloads everything the status page holds as one JSON file (`lamp-page-data`, version 1): page settings and logo, component groups and components with their status history, incidents with updates, drafts, internal notes and post-incident reports, maintenance with notices, subscribers with channel, components and consent state, and reference numbers. The card says what is in it and what is left out. Restore page data takes that file on a new installation (local or hosted) with a check first and an all-or-nothing restore; downloading again gives back the same file. docs/backups-and-recovery.md documents the format.
- **Hosted backups and restores need only Node, git and rer.** `node scripts/export.mjs --remote`, `node scripts/setup.mjs --restore-from` and `node scripts/import.mjs` read the deployment's private input file with `--env-file` and run the checkout's own Wrangler, so no global pnpm is needed. Backups and recovery, Update Lamp (its pre-update backup) and OPERATIONS.md give these commands instead of `pnpm run export:cloudflare`.
- **Deploy to Cloudflare is one guided page.** It asks for each input in plain words in the order the dry run lists missing ones, including the Cloudflare token's permissions, the workers.dev addresses, and how to authenticate a sending domain at SendGrid or Resend (or use Managed hosting, where Run Edit Run provides mail). `rer deploy --dry-run` lists exactly the missing inputs by name with the step that explains each, and names the Cloudflare inputs the real deploy also needs.
- `deploy.json` declares `publicSettings` `LAMP_APP_HOST` and `LAMP_PAGE_HOST`, so `rer deploy` prints the sign-in address, and `deployGuide` names the deploy page. Removal says which Worker it is removing while it works.
- Local development no longer answers `/__dev/outbox`: there is no local outbox or notice address.
- The docs name the pinned `@runeditrun/rer` 0.2.42.
- A redeploy keeps `OIDC_TRANSACTION_SECRET` as it keeps the other link and session secrets, so an identity-provider sign-in in progress survives it, and a deploy without it no longer blanks it. `rer deploy --rotate-secret NAME` now replaces a secret on purpose, as `LAMP_REPLACE_SECRETS` does. OPERATIONS.md describes both.
- Sorry subscribers held for cutover are deleted with their addresses 30 days after the import's review time if the owner neither releases them nor undoes the import. Cutover shows the **Release by** date.
- The AI provider and identity provider guides name `rer dev --stop` and `rer dev`. A local operator invitation says no email was sent because local mail is suppressed. **Confirm my identity** says it keeps you signed in and how confirmation works.
- README names the latest release tag, how to start it, and which `rer` version a checkout runs.
- Pins `@runeditrun/rer` 0.2.38: generated deployment secrets are kept in `.rer/deploy/<environment>.secrets.env` and reused, and deploy hooks build without local settings files.
- A page data file names a draft's reviewer by email (`reviewed_by_email`), as it names authors, so a page holding a reviewed, unpublished draft restores instead of being refused.
- This checkout pins rer **0.2.42**.
- Product screenshot: `.github/assets/release/lamp-1.7.0-status-page-1440.png` (a business's public status page at 1440 pixels: grouped components with 90-day uptime, an incident in progress with its latest update, and the subscribe form).

Upgrading: back up data and owner source. This release adds no migration. Run `pnpm install --frozen-lockfile` for the rer 0.2.42 pin. Sorry subscribers still held for cutover more than 30 days after their reviewed dry run are deleted with their addresses by the first scheduled run after the update: release or undo them first if you mean to keep them. Hosted backups and restores now use `node scripts/export.mjs --remote` and `node scripts/setup.mjs --restore-from` with `--env-file` (docs/backups-and-recovery.md). Installations on 1.5.1 or earlier follow the earlier notes below first.

## 1.6.0

- A redeploy never replaces the secrets behind existing links and sessions: each Worker keeps the `SESSION_SECRET`, `SUBSCRIBER_TOKEN_SECRET` and `WEBHOOK_SIGNING_SECRET` it holds, so emailed Manage, Unsubscribe and one-click links keep working and operators stay signed in. `LAMP_REPLACE_SECRETS=NAME` replaces one on purpose. The deploy guide's secret step needs only `od` and `tr`, not Node.
- Subscribers can choose components on the subscribe form, and the subscribe form and management page keep exactly the boxes ticked (only the last one was kept before).
- Unsubscribing restores the address's confirmation allowance, so re-subscribing sends a fresh confirmation. Deliveries lists confirmation and other subscription emails, and labels incident rows with their reference, title and status.
- A resolution email's subject starts with "Resolved:". AI suggestions fill "Who is affected" and "What is the impact" in customer words, without brief refs, IDs or machine timestamps.
- Identity provider settings walk through Okta and a Run Edit Run Auth link on the page, and say plainly why Microsoft Entra cannot be finished there. Sorry move-in finds your pages from a token. The UptimeRobot preset shows the JSON body to configure, and a new preset is listed at once.
- A build never writes `.dev.vars` or another local settings file into `dist`, and the build refuses output that holds one.
- The Run page shows Base's standard two lines (rer 0.2.35 and later): install `rer`, then `rer dev just-every/run-lamp`.
- Move-in keeps its source selector disabled until hydration so early selections cannot leave the displayed provider and import state out of sync. Verification hands local sign-in database state between Wrangler and its assertion proxy, and aggregates attempt-specific shard results without stale artifact overwrites.
- Storage verification keeps its kernel-assigned HTTP sockets bound through Vite/workerd startup, preventing port collisions without retrying or changing application assertions.
- Post-incident reports can be saved, edited after reload, and published from the incident editor. Saving sends only the four editable report fields; publication metadata remains managed by the server.
- Managed hosting includes RER mail without an owner provider account or mail key. RER supplies `MAIL_PROVIDER=rer`, `MAIL_FROM`, `MAIL_RELAY_URL` and private `MAIL_API_KEY`; ordinary hosting retains Resend and SendGrid.
- Adopt Base's relay adapter with one-click unsubscribe, list identity and incident threads rooted in the relay's returned Message-ID.
- Native deploy and hosted proof select the provider’s own mail declaration after deployment environment inputs are loaded, preserving direct provider credentials alongside Managed mail.
- Operations declares mail dispatch as a Worker loop and validates conditional provider credentials in Lamp’s configuration module, retaining compatibility with the pinned CLI.
- Managed relay acceptance is shown as **Accepted by RER** in Deliveries. Migration `0026_managed_mail_threads.sql` adds the durable message-key index; apply it before restarting. The publication preview uses a clean frame without an email-pattern finding.
- Lamp moves in from Sorry: authenticated saved/API reads or keyless public JSON, with held subscribers released only by the owner after hostname cutover (migration `0025_sorry_import_release.sql`).
- This checkout pins rer **0.2.36**.
- Product screenshot: `.github/assets/release/lamp-1.6.0-status-page-1440.png` (a business's public status page at 1440 pixels: grouped components with 90-day uptime, a resolved incident and the subscribe form's component choice).

Upgrading: back up data and owner source, then apply `0025_sorry_import_release.sql` and `0026_managed_mail_threads.sql` before starting this revision; both are additive. Run `pnpm install --frozen-lockfile` for the rer 0.2.36 pin. Redeploys keep the secrets behind existing links and sessions; use `LAMP_REPLACE_SECRETS` only to rotate one on purpose. Installations on 1.5.0 or earlier follow the earlier notes below first.

## 1.5.1

- Mark synthetic credentials and documentation placeholders so hosted source admission accepts the fixtures. Application behaviour, the contract, migrations and stored data are unchanged from 1.5.0.
- This checkout pins rer **0.2.24**, with every Base copy refreshed from that release and the demo imported from the package. Lamp's SendGrid and Resend mail paths are unchanged.
- Product screenshot: `.github/assets/release/lamp-1.5.1-status-page-1440.png` (a business's public status page at 1440 pixels: components with 90-day uptime, scheduled maintenance and a resolved incident).

Upgrading: no migration. Back up as usual, update the source, run `pnpm install --frozen-lockfile` and restart. Installations on 1.4.0 follow the 1.5.0 notes below first.

## 1.5.0

- Attaching or detaching a component on a live incident asks for confirmation before changing the public page. Attaching queues the latest published update for eligible subscribers who follow that component and have not already been notified about the incident; the confirmation shows the current count. Detaching sends no email. Internal components are excluded from the attach picker.
- Maintenance already in progress can be extended without starting a new window.
- Deliveries shows **Accepted by SendGrid** or **Accepted by Resend** when the provider accepted a message and signed delivery receipts are not configured. CSV includes `providerAcceptedAt`; acceptance does not establish inbox delivery. Local pages explain that mail is suppressed.
- Sender authentication checks read every provider page. NOTIFY-010 accepts aligned DKIM with DMARC without requiring SPF on the visible From domain. Local checks explain suppression and leave sender verification incomplete.
- The initial operator is labelled **Owner**, and an owner claimed at deployment can enter from the Lobby before completing page setup.
- Subscriber mail subjects and confirmation, management and unsubscribe pages use the configured page name. Subscribers asks for confirmation before removing a destination. Owners must monitor the From mailbox and process emailed unsubscribe requests in Subscribers; HTTPS one-click unsubscribe remains automatic.
- `rer signin` supports one-use hosted owner entry. Migration `0023_owner_signin.sql` adds its installation-local grants table; grants are excluded from exports.
- The development mail viewer and `rer outbox` have been removed. Local mail is neither sent nor retained; use a hosted installation to check actual mail delivery. Custom `mail.sender.v1` adapters must handle `suppressed` in place of the development-only `captured` disposition.
- This checkout pins rer **0.2.22**, with all Base copies refreshed from that release; the former local production-auth diagnostic patch is no longer carried. The public installer may install a newer CLI; the checkout's pin selects its runtime. Local setup repairs obsolete `AUTH_ORIGIN` values when moving ports.
- The standalone browser installer starts the managed development runtime so its one-click owner entry works.
- The previous-tag upgrade gate now starts from v1.4.0 and explicitly sends imported invitations. Release tags and nightly CI run the upgrade, installer and README clone journeys.

Upgrading: back up data and owner source, then apply `0023_owner_signin.sql` after `0022_import_maintenance_updates.sql`, followed by `0024_import_kit_custody_upgrade.sql`, before starting this revision. Migration 0024 adds Base import-kit custody tables and triggers; local archives keep that installation-specific custody out of portable product data. Run `rer verify` and `pnpm run verify:release` before adoption. Hosted APIs and stored application data remain compatible. After stopping local dev, old installations may still hold captured mail under the obsolete `lamp-local-development-outbox` R2 bucket and its separate development-outbox D1 store in `.wrangler/state`. Delete only those obsolete outbox stores after backing up; keep the `lamp-local` application database and `lamp-local-snapshots` bucket. The new runtime never reads the old mail.

## 1.4.0

- Move-in now supports Statuspage, Better Stack and Instatus through their fixed-origin APIs or saved responses. Cutover preview shows the old and native addresses, feed behavior, unavailable paths, unsupported consumers and invitation deadlines; each Opens check follows a credentialless redirect and checks the resulting page, without claiming DNS or inbox delivery.
- Imported email subscribers receive no invitation during preview, apply, resume or Cutover checks. Only the owner's explicit Send invitations action can claim an eligible subscriber; expiry stays fixed at the import review time, expired subscribers cannot be invited, and uncertain claimed sends are not retried automatically.
- Better Stack maintenance messages remain historical updates in the imported maintenance timeline. They do not create native lifecycle notices or replay notifications; migration 0022 adds the history table and refreshes public snapshots when those records change.
- Public snapshots validate the current generation on reuse and cache immutable artifact bytes under that generation. A warmed cache cannot return an earlier generation on a healthy request; published changes stay within the ten-second public freshness bound, while retained responses cover origin errors for one hour.
- The seed's public-read figure (publicPageRequestsPerSecond, the PAGE-008 per-address rate) is now 10/s, a local measurement rather than a hosted capacity: one Miniflare workerd process on a shared runner, driven in-process at an offered 10/s for 30 seconds, uncompressed and with no CDN, returned 300/300 HTTP 200 in each of four fresh runs (two full-page, two mixed-route). It is a local floor, not a ceiling. The previous 5,000/s figure was never measured; a 5,000/s attempt failed with loopback connection resets in the load client, which says nothing about the Worker. On Cloudflare every public read still runs the Worker against the R2 current pointer and edge-cached generation bytes, and that capacity has not been measured. How public reads are served did not change, and no rate limiter was added.
- The populated local fixture rendered 200 components across 25 groups, all 25 open-incident titles, and a 200-update public incident timeline. These are representative record counts; arbitrary text and worst-case history or artifact sizes remain unqualified. A local authenticated publish/native scheduled-trigger run persisted 1,000 unique fake-provider acceptances (p95 185.474 seconds, last acceptance 191.362 seconds including 64.488 seconds waiting for the trigger). This does not qualify a live provider account, quota, latency or recipient delivery. Paced intake evidence covers 120 signed requests with durable draft records and HTTP 202 receipts while public status stayed unchanged.
- Scheduled publication (UPDATE-006) and automatic maintenance transitions (MAINT-002) now promise 240 seconds instead of 60. The bound comes from one local stress run, not a hosted guarantee: on a single native workerd process on a shared runner (1-minute load 44.85 at admission), 20 scheduled updates and 20 maintenance starts fell due in the same cron minute, with 200 components, 25 groups, 25 open incidents of 200 updates each and 1,000 subscribers. The Worker processed them one at a time and answered no request for about three minutes. The latest due-update publication became visible 238.5 seconds after its publish time, the latest maintenance start after 236.6 seconds and the latest completion after 178.6 seconds. Each family's 20 samples come from one cron tick and one response, so together they are one observation, not a p95 over independent runs. In a separate direct-invocation run, a single due update published within 13.1 seconds of its tick and a single maintenance start or end within 48.0 seconds. More items due in one minute take longer, Cloudflare Cron timing is unmeasured, and no scheduler fix was made.
- Optional AI suggestions now use an 18-second provider transport budget, reserving two seconds inside the existing 20-second visible error contract. This is an implementation budget; provider timing remains unmeasured.
- The public status-page header now links Sign in to the operator host. Owner documentation has been expanded and reorganized into task guides at the existing app-host /docs route and its /docs/<slug> pages.
- Cloudflare deploy guidance now distinguishes deployment health from full source and browser verification. `rer deploy --dry-run` validates and builds without contacting Cloudflare; a real deploy validates inputs, provisions resources, applies migrations, builds and uploads the Worker with secrets, then checks application health. Run `rer verify` separately, and record hosted readiness and provider delivery for each installation.
- Local backup and restore guidance now uses the canonical RUN-LOCALLY.md sequence: stop the server, export before reset, import only into an empty destination, and restore with the original owner. Deployed archives remain documented in OPERATIONS.md.
- Dependency updates address the reviewed security advisories: Playwright and its test package move to [1.55.1](https://github.com/microsoft/playwright/releases/tag/v1.55.1); the lock and overrides update transitive Sharp to [0.35.5](https://github.com/lovell/sharp/releases/tag/v0.35.5), including its native libraries, Undici to [7.29.1](https://github.com/nodejs/undici/releases/tag/v7.29.1) and source-map-js to [1.2.2](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2). The RER CLI is also pinned to 0.2.1.

Upgrading: back up data and owner source, then apply `0022_import_maintenance_updates.sql` after `0021_update_reminders.sql` before starting this revision. Run `rer verify` and `pnpm run verify:release` before adoption. The release check upgrades a populated installation from the previous published tag and verifies its data, owner access, publication and archive restore.


## 1.3.0

- The operator app wears the landing's style: its paper, green-black ink, the
  self-hosted Inter face and mark 18; ink pills, white plates and dot chips.
  Amber marks only live work (an overdue incident, the open composer and new
  incident panel). The lit lamp hangs over sign-in, first-run setup, the empty
  overview and a page that could not load. At 390 pixels the sections are one
  scrolling row of tabs, the current one kept in view. Labels, routes and
  behaviour are unchanged.
- Settings → Move in from Statuspage: a dry run first, then components, groups, incident history at its original times, maintenance and email subscribers; nobody is notified about history, each subscriber gets one invitation to confirm, a second run changes nothing, and undo keeps what changed since. Guide: docs/moving-in.md.
- Settings → Slack and Teams: channels follow chosen components and receive each published update once when "Slack and Teams" is selected for it; webhook URLs are stored encrypted and never shown again.
- Alerts → Connect a monitoring tool: Datadog, UptimeRobot, Better Stack and Pingdom presets read each tool's own alert, draft an incident on the mapped component, and close a never-published draft on recovery.
- The browser installer wears Lamp's own look (paper, ink, the lamp mark and Inter) through Base's theme hook: public/rer-theme.css, also linked by sign-in and first-run setup.
- Every Base copy is on Base 3d643dd; Lamp no longer carries Base's own tests.
- RER-managed and independent delivery builds use trusted-build bf7a25a.
- The landing page says what Lamp replaces, as the hero's closing line, under the two actions (the hero's proof row of three short facts is gone), with the three names in bold, and in its description: "100% free, open source alternative to Atlassian Statuspage, Instatus and Better Stack"; seed.json `replaces` names the same three.
- Local development: rer dev's scheduled triggers reach the runtime, rer preview starts, and a development server without mail capture says how to start the outbox.
- Docs at `/docs` on the app host, in the landing page's look, cut at build time from the repository's own Markdown (README, RUN-LOCALLY, OPERATIONS, the move-in guide and this changelog) as `docs/site.json` lists; the landing page's Docs links lead there.

Upgrading: apply migrations 0017 and 0018 after 0016.

## 1.2.0

For a new operator:
- A first-run page at `/setup` names the page, its tagline, time zone and colour; the Overview then shows an eight-step setup checklist built from saved server state, each open step linking to the screen that completes it.
- The composer opens a fresh empty draft for each next update, with lifecycle prompts; the published wording never reappears, and drafts autosave per incident and next update.
- Plain words in the operator app: Set status, Status history, move up and down.
- Every time shows in the page's configured time zone, with its label; a next-update time more than 24 hours ahead warns.
- At 390 pixels Preview comes before Publish, and the operator navigation wraps.
- `pnpm signin-link --email <operator>` issues one ordinary single-use sign-in link from the terminal, printed once and audited.
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
