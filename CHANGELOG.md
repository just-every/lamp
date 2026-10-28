# Changelog

## 1.11.0 (unreleased)

**Slack and Teams incident desk.** Signed chat actions can open a private draft, stage component states, use the common preview and explicitly publish as a linked operator. One-time identity linking expires after ten minutes. Settings → Slack and Teams exposes code creation and link removal. Native archives retain durable links and exclude pending codes, previews and request receipts; no transfer expiry wait is needed. Live workspace installation has not been checked.

Maintenance reschedule notices now bind their retained recipient IDs before the channel filter, preserving the original recipient set across a changed window.

**Statuspage-format webhooks (SUB-018, partial).** Webhook subscriptions choose Lamp (the default) or Statuspage through the operator doors and recipient management link. One shared mapper supplies public API and webhook statuses, stable IDs, incident history and maintenance notice fields. Both formats retain the same exact-body signature scheme; update text remains plain and unchanged. Standalone component-change notifications, imported webhook subscriptions and MAINT-009's future in-window updates remain with their carriers. The current public subscribe form is email-only; new webhook endpoints choose their format through the operator and CSV doors, and recipients can change it through their management link. SUB-018 stays partial pending the public-door ruling.

**Subscriber import and export (SUB-017).** Operators can dry-run a bounded CSV without writing or sending mail, create pending email and webhook subscriptions, and export subscription state, component selection and recorded consent. An owner explicitly sends each imported confirmation invitation at most once. Add subscriber sends one confirmation and records the adding operator privately in the directory and audit log. SMS, additional languages and per-channel limit enforcement remain with SUB-013, I18N-001 and SUB-020.

Report follow-up preserves MOVE-002 silence across upgrade: retroactive-only imported incidents do not enqueue automatic report reminders. Their owed report remains visible, and a live published update enables the ordinary reminder carrier.

**Follow-ups (AUTO-003, partial).** Overview brings the existing incident, publication, maintenance, report, invitation and notification obligations into one private list with owners, due times, stop conditions and failures. Reasoned dismissals are audited and apply only to the current occurrence, so later failures return. Operators can explicitly retry an unfinished notification dispatch through the queue; a rejected handoff remains a visible failure. Vendor-feed, secondary-origin and SMS-cap entries remain with their unbuilt carriers.

Status badges now use the public page’s amber for Partially unavailable, retaining their labels, 2KB SVG limit and generation caching. Existing public-door journeys cover all states and database-free reads (PAGE-018).

**Maintenance automation per window (MAINT-009, partial).** A window can turn auto-start or auto-complete off; both default on and existing windows retain their behavior. An opted-out start stays Scheduled and sends one operator start-due email until an operator starts it. An opted-out completion stays In progress, keeps its original end and overrun label, raises one overrun alert after fifteen minutes, and sends no Completed notice until an operator completes it. Date-only rescheduling preserves off switches. This slice adds no changed entry for MAINT-001, MAINT-002, MAINT-004 or MAINT-005: their existing-window behavior is unchanged. The remaining MAINT-009 wording, in-window updates, Verifying, import mapping, public API and automation doors, page-wide defaults and operator push remain unbuilt.

**Accessibility reporting (PAGE-020, partial).** This release includes a VPAT® 2.5 Rev 508 report at `/docs/accessibility/vpat` on the app host. The release validator requires its version and Section 508/WCAG conformance tables. The report distinguishes measured browser journeys from unmeasured criteria and surfaces; private pages remain with AUD-002. The public-footer link awaits the owner UI pass.

**The next-update promise (AGENT-002).** Within the update-due lead, Lamp prepares one private “Still working on it” draft when no saved draft exists. Preparation uses the existing brief without a model: it restates the latest published impact and cites newer accepted evidence, or says that nothing has changed. A private composer panel keeps the complete cited evidence. The owner’s due email links to that draft; unowned incidents retain the all-operator reminder rule. Preparation never publishes, replaces an operator draft, changes the promised time or queues subscriber notices. An unpublished draft leaves the commitment overdue.

**Report follow-up (AUTO-004, partial).** Owed reports remind the communication owner by email on the due day and once each following week; an unowned report reminds every active operator. Publishing a report or waiving it with a reason stops reminders. Waivers are recorded atomically in the audit log, remove the report from the owing list and still allow a report to be written later. Operator-chat reminders remain with NOTIFY-016.

**Named incident communication (INCIDENT-011, partial).** An unresolved incident starts with its opener as communication owner. Operators can take over or reassign it to another active operator, with an atomic audit entry. Due and overdue emails go to that owner; an unowned incident is flagged on Overview and reminds every active operator. Ten minutes after the original commitment, one escalation reaches every active operator (all have publish rights until TEAM-004). Ownership is private and cannot be changed on a resolved incident. Push, operator chat and Oncall responder delivery remain with MOBILE-002, NOTIFY-016 and INTAKE-012.

**Built-in page layouts.** Settings → Page can publish one of three layouts without AI, each laid out after the owner's L9 studies: Calm headline (one sentence, then components and history in hairline columns), Uptime-history-led (the overall uptime over one 90-day heatmap with incident callouts) and Regions map (a dotted world with a labelled pin per region, region filters and a components table). Default keeps the existing page and its stylesheet and script byte for byte; a layout publishes its own. Components take an optional region in the component editor. Regions map needs public components in at least two regions; until then the public page shows Calm headline and Settings says why.

**Maintenance calendar and defaults.** The public footer links to the retained `/maintenance.ics` calendar and the Accessibility (VPAT) report. Calendar events retain their UID through rescheduling, raise SEQUENCE and mark cancellations. Settings → Writing has Maintenance automation defaults, initially both on; new windows inherit them and existing windows keep their choices. Maintenance wording and in-window updates remain partial under MAINT-009.

Migrations: `0043_page_templates.sql` adds the saved page layout (`page_settings.template`, `default` for every existing page) and an optional `components.region`; `0044_widget_appearance.sql` adds the saved embed tag choices (`page_settings.widget_appearance`, the original embed defaults for every existing page). `0045_incident_communication_owner.sql` adds private communication-owner assignments and extends the reminder kinds with escalation while preserving every existing reminder. Existing incidents default to their opener. `0046_report_followups.sql` adds private report waiver and weekly reminder records. `0047_agent_promise_drafts.sql` adds sidecar-only private draft attribution and retained per-commitment preparation receipts; every existing draft stays unchanged. `0048_maintenance_automation.sql` adds the window-owned automation sidecar; absent rows preserve both original on defaults. `0049_follow_up_dismissals.sql` adds private reasoned Follow-ups dismissals by exact obligation occurrence. `0050_detached_component_visibility.sql` keeps the retained incident and maintenance attachments of a deleted internal component private. `0052_chat_desk_links.sql` adds private chat links, expiring link and preview authority, and replay receipts without changing existing data. `0053_subscriber_intake.sql` adds native subscriber attribution and invitation receipts. `0054_subscriber_webhook_formats.sql` adds the checked webhook format with Lamp as the existing default. `0055_maintenance_automation_defaults.sql` adds page-level automation defaults, initially both on, without changing existing windows.

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

## Contract editorial rewrite — 28 October 2026

The contract adopts one source, capability parts, Base citations and company-policy agent classes. Statuses carry or are demoted for unasserted outcomes; this entry claims no new acceptance proof.


## Public contract rewrite source notes (28 October 2026)

### DOCS-001

The app host serves `/docs` and each published `/docs/<slug>` page as public documentation built from repository Markdown selected by `docs/site.json`. Documentation is available without an operator session; the public page host does not serve it.

Original Evidence cell: `tests/e2e/start-runtime.test.mjs`


### PAGE-001

`GET /` on the status page host returns, in one response: the overall status; every visible component with its current state and note; every unresolved incident with its 5 most recent published updates, newest first, and a link to that incident's page carrying all of them; every maintenance that is in progress and every scheduled maintenance starting within 14 days; and each visible component's uptime figure and daily record for the reporting window.

Original Evidence cell: `tests/e2e/app-api.test.mjs`


### PAGE-002

The complete content of PAGE-001, and the subscribe form of SUB-001, are present and usable in the initial HTML response. With JavaScript disabled, every status, update, and timestamp is rendered and readable and the subscribe form submits. Script preserves the page’s configured time zone and its visible label; operator entry, timelines, previews and public timestamps use that same zone.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### PAGE-003

At the component limit in `seed.json → limits`, the public page's initial HTML response is at most 50KB gzipped, and the page issues at most 4 further requests — stylesheet, font, logo, script — all to its own origin.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### PAGE-004

*Policy: `page.status-rollup.v1`; default: the overall status is the most severe current state among visible components, under the order in COMP-001.* It is shown as one labeled state at the top of the page. With every visible component Operational and no unresolved incident, that label reads as operational.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### PAGE-005

Every change to the content in PAGE-001 writes a complete rendered snapshot of the public page, the Atom feed, and the widget payload to object storage. Serving those three surfaces reads the snapshot and issues no database query. A snapshot write that fails is retried until it succeeds and is reported as a failed job under BASE-OPS-004; the previous snapshot keeps serving until it does.

Original Evidence cell: `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/snapshot-retained.test.mjs`


### PAGE-006

When the database, the queue, or object storage is unreachable, the three surfaces in PAGE-005 return 200 — from the current snapshot, or from the cached response under the `stale-if-error` directive of PAGE-007 when the origin itself cannot answer. They return 503 only when no snapshot has ever been written. A response that could not be built from current data states the instant its content was generated and is labeled as the last known state; no failed read ever produces the all-clear of PAGE-004. `/health` still reports 503 per BASE-OPS-001; the public page's availability does not depend on it.

Original Evidence cell: `tests/e2e/app-api.test.mjs`, `tests/e2e/public-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`


### PAGE-007

Stable public URLs validate the current snapshot generation on reuse with a generation ETag and `Cache-Control: public, max-age=0, stale-if-error=3600`. Immutable artifact bytes are cached by generation and artifact key; advancing the published generation makes previous cache entries ineligible for a healthy current response. An update, component state change, or maintenance transition is readable on the status page, history, incident and maintenance permalinks, Atom feed, widget and public JSON within 10 seconds of the request that caused it returning 200. An unreachable origin may use its retained response for the one-hour error window; the application also retains labeled last-known snapshots under PAGE-006.

Original Evidence cell: `tests/e2e/app-api.test.mjs`, `tests/e2e/public-contract.test.mjs`, `tests/e2e/snapshot-retained.test.mjs`


### PAGE-008

The public read paths marked `read` in `seed.json → deploy.publicPaths` never return 429. Requests from one address up to the `publicPageRequestsPerSecond` limit in `seed.json → limits` all return 200. **Supersedes BASE-ACCESS-003** for those paths only. A status page is read hardest at the moment it matters most, and a per-address limit would reject real readers behind one egress address during an incident — but the decisive reason is mechanical: RFC 6585 requires that a 429 is never stored by a cache, so rate limiting the read path converts a cacheable traffic spike into an uncacheable one and sends it all to the origin. Those paths share immutable generation bytes in the edge cache. Healthy requests validate the current generation without querying the database; artifact caching reduces object-byte reads, while validation requests still reach the Worker. The public write paths (`/subscribe`, `/unsubscribe`, `/manage`, `/api/intake/*`) stay rate limited under BASE-ACCESS-003.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### PAGE-009

Every timestamp on a public surface or in a notification is rendered in the page's configured timezone with its UTC offset, and every timestamp on the page carries the same instant as an ISO 8601 value in a machine-readable attribute. Owner exception (S4, DIVERGENCE.md "Public page clarity — owner L10, 20 October 2026"): while script runs, the page's generation time shows a relative label, refreshed while the page is open. Its tooltip gives the absolute time in the configured timezone with its UTC offset, and its `datetime` keeps the ISO 8601 instant. The initial HTML and script-disabled readers see the absolute time. Incident, maintenance, feed and notification timestamps keep the absolute display.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`. The PAGE-014/PAGE-009 journey finds the relative generation label with the absolute zone-and-offset tooltip and ISO datetime (`tests/e2e/public-contract.test.mjs`, lines 622-627). Changed in 1.11.0 by the owner's S4 exception (DIVERGENCE.md "Public page clarity"): the generation time shows a relative label while script runs; RELEASE.json records the change.


### PAGE-010

`/feed.atom` validates as Atom 1.0 and contains one entry for every published incident update and for every maintenance notice — scheduled, rescheduled, started, completed, canceled — from the last 12 months, ordered newest first. An entry's identifier is stable from first publication and is never reused.

Original Evidence cell: `tests/e2e/app-api.test.mjs`, `tests/e2e/public-contract.test.mjs`


### PAGE-011

One script tag renders a banner showing the overall status and any unresolved incident, read from the PAGE-005 snapshot. The script is at most 10KB gzipped, loads only from the deployment's origin, and renders only on the host origins listed in settings per BASE-PUBLIC-002.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### PAGE-012

Page name, logo, accent color, timezone, hostname, and a footer-credit toggle are set in settings without a code change. The footer credit is the plain static text `Powered by Lamp`, defaults on, and disabling it makes no network action. The logo is served from the deployment's own origin. The favicon composites a mark for the current overall status over the configured logo rather than replacing it, and the page carries Open Graph metadata whose title and image state the current overall status.

Original Evidence cell: `tests/e2e/app-api.test.mjs`, `tests/e2e/public-contract.test.mjs`


### PAGE-013

Every public page response carries a `Content-Security-Policy` whose `default-src`, `script-src`, `style-src`, `img-src`, `connect-src`, `form-action`, and `base-uri` name only the deployment's own origin, and `frame-ancestors 'none'`, together with `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. The page contains no CAPTCHA and no consent banner, because it stores nothing on the visitor's device and loads nothing that would need either.

Original Evidence cell: `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/public-contract.test.mjs`


### PAGE-014

When script is available the page re-reads `/api/public/status` at most every 30 seconds and updates the overall status and the newest update in place. That response is a fixed set of fields whose size does not grow with the number of components. The region it updates is an ARIA live region, so a change is announced without a reload. With script disabled the page does not refresh itself and states the instant its content was generated.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### PAGE-015

The public page, feeds, widget, badges and public API are served on the buyer's custom domain. The owner adds a hostname, and Lamp provisions it as a Cloudflare custom hostname with an automatically issued TLS certificate and shows the exact DNS record to create. *Secondary origin.* Every snapshot generation (PAGE-005) is also copied, as static objects at the same paths, to a secondary origin the owner chooses on a separate provider. The supported secondaries are an AWS S3 bucket behind a CloudFront distribution that carries an ACM certificate for the buyer's hostname (independent of Cloudflare, and the recommended choice); a Backblaze B2 bucket behind a CDN that serves the buyer's hostname with its own certificate (Bunny.net or Fastly); and a second Cloudflare account. Setup states that a second Cloudflare account covers a failure of Lamp's Worker or account but not an outage of Cloudflare itself. Each copy carries the PAGE-006 "last known state" label and its generation instant. A secondary that falls more than two generations or 5 minutes behind is reported to operators under BASE-OPS-004 and listed in AUTO-003. *Failover topology.* Lamp does not operate DNS. The supported topology is health-checked failover at a DNS provider independent of Cloudflare: Amazon Route 53 failover routing (a primary record to the Cloudflare custom hostname with a health check, a secondary record to the secondary origin) or IBM NS1 Connect with an up/down monitor and a priority filter chain. Lamp's part is threefold. First, the primary serves `/__lamp/serving` on the buyer's hostname: it returns 200 only when the Worker can serve the current snapshot generation from object storage, and 503 otherwise. It needs no database, so a database outage, which PAGE-006 already survives, never triggers failover. Second, Settings → Independence shows the exact records and health-check settings for the chosen provider: an HTTPS check of `/__lamp/serving` every 10 seconds (Route 53 fast interval), failure threshold 3, record TTL 60 seconds. Third, a setup check verifies the arrangement end to end: the hostname resolves to the primary, the provider's secondary record names the secondary origin, the secondary answers TLS for the buyer's hostname (by SNI) with the newest generation, and the health check targets `/__lamp/serving`. Each failing step is named. With those settings the buyer's hostname serves the secondary within 180 seconds of the primary failing (30 seconds of detection, 60 seconds of TTL, and resolver margin). A primary too overloaded to answer the health check within the provider's response window counts as failing too (PAGE-021). Failback is automatic when the health check passes again. Lamp keeps writing each new generation to the secondary while the primary serves, so failback never shows older content than failover did. *What the secondary serves.* Read-only, at the same paths as the primary: the status page, history, incident and maintenance permalinks, the Atom and RSS feeds (PAGE-010, PAGE-017), the widget and embed variants (PAGE-011, PAGE-019), badges (PAGE-018), the Statuspage-compatible and native public APIs with their CORS headers (PAGE-016), and `/maintenance.ics` (MAINT-007), each labeled with its generation instant. Not served: subscribe, manage, unsubscribe, alert intake and the operator app. The secondary answers their paths with 503 and `Retry-After` and a page that says subscriptions are paused while the standby copy is serving, never a false success. Publishing and notification delivery need the primary. During failover the page shows the last published generation, and work committed before the outage is delivered under NOTIFY-009 when the primary returns. Acceptance: a custom-hostname journey shows the DNS record and certificate state, and serves `/` on that hostname. `/__lamp/serving` returns 200 with the database stopped and 503 with object storage stopped. Against a Route 53 test zone configured from Settings → Independence (hosted acceptance; locally, a DNS harness polling `/__lamp/serving` with the same interval, threshold and TTL), the primary Worker is stopped after a publish: resolving and fetching the buyer's hostname returns the secondary's newest generation, labeled, within 180 seconds. On the secondary, `/api/v2/summary.json`, `/feed.rss` and a badge return 200 with the same generation, and `POST /subscribe` returns 503 with `Retry-After`. Restarting the primary returns the hostname to it. The setup check names a missing secondary record. A failing mirror write shows as a failed job on Overview. Status: **partial** — `src/core/app/host-dispatch.ts`, `src/core/features/page-settings/service.ts`, `tests/e2e/public-contract.test.mjs`. The configured hostname, isolated public-host routing and retained snapshots (PAGE-006) ship. Custom-hostname provisioning, the secondary origin, `/__lamp/serving`, the failover setup check and read-only standby serving do not.

Original Evidence cell: `src/core/app/host-dispatch.ts`, `src/core/features/page-settings/service.ts`, `tests/e2e/public-contract.test.mjs`

Original Gap cell: The configured hostname, isolated public-host routing and retained snapshots (PAGE-006) ship. Custom-hostname provisioning, the secondary origin, `/__lamp/serving`, the failover setup check and read-only standby serving do not.

### PAGE-016

The public host serves `/api/v2/summary.json`, `/api/v2/status.json`, `/api/v2/components.json`, `/api/v2/incidents.json`, `/api/v2/incidents/unresolved.json`, `/api/v2/scheduled-maintenances.json`, `/api/v2/scheduled-maintenances/upcoming.json` and `/api/v2/scheduled-maintenances/active.json` with Statuspage v2 field names, ID formats, impact values and status indicators (`none`, `minor`, `major`, `critical`, `maintenance`). Lamp's Component states and lifecycle map onto those values in a documented table. The `scheduled-maintenances` responses carry each maintenance's MAINT-009 updates as `incident_updates` with their `body` and Statuspage's maintenance statuses (`scheduled`, `in_progress`, `verifying`, `completed`), together with `scheduled_for`, `scheduled_until`, `scheduled_auto_in_progress` and `scheduled_auto_completed`. Existing Statuspage clients, scripts and dashboards therefore switch by changing only the hostname. A Lamp-native `/api/public/v1/` serves the same records with complete incident timelines, post-incident reports and cursor pagination. Every response is read from the PAGE-005 snapshot with no database query, allows any origin under CORS, is cached under PAGE-007 and is never rate limited under PAGE-008. Internal components, internal notes and private-page records never appear. Acceptance: a snapshot test validates every v2 response against Statuspage's published v2 schema fixtures, and an unmodified Statuspage client library reads a Lamp page. With the database unavailable, every path still returns 200 from the snapshot. Status: **partial** — `src/core/features/public-snapshot/public-api.ts`, `tests/e2e/helpers/public-resources-flow.mjs`, `tests/e2e/snapshot-retained.test.mjs`. Statuspage v2 responses, stable imported IDs, an unmodified Statuspage embed client, and paginated native timelines and reports ship from retained snapshots. MAINT-009 wording, Verifying and per-window automation switches remain unbuilt; maintenance responses expose existing native lifecycle notices.

Original Evidence cell: `src/core/features/public-snapshot/public-api.ts`, `tests/e2e/helpers/public-resources-flow.mjs`, `tests/e2e/snapshot-retained.test.mjs`

Original Gap cell: Statuspage v2 responses, stable imported IDs, an unmodified Statuspage embed client, and paginated native timelines and reports ship from retained snapshots. MAINT-009 wording, Verifying and per-window automation switches remain unbuilt; maintenance responses expose existing native lifecycle notices.

### PAGE-017

`/feed.rss` is a valid RSS 2.0 feed with exactly the entries, order and stable identifiers of the Atom feed in PAGE-010. `/history.rss` and `/history.atom` (the Statuspage paths) serve the same feeds on every installation, not only after an import. Each visible component also has `/components/<slug>/feed.atom` and `/components/<slug>/feed.rss`, carrying only the incidents and maintenance that claimed a state on that component. All feeds are snapshot artifacts. Acceptance: the W3C feed validator accepts every feed. A component feed omits an incident that never touched that component. A feed reader polling `/history.rss` before and after a publish sees the new entry within PAGE-007's 10 seconds. Status: **done** — `src/core/features/public-snapshot/feeds.ts`, `tests/e2e/helpers/public-resources-flow.mjs`. Ten actual dev Atom/RSS feeds validate with zero W3C errors or warnings; global aliases and component feeds retain event identity and share their snapshot.

Original Evidence cell: `src/core/features/public-snapshot/feeds.ts`, `tests/e2e/helpers/public-resources-flow.mjs`

Original Gap cell: Ten actual dev Atom/RSS feeds validate with zero W3C errors or warnings; global aliases and component feeds retain event identity and share their snapshot.

### PAGE-018

`/badge.svg` renders a shields-style SVG with the overall status. `/components/<slug>/badge.svg` renders one component's state, and `/components/<slug>/uptime.svg` its uptime figure for the reporting window. `/badge.json` returns the shields.io endpoint schema, so README badges and dashboards can embed status without script. Badges are snapshot artifacts of at most 2KB, use the page's state colors with a text label so color is never the only signal, and are cached by generation under PAGE-007. Acceptance: a test fetches each badge after a component change and finds the new label within 10 seconds. shields.io's endpoint badge renders `/badge.json`. With the database unavailable, badges are served from the snapshot. Status: **done** — `src/core/features/public-snapshot/badges.ts`:7, `src/core/features/public-snapshot/state-colors.json`:1, `tests/e2e/helpers/public-resources-flow.mjs`:75 (existing stable-feed/public-resource journey in `tests/e2e/public-contract.test.mjs`:755), `tests/e2e/snapshot-retained.test.mjs`:32. The public-door journey changes an isolated component through every state, fetches the overall/component/uptime SVGs and endpoint JSON within ten seconds, checks their labels, page-resolved colours, 2KB bound and generation caching. Its page-state-colour assertion fails against the published palette and passes with Partially unavailable amber. The retained-snapshot journey serves badges with the database unavailable. Hosted GETs on 23 October 2026 at 08:07:08 UTC returned HTTP 200 for status.run-lamp.com/badge.json, /badge.svg and the shields.io endpoint; shields rendered “status: Operational”. No hosted state changed; full bodies remain outside the distributed tree under ACCEPTANCE.md’s release evidence boundary. Judged against every PAGE-018 acceptance sentence; no gap remains for this clause.

Original Evidence cell: `src/core/features/public-snapshot/badges.ts`:7, `src/core/features/public-snapshot/state-colors.json`:1, `tests/e2e/helpers/public-resources-flow.mjs`:75 (existing stable-feed/public-resource journey in `tests/e2e/public-contract.test.mjs`:755), `tests/e2e/snapshot-retained.test.mjs`:32. The public-door journey changes an isolated component through every state, fetches the overall/component/uptime SVGs and endpoint JSON within ten seconds, checks their labels, page-resolved colours, 2KB bound and generation caching. Its page-state-colour assertion fails against the published palette and passes with Partially unavailable amber. The retained-snapshot journey serves badges with the database unavailable. Hosted GETs on 23 October 2026 at 08:07:08 UTC returned HTTP 200 for status.run-lamp.com/badge.json, /badge.svg and the shields.io endpoint; shields rendered “status: Operational”. No hosted state changed; full bodies remain outside the distributed tree under ACCEPTANCE.md’s release evidence boundary.

Original Gap cell: Judged against every PAGE-018 acceptance sentence; no gap remains for this clause.

### PAGE-019

Besides the PAGE-011 banner, the owner can choose a floating notice that appears in a corner of the host page only while an incident is unresolved or a maintenance is in progress (Statuspage's status embed), and a compact status dot with a label for site headers and footers. The owner sets position and colors. Every variant reads the same snapshot payload, stays within PAGE-011's 10KB and origin allow-list, and shows nothing at all when everything is operational, if the owner chooses. Acceptance: a browser journey embeds each variant on an allow-listed origin and an origin that is not listed. Only the allow-listed origin renders, and the floating notice appears and disappears with the incident. Status: **done** — `src/core/features/page-settings/ui/public-resources.tsx`, `tests/e2e/helpers/widget-variants-flow.mjs`, `tests/e2e/helpers/widget-privacy-flow.mjs`. Banner, floating notice and dot are configurable and refresh without cookies, referrers or visitor data; unlisted origins render nothing.

Original Evidence cell: `src/core/features/page-settings/ui/public-resources.tsx`, `tests/e2e/helpers/widget-variants-flow.mjs`, `tests/e2e/helpers/widget-privacy-flow.mjs`

Original Gap cell: Banner, floating notice and dot are configurable and refresh without cookies, referrers or visitor data; unlisted origins render nothing.

### PAGE-020

Every public page, private page, subscription page and email meets WCAG 2.2 AA. Each release publishes a VPAT in the ITI VPAT 2.5 Rev 508 edition, `docs/accessibility/vpat.md`, which names the release version it describes, its evaluation date and the methods used. It is served at `/docs/accessibility/vpat` (DOCS-001) and linked from the public page footer, so enterprise and public-sector buyers can procure Lamp. Component and incident states are never conveyed by color alone, and the live region of PAGE-014 is announced by screen readers. Acceptance: the accessibility suite runs axe at 1440 and 390 widths on the public page, history, incident permalink, maintenance permalink and subscription management with no serious or critical finding. Private-page axe coverage belongs to AUD-002. A keyboard-only journey subscribes and manages a subscription. `pnpm validate:release` refuses a release whose `docs/accessibility/vpat.md` is absent, lacks the Section 508 chapters (Chapter 3 Functional Performance Criteria, Chapter 5 Software, Chapter 6 Support Documentation, and the WCAG 2.x A and AA tables), or names a version other than the one `RELEASE.json` releases. `GET /docs/accessibility/vpat` on the app host returns that document. Status: **partial** — `tests/e2e/maintenance-timezone.test.mjs` (maintenance creation and correction use the page zone; public maintenance and keyboard subscription journeys are accessible), `tests/e2e/helpers/accessibility-subscription-flow.mjs` (accessibilitySubscriptionFlow), `tests/release-history.test.mjs` (release validation). At 1440/390 the public page, history, incident and maintenance permalinks and subscription management pass axe; keyboard-only subscribe/manage retains visible focus. The public footer's Accessibility (VPAT) link opens the app-host document. Release validation rejects absent reports, missing required Section 508/WCAG tables and the wrong release version. Private-page axe belongs to AUD-002 after the approved carve. The VPAT records its evaluation methods and criterion limits; no whole-product conformance is claimed. Additional push-Verify evidence: `tests/e2e/delivery-contract.test.mjs` (Attributed operator additions, confirmed component scope, private management and opt-out), loading `tests/e2e/helpers/subscriber-add-flow.mjs` in the delivery shard, captures real confirmation, incident-update and maintenance-notice HTML at the Resend edge and audits every document with axe and no horizontal overflow at 1440/390. Each is a complete English HTML document with wrapping body text and no pre element. `tests/e2e/start-runtime.test.mjs` in the runtime shard proves the app-host VPAT document. The VPAT includes the measured email scope and the existing footer link. Additional push-Verify screen evidence: `tests/e2e/publishing-browser.test.mjs` (HIST-002 — AGENT-005 TEAM-007 HIST-007 — an operator publishes a report, browses audit history and reports subscribers), loading `tests/e2e/helpers/post-incident-report-flow.mjs` in the composer shard, audits the complete report screen in generated, draft, published-operator and public-published states at 1440/390. Brief disclosures have 44-pixel targets. The existing capacity-refusal journey in `tests/e2e/statuspage-import.test.mjs` (MOVE-002 — SUB-017 and SUB-020 imports keep history silent, CSV dry runs write nothing, pending subscribers need explicit invitations, and capacity refuses excess without writes) in the imports-statuspage shard passes its unchanged strict axe, overflow and hydration checks at both widths; the same Atom/RSS links use existing public utility navigation for stable targets without stylesheet changes. `tests/e2e/public-contract.test.mjs` (PAGE-013 PAGE-014 PAGE-008 PAGE-009 PAGE-003, public shard) proves the persistent role=status, aria-live=polite, aria-atomic=true region exists on first load; real operator publication, update and resolution change its customer-facing text at 1440/390 after the public snapshot is ready; unchanged polls and relative-time renders do not mutate the announcement; internal incident ids are absent. The default page keeps its generation clock outside the announcement and changes announcement text only when the public facts change. The two widths retain axe and overflow checks. This is browser live-region delivery evidence; incomplete VPAT criterion evaluations still prevent whole-product conformance. Proposal pending ct judgment. The existing `tests/e2e/public-contract.test.mjs` (PAGE-013 PAGE-014 PAGE-008 PAGE-009 PAGE-003, public shard) additionally asserts the same persistent polite/atomic live region, published incident text and resolution, unchanged-refresh silence, and exclusion of internal incident ids on Calm headline, Uptime-history-led and Regions map at 1440/390, with axe and overflow checks. Generation clocks stay outside every announcement; unchanged public facts retain their existing nodes. Regions reserves space for all state labels and refreshes map content in place, so incident state changes preserve the live region. This narrows the browser gap only; manual criterion evaluation and actual assistive-technology conformance remain unproved. Proposal pending ct judgment. Gap: The VPAT records incomplete criterion evaluations, so whole-product WCAG 2.2 AA is unproved. Additional phone-carve evidence: `tests/e2e/helpers/sms-subscriber-flow.mjs` (smsSubscriberFlow) and `tests/e2e/helpers/sms-browser-flow.mjs` (smsBrowserFlow), within the existing delivery registration, prove phone CSV dry-run counts with no writes and Add subscriber phone/component selection with one opt-in at 1440/390. Valid phones no longer receive the former SUB-013-unavailable refusal; SUB-017 status is unchanged.

Original Evidence cell: `tests/e2e/maintenance-timezone.test.mjs` (maintenance creation and correction use the page zone; public maintenance and keyboard subscription journeys are accessible), `tests/e2e/helpers/accessibility-subscription-flow.mjs` (accessibilitySubscriptionFlow), `tests/release-history.test.mjs` (release validation). At 1440/390 the public page, history, incident and maintenance permalinks and subscription management pass axe; keyboard-only subscribe/manage retains visible focus. The public footer's Accessibility (VPAT) link opens the app-host document. Release validation rejects absent reports, missing required Section 508/WCAG tables and the wrong release version. Private-page axe belongs to AUD-002 after the approved carve. The VPAT records its evaluation methods and criterion limits; no whole-product conformance is claimed.  Additional push-Verify evidence: `tests/e2e/delivery-contract.test.mjs` (Attributed operator additions, confirmed component scope, private management and opt-out), loading `tests/e2e/helpers/subscriber-add-flow.mjs` in the delivery shard, captures real confirmation, incident-update and maintenance-notice HTML at the Resend edge and audits every document with axe and no horizontal overflow at 1440/390. Each is a complete English HTML document with wrapping body text and no pre element. `tests/e2e/start-runtime.test.mjs` in the runtime shard proves the app-host VPAT document. The VPAT includes the measured email scope and the existing footer link. Additional push-Verify screen evidence: `tests/e2e/publishing-browser.test.mjs` (HIST-002 — AGENT-005 TEAM-007 HIST-007 — an operator publishes a report, browses audit history and reports subscribers), loading `tests/e2e/helpers/post-incident-report-flow.mjs` in the composer shard, audits the complete report screen in generated, draft, published-operator and public-published states at 1440/390. Brief disclosures have 44-pixel targets. The existing capacity-refusal journey in `tests/e2e/statuspage-import.test.mjs` (MOVE-002 — SUB-017 and SUB-020 imports keep history silent, CSV dry runs write nothing, pending subscribers need explicit invitations, and capacity refuses excess without writes) in the imports-statuspage shard passes its unchanged strict axe, overflow and hydration checks at both widths; the same Atom/RSS links use existing public utility navigation for stable targets without stylesheet changes. `tests/e2e/public-contract.test.mjs` (PAGE-013 PAGE-014 PAGE-008 PAGE-009 PAGE-003, public shard) proves the persistent role=status, aria-live=polite, aria-atomic=true region exists on first load; real operator publication, update and resolution change its customer-facing text at 1440/390 after the public snapshot is ready; unchanged polls and relative-time renders do not mutate the announcement; internal incident ids are absent. The default page keeps its generation clock outside the announcement and changes announcement text only when the public facts change. The two widths retain axe and overflow checks. This is browser live-region delivery evidence; incomplete VPAT criterion evaluations still prevent whole-product conformance. Proposal pending ct judgment. The existing `tests/e2e/public-contract.test.mjs` (PAGE-013 PAGE-014 PAGE-008 PAGE-009 PAGE-003, public shard) additionally asserts the same persistent polite/atomic live region, published incident text and resolution, unchanged-refresh silence, and exclusion of internal incident ids on Calm headline, Uptime-history-led and Regions map at 1440/390, with axe and overflow checks. Generation clocks stay outside every announcement; unchanged public facts retain their existing nodes. Regions reserves space for all state labels and refreshes map content in place, so incident state changes preserve the live region. This narrows the browser gap only; manual criterion evaluation and actual assistive-technology conformance remain unproved. Proposal pending ct judgment.

Original Gap cell: The VPAT records incomplete criterion evaluations, so whole-product WCAG 2.2 AA is unproved.

### PAGE-021

A status page takes its heaviest traffic during the outage it reports. The hosted deployment on the owner's Cloudflare account serves the public read paths (PAGE-008) at the rate a mid-size SaaS sees in that hour. It sustains 2,000 requests per second for 10 minutes, spread across `/`, `/api/v2/summary.json` (PAGE-016), `/api/public/status` (PAGE-014), `/feed.atom` (PAGE-010) and `/badge.svg` (PAGE-018). It also absorbs a burst of 5,000 requests per second for 60 seconds, and serves 200 requests per second from one address, which is one company's egress during an incident. At those rates every response is 200, with no 429 and no 5xx. The p95 time to first byte, measured from US-East and US-West clients outside Cloudflare, is at most 300 ms for `/api/public/status`, `/api/v2/summary.json` and `/badge.svg`, and at most 500 ms for `/` and `/feed.atom`. A publish during the run still reaches every surface within PAGE-007's 10 seconds. These reads stay generation-cached at the edge (PAGE-007), query no database (PAGE-005) and are never rate limited (PAGE-008), so the work at the origin per request does not grow with traffic. Load and failover are linked. A primary too slow to answer `/__lamp/serving` within the DNS provider's health-check response window (2 seconds for Route 53) counts as failed, so PAGE-015 fails the hostname over when the primary is overloaded as well as when it is down. The release that ships this clause replaces the local `seed.json → limits.publicPageRequestsPerSecond` value of 10 with the sustained hosted rate measured by its acceptance run, marks it `estimate: false` and records that run as the evidence. PAGE-008's promise then holds at that rate. Acceptance: a hosted load run against a test installation on Cloudflare (not Miniflare), driven by k6 from US-East and US-West runners outside Cloudflare, holds the sustained, burst and single-address rates above on the five paths. Every response is 200, and the run's p95 for each path is within its bound. A publish 5 minutes into the run is readable on all five paths within 10 seconds. During the run the database's query count for public reads stays at zero. The run's k6 summary, the deployment identity and the commit are recorded as release evidence (ACCEPTANCE.md, release evidence boundary). Status: **partial** — `src/core/features/public-snapshot/routes.ts`, `tests/e2e/public-contract.test.mjs:572`. Generation-cached, database-free and unthrottled public reads ship (PAGE-005, PAGE-007, PAGE-008). They are measured only as a local Miniflare floor of 10 requests per second (`seed.json → limits`). There is no hosted load run and no stated hosted rate.

Original Evidence cell: `src/core/features/public-snapshot/routes.ts`, `tests/e2e/public-contract.test.mjs`

Original Gap cell: Generation-cached, database-free and unthrottled public reads ship (PAGE-005, PAGE-007, PAGE-008). They are measured only as a local Miniflare floor of 10 requests per second (`seed.json → limits`). There is no hosted load run and no stated hosted rate.

### THEME-001

In Settings, without a code change, the owner sets background, surface, text, link and per-state colors (Lamp checks each pair against WCAG AA contrast before saving), a font from the bundled set or an uploaded WOFF2 served from the page's own origin, a header image, custom header and footer links, custom header and footer HTML, and layout choices: groups collapsed or expanded, uptime bars shown or hidden per component, and how many days of history appear on the page. Owner CSS is accepted when it contains no `@import`, no `url()` to another origin, no `expression()` and no `behavior`. It is scoped to the page and shipped inside the snapshot stylesheet, so PAGE-003 and PAGE-013 still hold. Custom header and footer HTML (at most 8KB each) is sanitized on save to an allow-list of elements (`a`, `p`, `span`, `strong`, `em`, `br`, `ul`, `ol`, `li`, `nav`, `img`) and attributes (`href` to https or the page's own paths, `class`, `alt`, `src` to an image uploaded to the page's own origin). No script, event-handler attribute, `style` attribute, form, iframe or external resource survives, so the CSP of PAGE-013 needs no exception. The sanitized markup is rendered into the snapshot, so it is present without script. Acceptance: a settings journey changes every theme field, and the next snapshot shows them. CSS with `@import` or an external `url()` is refused with 400 and the offending rule named. Header HTML containing `<script>`, an `onclick` attribute and an external `<img>` saves with all three removed, and the save response lists each removal. A color pair below 4.5:1 is refused. The page weight check of PAGE-003 passes with custom CSS present. Status: **partial** — `src/core/features/page-settings/service.ts`, `src/core/features/public-snapshot/branding.ts`, `tests/e2e/public-contract.test.mjs`. Name, logo, accent color, timezone, hostname, favicon and footer credit (PAGE-012) ship. Full palette, fonts, layout options and custom CSS do not.

Original Evidence cell: `src/core/features/page-settings/service.ts`, `src/core/features/public-snapshot/branding.ts`, `tests/e2e/public-contract.test.mjs`

Original Gap cell: Name, logo, accent color, timezone, hostname, favicon and footer credit (PAGE-012) ship. Full palette, fonts, layout options and custom CSS do not.

### I18N-001

The owner picks a default language and any additional languages from a shipped set. American English and US Spanish come first, then French, German, Brazilian Portuguese and Japanese. Every fixed string on public and private pages, in feeds, in emails and SMS, and on subscription pages is translated. Times follow PAGE-009 in each locale's format. Each language has its own snapshot under `/<lang>/` with `hreflang` alternates and a visible language switcher. Accept-Language suggests a language through a link and never silently changes what a URL serves. Each subscriber has a language, chosen when subscribing and changeable from SUB-007's page. Subscriber reporting (HIST-007) counts subscribers by language, in its current counts, daily trend and CSV. Acceptance: with English and Spanish enabled, `/es/` renders every fixed string in Spanish, in the initial HTML and without script. A Spanish-language subscriber's email uses the Spanish template. Turning a language off removes its pages from the next snapshot. HIST-007's report and CSV count the English and Spanish subscribers separately. An operator imports subscribers from CSV (email, phone, webhook URL, components, language) through a dry run that counts what would be created, skipped or refused, and writes nothing. Status: **missing**. Released `seed.json → nonGoals` excludes multi-language pages; this clause replaces that exclusion.


Original Gap cell: Released `seed.json → nonGoals` excludes multi-language pages; this clause replaces that exclusion.

### I18N-002

Each update can carry its text in every enabled language. The composer shows each language beside the default, and preview (UPDATE-004) renders each one. When a language has no text, the operator either supplies it or explicitly chooses "publish in the default language for this language", which is recorded on the update. Notifications go out in each subscriber's language. Translation never delays the default-language publication: the operator can publish the default language first and add translations as a correction-free addition, marked "translation added at" on that language's timeline. Acceptance: a publish with English and Spanish text sends Spanish email to Spanish subscribers and English email to the rest. A publish with no Spanish text and no explicit choice is refused with 400, naming the language. Adding the Spanish text later notifies nobody a second time, and NOTIFY-005 still holds. Status: **missing**.


Original Gap cell: Not built.

### COMP-001

A component's public state is exactly one of Operational, Degraded performance, Partially unavailable, Major outage, or Under maintenance. Those states are ordered by severity, most severe first: Major outage, Partially unavailable, Degraded performance, Under maintenance, Operational. Every clause that says "most severe" means this order.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### COMP-002

A component belongs to at most one group. Operators set the order of groups and of components within a group, and the public page renders them in that order.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### COMP-003

Every change to a component's public state appends an entry recording the previous state, the new state, the instant of the change, and the operator or incident that caused it. An entry is never modified or removed; a correction under UPTIME-004 appends a superseding entry rather than altering the one it corrects.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### COMP-004

A component has a note of at most 250 characters, empty by default. When it is not empty it is shown beside that component's state on the public page exactly as entered.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### COMP-005

A component marked internal is absent from the public page, the Atom feed, the widget, and every uptime figure, and never contributes to the overall status.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### COMP-006

Three things claim a state for a component: an unresolved incident, an in-progress maintenance, and an operator's standing claim set outside either. An incident or maintenance claims a state per attached component, chosen when the component is attached. A component's public state is the most severe of the states claimed for it, and Operational when nothing claims it. Resolving an incident, completing a maintenance, attaching or detaching a component, and setting or clearing an operator claim each recompute that component's state by this rule within 10 seconds.

Original Evidence cell: `tests/e2e/app-api.test.mjs`


### COMP-007

Deleting a component removes it and its state history from the public page and from every uptime figure within 10 seconds. Incidents and maintenance that referenced it keep the component's name in their published updates.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### COMP-008

A component can be linked to one or more Uptime monitors, or to a monitor or alert in another tool through its intake source: the presets of INTAKE-006 and INTAKE-008 to INTAKE-012 and INTAKE-014, and the component's automation email address (INTAKE-013). A linked monitor becomes a fourth kind of claimant in COMP-006, beside incidents, maintenance and operators. When an AUTO-001 rule allows it, a confirmed failure claims the state the rule names, and the confirmed recovery releases that claim. Each claim records the monitor or source, the evidence instant and the rule in COMP-003's history. Unknown or stale monitor evidence never claims Operational, and it never releases a claim another claimant holds. Acceptance: an Uptime signed failure for a monitor linked under an "automatic" rule moves the component to the named state on the page within 30 seconds and appends a history entry naming the monitor. The signed recovery releases the claim, while an operator's standing claim on the same component survives. A component whose rule only drafts changes no public state. Status: **missing**. Released COMP-006 names three claimants; the release that ships this clause records COMP-006 as changed.


Original Gap cell: Released COMP-006 names three claimants; the release that ships this clause records COMP-006 as changed.

### COMP-009

Operators create, edit, reorder and delete components and groups in bulk, through a table view and CSV import. Each component has an optional public description (at most 500 characters, plain text), shown on the page behind a disclosure, and a start date from which its uptime is shown (UPTIME-003). Acceptance: a CSV of 50 components with groups and descriptions imports through a dry run that writes nothing, then applies. The page renders the new order, and the descriptions open without script through `<details>`. Status: **done** — `src/core/features/components/catalogue-routes.ts`, `src/core/features/components/ui/catalogue-drawer.tsx`, `tests/e2e/helpers/catalogue-history-flow.mjs`.

Original Evidence cell: `src/core/features/components/catalogue-routes.ts`, `src/core/features/components/ui/catalogue-drawer.tsx`, `tests/e2e/helpers/catalogue-history-flow.mjs`


### COMP-010

A visible component can be marked "show only when not Operational", which is Statuspage's `only_show_if_degraded`. While its public state is Operational it is left out of the page's component list, the widget and the component lists in the feeds, and its uptime figure and daily record are not shown. When any claim gives it another state, it appears in its group within PAGE-007's 10 seconds. It disappears again when its state returns to Operational. Its state history (COMP-003) and uptime (UPTIME-001) are kept throughout, and its state always counts toward the overall status (PAGE-004). Unlike an internal component (COMP-005), it is public whenever it is affected. PAGE-016 serves it with `only_show_if_degraded: true` and lists it only while it is not Operational, as Statuspage does. Imports from Statuspage keep the flag (MOVE-001). Acceptance: a component marked "show only when not Operational" is absent from `/`, `/feed.atom` and `/api/v2/components.json` while Operational. An incident claiming Degraded performance on it makes it appear on all three within 10 seconds, with `only_show_if_degraded: true` in the API. Resolving the incident removes it again. A Statuspage fixture component with `only_show_if_degraded: true` imports with the flag set. Status: **done** — `src/core/features/public-snapshot/component-visibility.ts`, `tests/e2e/helpers/catalogue-history-flow.mjs`, `tests/e2e/statuspage-import.test.mjs`.

Original Evidence cell: `src/core/features/public-snapshot/component-visibility.ts`, `tests/e2e/helpers/catalogue-history-flow.mjs`, `tests/e2e/statuspage-import.test.mjs`


### DEP-001

An operator adds a third-party component from a catalog: AWS, Google Cloud, Microsoft Azure, Cloudflare, Fastly, Vercel, Stripe, GitHub, Twilio, SendGrid, Okta, Auth0, Atlassian, Slack, Zoom, Shopify, Datadog, PagerDuty, OpenAI and Anthropic. They can also add any page that publishes the Statuspage v2 API, an RSS or Atom status feed, or a JSON status endpoint with configured paths. Lamp's scheduled trigger reads each followed vendor at most every 2 minutes, with GET requests to that vendor's public status origin only. It maps the vendor's state for the chosen vendor components onto COMP-001's states through a shown table, and records every vendor change in COMP-003's history, attributed to the vendor feed. Vendor origins are declared in `seed.json → externals`. Every catalog entry ships with a recorded fixture of that vendor's public status format and its mapping table, and `pnpm validate:release` refuses a catalog entry that lacks either. Acceptance: against a recorded Statuspage-format fixture and a recorded AWS Health RSS fixture, a vendor change appears on the vendor component within 4 minutes, and the history entry names the feed. A vendor feed that returns 500 three times shows "vendor status unavailable since" with the time, and never shows Operational. A generated check iterates the whole catalog and, for each of the 20 vendors, maps that vendor's recorded samples for every state its format defines (operational, degraded, outage and maintenance where offered) onto the expected COMP-001 states; removing one vendor's fixture fails `pnpm validate:release`. Status: **missing**.


Original Gap cell: Not built.

### DEP-002

A vendor component is labeled "reported by <vendor>" and links to the vendor's own page. By default it claims nothing on the buyer's own components and does not move the overall status. The owner can mark own components as depending on a vendor component and choose, per dependency, one of three behaviors: show only; draft an incident on the dependent components from a saved "upstream provider" template; or include the vendor component in the overall status rollup (PAGE-004). A vendor recovery never resolves a buyer incident; it is shown in that incident's brief as evidence. Acceptance: with a default dependency, a vendor outage leaves the buyer's components and overall status unchanged. With "draft", it creates one private draft attached to the dependent components and changes no public surface. A vendor recovery adds a brief entry and leaves the draft unresolved. Status: **missing**.


Original Gap cell: Not built.

### DEP-003

Operators can follow a vendor component without showing it publicly; DEP-001 internal vendor components honor COMP-005. A followed vendor's state change sends one operator alert to email, the operator Slack or Teams channel and push (NOTIFY-016), deduplicated by vendor incident, so the team hears about upstream trouble before customers report it. Acceptance: an internal vendor component's outage sends exactly one operator alert per vendor incident, and nothing appears on the public page, feed or API. Status: **missing**.


Original Gap cell: Not built.

### UPTIME-001

For each visible component the page shows the percentage of the reporting window during which the component was not in a downtime state, computed from COMP-003 state history at one-minute resolution and rounded down to two decimal places, so a window containing any downtime never shows 100.00%. The reporting window is 90 days.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### UPTIME-002

*Policy: `uptime.downtime-states.v1`; default: a minute in Major outage or Partially unavailable counts as one downtime minute, a minute in Degraded performance counts as half a downtime minute, and a minute in Under maintenance counts as none.* Degraded performance is not weighted at zero: most published incidents never get worse than it, and discarding them is what makes an uptime figure disagree with the incident history printed beneath it.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### UPTIME-003

A component whose earliest state history entry is later than the start of the reporting window shows uptime computed from that entry, and the page labels the figure with the coverage: elapsed hours and minutes while it covers less than one whole day ("less than 1 minute" below a minute), and whole days from one day onward. A component with no data says No data (owner S4, DIVERGENCE.md "Public page clarity").

Original Evidence cell: `tests/e2e/public-contract.test.mjs`. First-day coverage reads in hours and minutes (`tests/e2e/public-contract.test.mjs`, line 405); whole-day labels apply from one day (`tests/e2e/public-contract.test.mjs`, line 452). Changed in 1.11.0 by the owner's S4 exception (DIVERGENCE.md "Public page clarity"): first-day coverage reads in hours and minutes, and a component with no data says No data; RELEASE.json records the change.


### UPTIME-004

An operator can correct a closed interval of a component's state history, stating the correct state for that interval and a reason. The correction appends to the history per COMP-003, recomputes every uptime figure it affects within 60 seconds, and records the operator, the interval, and the reason in the audit log. A request without a reason is rejected with 400.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### UPTIME-005

Beside the uptime figures the page names each state's weight under UPTIME-002 and the length of the window under UPTIME-001, in text present in the initial HTML. Because UPDATE-001 refuses to publish an update that claims no component, every published incident moves these figures; none of the incident history printed on the same page is invisible to them.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### UPTIME-006

The page shows one mark per day of the reporting window for each visible component. A day containing any downtime minute is labeled with the number of downtime minutes in that day. A day before the component's earliest state history entry is rendered as having no data and is visually distinct from a day with no downtime.

Original Evidence cell: `tests/e2e/public-contract.test.mjs`


### UPTIME-007

For a component linked to an Uptime monitor (COMP-008), the owner chooses what the page shows: the claimed uptime of UPTIME-001, measured availability from the monitor's scheduled evidence, or both side by side. Measured figures are labeled with their source and method. Minutes with no fresh evidence (Uptime's Unknown) are shown as no data and are never counted as up. The daily record of UPTIME-006 marks each day's measured downtime minutes. Corrections under UPTIME-004 apply only to claimed figures; measured evidence is never rewritten. Acceptance: an imported 90-day Uptime evidence fixture with one 30-minute outage and one 2-hour Unknown gap renders a measured figure that excludes the gap from the denominator. The gap is labeled as no data, and the claimed figure beside it is unchanged. Status: **missing**.


Original Gap cell: Not built.

### UPTIME-008

Up to 10 public metrics, such as response time per region, error rate or queue depth, can be shown on the page as charts per component, as Statuspage system metrics do. They are fed by Uptime timings, by pulls from Datadog, New Relic, Pingdom or a Prometheus-compatible query endpoint using a read-only key the owner supplies, or by pushes through the management API (API-001). Lamp stores only aggregated points (1-minute for the last day, hourly for 30 days, daily for 90 days) and renders each chart as inline SVG in the snapshot with a text summary, so it works without script. A source that stops reporting shows a gap labeled with when data stopped, never an interpolated line. Acceptance: a pushed metric series renders in the next snapshot. A Datadog query fixture fills a chart. A 20-minute gap renders as a labeled gap. Page weight stays within PAGE-003 with 10 charts. Status: **done** — `src/core/features/metrics/`, migration `migrations/core/0062_public_metrics.sql` (inventoried in RELEASE.json 1.11.0). `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow, called by the existing INTAKE-014 INTAKE-011 INTAKE-009 case in `tests/e2e/channels-and-presets.test.mjs`, notifications shard) asserts a pushed 160 ms series in the next public snapshot; sealed read-only Datadog, New Relic, Pingdom and Prometheus query fixtures fill inline charts with 42, 87, 60 and 12.5 ms; authenticated paired Uptime timing fills 123 ms, while a wrong signature or absent timing adds no point. A 20-minute gap has two disconnected SVG paths and a stopped/resumed timestamp label; a source that stays silent has its last-report timestamp label. `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow) asserts weighted hourly and daily sums and sample counts, retention just inside and outside the 1-day minute, 30-day hourly and 90-day daily boundaries, and expiry beyond 90 days. Hourly and daily history is stored; the public inline chart displays only the last 24 hours. Seven populated charts render with script disabled at 1440/390; enabled-script axe, overflow and hydration checks pass. `tests/e2e/helpers/metric-weight-flow.mjs` (tenMetricWeightFixture, called by PAGE-013 PAGE-014 PAGE-008 PAGE-009 PAGE-003 in `tests/e2e/public-contract.test.mjs`, public shard) pushes ten 1,440-point series beside 200 populated components, refuses an eleventh without insertion, and retains PAGE-003's 50 KiB gzip bound across default, calm, uptime and regions templates. The original browser check retains the four-request initial asset bound. `tests/e2e/helpers/metrics-browser-flow.mjs` (metricsBrowserFlow in the same notifications registration) proves all six feed setups and native versioned-push routing with an anonymous 401, ordinary-edit autosave, sealed-key redaction after reload including Prometheus and the Datadog application-key field, and no clipping, overflow, serious axe finding or hydration mismatch at 1440/390 in component settings. `tests/auth-adoption/portability.test.mjs` (native rer archive, ownership-authority shard) preserves minute, hourly and daily aggregate sums and sample counts and requires query-key reconnect after restore without carrying plaintext or ciphertext. `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow, same notifications case) issues a metrics:write management token and pushes the 160 ms series through the versioned metrics-points management endpoint without an operator cookie; it asserts the next public snapshot, token/issuer audit attribution, hash-only storage, last-used time, a no-scope 403 with no sample/audit/usage change, and immediate revoked-token 401 with no such changes. Additive migration `migrations/core/0063_management_metric_tokens.sql` is inventoried in RELEASE.json. The native archive journey preserves token metadata but excludes bearer/hash authority and refuses the restored old bearer. Both ct retention and token-push repairs are proposals pending judgment; API-001 remains partial. Proposal pending ct's judge.

Original Evidence cell: `src/core/features/metrics/`, migration `migrations/core/0062_public_metrics.sql` (inventoried in RELEASE.json 1.11.0). `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow, called by the existing INTAKE-014 INTAKE-011 INTAKE-009 case in `tests/e2e/channels-and-presets.test.mjs`, notifications shard) asserts a pushed 160 ms series in the next public snapshot; sealed read-only Datadog, New Relic, Pingdom and Prometheus query fixtures fill inline charts with 42, 87, 60 and 12.5 ms; authenticated paired Uptime timing fills 123 ms, while a wrong signature or absent timing adds no point. A 20-minute gap has two disconnected SVG paths and a stopped/resumed timestamp label; a source that stays silent has its last-report timestamp label. `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow) asserts weighted hourly and daily sums and sample counts, retention just inside and outside the 1-day minute, 30-day hourly and 90-day daily boundaries, and expiry beyond 90 days. Hourly and daily history is stored; the public inline chart displays only the last 24 hours. Seven populated charts render with script disabled at 1440/390; enabled-script axe, overflow and hydration checks pass. `tests/e2e/helpers/metric-weight-flow.mjs` (tenMetricWeightFixture, called by PAGE-013 PAGE-014 PAGE-008 PAGE-009 PAGE-003 in `tests/e2e/public-contract.test.mjs`, public shard) pushes ten 1,440-point series beside 200 populated components, refuses an eleventh without insertion, and retains PAGE-003's 50 KiB gzip bound across default, calm, uptime and regions templates. The original browser check retains the four-request initial asset bound. `tests/e2e/helpers/metrics-browser-flow.mjs` (metricsBrowserFlow in the same notifications registration) proves all six feed setups and native versioned-push routing with an anonymous 401, ordinary-edit autosave, sealed-key redaction after reload including Prometheus and the Datadog application-key field, and no clipping, overflow, serious axe finding or hydration mismatch at 1440/390 in component settings. `tests/auth-adoption/portability.test.mjs` (native rer archive, ownership-authority shard) preserves minute, hourly and daily aggregate sums and sample counts and requires query-key reconnect after restore without carrying plaintext or ciphertext. `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow, same notifications case) issues a metrics:write management token and pushes the 160 ms series through the versioned metrics-points management endpoint without an operator cookie; it asserts the next public snapshot, token/issuer audit attribution, hash-only storage, last-used time, a no-scope 403 with no sample/audit/usage change, and immediate revoked-token 401 with no such changes. Additive migration `migrations/core/0063_management_metric_tokens.sql` is inventoried in RELEASE.json. The native archive journey preserves token metadata but excludes bearer/hash authority and refuses the restored old bearer. Both ct retention and token-push repairs are proposals pending judgment; API-001 remains partial. Proposal pending ct's judge.


### UPTIME-009

Operators download, per component and for any month or quarter, an availability report with claimed and (where linked) measured uptime, every incident and maintenance that affected it, and total downtime minutes, as CSV and PDF. The report can be shared with one audience (AUD-003) on its private page. Customers with contractual SLAs then get the same numbers the page shows. Acceptance: the report for a fixture month equals the page's figures for the same window to two decimal places, and lists every incident whose claims fall in that window. **Current evidence and future obligations (20 October 2026, owner L10):** every current component has operator-only CSV/PDF exports for calendar months and quarters in the configured page timezone, with the same aggregate state-history, correction and weighting policy as the public page. Bounds are start-inclusive/end-exclusive; current periods count elapsed tracked time, future periods and absent history say No data. Configured tracking dates retain the page's timezone. Total minutes are labeled weighted downtime; maintenance's zero weight follows the page, while all overlapping scheduled/canceled/completed windows retain their state labels. Incident membership follows retained component claim intervals, including claims masked by a higher-severity incident; older imported incidents use their retained public attachments/history. There is no linked measured uptime yet: UPTIME-007/COMP-008 must add measured figures to these exports before that evidence ships. AUD-003 must add sharing on the selected audience's private page before audience sharing ships; the operator download does not claim private-page sharing today. Status: **done** — `src/core/features/availability-reports/`, `src/core/features/public-snapshot/uptime.ts`, UPTIME-009 in `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/helpers/availability-report-flow.mjs` and `tests/e2e/helpers/availability-report-browser-flow.mjs`. Month/quarter bounds, weighted overlap/correction/maintenance parity, complete incident membership, no-data coverage, authenticated CSV/PDF downloads and 1440/390 operator journeys are exercised.

Original Evidence cell: `src/core/features/availability-reports/`, `src/core/features/public-snapshot/uptime.ts`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/helpers/availability-report-flow.mjs`, `tests/e2e/helpers/availability-report-browser-flow.mjs`



### INCIDENT-001 prior Status evidence

`tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs`

### INCIDENT-002 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`

### INCIDENT-003 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`, `tests/reference-storage/references.test.mjs`

### INCIDENT-004 prior Status evidence

`tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs`

### INCIDENT-005 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`

### INCIDENT-006 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`

### INCIDENT-007 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`

### INCIDENT-009 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`

### INCIDENT-008 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`

### INCIDENT-010 prior Status evidence

`tests/e2e/update-reminders.test.mjs`

### INCIDENT-011 prior evidence

Status: **partial** — `src/core/features/incidents/communication-owner.repository.ts`:7, `src/core/features/incidents/reminders.ts`:24, `tests/e2e/update-reminders.test.mjs`:79, `tests/e2e/helpers/communication-owner-flow.mjs`:7. An unresolved incident defaults to its opener as communication owner; private take-over and active-operator reassignment doors write an attributed audit entry atomically and refuse resolved incidents. Owner-only due/overdue email, one escalation per commitment at ten minutes overdue, and unowned fallback to every active operator ship; every operator has publish rights until TEAM-004. Overview and the composer show ownership privately, with takeover/reassignment and unowned journeys at 1440/390. The registered reminder journey covers owner movement, escalation, unowned fallback, audit JSON/CSV and public/email-renderer privacy. `tests/e2e/helpers/operator-alerts-flow.mjs`, loaded by the same registered owner-reminders journey in push Verify’s notifications shard, now proves the overdue reminder reaches an explicitly opted-in operator Slack or Teams channel once with its incident reference and operator-app link. Gap: push (MOBILE-002) and Oncall's current on-call responder (INTAKE-012) remain unbuilt. The seed policy inventory registration is held by uip; the policy is replaceable through the typed extension mount without editing that held file.

### INCIDENT-011 prior Status evidence

`src/core/features/incidents/communication-owner.repository.ts`:7, `src/core/features/incidents/reminders.ts`:24, `tests/e2e/update-reminders.test.mjs`:79, `tests/e2e/helpers/communication-owner-flow.mjs`:7 `tests/e2e/helpers/operator-alerts-flow.mjs`, loaded by the same registered owner-reminders journey in push Verify’s notifications shard, now proves the overdue reminder reaches an explicitly opted-in operator Slack or Teams channel once with its incident reference and operator-app link.

### INCIDENT-011 prior Gap

An unresolved incident defaults to its opener as communication owner; private take-over and active-operator reassignment doors write an attributed audit entry atomically and refuse resolved incidents. Owner-only due/overdue email, one escalation per commitment at ten minutes overdue, and unowned fallback to every active operator ship; every operator has publish rights until TEAM-004. Overview and the composer show ownership privately, with takeover/reassignment and unowned journeys at 1440/390. The registered reminder journey covers owner movement, escalation, unowned fallback, audit JSON/CSV and public/email-renderer privacy. Gap: push (MOBILE-002) and Oncall's current on-call responder (INTAKE-012) remain unbuilt. The seed policy inventory registration is held by uip; the policy is replaceable through the typed extension mount without editing that held file.

### INCIDENT-012 prior evidence

Status: **done** — `tests/e2e/app-api.test.mjs` (COMP-006 UPDATE-004 PAGE-012 INCIDENT-012 — Component claims, saved drafts, settings and operator records), loading `tests/chat-desk/flow.mjs` (chatDeskFlow, chatDeskNativeFlow) in push Verify’s api shard, proves signed Slack and Teams private drafts, shared preview, explicit attributed publication and component-history changes, invalid signatures/audiences, and refusal of formerly linked actors after owner authority is revoked without any incident, draft, update or audit creation. `tests/e2e/channels-and-presets.test.mjs` (SUB-014 NOTIFY-011 NOTIFY-012 UPDATE-013 — Private channels deliver the selected publication once with literal text and punctuated links) loads `tests/e2e/helpers/chat-links-browser-flow.mjs` in notifications: the signed-in Settings control mints, links once through signed Slack and removes links at 1440/390, with axe, overflow and hydration assertions. `tests/auth-adoption/portability.test.mjs` (ACCESS-001 INTAKE-009 native rer archive restores owner continuity and subscriber authority without restoring sessions, provider approval or a sealed PagerDuty key), loaded by ownership-authority, asserts archive-policy exclusions of chat_link_codes, chat_previews and chat_requests, retains durable chat_links, and advances only its Date clock past the original ten-minute lifetime before an actual signed Slack request with the old code returns 409 and creates no temporary authority. Until TEAM-004, linked active operators act as owners under TEAM-001. No live workspace or tenant acceptance is claimed. Additional push-Verify evidence for the four ct findings: `tests/e2e/app-api.test.mjs` (COMP-006 UPDATE-004 PAGE-012 INCIDENT-012 — Component claims, saved drafts, settings and operator records), loading `tests/chat-desk/flow.mjs` (chatDeskNativeFlow) in the api shard, (1) obtains the generated Slack composer and Teams message-extension card and drives their exposed action ids, values and component choices through open, save, preview and publish; asserts each visible card contains UPDATE-004's public heading, lifecycle and every field plus the shared renderer's email subject and complete plain-text preview, (2) asserts both Teams-attached component identities and Major outage claims in the staged draft and published incident, (3) asserts unlinked Slack and Entra actors leave incidents, incident_drafts, incident_updates and audit_entries unchanged, and (4) asserts the initial Major outage claim and exactly one new Major outage → Degraded performance history entry, matching the incident, publication time and immutable component transition of the returned published update.

### INCIDENT-012 prior Status evidence

`tests/e2e/app-api.test.mjs` (COMP-006 UPDATE-004 PAGE-012 INCIDENT-012 — Component claims, saved drafts, settings and operator records), loading `tests/chat-desk/flow.mjs` (chatDeskFlow, chatDeskNativeFlow) in push Verify’s api shard, proves signed Slack and Teams private drafts, shared preview, explicit attributed publication and component-history changes, invalid signatures/audiences, and refusal of formerly linked actors after owner authority is revoked without any incident, draft, update or audit creation. `tests/e2e/channels-and-presets.test.mjs` (SUB-014 NOTIFY-011 NOTIFY-012 UPDATE-013 — Private channels deliver the selected publication once with literal text and punctuated links) loads `tests/e2e/helpers/chat-links-browser-flow.mjs` in notifications: the signed-in Settings control mints, links once through signed Slack and removes links at 1440/390, with axe, overflow and hydration assertions. `tests/auth-adoption/portability.test.mjs` (ACCESS-001 INTAKE-009 native rer archive restores owner continuity and subscriber authority without restoring sessions, provider approval or a sealed PagerDuty key), loaded by ownership-authority, asserts archive-policy exclusions of chat_link_codes, chat_previews and chat_requests, retains durable chat_links, and advances only its Date clock past the original ten-minute lifetime before an actual signed Slack request with the old code returns 409 and creates no temporary authority. Until TEAM-004, linked active operators act as owners under TEAM-001. No live workspace or tenant acceptance is claimed. Additional push-Verify evidence for the four ct findings: `tests/e2e/app-api.test.mjs` (COMP-006 UPDATE-004 PAGE-012 INCIDENT-012 — Component claims, saved drafts, settings and operator records), loading `tests/chat-desk/flow.mjs` (chatDeskNativeFlow) in the api shard, (1) obtains the generated Slack composer and Teams message-extension card and drives their exposed action ids, values and component choices through open, save, preview and publish; asserts each visible card contains UPDATE-004's public heading, lifecycle and every field plus the shared renderer's email subject and complete plain-text preview, (2) asserts both Teams-attached component identities and Major outage claims in the staged draft and published incident, (3) asserts unlinked Slack and Entra actors leave incidents, incident_drafts, incident_updates and audit_entries unchanged, and (4) asserts the initial Major outage claim and exactly one new Major outage → Degraded performance history entry, matching the incident, publication time and immutable component transition of the returned published update.

### INCIDENT-013 prior evidence

Status: **done** — `src/core/features/incident-impact/`, `migrations/core/0031_incident_impact.sql`, `tests/e2e/helpers/incident-impact-flow.mjs`. Operators set or clear an attributed impact independently of claims; public snapshots, APIs and committed notifications carry it while component states and uptime remain claim-derived.

### INCIDENT-013 prior Status evidence

`src/core/features/incident-impact/`, `migrations/core/0031_incident_impact.sql`, `tests/e2e/helpers/incident-impact-flow.mjs`

### INCIDENT-013 prior Gap

Operators set or clear an attributed impact independently of claims; public snapshots, APIs and committed notifications carry it while component states and uptime remain claim-derived.

### UPDATE-001 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`, `tests/reference-storage/incident-publishing.test.mjs`, `tests/reference-storage/migration.test.mjs`. Changed in 1.10.0 with UPDATE-013: a bare https:// URL in any field becomes a link, nothing else is interpreted; RELEASE.json records the change.

### UPDATE-002 prior Status evidence

`tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs`. Changed in 1.10.0 with UPDATE-013: every surface renders the same links from the shared renderer; RELEASE.json records the change.

### UPDATE-003 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`

### UPDATE-004 prior Status evidence

`tests/e2e/app-api.test.mjs`

### UPDATE-005 prior Status evidence

`tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs`

### UPDATE-006 prior Status evidence

`tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs`

### UPDATE-007 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`

### UPDATE-008 prior Status evidence

`tests/e2e/delivery-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`

### UPDATE-009 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`

### UPDATE-010 prior evidence

Status: **missing**.

### UPDATE-010 prior Gap

Not built.

### UPDATE-011 prior evidence

Status: **done** — `src/core/features/incidents/wording-checks.ts`, `tests/e2e/publishing-contract.test.mjs`. Deterministic per-field findings name six rules, respect saved owner terms and length, can be dismissed, and never block publish.

### UPDATE-011 prior Status evidence

`src/core/features/incidents/wording-checks.ts`, `tests/e2e/publishing-contract.test.mjs`

### UPDATE-011 prior Gap

Deterministic per-field findings name six rules, respect saved owner terms and length, can be dismissed, and never block publish.

### UPDATE-012 prior evidence

Status: **partial** — `migrations/core/0027_update_component_changes.sql`, `src/core/features/incidents/publication-repository.ts`, `tests/e2e/helpers/review-update-flow.mjs`. Native drafts stage state changes, attachments and releases; review, scheduling and templates keep the choices. One transaction publishes claims, aggregate history, immutable timeline changes and recipients; mail and signed webhooks retain the published changes after later recovery. Gap: management-token and Statuspage write APIs, automation, chat desks, SMS and component-only/Statuspage webhook subscriptions are not built. The acceptance's two overlap cases (one Major outage → Partially unavailable entry beside a Partially unavailable claimant; none while another claimant holds Major outage) have no named journey yet; history is written from the aggregate state.

### UPDATE-012 prior Status evidence

`migrations/core/0027_update_component_changes.sql`, `src/core/features/incidents/publication-repository.ts`, `tests/e2e/helpers/review-update-flow.mjs`

### UPDATE-012 prior Gap

Native drafts stage state changes, attachments and releases; review, scheduling and templates keep the choices. One transaction publishes claims, aggregate history, immutable timeline changes and recipients; mail and signed webhooks retain the published changes after later recovery. Gap: management-token and Statuspage write APIs, automation, chat desks, SMS and component-only/Statuspage webhook subscriptions are not built. The acceptance's two overlap cases (one Major outage → Partially unavailable entry beside a Partially unavailable claimant; none while another claimant holds Major outage) have no named journey yet; history is written from the aggregate state.

### UPDATE-013 prior evidence

Status: **done** — `src/core/shared/update-links.ts`, `src/core/features/channels/slack-message.ts`, `src/core/features/channels/messages.ts`, `src/core/features/incidents/wording-checks.ts`, `tests/e2e/helpers/update-link-evidence.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/helpers/review-update-flow.mjs`, `tests/e2e/channels-and-presets.test.mjs`, `tests/resolve-composer/linked-update-flow.mjs`.

### UPDATE-013 prior Status evidence

`src/core/shared/update-links.ts`, `src/core/features/channels/slack-message.ts`, `src/core/features/channels/messages.ts`, `src/core/features/incidents/wording-checks.ts`, `tests/e2e/helpers/update-link-evidence.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/helpers/review-update-flow.mjs`, `tests/e2e/channels-and-presets.test.mjs`, `tests/resolve-composer/linked-update-flow.mjs`

### UPDATE-013 prior Gap

Current evidence and future obligations (21 October 2026): every presently built channel carries bare https:// URLs as UPDATE-013 states. Each is proven on the candidate through its public door with See https://help.example.com/kb/123., the same URL before , and inside (…), http://example.com/x, data:text/html,x, javascript:alert(1), <a href="https://x.test">x</a>, https://db-prod-3.internal/x and https://10.0.0.5/x. Page GET /, incident permalinks and history, with script on and off at 1440 and 390 pixels (native Worker and real browser): each link is <a href="<url>" rel="nofollow noopener ugc"> showing its own URL, ., , and ) stay outside it, the other schemes and the markup are escaped literal text, and PAGE-013's CSP is unchanged. Atom and RSS, including /history.atom, /history.rss and component feeds (native): well-formed, entries carry the same escaped anchors and non-HTTPS input stays literal. Notification email (the real SendGrid adapter at a recorded network edge): the HTML part links each URL directly with the URL as its text, the text part carries the bare URL, no redirect or tracking host appears, and the provider request disables click, open and analytics tracking. Operator Slack channel posts (NOTIFY-012, the real adapter at a recorded network edge): <https://help.example.com/kb/123> then ., never Slack's labelled-link form, with javascript: and markup Slack-escaped and literal. Operator Teams channel posts (NOTIFY-012, the real adapter at a recorded Workflows edge): Adaptive Card links whose visible text is the URL, punctuation outside them, and no link for the other schemes or the markup. Webhook subscribers (SUB-009, native controlled receiver: tests/e2e/helpers/review-update-flow.mjs:92 and :94-100, called at tests/e2e/publishing-contract.test.mjs:432 within the test at :394): a Lamp-format endpoint receives every update field byte-for-byte unchanged and its signature verifies over the exact body; a subscriber that registered a Slack incoming-webhook URL receives Slack's message form, whose signature verifies over the exact body the same way, whose text carries each bare https:// URL as <url>, never Slack's labelled-link form, with markup and the other schemes Slack-escaped and literal, and whose rich-text link elements show their own URL while every field reassembles unchanged. This is native controlled-receiver evidence, not Slack acceptance. UPDATE-011's composer (native browser): https://db-prod-3.internal/x raises the Internal hostname finding and https://10.0.0.5/x the IP address finding, each dismissible, and publish succeeds. The Slack and Teams evidence is real adapters against recorded network-edge fixtures; no live Slack or Teams provider acceptance is claimed, and a single 20 October 2026 live Slack readback kept outside the source tree is not counted as provider acceptance. Unbuilt channels carry this clause in their own text: SUB-013 and NOTIFY-014 for SMS, SUB-018 for Statuspage-format webhooks, SUB-014 for Slack-app subscriptions, SUB-015 for subscriber Teams subscriptions, and MAINT-009 for maintenance wording. Their provider-sandbox acceptance stays with those clauses. Release obligations: 1.10.0, the release that ships this clause, records UPDATE-001 and UPDATE-002 as changed in RELEASE.json. Mail-provider received-message proof belongs to ACCEPTANCE.md's release gate, "Authorized mail-provider acceptance, signed delivery events and received-message evidence for DKIM unsubscribe-header coverage and no tracking." 1.10.0's received-message evidence is recorded outside the source tree with its release evidence; this clause claims no mail-provider acceptance. A built channel that later renders a link wrongly returns this clause to partial.

### MAINT-001 prior Status evidence

`tests/e2e/intake-references.test.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/reference-storage/references.test.mjs`

### MAINT-002 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`

### MAINT-003 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`

### MAINT-004 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`

### MAINT-005 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`

### MAINT-006 prior Status evidence

`tests/e2e/publishing-contract.test.mjs`

### MAINT-007 prior evidence

Status: **done** — `tests/e2e/publishing-contract.test.mjs` (Per-window automation, scheduled transitions, notices, extension and cancellation), `tests/e2e/helpers/maintenance-calendar-flow.mjs` (maintenanceCalendarFlow), `tests/e2e/helpers/accessibility-subscription-flow.mjs`. The public retained /maintenance.ics response parses with Mozilla ical.js 2.2.1 as RFC 5545, uses CRLF and UTF-8 folding, and excludes internal-only maintenance and internal component names. Rescheduling keeps UID, raises SEQUENCE and changes the event window; cancellation yields STATUS:CANCELLED. Scheduled and in-progress events remain available; completed windows leave the feed. The public footer's Maintenance calendar link is proven at 1440/390. Wording is carried by MAINT-009 and calendar-client/email attachments by MISSING MAINT-010. Additional push-Verify evidence: `tests/e2e/helpers/maintenance-calendar-flow.mjs` (emptyMaintenanceCalendarFlow, called by publishing-contract setup before any maintenance exists) strictly checks the empty public /maintenance.ics response for CRLF, VERSION, PRODID and a UTC VTIMEZONE component. The same strict validator requires UID and DTSTAMP on every VEVENT in maintenanceCalendarFlow. Repair proposal: `tests/e2e/helpers/maintenance-calendar-flow.mjs` (emptyMaintenanceCalendarFlow, loaded by the existing MAINT-007 Per-window automation case in `tests/e2e/publishing-contract.test.mjs`, publishing shard) asserts the actual empty /maintenance.ics response has TZID Etc/UTC, STANDARD/DAYLIGHT observance, DTSTART, +0000 TZOFFSETFROM and TZOFFSETTO, with balanced BEGIN/END boundaries. Each VTIMEZONE in both empty and populated feeds must have those required properties. Negative assertions reject component-free calendars, missing TZID, missing observance, missing DTSTART, either missing offset and mismatched observance boundaries with the specific reason. maintenanceCalendarFlow retains the UID/SEQUENCE reschedule and STATUS:CANCELLED assertions.

### MAINT-007 prior Status evidence

`tests/e2e/publishing-contract.test.mjs` (Per-window automation, scheduled transitions, notices, extension and cancellation), `tests/e2e/helpers/maintenance-calendar-flow.mjs` (maintenanceCalendarFlow), `tests/e2e/helpers/accessibility-subscription-flow.mjs`. The public retained /maintenance.ics response parses with Mozilla ical.js 2.2.1 as RFC 5545, uses CRLF and UTF-8 folding, and excludes internal-only maintenance and internal component names. Rescheduling keeps UID, raises SEQUENCE and changes the event window; cancellation yields STATUS:CANCELLED. Scheduled and in-progress events remain available; completed windows leave the feed. The public footer's Maintenance calendar link is proven at 1440/390. Wording is carried by MAINT-009 and calendar-client/email attachments by MISSING MAINT-010.  Additional push-Verify evidence: `tests/e2e/helpers/maintenance-calendar-flow.mjs` (emptyMaintenanceCalendarFlow, called by publishing-contract setup before any maintenance exists) strictly checks the empty public /maintenance.ics response for CRLF, VERSION, PRODID and a UTC VTIMEZONE component. The same strict validator requires UID and DTSTAMP on every VEVENT in maintenanceCalendarFlow. Repair proposal: `tests/e2e/helpers/maintenance-calendar-flow.mjs` (emptyMaintenanceCalendarFlow, loaded by the existing MAINT-007 Per-window automation case in `tests/e2e/publishing-contract.test.mjs`, publishing shard) asserts the actual empty /maintenance.ics response has TZID Etc/UTC, STANDARD/DAYLIGHT observance, DTSTART, +0000 TZOFFSETFROM and TZOFFSETTO, with balanced BEGIN/END boundaries. Each VTIMEZONE in both empty and populated feeds must have those required properties. Negative assertions reject component-free calendars, missing TZID, missing observance, missing DTSTART, either missing offset and mismatched observance boundaries with the specific reason. maintenanceCalendarFlow retains the UID/SEQUENCE reschedule and STATUS:CANCELLED assertions.

### MAINT-008 prior evidence

Status: **missing**.

### MAINT-008 prior Gap

Not built.

### MAINT-009 prior evidence

Status: **partial** — `tests/e2e/maintenance-request-mail.test.mjs` (required maintenance wording reaches scheduled, reminder and start mail without duplicate dispatch), `tests/e2e/maintenance-timezone.test.mjs` (Native maintenance editing preserves zones and daylight saving and persists window automation choices), `tests/e2e/publishing-contract.test.mjs` (Per-window automation, scheduled transitions, notices, extension and cancellation) and `scripts/test-owner-migrations.mjs`. New native windows require affected-audience and customer-impact statements of at most 250 characters each; existing window-update doors edit the pair atomically and preserve omitted wording. Scheduled, 24-hour reminder and start emails carry both statements beside the window through shared UPDATE-002 wording and existing link rendering. Each notice freezes its wording; legacy windows remain title-only without backfill. Existing automation switches, Settings defaults, transition guards, start-due and overrun behavior remain proven. Create, scheduled-window and in-progress window editors pass axe, overflow and hydration checks at 1440/390. RELEASE.json records MAINT-001, MAINT-002, MAINT-004 and MAINT-005 as changed with the precise new-window wording scope; legacy timing and overrun semantics are unchanged. Gap: Optional what-still-works and details wording; wording drafts and previews; calendar wording and proof of non-email wording surfaces; Updates during the window; Every door; Verifying; imported Statuspage automation and message mapping; NOTIFY-016 push remain unbuilt or unproven.

### MAINT-009 prior Status evidence

`tests/e2e/maintenance-request-mail.test.mjs` (required maintenance wording reaches scheduled, reminder and start mail without duplicate dispatch), `tests/e2e/maintenance-timezone.test.mjs` (Native maintenance editing preserves zones and daylight saving and persists window automation choices), `tests/e2e/publishing-contract.test.mjs` (Per-window automation, scheduled transitions, notices, extension and cancellation) and `scripts/test-owner-migrations.mjs`. New native windows require affected-audience and customer-impact statements of at most 250 characters each; existing window-update doors edit the pair atomically and preserve omitted wording. Scheduled, 24-hour reminder and start emails carry both statements beside the window through shared UPDATE-002 wording and existing link rendering. Each notice freezes its wording; legacy windows remain title-only without backfill. Existing automation switches, Settings defaults, transition guards, start-due and overrun behavior remain proven. Create, scheduled-window and in-progress window editors pass axe, overflow and hydration checks at 1440/390. RELEASE.json records MAINT-001, MAINT-002, MAINT-004 and MAINT-005 as changed with the precise new-window wording scope; legacy timing and overrun semantics are unchanged.

### MAINT-009 prior Gap

Optional what-still-works and details wording; wording drafts and previews; calendar wording and proof of non-email wording surfaces; Updates during the window; Every door; Verifying; imported Statuspage automation and message mapping; NOTIFY-016 push remain unbuilt or unproven.

### MAINT-010 prior evidence

Status: **missing**.

### MAINT-010 prior Gap

Calendar-client use and maintenance-email .ics attachments carved from MAINT-007; not built.

### SUB-013 previous evidence and status

Status: **partial** — `tests/e2e/delivery-contract.test.mjs` (Attributed operator additions, confirmed component scope, private management and opt-out, delivery shard), loading `tests/e2e/helpers/sms-subscriber-flow.mjs` (smsSubscriberFlow) and `tests/e2e/helpers/sms-browser-runtime.mjs` / `tests/e2e/helpers/sms-browser-flow.mjs` (smsBrowserFlow). At the synthetic Twilio HTTP edge, the native public form admits US/Canada E.164 numbers, rejects malformed and disabled-country numbers including non-US/Canada NANP numbers, and admits an owner-enabled country. Repeated opt-ins send one text per number per 24 hours naming the page, frequency, rates and HELP/STOP. Unsigned and wrong-signature replies return 401 without mutations or sends; signed YES records number, actual consent time, page and exact wording once. STOP, UNSUBSCRIBE, CANCEL, END and QUIT each deactivate immediately with one confirmation, including replay deduplication; HELP carries the page and support contact. A selected active number receives one publish, unconfirmed numbers receive only their opt-in, unrelated components send nothing and the next publication after STOP records suppression. Incident, maintenance and report SMS carry intact HTTPS URLs with punctuation outside, literal non-HTTPS schemes, no provider shortening/tracking fields and a complete permanent public link; an overlength update stays within two segments without a partial URL. Mixed email/phone/webhook CSV preview returns created/skipped/refused counts with no writes or sends; operator Add preserves phone components and sends one opt-in. Native browser assertions cover subscribe, Add, country Settings and the SMS composer control with axe, overflow, hydration and full-label checks at 1440/390. `tests/auth-adoption/upgrade.test.mjs` preserves populated 0064 subscriber/token/delivery history through additive `migrations/core/0065_sms_subscriptions.sql`; `tests/e2e/export-import.test.mjs` retains the six durable SMS tables; `tests/e2e/subscriber-erasure.test.mjs` erases SMS consent, replay authority and provider identifiers while preserving another subscriber. `tests/e2e/helpers/subscriber-add-flow.mjs` additionally proves that without provider configuration a valid public phone request returns 503 with no subscriber creation or fallback mail. Optional Twilio environment fields are labelled in setup and declared in seed.json; its nonGoals stay unchanged. Partial proposal, uncounted pending ct judgment. Gap: Twilio test-account receipt pending (held-key Mac run); released seed.json nonGoals SMS exclusion is removed by the release that ships the full clause; page names or support contacts whose complete carrier wording exceeds two segments are refused rather than truncated.

### SUB-014 previous evidence and status

Status: **done** — `tests/e2e/channels-and-presets.test.mjs` (SUB-014 NOTIFY-011 NOTIFY-012 UPDATE-013 — Private channels deliver the selected publication once with literal text and punctuated links, notifications shard), loading `tests/e2e/helpers/self-serve-chat-flow.mjs` (selfServeChatFlow) and `tests/e2e/slack-subscriptions-helper.mjs` (prepareSlackSubscription, removeSlackSubscription, verifySlackPublication). The recorded synthetic provider-edge request and response in `tests/fixtures/slack-subscriptions/oauth-exchange.json` are matched at the real Slack OAuth adapter: POST, client, code and callback path; the public Get updates in Slack control requests only incoming-webhook, selects components and completes cookie-free hashed-state installation at 1440/390. The active subscription receives the next eligible publish, and its webhook is stored encrypted in the existing subscriber-owned Slack kind from additive migration `migrations/core/0056_subscriber_channels_preferences.sql`. The signed app_uninstalled payload in `tests/fixtures/slack-subscriptions/events.json`, using its test signing secret, deactivates the subscription with that reason; selfServeChatFlow asserts the next publication skips it. verifySlackPublication asserts See <https://help.example.com/kb/123>. with punctuation outside the URL. The recorded tokens_revoked payload also deactivates and suppresses the next publish; a channel_is_archived edge reply deactivates with that reason and later publication skips it. Continuation and callback axe, overflow and script-error checks pass at both widths. `tests/e2e/update-reminders.test.mjs` (INCIDENT-010 — INCIDENT-011 NOTIFY-016 AGENT-002 AUTO-003 owner reminders, durable follow-ups, reasoned failure dismissal and Queue recovery follow the original commitment) consumes the same OAuth reply and preserves the separation of public subscriptions from private operator alerts. These are recorded synthetic edge fixtures; no live Slack install or provider acceptance is claimed. Completion is a proposal pending ct judgment.

### SUB-015 previous evidence and status

Status: **done** — Synthetic Workflows network-edge proof: `tests/e2e/channels-and-presets.test.mjs` (SUB-014 NOTIFY-011 NOTIFY-012 UPDATE-013 — Private channels deliver the selected publication once with literal text and punctuated links), `tests/e2e/helpers/self-serve-chat-flow.mjs` (selfServeChatFlow) and `tests/e2e/teams-subscriptions-helper.mjs`. A native public form sends a verification Adaptive Card; only channel confirmation activates the encrypted selected-component subscription, which receives the next publish. Non-Microsoft hosts return 400. Bare HTTPS links show the URL itself with punctuation outside. Other schemes and markup are asserted for the operator card in `tests/e2e/channels-and-presets.test.mjs`:135-146; the subscriber card proof asserts the Acceptance sentence’s HTTPS link. Ten failed deliveries deactivate the endpoint and the next publish skips it. Submission, channel confirmation and success screens pass axe, overflow and hydration checks at 1440/390. No live Teams call was made from this run.

### SUB-016 previous evidence and status

Status: **partial** — `tests/e2e/delivery-contract.test.mjs` (Attributed operator additions, confirmed component scope, private management and opt-out), `tests/e2e/helpers/subscriber-preferences-flow.mjs` (subscriberPreferencesFlow), `tests/e2e/helpers/subscriber-intake-browser-flow.mjs` and `tests/e2e/helpers/webhook-format-browser-flow.mjs`. Public subscription, operator Add and session-free token management retain component, event-kind and impact-threshold preferences for email, webhook, Slack and Teams. The recorded email edge receives nothing for a Degraded incident and receives its escalation; maintenance-only email and webhook recipients receive maintenance notices and no incident. Webhooks default to component changes; other channels do not. Existing public, management and operator screens pass axe, overflow and hydration checks at 1440/390. `tests/e2e/helpers/chat-preferences-flow.mjs` (chatPreferencesFlow), within the existing private-channel journey in `tests/e2e/channels-and-presets.test.mjs`, proves maintenance-only Slack and Teams, incident suppression, retained-recipient rescheduling and cancellation, and configured-zone delivery. `tests/e2e/helpers/sms-subscriber-flow.mjs` (smsSubscriberFlow, loaded by the same existing delivery registration) proves a signed-YES SMS subscriber edits preferences on the session-free SUB-007 management page, receives the maintenance start and no incident on the same component. Partial Gap narrowing is a proposal pending ct judgment. Gap: single-incident following waits for SUB-019; audience subscriptions wait for AUD-004. SMS component-only status notifications remain unbuilt.

### SUB-017 previous evidence and status

Status: **done** — `tests/e2e/statuspage-import.test.mjs` (imports keep history silent, CSV dry runs write nothing, and pending subscribers receive only explicit owner invitations), `tests/e2e/helpers/subscriber-csv-flow.mjs`, `tests/e2e/delivery-contract.test.mjs` (Attributed operator additions, confirmed component scope, private management and opt-out), `tests/e2e/helpers/subscriber-add-flow.mjs`, `tests/e2e/helpers/subscriber-intake-browser-flow.mjs`. Public operator CSV preview writes nothing and reports 97 created plus three reasoned refusals from 100 rows; apply creates 97 pending subscriptions without mail. Explicit invitations send 50, then 47, then zero, and CSV export retains 97 rows with channel, state, selections and consent time. The Add subscriber public door sends one confirmation; after confirmation its two selected components receive updates and a third does not. The private list and audit record the adding operator. At 1440/390 native browser journeys prove Add, attribution, dry run, apply, explicit idempotent invitations and CSV export. Phone, multi-language and over-limit obligations are carried by SUB-013, I18N-001 and SUB-020 after the approved carves; API-001 inherits its future door. Additional push-Verify evidence: `tests/e2e/statuspage-import.test.mjs` (MOVE-002 — SUB-017 and SUB-020 imports keep history silent, CSV dry runs write nothing, pending subscribers need explicit invitations, and capacity refuses excess without writes), loading `tests/e2e/helpers/subscriber-csv-flow.mjs` and `tests/e2e/helpers/subscriber-intake-browser-flow.mjs` in the imports-statuspage shard. The authenticated owner-only batch-summary door returns each durable CSV batch and its remaining eligible invitations without destinations or tokens. Native reads prove 97 to 47 to zero remaining across existing bounded send actions, signed-out 401 and public-host 404; the existing public role policy refuses member invitations with 403 while the owner read returns 200. At 1440/390 two import batches remain selectable after reload, each sends only on the existing explicit action, and both retain zero remaining after another reload. The screen passes axe, overflow and hydration checks; the completed batch action is disabled. Additional phone-carve evidence: `tests/e2e/helpers/sms-subscriber-flow.mjs` (smsSubscriberFlow) and `tests/e2e/helpers/sms-browser-flow.mjs` (smsBrowserFlow), within the existing delivery registration, prove phone CSV dry-run counts with no writes and Add subscriber phone/component selection with one opt-in at 1440/390. Valid phones no longer receive the former SUB-013-unavailable refusal; SUB-017 status is unchanged.

### SUB-018 previous evidence and status

Status: **partial** — `src/core/shared/statuspage-mapping.ts`, `src/core/shared/statuspage-records.ts`, `src/core/features/deliveries/statuspage-webhook.ts`, `src/core/features/deliveries/statuspage-webhook.repository.ts`, `src/core/features/subscribers/webhook-format.repository.ts`, `src/core/features/subscribers/ui/webhook-format.tsx`, `tests/e2e/helpers/statuspage-webhook-receiver.mjs`, `tests/e2e/helpers/statuspage-webhook-flow.mjs`, `tests/e2e/helpers/statuspage-webhook-maintenance.mjs`, `tests/e2e/delivery-contract.test.mjs` (the existing signed-webhook journey, extended and retitled; receiver authored from this clause and frozen before delivery implementation). New webhook subscriptions choose Lamp or Statuspage through the operator add, legacy creation and optional CSV webhook_format doors; omission defaults new subscriptions to Lamp and preserves an existing recipient choice on legacy retry. The recipient management form changes the format inside its existing token-authorized transaction. A canonical subscriber column preserves it through technical archives and page-data JSON. The public API and webhook renderer use one status, stable native/imported ID and record projection. A strict controlled receiver accepts the three incident bodies with complete one/two/three-update arrays and existing maintenance notices/windows; exact-body HMAC signatures verify, unsubscribe links work, no subscriber address is present, and the impact text See https://help.example.com/kb/123. remains plain and unchanged. Browser proof in `tests/e2e/helpers/subscriber-intake-browser-flow.mjs` and `tests/e2e/helpers/webhook-format-browser-flow.mjs` covers the private chooser and public management form at 1440 and 390. Component-change bodies and acceptance belong to NOTIFY-017; imported webhook format belongs to MOVE-010, and maintenance in-window wording/updates to MAINT-009, after the approved carves. Gap: The existing public subscribe form accepts email only, so there is no public webhook form in which to mount a format chooser. Operator creation, CSV and token-authorized management expose the choice. Default ADOPTED: PARTIAL pending ct ruling on whether these existing doors meet anyone subscribing a new endpoint; existing subscriptions retain Lamp unless explicitly changed.

### SUB-019 previous evidence and status

Status: **missing**.

### SUB-020 previous evidence and status

Status: **done** — `tests/e2e/statuspage-import.test.mjs` (MOVE-002 — SUB-017 and SUB-020 imports keep history silent, CSV dry runs write nothing, pending subscribers need explicit invitations, and capacity refuses excess without writes), `tests/e2e/helpers/subscriber-limits-flow.mjs` (subscriberLimitsFlow, subscriberChannelLimitsFlow) and `tests/e2e/helpers/subscriber-limits-browser-flow.mjs` (subscriberLimitsBrowserFlow). A direct fixture-database setup inserts 24,998 subscriptions and two public opt-ins reach 25,000; script-free public POSTs for a new and an existing address return identical 409 pages with Atom/RSS links, create nothing and send nothing. Recorded operator mail receives each 80% and 100% alert once; full Follow-ups remain until below capacity. The 300-into-100-free import and CSV each name an excess of 200, refuse exactly those rows, and refuse apply without changing any application table or mail; narrowed fresh dry runs apply. A full installation also refuses a single-row import unchanged. Saved and recorded fixed-origin API responses with 5,000 and 25,000 subscribers fit without narrowing. Pending/active counts and webhook/chat sublimits are enforced atomically. Subscribers (/app/subscribers), Move in, Follow-ups and full-capacity public pages pass axe, overflow and hydration checks at 1440/390. This is fixture admission proof, not a 25,000-recipient delivery qualification. Gap: SUB-019 carries incident-subscription limits and NOTIFY-016 carries the 80% and 100% capacity alerts by name (ct 24 October 2026 07:10Z). MOVE-007, MOVE-008 and MOVE-010 remain unbuilt and inherit Imports at the limit by name. Additional phone-carve evidence: `tests/e2e/helpers/sms-subscriber-flow.mjs` (smsSubscriberFlow) and `tests/e2e/helpers/sms-browser-flow.mjs` (smsBrowserFlow), within the existing delivery registration, prove phone CSV dry-run counts with no writes and Add subscriber phone/component selection with one opt-in at 1440/390. Valid phones no longer receive the former SUB-013-unavailable refusal; SUB-017 status is unchanged.

### NOTIFY-013 previous evidence and status

Status: **partial** — `tests/e2e/delivery-contract.test.mjs` (NOTIFY-013 NOTIFY-002 NOTIFY-004 NOTIFY-005 NOTIFY-007 NOTIFY-008 NOTIFY-010 — Durable email capture, delivery records and frozen headers), loading `tests/e2e/helpers/mail-failover-flow.mjs`, `tests/e2e/helpers/mail-provider-fixtures.mjs` and `tests/e2e/helpers/mail-settings-browser-flow.mjs` in push Verify’s delivery shard. Real public sign-in, subscription, confirmation, owner Settings, publish, scheduled and Queue doors use only provider network-edge fixtures. Resend 503 failures reach Mailgun, SES or Postmark once at six controlled minutes with a frozen submitted Message-ID, accepting-provider log and no replay after primary recovery; rapid Queue replays do not exhaust the failover deadline. Secondary sending defaults off and requires an explicit owner selection from deployment-connected providers. The production Settings selector and real delivery acceptance row run at 1440/390 with reload persistence, axe, overflow and hydration assertions. Accepted receipts survive disabled or removed secondary configuration, while unconfirmed routing and changed credentials deny a new provider submission. Mailgun HMAC and SES SNS signatures reject invalid fixtures and deactivate hard-bounced addresses; Postmark’s documented Basic authentication is proved without calling it a payload signature. Existing `tests/e2e/sendgrid-provider.test.mjs` and Resend event assertions retain their signed callback coverage. Provider domain reads and disabled tracking are asserted, including explicit disabled SES VDM engagement metrics, no OPEN/CLICK destinations and the configured SNS feedback route. `tests/e2e/maintenance-request-mail.test.mjs` pins the stable non-incident Message-ID; populated technical archive journeys retain routing and owner selection. Gap: Reported-outage switching is unbuilt. Postmark offers authenticated rather than native signed payloads, so the signed-events sentence remains unmet for it. SES rewrites the received Message-ID, so the same-Message-ID sentence remains unmet for SES failover. Ambiguous primary submissions, including SendGrid HTTP 5xx responses, deliberately stop rather than crossing providers; only explicit safe retryable rejections enable failover. These existing obligations remain partial pending ct judgment.

### NOTIFY-014 previous evidence and status

Status: **partial** — `tests/e2e/helpers/sms-delivery-receipts-flow.mjs` (smsDeliveryReceiptsFlow), loaded by the existing attributed-subscriber journey in `tests/e2e/delivery-contract.test.mjs`, push Verify delivery shard: a public publish sends exactly three requests through the Twilio network-edge fake with SUB-013 rendering unchanged, the full URL and outside period, and no shortening/tracking option or redirect; three signed callbacks record delivered receipts; fresh publications record undelivered and failed, while unsigned and wrong-signature callbacks return 401 and leave SMS storage and the delivery log unchanged; the operator log exposes subscriber, SMS channel, update, queue/outcome instants, channel/outcome/update filters and matching CSV rows, the delivered and SMS + Failed exports carrying each text's providerOutcome (delivered, undelivered, failed). `tests/e2e/helpers/sms-browser-flow.mjs` (smsBrowserFlow via smsBrowserRuntime in the same registration) matches SMS delivery-log rows to each filter's response by phone, pill state and provider outcome, and audits rows and filters at 1440/390 for axe, overflow, unclipped controls and hydration. PARTIAL PROPOSAL, uncounted pending ct judgment. Gap: Twilio test-account receipt pending (held-key Mac run); Settings cost estimate, monthly spend cap, cap confirmation queue and stated acceptance time are not built; Plivo (V3 signatures) and retryable failover are not built; the throughput bound is stated, not measured (NOTIFY-018); released seed.json nonGoals SMS exclusion stays until the release that ships the full clause.

### NOTIFY-015 previous evidence and status

Status: **done** — `src/core/features/communication-performance/repository.ts`, `src/core/features/communication-performance/ui/incident-reach.tsx`, `tests/e2e/helpers/communication-performance-flow.mjs`. The incident panel shows each update and distinct incident reach from committed email/webhook delivery rows, with separate provider acceptance, signed email delivery outcomes and CSV. Its own visible polling leaves the composer untouched; imported source delivery is labeled unknown.

### NOTIFY-016 previous evidence and status

Status: **partial** — `tests/e2e/update-reminders.test.mjs` (INCIDENT-010 — INCIDENT-011 NOTIFY-016 AGENT-002 AUTO-003 owner reminders, durable follow-ups, reasoned failure dismissal and Queue recovery follow the original commitment), loading `tests/e2e/helpers/operator-alerts-flow.mjs` in push Verify’s notifications shard. Repeated controlled overdue ticks produce exactly one email, one opted-in operator Slack post and one Teams post, carrying the incident reference and operator-app link. Subscriber destinations and publication-only operator channels receive no private alerts. A terminal subscriber failure is rendered without an address, subscriber identifier or provider error. A real public opt-in crosses the 80% capacity boundary and produces deduplicated capacity alerts with /app/subscribers; the same path carries SUB-020 capacity events. Migration 0060 leaves existing channels opted out. Owner/admin API controls and `tests/e2e/helpers/channel-deletion-flow.mjs` (operatorAlertSettingsBrowserFlow), loaded by the existing private-channels registration in `tests/e2e/channels-and-presets.test.mjs`, prove default-off creation, explicit opt-in and opt-out retained across reload at 1440/390, with axe, overflow and hydration assertions. Consent is checked again before queued sends; opting out prevents the queued Slack alert while still-consenting Teams receives its event. Gap: Push to installed operator devices (MOBILE-002), DEP-003 vendor alerts and HIST-006 traffic alerts remain unbuilt.

### NOTIFY-017 previous evidence and status

Status: **partial** — Public-door proof: `tests/e2e/delivery-contract.test.mjs` (Statuspage receiver compatibility, signed webhook delivery, provider receipts and bounce suppression), `tests/e2e/helpers/statuspage-webhook-flow.mjs` and `tests/e2e/helpers/component-notification-flow.mjs` (componentNotificationFlow). The unchanged strict receiver accepts every component_update field for committed operator, incident publication/resolution/attachment/detachment and maintenance start/completion transitions. Lamp component.changed carries old/new state, instant and claimant kind without operator identity. Webhooks default to component changes; email without that selection, internal components, repeated unchanged claims and corrections stay silent. Incident carriers deduplicate normal Lamp subscriptions while component-only and explicitly opted-in Statuspage subscriptions receive exactly one old-to-new change. Browser preferences proof runs at 1440/390. Gap: Monitor or alert-source claims under AUTO-001, automation email under INTAKE-013, vendor feeds under DEP-001 and AUTO-002’s flap guard are not built. Current claimants are operator standing claims, incidents and maintenance.

### NOTIFY-018 previous evidence and status

Status: **partial** — `src/core/features/deliveries/service.ts`, `tests/e2e/delivery-contract.test.mjs`. NOTIFY-002's 5-minute bound ships and is tested for email at the subscriber limit. No bound is stated or tested for webhooks, Slack, Teams or SMS.

### NOTIFY-019 previous evidence and status

Status: **partial** — `src/core/shared/email-branding.ts`, `src/core/features/page-settings/ui/email-branding-settings.tsx`, `tests/e2e/helpers/email-branding-worker-flow.mjs`, `tests/e2e/helpers/email-branding-browser-flow.mjs`, `tests/e2e/page-data.test.mjs`. Display name and Reply-To work with SendGrid and Resend. Subject prefixes, uploaded same-host logos, plain-text headers/footers, shared preview, immutable retry envelopes and page-data export/restore ship. Managed mail supports subject/logo/wording but owns From and does not accept Reply-To; Settings and restore refuse unsupported identity settings. Audience-specific settings await AUD-001. Provider transport is proven against network-edge fixtures, not live inbox receipt.

### NOTIFY-020 previous evidence and status

Status: **partial** — `src/core/features/deliveries/service.ts`, `tests/e2e/delivery-contract.test.mjs:942`. Durable queued email delivery ships, with the 5-minute bound qualified only locally at 1,000 subscribers under a 10-per-second fake quota (`seed.json → limits`). There is no hosted run, no qualification above 1,000, no provider batch sending, and no check of the provider account's rate.

Original proof sentences, old acceptance table cells and daily-use status notes for these clauses are retained verbatim in docs/contract/intake-details.md. No new tests or product setup code changed.

### AUD-001 source record

Status: **missing**. Replaces the released `seed.json → nonGoals` exclusions of more than one page per deployment and of private or audience-scoped pages.

### AUD-002 source record

Status: **missing**.

### AUD-003 source record

Status: **missing**.

### AUD-004 source record

Status: **missing**.

### AUD-005 source record

Status: **missing**.

### API-001 source record

Status: **partial** — `src/core/features/management-api/`, `src/core/features/metrics/`, `migrations/core/0063_management_metric_tokens.sql`, `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow, existing notifications case in `tests/e2e/channels-and-presets.test.mjs`) and `tests/e2e/helpers/metrics-portability-flow.mjs` (native rer archive in `tests/auth-adoption/portability.test.mjs`, ownership-authority shard). The bounded metrics:write slice proves bearer next-snapshot ingestion, no-scope refusal, token/issuer audit attribution, hash-only storage, last-used time, immediate revoke and inert metadata after restore. Replaces the released `seed.json → nonGoals` exclusion of a token API when the full clause ships. The read slice uses the same issuance, hash-only bearer authority, immediate revoke and last-used metadata: GET /api/v1/components returns components and groups to an explicit read token; a no-scope or metrics:write-only token receives 403, and a revoked read token receives 401 without usage changes. `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow, existing INTAKE-014 INTAKE-011 INTAKE-009 registration in `tests/e2e/channels-and-presets.test.mjs`, notifications shard) asserts each public-door result. `migrations/core/0064_management_read_tokens.sql` adds opt-in read metadata; `tests/auth-adoption/upgrade.test.mjs` (ACCESS-001 TEAM-001 TEAM-002 upgrade preserves identities, history and subscriber authority and destroys legacy credentials, ownership-upgrade shard) proves populated 0063 metadata survives without acquiring read scope. `tests/e2e/helpers/metrics-portability-flow.mjs` in the existing native archive registration (ownership-authority shard) retains read metadata and refuses its old bearer after restore. No Settings screen changes. Proposal pending ct judgment. `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow, existing INTAKE-014 INTAKE-011 INTAKE-009 registration in `tests/e2e/channels-and-presets.test.mjs`, notifications shard) additionally asserts GET /api/v1/metrics returns the same sanitized metric definitions as the operator door to an explicit read bearer without a cookie; no-scope and metrics:write-only bearers receive 403; immediate revocation returns 401; refusals leave usage metadata unchanged. Datadog, New Relic, Pingdom and Prometheus query fixtures prove neither plaintext nor sealed provider credentials are returned. The existing read authorization, rate limit and final credential fence are shared; no scope or migration is added. Proposal pending ct judgment. Gap: Read is built only for components, groups and metric definitions; the other read resources, components:write, incidents:write, maintenance:write, subscribers:write and admin scopes, OpenAPI 3.1 and a generated incident-lifecycle client remain unbuilt. Component-state token attribution, incident-publication refusal and audit-view acceptance remain unproved.

### API-002 source record

Status: **missing**.

### API-003 source record

Status: **missing**.

### API-004 source record

Status: **missing**.

### INTEG-001 source record

Status: **missing**.

### INTEG-002 source record

Status: **missing**.

### MOBILE-001 source record

Status: **done** — `src/core/app/client/ui/responsive.css`, `src/core/features/intake/ui/alerts-page.tsx`, `tests/e2e/helpers/phone-desk-flow.mjs`. Native terminal-link sign-in, signed-alert draft, attachment, autosave/reload, preview, publish, resolution, standing claim and maintenance scheduling pass at 390×844 and 1440 px, with accessibility, overflow and 44 px phone-control checks.

### MOBILE-001 source record

Native terminal-link sign-in, signed-alert draft, attachment, autosave/reload, preview, publish, resolution, standing claim and maintenance scheduling pass at 390×844 and 1440 px, with accessibility, overflow and 44 px phone-control checks.

### MOBILE-002 source record

Status: **missing**.

### MOVE-007 source record

Status: **missing**.

### MOVE-008 source record

Status: **missing**.

### MOVE-009 source record

Status: **done** — `src/core/features/statuspage-import/public-paths.mjs`, `src/core/features/public-snapshot/import-aliases.ts`, `src/core/features/statuspage-import/operating-notes.ts`, `tests/e2e/statuspage-import.test.mjs`, `tests/e2e/cutover-browser.test.mjs`, `tests/e2e/public-contract.test.mjs`. History and Atom aliases, Statuspage /api/v2 read endpoints, RSS and the `/embed/script.js` floating notice are served after import, and Cutover lists them as served. Cutover's Operating Lamp after Statuspage guide carries the correction-update, component-state and degraded-only notes at 1440 and 390 px. Webhook bodies (SUB-018, MOVE-010) and automation addresses (INTAKE-013) are those clauses' to ship; Cutover names them unavailable until then.

### MOVE-009 source record

History and Atom aliases, Statuspage /api/v2 read endpoints, RSS and the /embed/script.js floating notice are served after import, and Cutover lists them as served. Cutover's Operating Lamp after Statuspage guide carries the correction-update, component-state and degraded-only notes at 1440 and 390 px. Webhook bodies (SUB-018, MOVE-010) and automation addresses (INTAKE-013) are those clauses' to ship; Cutover names them unavailable until then.

### MOVE-010 source record

Status: **missing**. Released imports carry email subscribers only (`src/core/features/statuspage-import/`).

### MOVE-011 source record

Status: **done** — `src/core/features/statuspage-import/postmortems.ts`, `src/core/features/statuspage-import/templates.ts`, `tests/e2e/helpers/postmortem-template-import-flow.mjs`, `tests/e2e/helpers/imported-template-apply-flow.mjs`, `tests/e2e/statuspage-import.test.mjs`, `tests/e2e/publishing-contract.test.mjs`. Statuspage published reports retain original times, draft reports remain private, and templates retain metadata, component states and full oversized wording for shortening. Dry run, silent apply, repeat and conditional undo cover both. Status.io and incident.io carry the same rules as part of MOVE-007 and MOVE-008. The next release records MOVE-001, MOVE-002 and MOVE-004 as changed; 1.8.0 shipped the reader without that record.

### MOVE-011 source record

Statuspage published reports retain original times, draft reports remain private, and templates retain metadata, component states and full oversized wording for shortening. Dry run, silent apply, repeat and conditional undo cover both. Status.io and incident.io carry the same rules as part of MOVE-007 and MOVE-008. The next release records MOVE-001, MOVE-002 and MOVE-004 as changed; 1.8.0 shipped the reader without that record.

### MOVE-012 source record

Status: **partial** — `src/core/features/statuspage-import/betterstack/read.ts`, `src/core/features/statuspage-import/instatus/normalize.ts`, `src/core/features/statuspage-import/sorry/read.ts`, `tests/betterstack/reader.test.mjs:47`. The Better Stack, Instatus and Sorry readers refuse private, password-protected, IP-restricted and audience-scoped sources rather than publishing them. The Statuspage reader also requires page and page-access-group responses and refuses private, IP-restricted, audience-scoped or unknown visibility (MOVE-012 in `tests/auth-adoption/cutover.test.mjs`). Importing private and audience pages as private (AUD-001 to AUD-005) is not built.

### PORT-001 source record

Status: **partial** — `tests/e2e/export-import.test.mjs`, `scripts/installer/archive-policy.mjs`. Export, clean restore and equivalent re-export cover every released record (HIST-004). Built target records (Uptime and grouped intake sources and their mappings, PagerDuty sources) travel in the full-table archive, with the PagerDuty REST key written as NULL so the restored source asks to reconnect. Gap: Slack and Teams `channel_destinations.sealed_url` ciphertext travels in both archives (`scripts/export.mjs`, `scripts/installer/archive-policy.mjs`), and a restore with the same `WEBHOOK_SIGNING_SECRET` posts without reconnecting, so restored integrations are not all disabled until reconnected. Pages, audiences, roles, vendor components, metrics, translations, SMS consent and API-token metadata are not built.

### PORT-002 source record

Status: **partial** — `tests/e2e/subscriber-erasure.test.mjs`, `tests/auth-adoption/operator-erasure.test.mjs`. Subscriber and operator erasure ship for released records. The identifiers that target clauses add are not built.

### AGENT-001 source record

Status: **partial** — `src/core/features/brief/build.ts`, `src/core/features/ai/service.ts`, `tests/e2e/incident-brief.test.mjs`. The model-free brief flags a monitor recovery with a non-resolved lifecycle and a passed commitment, and an operator can request a cited suggestion (DRAFT-001, DRAFT-004). Continuous comparison against responder, monitor and support evidence does not exist.

### AGENT-002 source record

Status: **done** — `src/core/features/incidents/promise-draft.ts`:16, `src/core/features/incidents/promise-draft.repository.ts`:6, `src/core/features/incidents/reminders.ts`:24, `tests/e2e/update-reminders.test.mjs`:57, `tests/e2e/incident-brief.test.mjs`:86, `tests/e2e/helpers/prepared-draft-flow.mjs`:8. Model-free preparation from the existing brief is wired before due reminders: a private draft restates the last published impact and cites newer accepted evidence, or states that nothing has changed. An atomic receipt limits preparation to one per incident and committed time; existing saved drafts are never overwritten. The composer carries private Lamp attribution and complete cited evidence, and the owner reminder links to it; unowned fallback follows INCIDENT-011. Preparation changes no commitment or publication and queues no subscriber notification. The named native Worker journeys prove one cited draft and owner reminder, preserved operator drafts, unchanged original commitments after overdue, no subscriber event, no model request, byte-identical public surfaces and working private composer citations at 1440 and 390. No gap remains for this clause.

### AGENT-002 source record

Model-free preparation from the existing brief is wired before due reminders: a private draft restates the last published impact and cites newer accepted evidence, or states that nothing has changed. An atomic receipt limits preparation to one per incident and committed time; existing saved drafts are never overwritten. The composer carries private Lamp attribution and complete cited evidence, and the owner reminder links to it; unowned fallback follows INCIDENT-011. Preparation changes no commitment or publication and queues no subscriber notification. The named native Worker journeys prove one cited draft and owner reminder, preserved operator drafts, unchanged original commitments after overdue, no subscriber event, no model request, byte-identical public surfaces and working private composer citations at 1440 and 390. No gap remains for this clause.

### AGENT-003 source record

Status: **partial** — `src/core/features/incidents/service.ts`, `tests/reference-storage/incident-publishing.test.mjs`. Each update carries an operator-written affected-audience statement (UPDATE-001). There are no audiences and no drafted variants.

### AGENT-004 source record

Status: **done** — `src/core/features/brief/recovery-check.ts`, `src/core/features/incidents/recovery-repository.ts`, `src/core/features/incidents/publication-repository.ts`, `tests/e2e/helpers/recovery-check-flow.mjs` (AGENT-004 through `tests/e2e/incident-brief.test.mjs`). Firing, recovery holds, re-fires and partial grouped recovery refuse unreasoned publication; a named operator's override is private and atomically audited.

### AGENT-005 source record

Status: **done** — `src/core/features/reports/draft.ts`, `src/core/features/reports/service.ts`, `src/core/features/reports/ui/report-editor.tsx`, AGENT-005 in `tests/e2e/publishing-contract.test.mjs` and `tests/e2e/helpers/post-incident-report-flow.mjs`. Private cited drafts, empty flagged fields, refusal until human completion, preservation of edits, and immutable publication are exercised through operator doors.

### AGENT-006 source record

Status: **missing**.

### AGENT-007 source record

Status: **missing**.

### AGENT-008 source record

Status: **missing**.

### AGENT-009 source record

Status: **missing**.

### SETUP-001 source record



### SETUP-002 source record



### ACCESS-001 source record



### MOVE-001 source record



### MOVE-002 source record



### MOVE-003 source record



### MOVE-004 source record



### MOVE-005 source record



### MOVE-006 source record



### AUD-001 source record

Replaces the released `seed.json → nonGoals` exclusions of more than one page per deployment and of private or audience-scoped pages.

### AUD-002 source record

Nothing built yet.

### AUD-003 source record

Nothing built yet.

### AUD-004 source record

Nothing built yet.

### AUD-005 source record

Nothing built yet.

### API-001 source record

`src/core/features/management-api/`, `src/core/features/metrics/`, `migrations/core/0063_management_metric_tokens.sql`, `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow, existing notifications case in `tests/e2e/channels-and-presets.test.mjs`) and `tests/e2e/helpers/metrics-portability-flow.mjs` (native rer archive in `tests/auth-adoption/portability.test.mjs`, ownership-authority shard). The bounded metrics:write slice proves bearer next-snapshot ingestion, no-scope refusal, token/issuer audit attribution, hash-only storage, last-used time, immediate revoke and inert metadata after restore. Replaces the released `seed.json → nonGoals` exclusion of a token API when the full clause ships. The read slice uses the same issuance, hash-only bearer authority, immediate revoke and last-used metadata: GET /api/v1/components returns components and groups to an explicit read token; a no-scope or metrics:write-only token receives 403, and a revoked read token receives 401 without usage changes. `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow, existing INTAKE-014 INTAKE-011 INTAKE-009 registration in `tests/e2e/channels-and-presets.test.mjs`, notifications shard) asserts each public-door result. `migrations/core/0064_management_read_tokens.sql` adds opt-in read metadata; `tests/auth-adoption/upgrade.test.mjs` (ACCESS-001 TEAM-001 TEAM-002 upgrade preserves identities, history and subscriber authority and destroys legacy credentials, ownership-upgrade shard) proves populated 0063 metadata survives without acquiring read scope. `tests/e2e/helpers/metrics-portability-flow.mjs` in the existing native archive registration (ownership-authority shard) retains read metadata and refuses its old bearer after restore. No Settings screen changes. Proposal pending ct judgment. `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow, existing INTAKE-014 INTAKE-011 INTAKE-009 registration in `tests/e2e/channels-and-presets.test.mjs`, notifications shard) additionally asserts GET /api/v1/metrics returns the same sanitized metric definitions as the operator door to an explicit read bearer without a cookie; no-scope and metrics:write-only bearers receive 403; immediate revocation returns 401; refusals leave usage metadata unchanged. Datadog, New Relic, Pingdom and Prometheus query fixtures prove neither plaintext nor sealed provider credentials are returned. The existing read authorization, rate limit and final credential fence are shared; no scope or migration is added. Proposal pending ct judgment. Gap: Read is built only for components, groups and metric definitions; the other read resources, components:write, incidents:write, maintenance:write, subscribers:write and admin scopes, OpenAPI 3.1 and a generated incident-lifecycle client remain unbuilt. Component-state token attribution, incident-publication refusal and audit-view acceptance remain unproved.

### API-002 source record

Nothing built yet.

### API-003 source record

Nothing built yet.

### API-004 source record

Nothing built yet.

### INTEG-001 source record

Nothing built yet.

### INTEG-002 source record

Nothing built yet.

### MOBILE-001 source record

`src/core/app/client/ui/responsive.css`, `src/core/features/intake/ui/alerts-page.tsx`, `tests/e2e/helpers/phone-desk-flow.mjs`. Native terminal-link sign-in, signed-alert draft, attachment, autosave/reload, preview, publish, resolution, standing claim and maintenance scheduling pass at 390×844 and 1440 px, with accessibility, overflow and 44 px phone-control checks.

### MOBILE-002 source record

Nothing built yet.

### MOVE-007 source record

Nothing built yet.

### MOVE-008 source record

Nothing built yet.

### MOVE-009 source record

`src/core/features/statuspage-import/public-paths.mjs`, `src/core/features/public-snapshot/import-aliases.ts`, `src/core/features/statuspage-import/operating-notes.ts`, `tests/e2e/statuspage-import.test.mjs` (MOVE-005 case), `tests/e2e/cutover-browser.test.mjs` (MOVE-009 case), `tests/e2e/public-contract.test.mjs` (MOVE-009 case). History and Atom aliases (MOVE-005), Statuspage /api/v2 read endpoints, RSS and the `/embed/script.js` floating notice are served after import; Cutover lists them as served and its Operating Lamp after Statuspage guide carries the correction-update, component-state and degraded-only notes. Webhook bodies (SUB-018, MOVE-010) and automation addresses (INTAKE-013) are those clauses' to ship; Cutover names them unavailable until then.

### MOVE-010 source record

Released imports carry email subscribers only (`src/core/features/statuspage-import/`).

### MOVE-011 source record

`src/core/features/statuspage-import/postmortems.ts`, `src/core/features/statuspage-import/templates.ts`, `tests/e2e/helpers/postmortem-template-import-flow.mjs`, `tests/e2e/helpers/imported-template-apply-flow.mjs`, `tests/e2e/statuspage-import.test.mjs` (MOVE-011 cases), `tests/e2e/publishing-contract.test.mjs`. Statuspage published reports retain original times, draft reports remain private, and templates retain metadata, component states and full oversized wording for shortening. Dry run, silent apply, repeat and conditional undo cover both. Status.io and incident.io carry the same rules as part of MOVE-007 and MOVE-008.

### MOVE-012 source record

`src/core/features/statuspage-import/betterstack/read.ts`, `src/core/features/statuspage-import/instatus/normalize.ts`, `src/core/features/statuspage-import/sorry/read.ts`, `tests/betterstack/reader.test.mjs:47`. The Better Stack, Instatus and Sorry readers refuse private, password-protected, IP-restricted and audience-scoped sources rather than publishing them. The Statuspage reader reads no visibility at all (`docs/moving-in.md`), so a private Statuspage page would import as public, and private and audience pages (AUD-001 to AUD-005) are not built.

### PORT-001 source record

`tests/e2e/export-import.test.mjs`, `scripts/installer/archive-policy.mjs`. Export, clean restore and equivalent re-export cover every released record (HIST-004). Built target records (Uptime and grouped intake sources and their mappings, PagerDuty sources) travel in the full-table archive, with the PagerDuty REST key written as NULL so the restored source asks to reconnect. Gap: Slack and Teams `channel_destinations.sealed_url` ciphertext travels in both archives (`scripts/export.mjs`, `scripts/installer/archive-policy.mjs`), and a restore with the same `WEBHOOK_SIGNING_SECRET` posts without reconnecting, so restored integrations are not all disabled until reconnected. Pages, audiences, roles, vendor components, metrics, translations, SMS consent and API-token metadata are not built.

### PORT-002 source record

`tests/e2e/subscriber-erasure.test.mjs`, `tests/auth-adoption/operator-erasure.test.mjs`. Subscriber and operator erasure ship for released records. The identifiers that target clauses add are not built.

### AGENT-001 source record

`src/core/features/brief/build.ts`, `src/core/features/ai/service.ts`, `tests/e2e/incident-brief.test.mjs`. The model-free brief flags a monitor recovery with a non-resolved lifecycle and a passed commitment, and an operator can request a cited suggestion (DRAFT-001, DRAFT-004). Continuous comparison against responder, monitor and support evidence does not exist.

### AGENT-002 source record

`src/core/features/incidents/promise-draft.ts`:16, `src/core/features/incidents/promise-draft.repository.ts`:6, `src/core/features/incidents/reminders.ts`:24, `tests/e2e/update-reminders.test.mjs`:57, `tests/e2e/incident-brief.test.mjs`:86, `tests/e2e/helpers/prepared-draft-flow.mjs`:8. Model-free preparation from the existing brief is wired before due reminders: a private draft restates the last published impact and cites newer accepted evidence, or states that nothing has changed. An atomic receipt limits preparation to one per incident and committed time; existing saved drafts are never overwritten. The composer carries private Lamp attribution and complete cited evidence, and the owner reminder links to it; unowned fallback follows INCIDENT-011. Preparation changes no commitment or publication and queues no subscriber notification. The named native Worker journeys prove one cited draft and owner reminder, preserved operator drafts, unchanged original commitments after overdue, no subscriber event, no model request, byte-identical public surfaces and working private composer citations at 1440 and 390. No gap remains for this clause.

### AGENT-003 source record

`src/core/features/incidents/service.ts`, `tests/reference-storage/incident-publishing.test.mjs`. Each update carries an operator-written affected-audience statement (UPDATE-001). There are no audiences and no drafted variants.

### AGENT-004 source record

`tests/e2e/helpers/recovery-check-flow.mjs` through AGENT-004 in `tests/e2e/incident-brief.test.mjs`: firing and held recovery, later re-fire, partial grouped recovery, scheduled refusal, private reason and audit attribution; operator browser at 1440/390. Absent sources are not tracked; DEP-001, HIST-006, INTEG-001 and COMP-008 inherit before shipping, as CONTRACT specifies.

### AGENT-005 source record

AGENT-005 in `tests/e2e/publishing-contract.test.mjs` and `tests/e2e/helpers/post-incident-report-flow.mjs`: every available source cited, empty flagged human fields, unchanged prompts refused with 400, edits preserved and immutable publication; 1440/390 operator and public browser journey. Recorded window is not monitor-measured downtime; INTAKE-012/009/014 timeline capabilities and COMP-008/UPTIME-007 evidence inherit before shipping.

### AGENT-006 source record

Nothing built yet.

### AGENT-007 source record

Nothing built yet.

### AGENT-008 source record

Nothing built yet.

### AGENT-009 source record

Nothing built yet.


## Previous status and claim record — 26 October 2026

Judged from the code and tests at commit `9e1301e331992add4badf8b5e9ded34bc88d1f26` (26 October 2026). Rows changed after that commit name their own journeys under Evidence.

INTAKE-009 is judged done on 21 October 2026 on the 1.10.0 release candidate, which inventories its migration 0042, from its named API, browser and native archive journeys below.

UPDATE-013 is judged done on 21 October 2026 on the 1.10.0 release candidate from its named native Worker, controlled-receiver, recorded network-edge and browser journeys below; 1.10.0 records UPDATE-001 and UPDATE-002 as changed.

AGENT-002 is judged done on 23 October 2026 from its named native Worker and 1440/390 composer journeys at `0d6a2603125275533581db516548144f06b0b161`.

INTAKE-011 history: before c23, the partial rationale was “Metric ingestion and the public chart are not built; waiting for UPTIME-008” (parent of d593176, CONTRACT.md). The displayed-template proof is now repaired as a proposal; ct acceptance remains separate. UPTIME-008 now also proposes completion from its retention boundaries and metrics:write token push; API-001 remains partial for its other acceptance points.

SUB-014 completion is a proposal pending ct judgment and is uncounted in fleet acceptance totals.

### Product claim status

The full product inventory and counts are in [CONTRACT.md](CONTRACT.md). These rows record the clauses built in the 18–19 October 2026 daily-use rounds.

| Clause | Status | Proven | Remaining |
| --- | --- | --- | --- |
| TEAM-007 | partial | Settings audit filters, pagination, matching CSV, state and maintenance records, component/group deletions, anonymized erased actors; incident-component removal without an aggregate state change, template component replacement, import removals/replacements and subscriber expiry are audited atomically; repeated subscriber tombstone erasure records no duplicate successful deletion. Existing Worker and 1440/390 browser journeys carry the assertions (`tests/e2e/helpers/audit-log-flow.mjs:6`, `tests/auth-adoption/operator-erasure.test.mjs:17`). | Logo removal/replacement; standing-claim removal without an aggregate state change; restored subscriber expiry proof. The logo and standing-claim repositories are held by open uip template branches. TEAM-004, AUTO-001 and API-001 add role-restricted access and their role, rule and token events. |
| HIST-007 | done | Current email/webhook counts by channel, state, component and deactivation reason; anonymous observed daily growth, JSON/CSV parity and archive restore; Worker and 1440/390 browser journeys. | None for this clause; AUD-004 and I18N-001 add audience and language breakdowns, and daily history before tracking is labeled unknown. |
| INTAKE-010 | done | Documented Alertmanager v4/Grafana v1 grouped payloads, exact label mapping, per-fingerprint deduplication and recovery, unmapped receipts, private drafts, archive restore and 1440/390 browser journeys. | None for this clause; automatic claims remain AUTO-001/COMP-008. |
| AGENT-004 | done | Linked alert and grouped-member recovery check, five-minute reported recovery hold, atomic private audited override and scheduled recheck; named API and 1440/390 browser journey. | DEP-001, HIST-006, INTEG-001 and COMP-008 must join before shipping; absent evidence is explicitly not tracked. |
| AGENT-005 | done | Model-free report drafts from every held alert/update with source citations, empty flagged human fields, incomplete-publish refusal, preserved edits and immutable publication; API and 1440/390 browser journeys. | Recorded window is labeled as recorded. INTAKE-012/009/014 timelines and COMP-008/UPTIME-007 measured evidence inherit before shipping. |
| INTAKE-008 | done | Uptime default schema-2 HMAC envelopes, monitor mapping, exact-body and stale refusal, isolated deduplication, brief evidence, unpublished recovery and 1440/390 journeys. | AUTO-001/COMP-008 must consume the same verified evidence before claims ship. |
| UPTIME-009 | done | Component month/quarter CSV/PDF reports with shared claimed uptime math, weighted downtime, all overlapping incident claims and maintenance, authenticated actual downloads and 1440/390 journeys. | UPTIME-007/COMP-008 must add measured figures when linked evidence ships; AUD-003 must add sharing when audience pages ship. |
| INCIDENT-012 | partial | Signed Slack and Teams requests, hashed one-time linking, private incident drafts, shared preview, explicit attributed publication and one-history-row component changes; real Worker and fake provider/receiver edges. Chat links survive the full-table archive. | Settings linking panel is unmounted; live workspaces/tenants were not used. TEAM-004 carries roles. Transient link/preview/replay authority awaits the archive-policy owner; wait ten minutes before transfer. |

## Accepted main social-posting proposal — 28 October 2026

Source: `f27975c13c0bcbac7dc20a399a3092449cfed545`. Its authoritative Status row remains target/missing.

Status: **done** — DONE proposal pending ct judgment. Acceptance 1: `tests/e2e/channels-and-presets.test.mjs` (INTEG-002 SUB-014 NOTIFY-011 NOTIFY-012 UPDATE-013 — Private channels deliver the selected publication once with literal text and punctuated links), loading `tests/e2e/helpers/social-posts-flow.mjs` (socialPostsFlow) proves one bounded prefixed lifecycle/impact/permalink post per connected X, Bluesky and Mastodon account against recorded synthetic API fixtures. Acceptance 2: the same test and helper prove native reply fields preserve one incident thread and maintenance posts only when chosen. Acceptance 3: the same test and helper prove explicit deselection queues nothing, per-update defaults, retroactive/import silence, and publish/Queue redelivery without duplicates. Acceptance 4: the same test and helper prove one X 503 send plus five retries, a failed delivery with attempt/outcome times, one operator alert, and page/Atom/email/healthy-account isolation. Credentials are sealed, absent from account APIs and durable delivery envelopes, and no raw provider error is logged; private/internal service origins and missing write scopes are refused. `tests/e2e/helpers/social-browser-flow.mjs` (socialBrowserFlow), loaded by that registration, proves Settings connect/remove/default controls, hidden saved credentials, and composer defaults/deselection/reset; Settings and composers at 1440 and 390 have no horizontal overflow, serious/critical accessibility findings or page/hydration errors. No live provider acceptance is claimed. UIP-GATE-NEEDED. Generator absent: judged Status rows/counts and generated documents await ct/lander upkeep.

Original source Gap: DONE proposal pending ct judgment; generator absent, so historical judged status/counts remain unchanged.

The retained 1.11.0 snapshots remain unchanged. Edition 1.11.1 carries the accepted main addition, migration 0066 and its original buyer instructions; INTEG-002 remains a Core target at its authoritative missing status pending ct judgment.

## 2026-10-28 — Unified import door implementation record

Evidence: `tests/e2e/sorry-import.test.mjs`, including `tests/e2e/helpers/import-door-flow.mjs`, is the seeded-page/held-subscriber public journey. Existing [Verify run 40637046257](https://github.com/just-every/run-lamp/actions/runs/40637046257) at `f27975c13c0bcbac7dc20a399a3092449cfed545` executed [imports-sorry job 122646353995](https://github.com/just-every/run-lamp/actions/runs/40637046257/job/122646353995) successfully (one test passed, zero failed). That execution used synthetic local test-install data and synthetic trust; it is neither a hosted test-page acceptance nor a signed real-export receipt.
