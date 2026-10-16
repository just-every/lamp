# CONTRACT.md — Lamp

This is the product Lamp is being built towards: a full replacement for Atlassian Statuspage, Better Stack Status Pages and Status.io that also goes past Instatus and incident.io Status Pages. A buyer of any of those products should be able to switch to Lamp. The document states the whole target and, clause by clause, how close the current build is.

## How to read this contract

Lamp has two kinds of clause, and they look different on purpose.

*Released clauses* are bullet items whose bold lead is the clause ID and title. Each one is a guarantee of the current release and has at least one tagged test. `pnpm verify` refuses a released clause that has no planned tagged journey (`scripts/verification/check-plan.mjs`). `pnpm validate:release` requires `RELEASE.json` to record every released clause added, changed or removed since the previous snapshot in `release-history/`. This target round did not change their text.

*Target clauses* are level-four headings (`#### AREA-NNN — Title.`) under each area's "target" heading. Each one gives the behaviour a buyer gets, its acceptance evidence (the journey or test through a public door that proves it) and its status: done, partial or missing, judged from the code and tests at the commit named in the status table. A target clause is not yet a release guarantee. The release that builds one moves it into bullet form with its tagged test and an `added` entry in `RELEASE.json`. When a target clause replaces released wording (for example TEAM-004 replaces TEAM-001's "There are no roles"), that release records the released clause as `changed` and removes the matching `seed.json → nonGoals` entry.

Every released clause has a stable ID and at least one tagged test; `pnpm verify` reports each as satisfied, overridden, or broken. Security, privacy, and operational guarantees are in `BASELINE.md`; a clause here may supersede one of them by naming its `BASE-` ID (PAGE-008, SUB-003, and SUB-005 do; target clauses API-001 and AUD-002 will). Capacity and rate limits are in `seed.json → limits`. Times are p95 at those limits, except the scheduled publication and automatic maintenance transition bounds: those 240-second bounds are declared promises based on one local stress observation, not p95 measurements over independent runs or hosted Cron guarantees. Clauses marked *Policy* have a default that buyers may replace through the named extension point.

## Scope

Lamp is the status page and incident communication product for one business. It does the whole job the category's incumbents sell:

- *Pages.* A public status page, private pages behind SSO or IP allow-lists for staff, and audience-specific pages for named enterprise customers. They are served on the buyer's own domain from infrastructure that keeps answering when the reported service, or Lamp's primary host, is down.
- *Components that follow evidence.* Component state comes from operators, from accepted alerts, from Uptime monitors and monitoring tools under explicit owner rules, and from the public status feeds of third-party vendors such as AWS, Cloudflare, Stripe and GitHub.
- *Incidents and maintenance.* Impact-first updates with templates, review, scheduled publication, next-update commitments, communication owners, post-incident reports and permanent history.
- *Distribution.* One publish reaches the page, the Atom and RSS feeds, the widget, badges, the public JSON API, email, SMS, webhooks, Slack and Microsoft Teams. Subscribers choose components and events on every channel, and each audience receives its own wording.
- *Team.* Roles, SSO enforcement, SCIM, audit, a mobile operator desk and push reminders.
- *Follow-up and automation.* Reminders before a promised update lapses, escalation, maintenance that starts and ends itself, report-due follow-up, automatic component changes under owner rules, redundant delivery and a visible list of every pending obligation.
- *Integrations.* Uptime, Oncall, Datadog, PagerDuty, Prometheus Alertmanager, Grafana, New Relic, UptimeRobot, Better Stack, Pingdom, SendGrid, Mailgun, Amazon SES, Postmark, Twilio, Plivo, Slack, Microsoft Teams, HappyToHelp, Zendesk, Intercom, Okta, Microsoft Entra ID, Google Workspace, GitHub Actions and Terraform.
- *Moving in.* Imports from Statuspage, Status.io, Better Stack, Instatus, incident.io and Sorry, with existing public addresses, feed readers and API consumers kept working.
- *Agents.* An agent keeps the public story in line with responder evidence, drafts audience and language variants, keeps next-update promises and checks customer-visible recovery. A named operator approves everything that reaches a customer.

Lamp is US-first: prices and costs in USD, SMS consent under TCPA and CTIA rules with 10DLC or toll-free registration, CAN-SPAM-compatible notification mail, and Section 508 / WCAG 2.2 AA accessibility for enterprise and public-sector buyers.

**Sibling products keep their own jobs.** Lamp tells customers what is happening. It does not measure and it does not page. [Uptime](https://github.com/just-every/run-uptime) is the monitor: it runs the checks and Lamp consumes its signed evidence (COMP-008, INTAKE-008, UPTIME-007). [Oncall](https://github.com/just-every/run-oncall) pages and escalates responders: Lamp takes in its incidents and timeline (INTAKE-012) and hands it unowned communication deadlines (INCIDENT-011). [HappyToHelp](https://github.com/just-every/run-happytohelp) is the support desk: Lamp gives it incident context (INTEG-001). [Auth](https://github.com/just-every/run-auth) is one identity provider for operator and private-page sign-in (TEAM-006, AUD-002). Visitor analytics belong to [Vane](https://github.com/just-every/run-vane); Lamp keeps only the aggregate counters HIST-006 needs. Shared code between these products is welcome. Shared products are not.

Nothing an automated source sends reaches a customer unless an operator publishes it, or unless an owner-approved automation rule (AUTO-001) publishes a saved template the owner wrote in advance. Lamp reports state; it does not measure it. Every component state comes from an operator, an accepted alert, an owner rule over monitor or vendor evidence, or an incident or maintenance, and never from a probe Lamp runs itself.

## Owner documentation

- **DOCS-001 — Public owner documentation.** The app host serves `/docs` and each published `/docs/<slug>` page as public documentation built from repository Markdown selected by `docs/site.json`. Documentation is available without an operator session; the public page host does not serve it.

## Public page

- **PAGE-001 — Contents.** `GET /` on the status page host returns, in one response: the overall status; every visible component with its current state and note; every unresolved incident with its 5 most recent published updates, newest first, and a link to that incident's page carrying all of them; every maintenance that is in progress and every scheduled maintenance starting within 14 days; and each visible component's uptime figure and daily record for the reporting window.
- **PAGE-002 — Readable without script.** The complete content of PAGE-001, and the subscribe form of SUB-001, are present and usable in the initial HTML response. With JavaScript disabled, every status, update, and timestamp is rendered and readable and the subscribe form submits. Script preserves the page’s configured time zone and its visible label; operator entry, timelines, previews and public timestamps use that same zone.
- **PAGE-003 — Weight.** At the component limit in `seed.json → limits`, the public page's initial HTML response is at most 50KB gzipped, and the page issues at most 4 further requests — stylesheet, font, logo, script — all to its own origin.
- **PAGE-004 — Overall status.** *Policy: `page.status-rollup.v1`; default: the overall status is the most severe current state among visible components, under the order in COMP-001.* It is shown as one labelled state at the top of the page. With every visible component Operational and no unresolved incident, that label reads as operational.
- **PAGE-005 — Snapshot read path.** Every change to the content in PAGE-001 writes a complete rendered snapshot of the public page, the Atom feed, and the widget payload to object storage. Serving those three surfaces reads the snapshot and issues no database query. A snapshot write that fails is retried until it succeeds and is reported as a failed job under BASE-OPS-004; the previous snapshot keeps serving until it does.
- **PAGE-006 — Serving through a failure.** When the database, the queue, or object storage is unreachable, the three surfaces in PAGE-005 return 200 — from the current snapshot, or from the cached response under the `stale-if-error` directive of PAGE-007 when the origin itself cannot answer. They return 503 only when no snapshot has ever been written. A response that could not be built from current data states the instant its content was generated and is labelled as the last known state; no failed read ever produces the all-clear of PAGE-004. `/health` still reports 503 per BASE-OPS-001; the public page's availability does not depend on it.
- **PAGE-007 — Publish latency and caching.** Stable public URLs validate the current snapshot generation on reuse with a generation ETag and `Cache-Control: public, max-age=0, stale-if-error=3600`. Immutable artifact bytes are cached by generation and artifact key; advancing the published generation makes previous cache entries ineligible for a healthy current response. An update, component state change, or maintenance transition is readable on the status page, history, incident and maintenance permalinks, Atom feed, widget and public JSON within 10 seconds of the request that caused it returning 200. An unreachable origin may use its retained response for the one-hour error window; the application also retains labelled last-known snapshots under PAGE-006.
- **PAGE-008 — Public read paths are not rate limited.** The public read paths marked `read` in `seed.json → deploy.publicPaths` never return 429. Requests from one address up to the `publicPageRequestsPerSecond` limit in `seed.json → limits` all return 200. **Supersedes BASE-ACCESS-003** for those paths only. A status page is read hardest at the moment it matters most, and a per-address limit would reject real readers behind one egress address during an incident — but the decisive reason is mechanical: RFC 6585 requires that a 429 is never stored by a cache, so rate limiting the read path converts a cacheable traffic spike into an uncacheable one and sends it all to the origin. Those paths share immutable generation bytes in the edge cache. Healthy requests validate the current generation without querying the database; artifact caching reduces object-byte reads, while validation requests still reach the Worker. The public write paths (`/subscribe`, `/unsubscribe`, `/manage`, `/api/intake/*`) stay rate limited under BASE-ACCESS-003.
- **PAGE-009 — Time display.** Every timestamp on a public surface or in a notification is rendered in the page's configured timezone with its UTC offset, and every timestamp on the page carries the same instant as an ISO 8601 value in a machine-readable attribute.
- **PAGE-010 — Atom feed.** `/feed.atom` validates as Atom 1.0 and contains one entry for every published incident update and for every maintenance notice — scheduled, rescheduled, started, completed, cancelled — from the last 12 months, ordered newest first. An entry's identifier is stable from first publication and is never reused.
- **PAGE-011 — Embeddable widget.** One script tag renders a banner showing the overall status and any unresolved incident, read from the PAGE-005 snapshot. The script is at most 10KB gzipped, loads only from the deployment's origin, and renders only on the host origins listed in settings per BASE-PUBLIC-002.
- **PAGE-012 — Branding.** Page name, logo, accent colour, timezone, hostname, and a footer-credit toggle are set in settings without a code change. The footer credit is the plain static text `Powered by Lamp`, defaults on, and disabling it makes no network action. The logo is served from the deployment's own origin. The favicon composites a mark for the current overall status over the configured logo rather than replacing it, and the page carries Open Graph metadata whose title and image state the current overall status.
- **PAGE-013 — Enforced isolation.** Every public page response carries a `Content-Security-Policy` whose `default-src`, `script-src`, `style-src`, `img-src`, `connect-src`, `form-action`, and `base-uri` name only the deployment's own origin, and `frame-ancestors 'none'`, together with `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. The page contains no CAPTCHA and no consent banner, because it stores nothing on the visitor's device and loads nothing that would need either.
- **PAGE-014 — Live refresh.** When script is available the page re-reads `/api/public/status` at most every 30 seconds and updates the overall status and the newest update in place. That response is a fixed set of fields whose size does not grow with the number of components. The region it updates is an ARIA live region, so a change is announced without a reload. With script disabled the page does not refresh itself and states the instant its content was generated.

### Public page — target

#### PAGE-015 — Served independently of what it reports.

The public page, feeds, widget, badges and public API are served on the buyer's custom domain. The owner adds a hostname, and Lamp provisions it as a Cloudflare custom hostname with an automatically issued TLS certificate and shows the exact DNS record to create. Every snapshot generation (PAGE-005) is also copied to a secondary static origin that the owner chooses on a separate provider: an AWS S3 bucket behind CloudFront, a Backblaze B2 bucket, or a second Cloudflare account. The documented DNS failover serves that copy when the primary Worker cannot answer. The copy carries the PAGE-006 "last known state" label and its generation instant. A secondary copy that falls more than two generations or 5 minutes behind is reported to operators under BASE-OPS-004.

Acceptance: a custom-hostname journey shows the DNS record and certificate state, and serves `/` on that hostname. In a fault test the primary origin is stopped after a publish; the secondary serves the newest generation, labelled, within 60 seconds. A failing mirror write shows as a failed job on Overview.

Status: **partial** — `src/core/app/host-dispatch.ts`, `src/core/features/page-settings/service.ts`, `tests/e2e/public-contract.test.mjs`. The configured hostname, isolated public-host routing and retained snapshots (PAGE-006) ship. Custom-hostname provisioning and the secondary origin do not.

#### PAGE-016 — Statuspage-compatible public API.

The public host serves `/api/v2/summary.json`, `/api/v2/status.json`, `/api/v2/components.json`, `/api/v2/incidents.json`, `/api/v2/incidents/unresolved.json`, `/api/v2/scheduled-maintenances.json`, `/api/v2/scheduled-maintenances/upcoming.json` and `/api/v2/scheduled-maintenances/active.json` with Statuspage v2 field names, ID formats, impact values and status indicators (`none`, `minor`, `major`, `critical`, `maintenance`). Lamp's Component states and lifecycle map onto those values in a documented table. Existing Statuspage clients, scripts and dashboards therefore switch by changing only the hostname. A Lamp-native `/api/public/v1/` serves the same records with complete incident timelines, post-incident reports and cursor pagination. Every response is read from the PAGE-005 snapshot with no database query, allows any origin under CORS, is cached under PAGE-007 and is never rate limited under PAGE-008. Internal components, internal notes and private-page records never appear.

Acceptance: a snapshot test validates every v2 response against Statuspage's published v2 schema fixtures, and an unmodified Statuspage client library reads a Lamp page. With the database unavailable, every path still returns 200 from the snapshot.

Status: **partial** — `src/core/features/public-snapshot/routes.ts`, `tests/e2e/public-contract.test.mjs`. The fixed-size `/api/public/status` (PAGE-014) ships. The v2-compatible and native record APIs do not.

#### PAGE-017 — RSS and per-component feeds.

`/feed.rss` is a valid RSS 2.0 feed with exactly the entries, order and stable identifiers of the Atom feed in PAGE-010. `/history.rss` and `/history.atom` (the Statuspage paths) serve the same feeds on every installation, not only after an import. Each visible component also has `/components/<slug>/feed.atom` and `/components/<slug>/feed.rss`, carrying only the incidents and maintenance that claimed a state on that component. All feeds are snapshot artifacts.

Acceptance: the W3C feed validator accepts every feed. A component feed omits an incident that never touched that component. A feed reader polling `/history.rss` before and after a publish sees the new entry within PAGE-007's 10 seconds.

Status: **partial** — `src/core/features/public-snapshot/feed-widget.ts`, `tests/e2e/public-contract.test.mjs`. The Atom feed ships, and `/history.atom` is aliased after a Statuspage or Instatus import (MOVE-005). RSS and per-component feeds do not.

#### PAGE-018 — Status badges.

`/badge.svg` renders a shields-style SVG with the overall status. `/components/<slug>/badge.svg` renders one component's state, and `/components/<slug>/uptime.svg` its uptime figure for the reporting window. `/badge.json` returns the shields.io endpoint schema, so README badges and dashboards can embed status without script. Badges are snapshot artifacts of at most 2KB, use the page's state colours with a text label so colour is never the only signal, and are cached by generation under PAGE-007.

Acceptance: a test fetches each badge after a component change and finds the new label within 10 seconds. shields.io's endpoint badge renders `/badge.json`. With the database unavailable, badges are served from the snapshot.

Status: **missing**.

#### PAGE-019 — Embed variants.

Besides the PAGE-011 banner, the owner can choose a floating notice that appears in a corner of the host page only while an incident is unresolved or a maintenance is in progress (Statuspage's status embed), and a compact status dot with a label for site headers and footers. The owner sets position and colours. Every variant reads the same snapshot payload, stays within PAGE-011's 10KB and origin allow-list, and shows nothing at all when everything is operational, if the owner chooses.

Acceptance: a browser journey embeds each variant on an allow-listed origin and an origin that is not listed. Only the allow-listed origin renders, and the floating notice appears and disappears with the incident.

Status: **partial** — `src/core/features/public-snapshot/feed-widget.ts`, `tests/e2e/public-contract.test.mjs`. The banner widget ships; the floating notice and status dot do not.

#### PAGE-020 — Accessible to the standard US buyers require.

Every public page, private page, subscription page and email meets WCAG 2.2 AA. The project publishes a VPAT (Section 508 edition) for the current release, so enterprise and public-sector buyers can procure it. Component and incident states are never conveyed by colour alone, and the live region of PAGE-014 is announced by screen readers.

Acceptance: the accessibility suite runs axe at 1440 and 390 widths on the public page, history, incident permalink, maintenance permalink, subscription management and a private page with no serious or critical finding. A keyboard-only journey subscribes and manages a subscription.

Status: **partial** — `tests/e2e/accessibility.test.mjs`. An accessibility suite covers the public and operator documents. There is no VPAT, and no WCAG 2.2 AA conformance claim across every surface.

### Theming and languages — target

#### THEME-001 — Full brand theming and custom CSS.

In Settings, without a code change, the owner sets background, surface, text, link and per-state colours (Lamp checks each pair against WCAG AA contrast before saving), a font from the bundled set or an uploaded WOFF2 served from the page's own origin, a header image, custom header and footer links, and layout choices: groups collapsed or expanded, uptime bars shown or hidden per component, and how many days of history appear on the page. Owner CSS is accepted when it contains no `@import`, no `url()` to another origin, no `expression()` and no `behavior`. It is scoped to the page and shipped inside the snapshot stylesheet, so PAGE-003 and PAGE-013 still hold.

Acceptance: a settings journey changes every theme field, and the next snapshot shows them. CSS with `@import` or an external `url()` is refused with 400 and the offending rule named. A colour pair below 4.5:1 is refused. The page weight check of PAGE-003 passes with custom CSS present.

Status: **partial** — `src/core/features/page-settings/service.ts`, `src/core/features/public-snapshot/branding.ts`, `tests/e2e/public-contract.test.mjs`. Name, logo, accent colour, timezone, hostname, favicon and footer credit (PAGE-012) ship. Full palette, fonts, layout options and custom CSS do not.

#### I18N-001 — Pages in several languages.

The owner picks a default language and any additional languages from a shipped set. American English and US Spanish come first, then French, German, Brazilian Portuguese and Japanese. Every fixed string on public and private pages, in feeds, in emails and SMS, and on subscription pages is translated. Times follow PAGE-009 in each locale's format. Each language has its own snapshot under `/<lang>/` with `hreflang` alternates and a visible language switcher. Accept-Language suggests a language through a link and never silently changes what a URL serves. Each subscriber has a language, chosen when subscribing and changeable from SUB-007's page.

Acceptance: with English and Spanish enabled, `/es/` renders every fixed string in Spanish, in the initial HTML and without script. A Spanish-language subscriber's email uses the Spanish template. Turning a language off removes its pages from the next snapshot.

Status: **missing**. Released `seed.json → nonGoals` excludes multi-language pages; this clause replaces that exclusion.

#### I18N-002 — Translated updates.

Each update can carry its text in every enabled language. The composer shows each language beside the default, and preview (UPDATE-004) renders each one. When a language has no text, the operator either supplies it or explicitly chooses "publish in the default language for this language", which is recorded on the update. Notifications go out in each subscriber's language. Translation never delays the default-language publication: the operator can publish the default language first and add translations as a correction-free addition, marked "translation added at" on that language's timeline.

Acceptance: a publish with English and Spanish text sends Spanish email to Spanish subscribers and English email to the rest. A publish with no Spanish text and no explicit choice is refused with 400, naming the language. Adding the Spanish text later notifies nobody a second time, and NOTIFY-005 still holds.

Status: **missing**.

## Components

- **COMP-001 — States and their order.** A component's public state is exactly one of Operational, Degraded performance, Partially unavailable, Major outage, or Under maintenance. Those states are ordered by severity, most severe first: Major outage, Partially unavailable, Degraded performance, Under maintenance, Operational. Every clause that says "most severe" means this order.
- **COMP-002 — Grouping and order.** A component belongs to at most one group. Operators set the order of groups and of components within a group, and the public page renders them in that order.
- **COMP-003 — Append-only state history.** Every change to a component's public state appends an entry recording the previous state, the new state, the instant of the change, and the operator or incident that caused it. An entry is never modified or removed; a correction under UPTIME-004 appends a superseding entry rather than altering the one it corrects.
- **COMP-004 — State note.** A component has a note of at most 250 characters, empty by default. When it is not empty it is shown beside that component's state on the public page exactly as entered.
- **COMP-005 — Internal components.** A component marked internal is absent from the public page, the Atom feed, the widget, and every uptime figure, and never contributes to the overall status.
- **COMP-006 — Component state is claimed, not set.** Three things claim a state for a component: an unresolved incident, an in-progress maintenance, and an operator's standing claim set outside either. An incident or maintenance claims a state per attached component, chosen when the component is attached. A component's public state is the most severe of the states claimed for it, and Operational when nothing claims it. Resolving an incident, completing a maintenance, attaching or detaching a component, and setting or clearing an operator claim each recompute that component's state by this rule within 10 seconds.
- **COMP-007 — Deletion.** Deleting a component removes it and its state history from the public page and from every uptime figure within 10 seconds. Incidents and maintenance that referenced it keep the component's name in their published updates.

### Components — target

#### COMP-008 — Monitor claims from measured evidence.

A component can be linked to one or more Uptime monitors, or to a monitor in another tool through its intake preset (INTAKE-006, INTAKE-008 to INTAKE-011). A linked monitor becomes a fourth kind of claimant in COMP-006, beside incidents, maintenance and operators. When an AUTO-001 rule allows it, a confirmed failure claims the state the rule names, and the confirmed recovery releases that claim. Each claim records the monitor, the evidence instant and the rule in COMP-003's history. Unknown or stale monitor evidence never claims Operational, and it never releases a claim another claimant holds.

Acceptance: an Uptime signed failure for a monitor linked under an "automatic" rule moves the component to the named state on the page within 30 seconds and appends a history entry naming the monitor. The signed recovery releases the claim, while an operator's standing claim on the same component survives. A component whose rule only drafts changes no public state.

Status: **missing**. Released COMP-006 names three claimants; the release that ships this clause records COMP-006 as changed.

#### COMP-009 — Component bulk editing and descriptions.

Operators create, edit, reorder and delete components and groups in bulk, through a table view and CSV import. Each component has an optional public description (at most 500 characters, plain text), shown on the page behind a disclosure, and a start date from which its uptime is shown (UPTIME-003).

Acceptance: a CSV of 50 components with groups and descriptions imports through a dry run that writes nothing, then applies. The page renders the new order, and the descriptions open without script through `<details>`.

Status: **partial** — `src/core/features/components/service.ts`, `tests/e2e/public-contract.test.mjs`. Components, groups, ordering and notes (COMP-002, COMP-004) ship. Bulk editing, CSV import and descriptions do not.

### Third-party dependencies — target

#### DEP-001 — Vendor components that follow vendor status.

An operator adds a third-party component from a catalogue: AWS, Google Cloud, Microsoft Azure, Cloudflare, Fastly, Vercel, Stripe, GitHub, Twilio, SendGrid, Okta, Auth0, Atlassian, Slack, Zoom, Shopify, Datadog, PagerDuty, OpenAI and Anthropic. They can also add any page that publishes the Statuspage v2 API, an RSS or Atom status feed, or a JSON status endpoint with configured paths. Lamp's scheduled trigger reads each followed vendor at most every 2 minutes, with GET requests to that vendor's public status origin only. It maps the vendor's state for the chosen vendor components onto COMP-001's states through a shown table, and records every vendor change in COMP-003's history, attributed to the vendor feed. Vendor origins are declared in `seed.json → externals`.

Acceptance: against a recorded Statuspage-format fixture and a recorded AWS Health RSS fixture, a vendor change appears on the vendor component within 4 minutes, and the history entry names the feed. A vendor feed that returns 500 three times shows "vendor status unavailable since" with the time, and never shows Operational.

Status: **missing**.

#### DEP-002 — Vendor state never silently becomes the buyer's outage.

A vendor component is labelled "reported by <vendor>" and links to the vendor's own page. By default it claims nothing on the buyer's own components and does not move the overall status. The owner can mark own components as depending on a vendor component and choose, per dependency, one of three behaviours: show only; draft an incident on the dependent components from a saved "upstream provider" template; or include the vendor component in the overall status rollup (PAGE-004). A vendor recovery never resolves a buyer incident; it is shown in that incident's brief as evidence.

Acceptance: with a default dependency, a vendor outage leaves the buyer's components and overall status unchanged. With "draft", it creates one private draft attached to the dependent components and changes no public surface. A vendor recovery adds a brief entry and leaves the draft unresolved.

Status: **missing**.

#### DEP-003 — Vendor watch for the team.

Operators can follow a vendor component without showing it publicly; DEP-001 internal vendor components honour COMP-005. A followed vendor's state change sends one operator alert to email, the operator Slack or Teams channel and push (NOTIFY-016), deduplicated by vendor incident, so the team hears about upstream trouble before customers report it.

Acceptance: an internal vendor component's outage sends exactly one operator alert per vendor incident, and nothing appears on the public page, feed or API.

Status: **missing**.

## Uptime

- **UPTIME-001 — Definition.** For each visible component the page shows the percentage of the reporting window during which the component was not in a downtime state, computed from COMP-003 state history at one-minute resolution and rounded down to two decimal places, so a window containing any downtime never shows 100.00%. The reporting window is 90 days.
- **UPTIME-002 — Downtime weights.** *Policy: `uptime.downtime-states.v1`; default: a minute in Major outage or Partially unavailable counts as one downtime minute, a minute in Degraded performance counts as half a downtime minute, and a minute in Under maintenance counts as none.* Degraded performance is not weighted at zero: most published incidents never get worse than it, and discarding them is what makes an uptime figure disagree with the incident history printed beneath it.
- **UPTIME-003 — Short history.** A component whose earliest state history entry is later than the start of the reporting window shows uptime computed from that entry, and the page labels the figure with the number of whole days it covers.
- **UPTIME-004 — Corrections.** An operator can correct a closed interval of a component's state history, stating the correct state for that interval and a reason. The correction appends to the history per COMP-003, recomputes every uptime figure it affects within 60 seconds, and records the operator, the interval, and the reason in the audit log. A request without a reason is rejected with 400.
- **UPTIME-005 — Stated method.** Beside the uptime figures the page names each state's weight under UPTIME-002 and the length of the window under UPTIME-001, in text present in the initial HTML. Because UPDATE-001 refuses to publish an update that claims no component, every published incident moves these figures; none of the incident history printed on the same page is invisible to them.
- **UPTIME-006 — Daily record.** The page shows one mark per day of the reporting window for each visible component. A day containing any downtime minute is labelled with the number of downtime minutes in that day. A day before the component's earliest state history entry is rendered as having no data and is visually distinct from a day with no downtime.

### Uptime — target

#### UPTIME-007 — Measured uptime bars.

For a component linked to an Uptime monitor (COMP-008), the owner chooses what the page shows: the claimed uptime of UPTIME-001, measured availability from the monitor's scheduled evidence, or both side by side. Measured figures are labelled with their source and method. Minutes with no fresh evidence (Uptime's Unknown) are shown as no data and are never counted as up. The daily record of UPTIME-006 marks each day's measured downtime minutes. Corrections under UPTIME-004 apply only to claimed figures; measured evidence is never rewritten.

Acceptance: an imported 90-day Uptime evidence fixture with one 30-minute outage and one 2-hour Unknown gap renders a measured figure that excludes the gap from the denominator. The gap is labelled as no data, and the claimed figure beside it is unchanged.

Status: **missing**.

#### UPTIME-008 — Public performance metrics.

Up to 10 public metrics, such as response time per region, error rate or queue depth, can be shown on the page as charts per component, as Statuspage system metrics do. They are fed by Uptime timings, by pulls from Datadog, New Relic, Pingdom or a Prometheus-compatible query endpoint using a read-only key the owner supplies, or by pushes through the management API (API-001). Lamp stores only aggregated points (1-minute for the last day, hourly for 30 days, daily for 90 days) and renders each chart as inline SVG in the snapshot with a text summary, so it works without script. A source that stops reporting shows a gap labelled with when data stopped, never an interpolated line.

Acceptance: a pushed metric series renders in the next snapshot. A Datadog query fixture fills a chart. A 20-minute gap renders as a labelled gap. Page weight stays within PAGE-003 with 10 charts.

Status: **missing**.

#### UPTIME-009 — Availability reports.

Operators download, per component and for any month or quarter, an availability report with claimed and (where linked) measured uptime, every incident and maintenance that affected it, and total downtime minutes, as CSV and PDF. The report can be shared with one audience (AUD-003) on its private page. Customers with contractual SLAs then get the same numbers the page shows.

Acceptance: the report for a fixture month equals the page's figures for the same window to two decimal places, and lists every incident whose claims fall in that window.

Status: **missing**.

## Incidents

- **INCIDENT-001 — Lifecycle.** An incident is in exactly one of Investigating, Identified, Monitoring, or Resolved. It is created in Investigating, and its state changes only through a published update that sets it.
- **INCIDENT-002 — Impact.** An incident's impact is the most severe state it has claimed on any attached component at any time since it was opened, so a resolved incident keeps the impact it reached. An incident with no attached components has no impact and cannot be published; UPDATE-001 requires at least one.
- **INCIDENT-003 — Reference.** Every incident has a reference of the form `INC-` followed by digits and a permanent public URL containing it. New manual and alert-intake incidents share one durable, increasing `INC-n` allocation sequence. Existing references and URLs never change. A reference is never reused, including after INCIDENT-007, a restart, or a failed creation; a failed creation may leave a gap. Legacy timestamp-sized references do not determine the starting sequence.
- **INCIDENT-004 — Published updates are immutable.** A published update is never edited or deleted. A correction is a new published update that names the update it corrects, and both stay on the public timeline in the order they were published.
- **INCIDENT-005 — Reopening.** An incident resolved in error is reopened by publishing an update that sets it to Investigating. The resolution update and the reopening update both stay on the public timeline.
- **INCIDENT-006 — Overdue update.** When the next-update time committed by an incident's latest published update passes with no newer update published, the incident is marked overdue in the operator app. The public page shows the committed time and never labels the incident overdue.
- **INCIDENT-007 — Deletion.** Deleting an incident requires a reason and removes it from the public page, the history page, and the Atom feed within 10 seconds. A request without a reason is rejected with 400. The operator, the reason, and the time are recorded in the audit log.
- **INCIDENT-009 — Retroactive incidents.** An operator can open an incident whose updates carry publication times in the past. Those times are what the public timeline and the history page show, the component states it claims are written into the state history at those times so UPTIME-001 counts them, and no subscriber is notified for any of its updates.
- **INCIDENT-008 — Internal notes.** An incident carries internal notes visible only to a signed-in operator. A note never appears on the public page, in the Atom feed, in the widget, in any notification, or in any AI request.
- **INCIDENT-010 — Update due.** *Policy: `incident.update-due.v1`; default: an update is due from 10 minutes before the committed next-update time.* From that lead until a newer update is published or the incident resolves, the operator app shows the incident as due at the committed time on Overview and on the incident list, with one action that opens its composer and brief, and the operator email of NOTIFY-006 is sent once for that committed time; after the time passes the incident is overdue under INCIDENT-006 and the overdue email is sent once. The scheduled trigger sends both, whether or not any operator page is open. A resolved incident, an incident with a newer update, and a retroactive update send neither, and a commitment that had already passed when this clause took effect sends no email. The public page shows only the committed time and never labels an incident due or overdue.

### Incidents — target

#### INCIDENT-011 — A named communication owner.

Every unresolved incident has a communication owner: the operator who opened it, until someone takes it over or it is reassigned. INCIDENT-010's due and overdue reminders go first to the owner by email, push (MOBILE-002) and the operator chat channel. When the commitment is 10 minutes overdue (*Policy: `incident.escalation.v1`*), the reminder goes to every operator with publish rights and, when Oncall is linked, to Oncall's current on-call responder for the affected service. An incident with no active owner (for example, the owner was removed) is flagged as unowned on Overview. The owner's name is never public (TEAM-003).

Acceptance: with a commitment passing, the owner alone gets the due reminder. Ten minutes after the time, every communicator and the linked Oncall escalation receive one escalation. Taking over an incident moves later reminders to the new owner.

Status: **partial** — `src/core/features/incidents/reminders.ts`, `tests/e2e/update-reminders.test.mjs`. Due and overdue reminders ship to operators. Owners, escalation and the Oncall handoff do not.

#### INCIDENT-012 — Run the incident from Slack or Teams.

The Lamp Slack app and Teams app let a linked operator open a draft incident (`/lamp incident`), attach components with their claimed states, write the update fields of UPDATE-001, see the UPDATE-004 preview and publish. Every action keeps the same validation, review (UPDATE-007), role checks (TEAM-004) and attribution as the web desk, and nothing publishes without an explicit Publish click by a linked operator.

Acceptance: a recorded Slack interaction payload opens a draft, a second publishes it after preview, and the incident appears on the page attributed to the linked operator. A payload from an unlinked Slack user is refused and creates nothing.

Status: **missing**.

## Updates

- **UPDATE-001 — Template.** Publishing an update requires at least one attached component, an affected-audience statement of at most 250 characters, a customer-impact statement of at most 250 characters, and, for a lifecycle other than Resolved, a next-update time. A resolved update requires no next-update time and carries no next-update promise on any surface, including when an older stored resolved update retains a time. A what-still-works statement of at most 250 characters and a details statement of at most 500 characters are optional. Every field is plain text; no HTML or markdown is interpreted. A publish request that omits a required field, exceeds a length, or attaches no component returns 400 and changes nothing. The next-update time is a commitment to publish again by then; it is never presented as an estimate of when the incident will be resolved.
- **UPDATE-002 — One rendering.** The public page, the Atom feed, the widget payload, and the notification email render an update from the same renderer. No surface omits a populated field of the update or shows a field the update does not carry.
- **UPDATE-003 — Sets the lifecycle.** Every published update sets the incident's lifecycle state. An update that sets Resolved records the incident's end time and recomputes every attached component under COMP-006.
- **UPDATE-004 — Preview.** Before publishing, the composer shows the update as the public page and as the notification email will render it, produced by the renderer named in UPDATE-002.
- **UPDATE-005 — Drafts.** An unpublished update appears on no public surface. A draft is saved within 2 seconds of the last edit and is restored unchanged after a browser reload. Publication consumes that draft and opens an empty draft for the next update, with lifecycle prompts. A stale tab cannot resurrect published wording or overwrite a newer acknowledged draft. Draft writes, template application, scheduling and publication require the acknowledged draft version. A fresh empty composer is not reported saved until a native write is acknowledged; Publish requires a complete acknowledged draft. Reconciliation after a lost acknowledgement identifies the attempted write and preserves later workflow changes.
- **UPDATE-006 — Scheduled publish.** An update given a future publish time publishes within 240 seconds of that time and appears on no public surface and in no notification before it. If UPDATE-007 review is in force and the update has not been reviewed when that time arrives, it is not published, stays a draft, and is reported under NOTIFY-006. The 240-second bound is a declared promise based on one local stress observation with 20 updates and 20 maintenance starts due in the same cron minute on a single workerd process on a shared runner; it is not a p95 over independent runs or a hosted Cron guarantee.
- **UPDATE-007 — Review.** *Policy: `update.review.v1`; default: no review is required. When review is required, a publish request for an update its author wrote is rejected with 409 until an operator other than the author marks it reviewed; the reviewer and the time are recorded on the update.*
- **UPDATE-008 — Publish is atomic.** One transaction commits the update together with the recipient set it will notify on each channel selected under NOTIFY-007. That set is fixed at publish time: a subscriber who narrows their selection afterwards still receives this update, and one who unsubscribes afterwards does not, per SUB-008. When the publish request returns 200 that transaction is committed, and PAGE-007 and NOTIFY-002 follow from it. When it returns an error the update is on no surface and no recipient is recorded for it. Dispatch of the committed set is retried until it succeeds and never blocks the publish.
- **UPDATE-009 — Templates.** An operator can save a template holding the update fields of UPDATE-001, the components it attaches with the state each claims, and the lifecycle state it sets. Applying a template fills the composer and attaches those components with those states, and publishes nothing.

### UPDATE-001 amendment — resolved updates

The original clause required a next-update time for every publication. The owner's
requirement for release 1.1.0 replaces that condition for Resolved updates: resolution
makes no promise to publish again. Active updates retain the next-update
requirement and every original field, length, component, preview, review and
atomic-publication guarantee. Existing published records are preserved; rendering
suppresses legacy resolved promises rather than rewriting their history.

### Updates — target

#### UPDATE-010 — Audience variants of one update.

An update can carry, for each audience (AUD-003) the incident is visible to, its own affected-audience, customer-impact and what-still-works text. The public page and public subscribers get the public text, and each audience's page and subscribers get that audience's text. Preview (UPDATE-004) shows every variant. A variant with no text uses the public text, and that choice is shown before publish. Lifecycle, components and next-update time are shared across variants, so one commitment is kept once.

Acceptance: one publish with a public text and an "Enterprise EU" variant renders each text on its own page. Each subscriber receives exactly one message with their audience's text. The public page, feed and API never contain the variant's words (AUD-005).

Status: **missing**.

#### UPDATE-011 — Wording checks before publish.

Before publish, the composer checks each field without a model and lists findings beside the field: a promise of a resolution time (which UPDATE-001 forbids presenting), an internal hostname or IP address, an email address, a word from the owner's blocked-terms list (customer names, codenames), and a field longer than the reader-friendly length the owner sets. Findings never block publication. Each one names the rule, and the operator can dismiss it.

Acceptance: an impact statement containing "fixed in 10 minutes" and `db-prod-3.internal` shows two findings with their rules, and publishing still succeeds when the operator dismisses them.

Status: **missing**.

## Scheduled maintenance

- **MAINT-001 — Distinct from incidents.** A scheduled maintenance has a start time, an end time, and attached components. It has a reference of the form `SCH-` followed by digits, and is listed separately from incidents wherever both appear. New maintenance references use a durable, increasing `SCH-n` allocation sequence independent of incidents and legacy timestamp-sized references. Existing references remain unchanged; deletion, restart and failed creation never permit reuse, and failures may leave gaps.
- **MAINT-002 — Automatic transitions.** A scheduled maintenance moves from Scheduled to In progress within 240 seconds of its start time, and from In progress to Completed within 240 seconds of its end time, with no operator action. The 240-second bound is a declared promise based on one local stress observation with 20 updates and 20 maintenance starts due in the same cron minute on a single workerd process on a shared runner; it is not a p95 over independent runs or a hosted Cron guarantee.
- **MAINT-003 — Component states.** A maintenance claims Under maintenance for every attached component while it is In progress, and claims nothing before it starts or after it completes. A component's public state follows from COMP-006 throughout, so a state an operator or an incident claimed before the window is still claimed after it.
- **MAINT-004 — Overrun.** A maintenance still In progress 15 minutes after its end time is shown on the public page as running longer than planned, beside its original end time, until an operator completes it or extends the window.
- **MAINT-005 — Reminders.** *Policy: `maintenance.reminders.v1`; default: subscribers are notified when the maintenance is scheduled, 24 hours before the start time, when it moves to In progress, and when it moves to Completed.*
- **MAINT-006 — Rescheduling and cancellation.** Changing the window of a scheduled maintenance notifies every subscriber already notified about it. Cancelling it publishes a cancellation notice to those same subscribers, removes it from the upcoming list within 10 seconds, and keeps it in the maintenance history marked cancelled.

### Scheduled maintenance — target

#### MAINT-007 — Maintenance calendar.

Each page serves `/maintenance.ics`, an iCalendar feed of scheduled and in-progress maintenance with a stable UID per maintenance. A reschedule (MAINT-006) updates the same event, and a cancellation marks it cancelled. Subscribers can add it to Google Calendar, Outlook or Apple Calendar, and every maintenance email carries an `.ics` attachment for that window.

Acceptance: the feed validates as RFC 5545. Rescheduling keeps the UID and raises SEQUENCE. A cancelled maintenance carries `STATUS:CANCELLED`.

Status: **missing**.

#### MAINT-008 — Maintenance from deploy pipelines.

The management API (API-001), the published GitHub Action and the Terraform provider (API-004) can create, start early, extend and complete a maintenance window, with the same notices as MAINT-005 and MAINT-006. A pipeline can then open a window when a deploy starts and close it when the deploy finishes.

Acceptance: a GitHub Actions workflow run against a test installation opens a window, the page shows it in progress, and the workflow's final step completes it. Subscribers receive the notices MAINT-005 names, once each.

Status: **missing**.

## Subscribers

- **SUB-001 — Subscribing.** Submitting an email address on the public page creates a pending subscription and sends one confirmation email to that address within 60 seconds. That address receives at most one confirmation email in any 24 hours however many times it is submitted, which is what bounds a subscription-bombing attack. A pending subscription receives no other notification. The form is a standard POST that works with script disabled, is rejected with 403 when the request carries `Sec-Fetch-Site: cross-site`, and carries no CSRF token, because with no cookie and no session there is no ambient authority to forge.
- **SUB-002 — Confirmation.** *Policy: `subscriber.confirmation.v1`; default: a subscription becomes active only when the link in the confirmation email is followed.*
- **SUB-003 — Pending expiry.** A pending subscription not confirmed within 72 hours is deleted, including the address it holds. **Supersedes BASE-DATA-002** for pending subscriptions only: the address was supplied by an unverified visitor who may not own it, so it is held only as long as confirmation is possible.
- **SUB-004 — Component selection.** A subscriber selects which components they want updates about, and is notified about an incident or maintenance only when it claims a state for at least one component in that selection. A subscription whose selection has never been narrowed follows every visible component, including components added after it was created. A subscription with a narrowed selection is unchanged when a component is added. When a component is attached to an unresolved incident, every subscriber who follows that component and has received no notification for that incident receives exactly one notification carrying its most recent published update, and then receives subsequent updates normally.
- **SUB-005 — Cookieless subscriber tokens.** A subscriber is identified on public surfaces only by an opaque token of at least 128 bits of entropy that addresses one subscription, is carried in the URL of a link the deployment emailed to that subscriber, grants no other capability, and is revoked when the subscription is deactivated or deleted. No cookie is set on any public surface. Responses on token-addressed paths carry `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. **Supersedes BASE-PUBLIC-001** for token-addressed paths only, which transmit the token on load rather than after a first interaction, because SUB-006 requires an unsubscribe that completes without any interaction on our page.
- **SUB-006 — One-click unsubscribe.** Every notification email carries a `List-Unsubscribe` header with a `mailto:` and an `https:` value, a `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header, and a visible unsubscribe link in the body. A POST to the `https:` value, with a body of `List-Unsubscribe=One-Click` in either multipart/form-data or application/x-www-form-urlencoded, deactivates that subscription and returns 200 with no redirect, no cookie, and no further interaction. Both headers are named in the message's DKIM `h=` tag, without which receivers decline to offer one-click at all. That endpoint's BASE-ACCESS-003 rate limit is counted per subscription token, never per source address, so one mailbox provider's shared egress cannot exhaust the limit for other subscribers.
- **SUB-007 — Managing a subscription.** The token URL in every notification opens a page that shows the subscription's channel and component selection and lets the subscriber change the selection or unsubscribe, without a session.
- **SUB-008 — Unsubscribe integrity.** After a subscription is deactivated, no notification is delivered to it. A notification committed before the deactivation and dispatched after it sends nothing and records the outcome as suppressed.
- **SUB-009 — Webhook subscribers.** An endpoint URL and a contact email address together subscribe as a webhook subscriber; the address exists so SUB-010 can say why the endpoint was deactivated. Each notification is a POST carrying `webhook-id`, `webhook-timestamp`, and `webhook-signature` headers, where the signature is a space-separated list of versioned HMAC-SHA256 values over `{webhook-id}.{webhook-timestamp}.{raw body}`, so a secret can be rotated without a gap. The body carries the incident, every update it has published, and each attached component's previous and new state, so a receiver that missed a delivery needs no prior state. It carries no subscriber address. A delivery succeeds only on a 2xx within 30 seconds; a redirect is a failure. A Slack incoming-webhook URL receives the same events with a Slack-formatted body.
- **SUB-010 — Failing destinations.** An address that hard-bounces once, or whose provider reports a spam complaint, is deactivated with that reason recorded. An address that soft-bounces on 5 consecutive notifications, and a webhook endpoint whose last 10 consecutive deliveries all failed under SUB-009, are deactivated with that reason recorded. Deactivating a webhook endpoint emails its contact address. A deactivated destination receives no further notification.
- **SUB-011 — Operator view.** Operators see every subscriber with channel, state of pending, active, or deactivated, component selection, and the reason and time of any deactivation. Deleting a subscriber deletes the address or endpoint it holds.
- **SUB-012 — No enumeration.** Submitting an address that already has a subscription returns the same status and body as submitting a new address and creates no second subscription. That address receives one email saying it is already subscribed, carrying its management link and nothing else.

### Subscribers — target

#### SUB-013 — SMS subscribers.

A visitor can subscribe a mobile number in E.164 form. United States and Canada numbers are accepted by default, and other countries only when the owner enables them. Lamp sends one opt-in text naming the page, the message frequency, "Msg & data rates may apply" and the HELP/STOP keywords. The subscription becomes active only when the visitor replies YES, and the consent record (number, time, page, wording) is kept as TCPA evidence. STOP, UNSUBSCRIBE, CANCEL, END and QUIT deactivate it at once and send the single carrier-required confirmation. HELP returns the page name and its support contact. Messages are at most two segments with a permanent link to the update. SMS subscribers choose components like any subscriber (SUB-004). SUB-001's limit of one confirmation per 24 hours per address applies per number.

Acceptance: through a Twilio test account, a US number subscribes, replies YES and receives one notification on publish. Replying STOP deactivates it, and the next publish records the delivery as suppressed. A number that never replied YES receives nothing beyond the opt-in.

Status: **missing**. Released `seed.json → nonGoals` excludes SMS; this clause and NOTIFY-014 replace that exclusion.

#### SUB-014 — Self-serve Slack subscriptions.

The public page offers "Get updates in Slack". The visitor installs Lamp's Slack app into their own workspace through Slack OAuth v2 with only the `incoming-webhook` scope, picks a channel and chooses components. Lamp stores the resulting webhook encrypted, as NOTIFY-011 does, and posts each eligible update with the same rendering as UPDATE-002. Removing the app (`app_uninstalled` or `tokens_revoked`), or a channel archived so that its webhook returns `channel_is_archived`, deactivates the subscription with that reason (SUB-010).

Acceptance: a recorded OAuth exchange against Slack's sandbox creates an active Slack subscription that receives the next publish. A recorded `app_uninstalled` event deactivates it, and the next publish skips it.

Status: **partial** — `src/core/features/subscribers/service.ts`, `src/core/features/channels/service.ts`, `tests/e2e/delivery-contract.test.mjs`. A subscriber can register a Slack incoming-webhook URL as a webhook subscriber (SUB-009), and operators add Slack channels (NOTIFY-011). Slack app sign-up does not exist.

#### SUB-015 — Self-serve Microsoft Teams subscriptions.

A visitor can subscribe a Microsoft Teams channel by pasting a Teams Workflows webhook URL ("When a Teams webhook request is received"). Only Microsoft's documented webhook hosts are accepted, and Lamp sends a verification card that the visitor confirms from the channel before the subscription becomes active. Updates are delivered as Adaptive Cards with the UPDATE-002 rendering. Component selection and failing-destination rules (SUB-004, SUB-010) apply.

Acceptance: against a recorded Teams Workflows endpoint, a subscription activates after confirmation and receives an Adaptive Card on publish. A non-Microsoft host is refused with 400.

Status: **partial** — `src/core/features/channels/teams.ts`, `tests/e2e/channels-and-presets.test.mjs`. Operator-configured Teams channels ship (NOTIFY-011, NOTIFY-012). Subscriber-owned Teams subscriptions do not.

#### SUB-016 — Preferences on every channel.

Every subscription on every channel (email, SMS, webhook, Slack, Teams, and audience subscriptions under AUD-004) selects components (SUB-004) and event kinds: incidents, maintenance, or both, and optionally only incidents whose impact reaches Partially unavailable or worse. The SUB-007 management page edits all of these without a session.

Acceptance: an SMS subscriber who chose "maintenance only" receives the maintenance start and nothing for an incident on the same component. An email subscriber who chose "Partially unavailable or worse" receives nothing for a Degraded incident and is notified when it escalates.

Status: **partial** — `src/core/features/subscribers/service.ts`, `tests/e2e/delivery-contract.test.mjs`. Component selection on subscriptions ships. Event-kind and impact-threshold preferences do not.

#### SUB-017 — Subscriber import and export.

An operator imports subscribers from CSV (email, phone, webhook URL, components, language) through a dry run that counts what would be created, skipped or refused, and writes nothing. Imported subscribers are pending and receive one confirmation invitation only when the owner explicitly sends invitations, as MOVE-002 does for move-in imports. Operators export the subscriber list with channel, state, components and consent time as CSV.

Acceptance: a CSV with 100 rows, 3 malformed, dry-runs as 97 created and 3 refused with reasons, then applies as 97 pending subscriptions. Sending invitations sends at most one each. The export CSV has 97 rows.

Status: **partial** — `src/core/features/statuspage-import/`, `tests/e2e/statuspage-import.test.mjs`. Move-in imports bring email subscribers in as pending (MOVE-002). CSV import and subscriber export do not exist.

## Notifications

- **NOTIFY-001 — What notifies subscribers.** *Policy: `notification.events.v1`; default: an incident notifies on its first published update, on every subsequent published update, and on the update that resolves it; a scheduled maintenance notifies per MAINT-005; a component state change made outside an incident or maintenance notifies no one.*
- **NOTIFY-002 — Delivery time.** At the subscriber limit in `seed.json → limits`, every eligible email notification for a published update is accepted by the mail provider within 5 minutes of the publish request returning 200.
- **NOTIFY-003 — Retry.** A notification that fails with a retryable error is retried 5 times with exponential backoff over 1 hour. After the last attempt it is recorded as failed against that subscriber and that update.
- **NOTIFY-004 — Delivery log, without tracking.** Every notification records the subscriber, channel, update, queue time, outcome, and outcome time. An outcome is one of queued, delivered, bounced, complained, suppressed, or failed. No notification carries a tracking pixel or a link that records who followed it, so no outcome describes reading. The log is filterable by channel, outcome, and update, and exports as CSV.
- **NOTIFY-005 — At most once.** A subscriber receives at most one notification per published update per channel, whatever the number of times the publish is retried or the queue delivers the job.
- **NOTIFY-006 — Operator alerts.** An operator email is sent, at most once per event, when an incident's next update becomes due under INCIDENT-010, when an incident becomes overdue under INCIDENT-006, when a maintenance overruns under MAINT-004, when a scheduled update is held back for review under UPDATE-006, when an alert creates a draft incident under INTAKE-002, and when a notification is recorded as failed under NOTIFY-003.
- **NOTIFY-007 — Channels are per update.** The operator selects, for each update, which subscriber channels receive it, and selecting none is allowed. The public page, the Atom feed, and the widget always receive the update and cannot be deselected. The delivery log records the selection.
- **NOTIFY-008 — Who the deployment emails.** The deployment sends email only to an operator, to an address with a pending subscription for its single confirmation email, and to an address with an active subscription. Every notification is sent through `mail.sender.v1` from the address configured in settings.
- **NOTIFY-010 — Mail headers.** Every notification email carries `List-Id`, `List-Archive`, and `List-Help` identifying the page, `Auto-Submitted: auto-generated` so it triggers no vacation reply, and, for every update after an incident's first, `In-Reply-To` and `References` naming the message that carried the first, so a mail client groups an incident's updates into one thread. `pnpm setup` and `rer deploy` fail naming the record when the From address's domain has no reachable DKIM public key for the configured selector or no DMARC policy. Aligned DKIM is sufficient; SPF at the From domain itself is not required, because a provider may authenticate its separate return-path domain.
- **NOTIFY-009 — Delivery never blocks publication.** A publish under UPDATE-008 returns 200 while the mail provider, the queue, or a subscriber endpoint is failing. The public page, the feed, and the widget update under PAGE-007 regardless, and the committed notification set is delivered under NOTIFY-003 when the channel recovers.
- **NOTIFY-011 — Slack and Teams channels.** An operator adds a Slack incoming-webhook URL or a Microsoft Teams channel webhook URL, with the components the channel follows (none selected follows every visible component). The URL is stored only encrypted, is never returned by any API or shown again after saving, and never appears in a log. Only the provider's own webhook hosts are accepted.
- **NOTIFY-012 — Channel posts.** Publishing an incident update with Slack and Teams selected for it (NOTIFY-007) commits, in the same transaction, one post to each channel that follows a visible component the update affects. Each post is delivered at most once, whatever the number of times the publish is retried or the delivery is re-run; a retroactive update posts nowhere.

### Notifications — target

#### NOTIFY-013 — Redundant email delivery.

The owner configures a primary and a secondary email provider from SendGrid, Mailgun, Amazon SES, Postmark and Resend, each authenticated for the From domain (NOTIFY-010). A notification whose primary send keeps failing with retryable errors for 5 minutes, or for which the primary reports an outage, is sent through the secondary. Lamp sends it there once, under NOTIFY-005's one-notification-per-update guarantee and the same Message-ID, so a subscriber never receives it twice. The delivery log records which provider accepted each message. A provider's signed delivery events (bounce, complaint, delivered) are verified for each configured provider.

Acceptance: with the primary's fake edge returning 503, a publish is accepted by the secondary within 7 minutes, and the log shows the provider. Restoring the primary sends nothing a second time. Each provider's signed bounce fixture deactivates the address (SUB-010).

Status: **partial** — `src/core/app/mail.ts`, `src/core/features/deliveries/service.ts`, `src/core/features/deliveries/sendgrid-events.ts`, `tests/e2e/sendgrid-provider.test.mjs`. One selectable provider with durable retries and SendGrid signed events ships. A secondary provider, failover and other providers' events do not.

#### NOTIFY-014 — SMS delivery.

SMS notifications go through Twilio or Plivo from the owner's registered 10DLC campaign or verified toll-free number. When both are configured, the other is used if the first fails retryably. Delivery receipts arrive through the provider's signed status callbacks (`X-Twilio-Signature`, Plivo's V3 signature) and record delivered, undelivered or failed (NOTIFY-004). Settings shows the estimated cost of the next publish in USD, from subscriber counts and the provider's rate the owner enters, and a monthly SMS spend cap. A publish that would pass the cap sends the SMS part only after an operator confirms.

Acceptance: through Twilio test credentials, a publish to 3 SMS subscribers records 3 delivered receipts from signed callbacks. An unsigned callback is refused with 401. A publish over the cap queues SMS until confirmed, and the page, email and feeds are not delayed (NOTIFY-009).

Status: **missing**.

#### NOTIFY-015 — Reach of each update.

The update view shows, live, how many subscribers it was committed to on each channel (UPDATE-008), and how many were delivered, bounced, suppressed or failed. The incident view shows the total reached for the whole incident. The figures come from the NOTIFY-004 log and describe delivery, never reading.

Acceptance: after a publish to 10 email and 2 webhook subscribers, with one email bouncing, the update view shows 10/2 committed and 9 delivered, 1 bounced and 2 delivered, matching the CSV export.

Status: **partial** — `src/core/features/deliveries/service.ts`, `tests/e2e/delivery-contract.test.mjs`. The filterable delivery log and CSV export ship (NOTIFY-004). Per-update reach in the update view does not.

#### NOTIFY-016 — Operator alerts beyond email.

Every NOTIFY-006 operator alert, along with DEP-003 vendor alerts and HIST-006 traffic alerts, can also go to an operator Slack or Teams channel and to installed operator devices through web push (MOBILE-002), each at most once per event. Operator alerts carry incident references and links to the operator app, and no subscriber data.

Acceptance: an overdue incident produces exactly one email, one Slack post to the operator channel and one push per subscribed device.

Status: **missing**.

## Alert intake

- **INTAKE-001 — Authenticated requests.** Each source is configured with one of two credentials. With a signing secret, a request is accepted only when the HMAC-SHA256 over its timestamp header and raw body matches and the timestamp is within 5 minutes of the deployment's clock; the signature is verified over the received bytes before they are parsed. With a bearer token, a request is accepted only when it presents that token, which exists because most monitoring tools — among them Datadog, Pingdom, and Uptime Kuma — cannot sign a webhook at all. A request with an absent, malformed, stale, or non-matching credential returns 401 and creates nothing.
- **INTAKE-002 — Alerts never publish.** *Policy: `alert.intake.v1`; default: an accepted alert creates or updates a draft incident within 30 seconds and changes no public surface. An operator publishes it under UPDATE-008.* A buyer who wants a monitored component to change state without waiting for a person replaces this policy; the narrative still waits for an operator, because no alert payload contains the UPDATE-001 fields.
- **INTAKE-003 — Deduplication.** Alerts carrying the same deduplication key produce one incident for as long as that incident is unresolved: an alert whose key matches an unresolved incident is recorded against that incident and creates no second one. A redelivery of a request already accepted creates no additional incident, draft, or alert record and returns the same status as the first delivery.
- **INTAKE-004 — Recovery alerts.** An alert marked as recovered for a deduplication key records the recovery time on the matching alert record and changes no public surface and no incident lifecycle state.
- **INTAKE-005 — Payload mapping.** Each source configures, as JSON paths into its own payload, which field supplies the deduplication key, which supplies the title, and which distinguishes a firing alert from a recovered one. A request whose payload lacks the configured deduplication-key path returns 400 and is recorded against that source where an operator can see it.
- **INTAKE-006 — Monitor presets.** A source can be a preset for Datadog, UptimeRobot, Better Stack or Pingdom, mapped to one component. Its endpoint accepts only that tool's documented alert payload (Datadog's webhook variables in the template Lamp shows, UptimeRobot's JSON webhook variables, Better Stack's incident webhook, Pingdom's state change webhook), authenticated by the source's token presented as a bearer header or as the endpoint's last path segment for tools that cannot send a header; the token is shown once, when Lamp generates it. A missing or wrong token returns 401 and records nothing; any other payload returns 400 and is recorded against the source. A firing alert creates or updates a draft incident attached to the mapped component, never a published one.
- **INTAKE-007 — Preset recovery.** A recovery from a preset closes the matching draft incident as Resolved when it was never published, leaving no public trace; an incident with a published update keeps its lifecycle and the recovery is recorded under INTAKE-004.

### Alert intake — target

#### INTAKE-008 — Uptime preset.

A source can be an Uptime preset. It accepts Uptime's signed JSON webhook destination (Lamp-compatible HMAC signing with a timestamp header, per Uptime's NOTIFY-001), maps each Uptime monitor to a component, and treats Uptime's confirmed Failing transition as firing and its recovery as recovered. Uptime's evidence summary (vantages, error category, first failure time) becomes What we know in the DRAFT-004 brief. Under an AUTO-001 rule it can also claim component state (COMP-008).

Acceptance: a signed Uptime failure fixture creates a draft on the mapped component, and the brief lists the vantages. A replay outside 5 minutes is refused with 401. The signed recovery records recovery and closes a never-published draft (INTAKE-007).

Status: **partial** — `src/core/features/intake/service.ts`, `tests/e2e/publishing-contract.test.mjs`. A generic signed source with configurable timestamp and signature headers and JSON-path mapping (INTAKE-001, INTAKE-005) can receive Uptime's webhook. There is no preset, no monitor-to-component mapping and no test with Uptime's payload.

#### INTAKE-009 — PagerDuty.

A source can be a PagerDuty preset. It accepts PagerDuty v3 webhook subscriptions (`incident.triggered`, `incident.acknowledged`, `incident.escalated`, `incident.resolved`), verified by the `X-PagerDuty-Signature` HMAC with the subscription's secret, and maps PagerDuty services to components. Acknowledgement and escalation become brief entries. When the owner connects a PagerDuty REST API key, each Lamp publication on a linked incident adds a note to the PagerDuty incident with the update text and permalink, so responders see what customers were told.

Acceptance: a signed v3 `incident.triggered` fixture creates a draft on the mapped component, and a wrong signature returns 401 and records nothing. A publish on the linked incident sends one note request to PagerDuty's fake REST edge.

Status: **partial** — `src/core/features/intake/service.ts`, `tests/e2e/publishing-contract.test.mjs`. A bearer-token generic source with JSON-path mapping can receive PagerDuty webhooks sent with a custom header. There is no preset, no v3 signature check and no note back to PagerDuty.

#### INTAKE-010 — Prometheus Alertmanager and Grafana Alerting.

A source can be an Alertmanager or a Grafana Alerting preset. It accepts their webhook payloads (version 4 grouped alerts), deduplicates by `groupKey` together with each alert's fingerprint, reads `status` firing or resolved, and maps alerts to components with label matchers the owner sets (for example `service="api"`, `region="us-east"`). A group whose alerts match several components attaches all of them. Authentication is the bearer token that Alertmanager's `http_config.authorization` and Grafana's contact point send.

Acceptance: a two-alert Alertmanager fixture matching two components creates one draft attached to both. The resolved fixture records recovery for both, and a payload whose labels match no component is recorded against the source as unmapped.

Status: **partial** — `src/core/features/intake/service.ts`, `src/core/features/intake/alert-title.ts`, `tests/e2e/publishing-contract.test.mjs`. A generic bearer source reading one JSON path for key, title and state can take a single Alertmanager group. There are no label matchers, no per-alert fingerprints and no preset.

#### INTAKE-011 — New Relic, Datadog and Pingdom depth.

A source can be a New Relic preset, accepting the New Relic workflow webhook template Lamp shows (issue ID, state ACTIVATED or CLOSED, entity names) and mapping entities to components. The Datadog, Pingdom and New Relic presets can also feed UPTIME-008 metrics with the read-only key the owner supplies.

Acceptance: a New Relic workflow fixture creates and closes a draft on the mapped component. A Datadog metrics query fixture fills a public chart.

Status: **partial** — `src/core/features/intake/presets.ts`, `tests/e2e/channels-and-presets.test.mjs`. Datadog, UptimeRobot, Better Stack and Pingdom alert presets ship (INTAKE-006). New Relic and metric ingestion do not.

#### INTAKE-012 — Oncall.

A source can be an Oncall preset. Oncall's signed incident events (opened, acknowledged, escalated, resolved) and its responder timeline entries flow into the matching Lamp draft or incident as brief evidence (DRAFT-004). Each Lamp publication posts back to the Oncall incident's timeline, and INCIDENT-011's escalation is delivered through Oncall's paging when it is linked. Lamp never pages anyone itself.

Acceptance: a signed Oncall "opened" fixture creates a draft, a later timeline entry appears in the brief with its time and author role, and a Lamp publish sends one timeline post to Oncall's fake edge.

Status: **missing**.

### Automation — target

#### AUTO-001 — Owner rules for what an alert may do.

For each component and source, the owner chooses one rule (*Policy: `alert.intake.v1` is replaced per component, never globally*). The choices are: **draft** (the released default, INTAKE-002); **claim** (claim the named state automatically while firing, and release on recovery); or **claim and publish** (also publish a saved UPDATE-009 template written in advance, and on recovery publish the template's Resolved update). Automatic publication is attributed to "rule <name>, approved by <owner>". It goes through UPDATE-008's atomic publish and NOTIFY-007's channel selection saved in the template, and is listed on the incident's internal timeline with the alert that caused it. A rule can only publish text an operator wrote and saved, so UPDATE-001's fields always exist.

Acceptance: under "claim", a firing alert changes the component's public state within 30 seconds, and no update or notification is sent. Under "claim and publish", the template's update appears on the page and subscribers are notified exactly once. Under "draft", nothing public changes. A rule edit is audited.

Status: **partial** — `src/core/features/intake/policies.ts`, `src/core/features/intake/presets.ts`, `tests/e2e/channels-and-presets.test.mjs`. The replaceable `alert.intake.v1` policy and preset-to-component mapping ship. There are no per-component rules, automatic claims or template publication.

#### AUTO-002 — Flap guard and undo for automatic changes.

An automatic claim waits for its rule's minimum firing duration (default 2 minutes), and its release waits for a recovery hold (default 5 minutes), so a flapping monitor neither flashes the public page nor spams subscribers. Any operator can undo an automatic claim or publication with one action. The undo appends to the history and timeline under COMP-003 and INCIDENT-004, and erases nothing.

Acceptance: an alert that fires for 60 seconds and recovers changes nothing public. One firing for 3 minutes claims the state, and a recovery followed by a re-fire 2 minutes later keeps the claim. Undo restores the previous state and appends an entry naming the operator.

Status: **missing**.

#### AUTO-003 — Every follow-up obligation is visible.

Overview has a Follow-ups list of every durable obligation Lamp is carrying. Each entry has its owner, due time, stop condition and current failure state. The list includes next-update commitments (INCIDENT-010), scheduled publications (UPDATE-006), maintenance transitions and reminders (MAINT-002, MAINT-005), reports owed (HIST-003), imported invitations nearing expiry (MOVE-002), vendor feeds that have gone stale (DEP-001), secondary-origin lag (PAGE-015), notifications in retry (NOTIFY-003) and SMS held at the spend cap (NOTIFY-014). An obligation that failed stays listed until an operator resolves or dismisses it with a reason.

Acceptance: a fixture with one of each obligation lists every one with its due time. Stopping the queue turns the notification entry into a visible failure. Completing each obligation removes it.

Status: **partial** — `src/core/features/incidents/reminders.ts`, `src/core/features/reports/service.ts`, `tests/e2e/update-reminders.test.mjs`. Due and overdue incidents show on Overview, and owed reports are marked. A unified obligations list does not exist.

#### AUTO-004 — Post-incident report follow-up.

When HIST-003 marks an incident as owing a report, its communication owner (INCIDENT-011) gets one reminder on the due day and one each week afterwards, by email and the operator channel, until a report is attached or an operator waives it with a reason. The waiver is recorded in the audit log.

Acceptance: 7 days after a Major outage resolves with no report, exactly one reminder goes out, and day 14 sends a second. A waiver with a reason stops reminders. A waiver without a reason is refused with 400.

Status: **partial** — `src/core/features/reports/service.ts`, `tests/e2e/publishing-contract.test.mjs`. Report-due marking ships (HIST-003). Reminders and waivers do not.

## Drafting

- **DRAFT-001 — Suggested update.** When an AI provider is configured, an operator can request a suggested update for an incident. The suggestion fills the composer's text fields it has text for, leaving any field it returns empty as the operator wrote it, is editable in every field, and is not published. Each filled field names the references of the DRAFT-004 brief it rests on; only references to what the brief knows are kept (an open question is not a source), and the composer shows each field's sources beside it, openable in the brief, or marks a field with none as written by the assistant with no source. A suggestion proposes no lifecycle and no next-update time, which remain the operator's commitment under UPDATE-001, and it changes no incident, public page, feed, or widget.
- **DRAFT-002 — Inputs.** A suggestion is built from the incident's accepted alerts, its published updates, its attached components customers can see and their claimed states, and the tone instructions configured in settings. Internal notes under INCIDENT-008 and internal components under COMP-001 are not sent. The provider receives exactly the brief of DRAFT-004, unchanged.
- **DRAFT-004 — Incident brief.** The operator's incident page, including the draft an alert creates, shows a brief built with no model. What we know lists each accepted alert with its time and source name, each published update, and each attached component customers can see with its claimed state. What we do not know yet lists plain questions computed from the incident's saved state: no component attached; no affected-audience or customer-impact statement yet; an unresolved draft with no next-update time; a draft raised by an alert and never published; a monitor recovery recorded while the latest published lifecycle is not Resolved; and a committed next-update time that has passed with no newer update. Every item carries a stable reference. One function builds the brief from the inputs of DRAFT-002 alone, and the page shows, collapsed, exactly what a suggestion request would send.
- **DRAFT-003 — Absent or failing provider.** AI calls go through `ai.provider.v1`. With no provider configured the composer shows no suggestion control and the deployment makes no AI request. When a configured provider fails or does not answer within 20 seconds, the composer shows the error and every other publish path behaves unchanged.

## Operators

- **TEAM-001 — Equal operators.** Every operator can create, edit, publish, and resolve every incident and maintenance, change every component, and manage subscribers. There are no roles. The only gate on publishing is UPDATE-007.
- **TEAM-002 — Management.** Operators are invited and removed in settings. The operator configured at setup can be removed only by themselves.
- **TEAM-003 — Attribution.** Every published update, component state change, maintenance change, history correction, and subscriber deletion records the operator who made it. That operator's name is shown in the operator app and on no public surface.

### Operators — target

#### TEAM-004 — Roles.

Each operator has one role. **Owner** and **Admin** manage settings, team, integrations, pages and billing-relevant providers. **Communicator** publishes, resolves, schedules maintenance and manages subscribers. **Responder** drafts, writes internal notes and attaches components, but cannot publish. **Viewer** has read-only access, including private pages. Every operator route enforces the role on the server. A forbidden request returns 403, changes nothing and is audited. UPDATE-007's review policy still applies on top of roles. The operator configured at setup is an Owner, and the last Owner cannot be demoted or removed.

Acceptance: a Responder's publish request returns 403, and the same draft published by a Communicator succeeds. A Viewer's settings write returns 403. Every 403 has an audit entry naming the operator, the route and the time.

Status: **missing**. Replaces released TEAM-001's "There are no roles" and the `seed.json → nonGoals` roles exclusion when shipped.

#### TEAM-005 — Access scoped to pages and audiences.

An operator's role can be limited to chosen pages and audiences (AUD-001, AUD-003). They then see and publish only incidents visible on those pages, and only subscribers of those pages.

Acceptance: a Communicator scoped to the "Enterprise" page cannot read or publish an incident visible only on the public page (403) and sees no public subscribers.

Status: **missing**.

#### TEAM-006 — Enforced SSO and SCIM.

The owner can require OpenID Connect sign-in through Auth, Okta, Microsoft Entra ID or Google Workspace for every operator. Email magic links are then disabled except for one recorded break-glass Owner path, which ACCESS-001's terminal sign-in keeps. A SCIM 2.0 endpoint provisions and deprovisions operators from the identity provider and maps IdP groups to TEAM-004 roles. A deprovisioned operator's sessions end within 60 seconds. Every SCIM change is audited.

Acceptance: with SSO enforced, a magic-link request for a non-owner returns the SSO notice and sends no mail. A SCIM `PATCH active=false` ends that operator's session, and their next request returns 401. A SCIM group change from Communicators to Responders removes publish rights.

Status: **partial** — `src/core/platform/auth/config.ts`, `tests/auth-adoption/dependencies.test.mjs`. Optional OIDC sign-in through Base (ACCESS-001) ships, off by default. Enforcement, break-glass and SCIM do not. When shipped, this replaces ACCESS-001's "SCIM and role synchronization remain out of scope".

#### TEAM-007 — Audit log view.

Owners and Admins see the audit log of BASE-OPS-005 in the operator app. It covers every publication, state change, correction, deletion, rule change, role change, token use and erasure, and is filterable by actor, action and time and exportable as CSV. Entries for erased people show the anonymised reference (BASE-DATA-003).

Acceptance: after a publish, a correction, a role change and a subscriber erasure, the audit view lists all four with actor and time, and the CSV export matches the filtered view.

Status: **partial** — `src/core/features/incidents/repository.ts`, `src/core/features/operators/repository.ts`, `tests/e2e/delivery-contract.test.mjs`. Audit entries are recorded for destructive and attributed actions (BASE-OPS-005, UPTIME-004, INCIDENT-007). There is no audit view or export.

## History and reports

- **HIST-001 — Public history.** The history page lists resolved incidents and completed maintenance grouped by month for the last 12 months, each with start time, end time, duration, the components it affected, and every update it published.
- **HIST-002 — Post-incident report.** An operator can attach one post-incident report to a resolved incident, holding a summary, a timeline, a cause, and remediation. It appears on that incident's public page within 10 seconds of publishing, and notifies subscribers on the channels the operator selects for it in the same way NOTIFY-007 selects them for an update.
- **HIST-003 — Report due.** *Policy: `postmortem.due.v1`; default: an incident that claimed Partially unavailable or Major outage on any component and has no post-incident report 7 days after resolution is marked as owing one in the operator app.*
- **HIST-004 — Export contents.** The export contains every incident, update, component with its full state history, maintenance, subscriber with channel and state, notification delivery record, post-incident report, setting, and audit entry as JSON, and every uploaded image as its original file.

### History and reports — target

#### HIST-005 — Communication performance.

Operators see, per incident and per month: the time from the first accepted alert to the first public update, the share of next-update commitments kept on time, time to resolve, subscribers reached per channel (NOTIFY-015), the delivery failure rate and reports owed. These are exportable as CSV. They measure the team's communication against its own promises.

Acceptance: a fixture month with three incidents, one of which missed a commitment by 4 minutes, reports 2 of 3 kept, with each incident's time to first update matching its timeline.

Status: **missing**.

#### HIST-006 — Traffic spike alert without visitor tracking.

Lamp counts requests per minute to the public read paths in an aggregate counter that stores no address, user agent, cookie or path beyond the surface name. It does not use the database, so PAGE-005 holds. When the count exceeds the owner's multiple (default 3×) of the trailing 7-day same-hour baseline and no incident is unresolved, operators get one alert: customers may be seeing a problem before monitoring does. The counter is not visitor analytics (see Vane).

Acceptance: a synthetic burst of 5× baseline with no open incident sends exactly one operator alert. The same burst during an unresolved incident sends none. The stored counter rows contain only surface, minute and count.

Status: **missing**.

#### HIST-007 — Subscriber reporting.

Operators see subscriber counts by channel, state, component, audience and language, with growth over time and the deactivation reasons of SUB-010. The counts are exportable as CSV.

Acceptance: a fixture with mixed channels reports counts equal to the SUB-011 list totals, and the trend shows each day's net change.

Status: **partial** — `src/core/features/subscribers/service.ts`, `tests/e2e/delivery-contract.test.mjs`. The operator subscriber list with channel, state, selection and deactivation reason ships (SUB-011). Counts, trends and export do not.

## Audiences and private pages — target

#### AUD-001 — Several pages in one deployment.

One deployment serves a public page and any number of private pages and audience pages. Each has its own hostname or path, branding (THEME-001), languages (I18N-001) and component set drawn from the same shared components. An incident or maintenance is visible on the pages the operator chooses, and one publish updates every page it is visible on. Each page has its own snapshot, feed, widget, badges and API (PAGE-005, PAGE-016 to PAGE-018).

Acceptance: an incident visible on the public page and on "Staff" appears on both after one publish. An incident visible only on "Staff" appears on no public surface. Each page's snapshot serves with the database unavailable.

Status: **missing**. Replaces the released `seed.json → nonGoals` exclusions of more than one page per deployment and of private or audience-scoped pages.

#### AUD-002 — Private page access.

A private page admits a visitor who passes the access methods the owner chose for it. The methods are: OIDC sign-in through Auth, Okta, Microsoft Entra ID or Google Workspace, optionally restricted to IdP groups; an emailed single-use link to an allow-listed address or email domain; or a source address in an IP allow-list (CIDR, IPv4 and IPv6). A visitor who fails sees a sign-in page that reveals nothing about the page except its name. An admitted visitor gets an HttpOnly, Secure, SameSite=Lax session cookie, signed so the Worker verifies it without a database read. That keeps PAGE-006's serving-through-failure on private pages. Private responses carry `Cache-Control: private, no-store` and are never stored in a shared edge cache. **Supersedes BASE-PUBLIC-001's no-cookie rule** for private-page hosts only, because a private page needs a session; public surfaces keep SUB-005.

Acceptance: a signed-out request to a private page returns its sign-in page with no incident text. Each access method admits an allowed visitor and refuses another. With the database unavailable, an admitted visitor still reads the last snapshot. No private response is cacheable by a shared cache.

Status: **missing**.

#### AUD-003 — Audiences for named customers.

An audience is a named group of customers, such as "Acme Corp" or "Enterprise EU". Its members come from email domains, IdP group claims, an explicit list or a CSV import. Each audience has the components that matter to it, a page (AUD-001) and its own update wording (UPDATE-010). Operators decide, for each incident, which audiences see it. Audience members see only their components and the incidents shared with them.

Acceptance: a member of "Acme Corp" signs in and sees the two components and one incident shared with Acme, and does not see an incident shared only with "Enterprise EU".

Status: **missing**.

#### AUD-004 — Audience subscribers.

Signed-in audience members can subscribe on any SUB-016 channel from their page. Their notifications carry their audience's wording and are never sent to public subscribers. Public subscribers never receive audience-only incidents. Unsubscribe and management follow SUB-006 and SUB-007.

Acceptance: an audience-only update notifies the audience's subscribers and no public subscriber. A combined update sends each subscriber exactly one message with their own wording.

Status: **missing**.

#### AUD-005 — Isolation is proven, not assumed.

No private component, private incident, audience wording, audience member or private subscriber ever appears in a public snapshot, feed, widget, badge, public API response or public notification. Private snapshots are written under a separate storage prefix that public routes cannot read.

Acceptance: a canary test writes unique strings into every private field, publishes, and searches every public artifact, response and outgoing public notification for them: zero matches. A crafted public request for a private snapshot key returns 404.

Status: **missing**.

## Management API and infrastructure as code — target

#### API-001 — Token-authenticated management API.

`/api/v1/` exposes pages, components, groups, incidents (create draft, publish an update under UPDATE-001's validation, resolve), maintenance, templates, subscribers (create, import, delete), audiences, metrics push and automation rules. An OpenAPI 3.1 document is served at `/api/v1/openapi.json`. Owners and Admins issue scoped tokens (`read`, `incidents:write`, `components:write`, `maintenance:write`, `subscribers:write`, `metrics:write`, `admin`). Each token is shown once, stored only as a hash, and has an expiry, a last-used time and an immediate revoke. Each token has its own rate limit with 429 and `Retry-After`. Every write is audited with the token's ID and issuing operator. Publication through a token still honours UPDATE-007 review and TEAM-004 roles: a token acts as its issuer, never with more rights. **Supersedes BASE-ACCESS-002's session requirement** for `/api/v1/` only.

Acceptance: a `components:write` token changes a component's state, and the change is attributed to the token. The same token's incident publish returns 403. A revoked token returns 401 within 10 seconds. The OpenAPI document validates, and a generated client completes an incident lifecycle.

Status: **partial** — `src/core/features/incidents/routes.ts`, `src/core/features/maintenance/routes.ts`, `tests/e2e/app-api.test.mjs`. Session-authenticated operator APIs exist for the app. There are no tokens, no public versioned API and no OpenAPI document. Replaces the released `seed.json → nonGoals` exclusion of a token API.

#### API-002 — Statuspage-compatible management API.

A subset of the Statuspage REST v1 API (`/v1/pages/{page_id}/components`, component status `PATCH`, `/v1/pages/{page_id}/incidents` create and update, scheduled maintenance create) accepts `Authorization: OAuth <token>` with an API-001 token. Existing scripts, CI steps and monitoring integrations written for Statuspage then work by changing the base URL. Lamp records which compatibility calls each token makes, so the owner can move them to `/api/v1/`.

Acceptance: the unmodified Statuspage component-status script from Atlassian's documentation, pointed at Lamp, changes the component state. An unsupported Statuspage endpoint returns 404 with a body naming the Lamp equivalent.

Status: **missing**.

#### API-003 — Operator event webhooks.

Owners configure signed operator webhooks for private events that subscriber webhooks never carry: alert received, draft created, update published, component changed, maintenance changed, subscriber changed and rule fired. They use the signing scheme, retry, failure rules and at-most-once delivery of SUB-009, SUB-010 and NOTIFY-005. Internal automation (Zapier, Make, n8n, a data warehouse) can then follow the desk.

Acceptance: an alert followed by a publish delivers two signed events to a controlled receiver in order. A receiver that fails 10 times is deactivated, and the owner is emailed.

Status: **missing**.

#### API-004 — Terraform, GitHub Actions and config-as-code.

A published Terraform provider manages pages, components, groups, audiences, alert sources, templates and automation rules, with plan and apply against API-001. A `lamp.yaml` file applied with `rer`'s Lamp command shows a create/change/delete plan before applying it. Published GitHub Actions open and complete maintenance (MAINT-008) and draft an incident on a failed deploy. Configuration drift made in the UI shows up in the next plan.

Acceptance: `terraform apply` of a fixture configuration creates its components and groups, and a second plan shows no changes. A UI edit makes the next plan show exactly that change.

Status: **missing**.

## Integrations — target

#### INTEG-001 — Incident context in the support desk.

HappyToHelp, Zendesk and Intercom show support agents the active incidents and maintenance, with impact, components and permalink, beside each conversation. HappyToHelp and Intercom are connected through their apps and APIs; Zendesk through a Zendesk app. An agent can link a ticket or conversation to a Lamp incident. On resolution the agent sees the resolved update and the linked tickets are listed for follow-up. Lamp never messages customers through the desk itself. Linked-ticket counts appear in the incident brief as customer-report evidence (AGENT-006) without customer identities.

Acceptance: against recorded Zendesk and Intercom API fixtures and a HappyToHelp test installation, an active incident appears in the agent sidebar payload, a linked ticket raises the brief's customer-report count, and resolution lists that ticket.

Status: **missing**.

## Mobile — target

#### MOBILE-001 — The operator desk works on a phone.

At 390 px wide, an operator can sign in, approve an alert draft, attach components, write and preview an update, publish, resolve, set a component claim and schedule maintenance. There is no horizontal scrolling, touch targets are at least 44 px, and the composer keeps its UPDATE-005 draft guarantees.

Acceptance: a browser journey at 390×844 publishes and resolves an incident from an alert draft with no horizontal overflow, and the accessibility checks pass on each step.

Status: **partial** — `tests/e2e/accessibility.test.mjs`. The subscriber screen is checked at 390 px for horizontal overflow. There is no full phone-width publish journey.

#### MOBILE-002 — Installable app with push.

The operator app is an installable progressive web app on iOS (16.4 and later), Android and desktop. An operator can enable web push per device for due and overdue commitments, alert drafts, escalations, delivery failures and vendor alerts (NOTIFY-016). A push contains the incident reference and opens its composer. It contains no subscriber data and, by the owner's choice, no update text. Lamp has no native store apps; the installed app is the mobile product.

Acceptance: a device with push enabled receives one push when an incident becomes due, and tapping it opens the composer. Removing the device stops further pushes.

Status: **missing**.

## Operator setup and recovery

- **SETUP-001 — Setup readiness.** Overview shows eight steps from saved server state: non-sample page name and branding, configured time zone, sender checked, first component, first published incident, public page opened through its protected check, reachable subscription form, and public address selected with custom-domain documentation. Open steps lead to their completion screen; all-complete collapses the checklist. Provider authentication checks and local outbox capture are labelled separately, and neither claims inbox delivery. Public GET paths remain database-free; protected operator actions retain the public-read checks. Choosing an address acknowledges that choice, not DNS validation, and the default deployment address is supported.
- **SETUP-002 — First-run setup.** A signed-in owner whose installation has no stored first-run completion is sent from every operator document to `/setup`, where they confirm the page name, tagline, time zone and accent colour. Saving stores completion durably; afterwards `/setup` opens the app and settings remain editable in Settings. A signed-out visitor to `/setup` is sent to sign-in and returned there. An installation that already had an operator before this clause is recorded as complete by its migration. A setup rerun never clears completion.
- **ACCESS-001 — Owner-terminal sign-in.** An owner with installation database access through Wrangler and the installation's `SESSION_SECRET` can issue a link for an existing active, non-erased operator; the remote command reads that secret only from its environment and refuses, naming it, when it is absent. The command uses the native hashed, 20-minute, single-use magic-link flow, records “sign-in link created from the command line”, and prints its only copy of the raw link once on stdout. It creates no operator or session; sign-in consumption creates the session under BASE-ACCESS-001 and BASE-ACCESS-002. Unknown, deactivated and erased operators receive the same refusal. Optional OpenID Connect sign-in through Auth, Google, Microsoft or Okta is supported by Base, off until the owner links and enables a provider; email magic links remain available. This replaces the former SSO exclusion. SCIM and role synchronization remain out of scope.

## Moving in

- **MOVE-001 — Dry run first.** An owner moving from Statuspage, Better Stack, Instatus or Sorry gives Settings → Move in either an API key with its page ID (read once with GET requests to the source's fixed API origin, never stored) or the source's saved API responses. A dry run counts every component, component group, incident with its updates, scheduled maintenance and subscriber as imported, changed, skipped or refused, names each reason, and writes nothing. An import applies only the reviewed dry run: if the source or this page changed since, it is refused and a fresh dry run is required.
- **MOVE-002 — Retroactive and silent.** An import keeps every incident update's original publication time and derives each imported component's state history from those times, as INCIDENT-009 does; it queues no notification for any incident or maintenance and publishes no maintenance notice. A window already over is imported as completed. Each imported email subscriber is pending. Preview, apply, resume, job reads and Cutover checks send no mail. Only the authenticated owner’s explicit Send invitations action claims and sends each eligible pending email subscriber at most one confirmation invitation, mentioning no past incident. For Statuspage, Better Stack and Instatus, confirmation expires 72 hours from the import review time stored as created_at, even when sending is delayed; expired subscribers cannot be invited and SUB-003 deletes unconfirmed addresses. A claim precedes the transport call to prevent duplicates across concurrent batches and retries. Proven preparation failures remain retryable because no message was submitted; interrupted or uncertain claimed sends are not automatically retried.
- **MOVE-003 — One import per source.** Running the same source again reports it as already imported and changes nothing and sends nothing. A record already imported is never imported a second time from another source.
- **MOVE-004 — Undo.** Undo removes every record the import created that nobody changed since, sends nothing, and keeps each record an operator or subscriber changed, together with the records it still needs, naming them.
- **MOVE-005 — Old public addresses.** Imported incident and maintenance source paths and supplied shortlink paths permanently redirect on the public host to each surviving record's Lamp permalink; maintenance has its own permanent page. Sorry numeric notice and supplied notice paths redirect to the matching incident or maintenance; `/notices`, `/history` and `/history/YYYY/month` (English month names) redirect to Lamp’s `/history/` while a Sorry import is retained. Source Atom paths (`/history.atom` for Statuspage and Instatus; `/feed.atom` for Better Stack) serve Lamp's Atom feed after import, even without incident history, until a complete undo removes the import. These responses come from the same versioned snapshot as the page, without database queries. A second apply duplicates no aliases; conditional undo removes exactly the removed records' aliases and keeps preserved records' aliases. New imports refuse and name unsafe addresses, native-path collisions and conflicting destinations; an older retained source reports unusable aliases without withholding the public snapshot. Missing shortlinks are never invented. Source-owned shortlink hostnames remain outside Lamp's control. Better Stack REST reports supply no documented public URL; their paths are unavailable unless an unchanged saved status-page webhook supplies an exact shortlink with a matching report ID. No `/incident/<REST-id>` path is guessed. Better Stack maintenance messages are retained as historical updates, without creating native lifecycle notices or replaying notifications.
- **MOVE-006 — Cutover preview.** Settings → Cutover is available after a dry run and for saved imports. It shows up to the first 25 old incident and maintenance addresses with proposed or surviving native permalinks, unavailable addresses and source-host limits, source feed answers, unsupported JSON/RSS/widget consumers, and eligible invitations with their original expiry deadline. Once the owner selects a public origin, each Opens check uses a credentialless browser request that follows the redirect and verifies the final native address and successful HTML response; failures remain explicit. The ordered guide covers import, preview, explicit invitations, hostname/custom-domain instructions, rechecking and keeping the source through the confirmation window. It claims neither DNS validation nor inbox delivery.

Instatus accepts its documented saved management REST response families with a separate owner acknowledgement that the page and supplied history are published and unrestricted. Known protected or unpublished source records cannot become public. Visual Component parents are groups; audience groups are refused access restrictions. Only confirmed, approved email-only subscriptions with resolved preferences become pending. Exact supplied public-summary incident/maintenance URLs are joined by source ID; missing URLs are not invented. Maintenance ends use explicit timestamps or documented duration minutes under completed/autoEnd semantics, with every update retained silently.

Sorry general notices may have no affected component and are carried as resolved informational history without outage claims; cancelled maintenance stays cancelled. Sorry additionally accepts keyless public JSON captures, including paginated components and notices plus full detail for every notice. Partial public previews name uncaptured details and cannot be applied. Subscribers come only from the authenticated API; eligible email rows are held inert without mail or confirmation expiry. After the hostname is live and the watch window closes, an explicit owner invitation action names the configured public origin, records that approval, and releases held rows into pending with a 72-hour window starting at release. Undo cannot recall mail or remove a released row as if it were still unchanged. Sorry numeric notice IDs and supplied notice paths redirect to surviving Lamp incidents or maintenance; `/notices`, `/history` and `/history/YYYY/month` (English month names) redirect to Lamp’s `/history/` while a Sorry import is retained.

### Moving in — target

#### MOVE-007 — From Status.io.

An owner gives Settings → Move in a Status.io API ID and key (read with GET requests to Status.io's API origin, never stored) or saved API responses. The dry run, apply, single import, undo and old-address rules of MOVE-001 to MOVE-006 apply. Containers become groups or components, incidents keep their messages and times, maintenance keeps its windows, and email, SMS and webhook subscribers come in as pending on their channels (MOVE-010).

Acceptance: a saved Status.io fixture dry-runs with counts and reasons, applies silently with original times, redirects its old incident paths, and undoes cleanly.

Status: **missing**.

#### MOVE-008 — From incident.io Status Pages.

An owner gives an incident.io API key with status-page read scope, or saved responses. Components, groups, incidents with updates and maintenance import under MOVE-001 to MOVE-006. Where incident.io exposes no subscriber export, the Cutover guide says so and shows how to invite those subscribers from the new page.

Acceptance: a saved incident.io fixture dry-runs and applies with original times and silent history, and Cutover names the subscriber limitation.

Status: **missing**.

#### MOVE-009 — Statuspage consumers keep working at cutover.

After a Statuspage import, everything that read the old page keeps working on the moved hostname: the Statuspage public API paths (PAGE-016), `/history.rss` and `/history.atom` (PAGE-017), and the embed script path `/embed/script.js`, which serves PAGE-019's floating notice. Cutover (MOVE-006) lists them as served instead of unsupported.

Acceptance: after a Statuspage fixture import, an unmodified Statuspage client reads `/api/v2/summary.json`, a feed reader reads `/history.rss`, and an old embed tag renders the notice. Cutover lists every one as served.

Status: **partial** — `src/core/features/statuspage-import/public-paths.mjs`, `src/core/features/public-snapshot/import-aliases.ts`, `tests/e2e/statuspage-import.test.mjs`. History and Atom aliases are served after import (MOVE-005). JSON API, RSS and embed compatibility are missing, and Cutover reports them as unsupported (MOVE-006).

#### MOVE-010 — Every subscriber channel moves.

Imports from Statuspage, Status.io and Better Stack bring webhook, Slack, Teams and SMS subscribers as well as email. Each arrives pending and is re-confirmed in its own channel's way: SMS by a YES reply (SUB-013), webhooks by a signed verification ping, Slack by reinstalling the app (SUB-014). The confirmation windows and owner-sent invitations of MOVE-002 apply. Nothing is sent before the owner's explicit invitation action.

Acceptance: a Statuspage fixture with email, webhook and SMS subscribers dry-runs all three channels. After invitations, the SMS subscriber is active only after replying YES, and the webhook subscriber only after its ping succeeds.

Status: **missing**. Released imports carry email subscribers only.

## Data, security and portability

The guarantees in `BASELINE.md` apply to every clause, released and target. They cover security headers and sessions (BASE-ACCESS), input handling (BASE-INPUT), cookieless public surfaces (BASE-PUBLIC), export and import, erasure, retention and declared outbound flows (BASE-DATA), and health, migrations, idempotency, visible failure and audit (BASE-OPS). Released replacements: PAGE-008 supersedes BASE-ACCESS-003 for public read paths, SUB-003 supersedes BASE-DATA-002 for pending subscriptions, and SUB-005 supersedes BASE-PUBLIC-001 for token-addressed paths. Target replacements: API-001 supersedes BASE-ACCESS-002 for `/api/v1/`, and AUD-002 supersedes BASE-PUBLIC-001 for private-page hosts.

### Data, security and portability — target

#### PORT-001 — Every new record travels.

HIST-004's export and the OPERATIONS.md restore path include every record the target clauses add: pages, audiences and members, audience wording, roles and scopes, vendor components and their history, monitor links and rules, metrics, translations, SMS consent records and API token metadata. Secrets never travel: API token hashes, SSO and SCIM secrets, Slack, Twilio and Plivo credentials, and secondary-origin keys. A restored installation re-authorizes each integration before it sends anything.

Acceptance: an export of a fixture with every target entity restores into an empty installation with equivalent re-export. A secret scan of the archive finds no credential, and every restored integration is disabled until reconnected.

Status: **partial** — `tests/e2e/export-import.test.mjs`. Export, clean restore and equivalent re-export cover every released record (HIST-004). Target entities are not built.

#### PORT-002 — Erasure reaches every new identifier.

BASE-DATA-003 erasure covers phone numbers and their SMS consent records, Slack and Teams installations, audience members, private-page sessions, API tokens and SCIM-provisioned operators, within 5 minutes and with anonymised audit entries. Erasing a phone number removes it from the delivery log while keeping the delivery outcome counts.

Acceptance: erasing an SMS subscriber removes the number from every table, and the delivery log keeps an anonymised row. Erasing an audience member ends their private-page session.

Status: **partial** — `tests/e2e/subscriber-erasure.test.mjs`, `tests/auth-adoption/operator-erasure.test.mjs`. Subscriber and operator erasure ship for released records. The identifiers that target clauses add are not built.

## Push further — target

These clauses go past what Instatus, incident.io and OpenStatus ship today. Each names what the agent does, which data it reads and the human control that bounds it. Every agent call goes through `ai.provider.v1` (DRAFT-003). Internal notes are never sent to a model (INCIDENT-008). An agent drafts, flags, reminds and checks; it never publishes, never moves a public commitment and never resolves an incident.

#### AGENT-001 — The public story matches responder evidence.

**What the agent does:** it continuously compares the latest published update of each unresolved incident with the evidence Lamp holds, and flags where they disagree. The flags are: *stale* (evidence changed and nothing has been published since); *contradictory* (the public update says Monitoring while a linked monitor is still failing, or says one region while evidence shows three, or a resolved update while an alert is still firing); and *incomplete* (evidence shows another component failing that the incident does not name). For each flag it drafts a correction update in the composer. **Data:** accepted alerts, Uptime evidence (COMP-008), Oncall timeline entries (INTAKE-012), PagerDuty acknowledgements (INTAKE-009), vendor feeds (DEP-001), support-ticket counts (INTEG-001) and the published timeline: everything in DRAFT-002's brief and none of the internal notes. **Human control:** flags and drafts are private. A named operator edits and publishes any correction. A contradiction can still be resolved only by an operator recording an override reason (AGENT-004).

Acceptance: a fixture with a public "Monitoring" update and a still-failing linked monitor shows a contradictory flag within 60 seconds. The flag cites the monitor evidence with its time, and the draft correction sits unpublished in the composer. Nothing public changes until an operator publishes.

Status: **partial** — `src/core/features/brief/build.ts`, `src/core/features/ai/service.ts`, `tests/e2e/incident-brief.test.mjs`. The model-free brief flags a monitor recovery with a non-resolved lifecycle and a passed commitment, and an operator can request a cited suggestion (DRAFT-001, DRAFT-004). Continuous comparison against responder, monitor and support evidence does not exist.

#### AGENT-002 — The next-update promise is kept.

**What the agent does:** 10 minutes before an incident's committed next-update time (INCIDENT-010), if no draft exists, it prepares one. The draft is a short "still working on it" update that restates the known impact and names what changed in the evidence since the last update, or says plainly that nothing has. It reminds the communication owner (INCIDENT-011) with the draft linked and escalates an unowned incident to every communicator. **Data:** the brief, the last published update and the commitment time. **Human control:** the operator sets the next commitment and publishes. The agent cannot change or extend the public time, and an unpublished draft lets the commitment lapse visibly as overdue.

Acceptance: with a commitment 10 minutes away and no draft, a cited draft appears and the owner gets one reminder linking it. If nobody publishes, the incident turns overdue exactly as INCIDENT-006 says, and the public page shows the original commitment.

Status: **partial** — `src/core/features/incidents/reminders.ts`, `src/core/features/ai/service.ts`, `tests/e2e/update-reminders.test.mjs`. Due and overdue reminders and on-request suggestions ship. Automatic drafting before the deadline and owner escalation do not.

#### AGENT-003 — Audience-specific impact.

**What the agent does:** for an incident visible to several audiences (AUD-003), it drafts each audience's UPDATE-010 wording from the components and regions that audience depends on. It names what that audience can and cannot do and leaves out components the audience does not use. **Data:** audience definitions and their component and region mappings, confirmed affected components and per-region monitor evidence; no member identities. **Human control:** an Owner or Admin approves audience definitions and mappings. A communicator approves every variant before it publishes. No private customer name or identifier is ever placed in public wording; the UPDATE-011 checks run on every variant.

Acceptance: an incident on the EU API region yields a draft variant for "Enterprise EU" that names the EU API, and no variant text for an audience without EU components. Publishing requires the communicator's explicit acceptance of each variant.

Status: **partial** — `src/core/features/incidents/service.ts`, `tests/reference-storage/incident-publishing.test.mjs`. Each update carries an operator-written affected-audience statement (UPDATE-001). There are no audiences and no drafted variants.

#### AGENT-004 — Customer-visible recovery is checked before close.

**What the agent does:** when an operator chooses Resolved, it runs a recovery check and shows the result with its evidence. The check asks: every linked monitor recovered and passing for the hold period; every vendor dependency recovered; no alert still firing; public-page traffic back near baseline (HIST-006); and linked support tickets (INTEG-001) no longer arriving. **Data:** the same evidence as AGENT-001. **Human control:** a passing check lets the named operator publish Resolved as usual. A failing check lets them publish only after recording an override reason, which appears on the internal timeline and in the audit log. The agent never resolves anything itself.

Acceptance: choosing Resolved while a linked monitor still fails shows the failing item with its evidence time and refuses the publish without an override reason (409). With a reason, it publishes and the reason is audited.

Status: **partial** — `src/core/features/brief/build.ts`, `tests/e2e/incident-brief.test.mjs`. The brief notes a recorded monitor recovery that has not been published as Resolved. There is no pre-close recovery check and no override.

#### AGENT-005 — A post-incident report drafted from the record.

**What the agent does:** for a resolved incident it drafts HIST-002's report. The summary and timeline come from alerts, published updates, Oncall and PagerDuty timeline entries and the measured outage window. Cause and remediation are left as marked prompts with the evidence that bears on them, never invented. Every timeline line cites its source. **Data:** the brief's sources and the measured window; no internal notes. **Human control:** the report stays a draft until an operator edits and publishes it, and the cause and remediation must be written by a person.

Acceptance: a resolved fixture incident yields a draft whose timeline lines each cite a brief reference, with cause and remediation empty and flagged. Publishing an untouched cause field is refused with 400.

Status: **missing**.

#### AGENT-006 — Unreported incidents surface early.

**What the agent does:** with no incident open, it watches for signs that customers are already affected: a traffic spike (HIST-006), a cluster of support conversations about one product area (INTEG-001), a vendor outage on a dependency (DEP-002), or monitors degrading below the alert threshold. When the signs line up, it proposes a private draft incident naming the likely components and the evidence. **Data:** aggregate counts and categories only, no customer messages or identities. **Human control:** the proposal reaches communicators as an operator alert. Nothing is public until a person publishes, and a dismissed proposal records who dismissed it and why.

Acceptance: a fixture with a 4× traffic spike and five support conversations tagged "login" in 10 minutes produces one private proposal naming the sign-in component and both signals, and changes no public surface.

Status: **missing**.

#### AGENT-007 — Translations drafted, never auto-published.

**What the agent does:** for each enabled language (I18N-001) it drafts the translation of every update and report, using the owner's glossary of product and component names. **Data:** the update text and the glossary. **Human control:** each language's text is published only after a person approves it, or under I18N-002's explicit "default language" choice. A machine translation is never published unapproved.

Acceptance: with Spanish enabled, the composer shows a Spanish draft that uses the glossary terms, and publishing without approving Spanish follows I18N-002's refusal.

Status: **missing**.

#### AGENT-008 — Scoped MCP tools for outside agents.

**What the agent does:** Lamp serves an MCP server so the buyer's own agents can work the desk. Its tools read components, incidents, briefs and subscriber counts, draft updates, propose maintenance windows and attach evidence. **Data:** only what the issuing token's API-001 scopes allow. **Human control:** there is no publish tool unless an Owner grants the separate `publish` scope. Even then, UPDATE-007 review and TEAM-004 roles apply as for the token's issuer, and every tool call is audited with the token and the arguments' record IDs.

Acceptance: an MCP client with a `read`+`incidents:draft` token drafts an update that appears unpublished in the composer. Its call to a publish tool fails because the tool is not offered. Each call has an audit entry.

Status: **missing**.

#### AGENT-009 — Maintenance notices drafted from change plans.

**What the agent does:** from a linked GitHub pull request, deploy plan or change ticket, it drafts a maintenance notice. The notice gives the affected components, the window, the expected customer impact in plain words and what will still work. **Data:** the linked change's title, description and labels, and the component catalogue. **Human control:** the notice is a draft until a communicator schedules it. The agent never schedules or starts a window itself.

Acceptance: a fixture pull request labelled `db-migration` with a stated window yields a draft maintenance on the database component with that window, unscheduled until an operator saves it.

Status: **missing**.

## Honest boundaries

What Lamp does not do, and how a buyer gets it:

| Not in Lamp | How the buyer gets it |
|---|---|
| Running probes, synthetic checks or measuring uptime itself | [Uptime](https://github.com/just-every/run-uptime) measures, and Lamp consumes its signed evidence (COMP-008, UPTIME-007); Datadog, Pingdom, New Relic and Prometheus feed in through presets. |
| Paging, on-call schedules and escalation of responders | [Oncall](https://github.com/just-every/run-oncall) or PagerDuty; Lamp hands them communication deadlines (INCIDENT-011) and takes in their timelines (INTAKE-009, INTAKE-012). |
| Being the support desk | [HappyToHelp](https://github.com/just-every/run-happytohelp), Zendesk or Intercom, with Lamp's incident context (INTEG-001). |
| Visitor analytics or email open tracking | [Vane](https://github.com/just-every/run-vane) for site analytics; Lamp keeps only aggregate request counts (HIST-006) and delivery outcomes (NOTIFY-004). |
| Logs, metrics storage and APM | The buyer's observability tool; Lamp shows at most 10 aggregated public metrics (UPTIME-008). |
| Operating SMS carriers or guaranteeing inbox or handset arrival | Twilio or Plivo, and SendGrid, Mailgun, Amazon SES, Postmark or Resend; Lamp records accepted, delivered, bounced and failed separately, and never claims a person read a message. The owner registers their own 10DLC campaign or toll-free number and pays carrier fees in USD. |
| Protection from an outage of every provider at once | PAGE-015's secondary origin on a separate provider covers the primary host; a buyer who needs a contractually independent standby keeps a separately operated status host. |
| Compliance certification of private pages (SOC 2, HIPAA, FedRAMP) | Private pages are access control (AUD-002), not certification. Lamp signs no BAA, and protected health information does not belong in updates. |
| Native App Store or Google Play apps | The installable app with push (MOBILE-002) is the mobile product. |
| Publishing machine translations or agent text unreviewed | Never; agent text is always a draft (Push further). |
| Paid plans, billing and sales tax | Lamp is owner-run; provider costs (Twilio, Plivo, email providers, Cloudflare) are billed to the owner directly by those providers in USD. |

## Status

Status at `just-every/run-lamp` main `0eebe91`. Released clauses are **done**: each has a tagged test in the routine `pnpm verify` plan. Target clauses carry the status stated in their text. Evidence paths are relative to the repository root.

Totals: 179 clauses — **104 done**, **33 partial**, **42 missing** (104 released, 75 target).

| Clause | Title | Kind | Status | Evidence |
|---|---|---|---|---|
| DOCS-001 | Public owner documentation | released | done | `tests/e2e/start-runtime.test.mjs` |
| PAGE-001 | Contents | released | done | `tests/e2e/app-api.test.mjs` |
| PAGE-002 | Readable without script | released | done | `tests/e2e/public-contract.test.mjs` |
| PAGE-003 | Weight | released | done | `tests/e2e/public-contract.test.mjs` |
| PAGE-004 | Overall status | released | done | `tests/e2e/public-contract.test.mjs` |
| PAGE-005 | Snapshot read path | released | done | `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/snapshot-retained.test.mjs` |
| PAGE-006 | Serving through a failure | released | done | `tests/e2e/app-api.test.mjs`, `tests/e2e/public-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |
| PAGE-007 | Publish latency and caching | released | done | `tests/e2e/app-api.test.mjs`, `tests/e2e/public-contract.test.mjs`, `tests/e2e/snapshot-retained.test.mjs` |
| PAGE-008 | Public read paths are not rate limited | released | done | `tests/e2e/public-contract.test.mjs` |
| PAGE-009 | Time display | released | done | `tests/e2e/public-contract.test.mjs` |
| PAGE-010 | Atom feed | released | done | `tests/e2e/app-api.test.mjs`, `tests/e2e/public-contract.test.mjs` |
| PAGE-011 | Embeddable widget | released | done | `tests/e2e/public-contract.test.mjs` |
| PAGE-012 | Branding | released | done | `tests/e2e/app-api.test.mjs`, `tests/e2e/public-contract.test.mjs` |
| PAGE-013 | Enforced isolation | released | done | `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/public-contract.test.mjs` |
| PAGE-014 | Live refresh | released | done | `tests/e2e/public-contract.test.mjs` |
| PAGE-015 | Served independently of what it reports | target | partial | `src/core/app/host-dispatch.ts`, `src/core/features/page-settings/service.ts`, `tests/e2e/public-contract.test.mjs` |
| PAGE-016 | Statuspage-compatible public API | target | partial | `src/core/features/public-snapshot/routes.ts`, `tests/e2e/public-contract.test.mjs` |
| PAGE-017 | RSS and per-component feeds | target | partial | `src/core/features/public-snapshot/feed-widget.ts`, `tests/e2e/public-contract.test.mjs` |
| PAGE-018 | Status badges | target | missing | — |
| PAGE-019 | Embed variants | target | partial | `src/core/features/public-snapshot/feed-widget.ts`, `tests/e2e/public-contract.test.mjs` |
| PAGE-020 | Accessible to the standard US buyers require | target | partial | `tests/e2e/accessibility.test.mjs` |
| THEME-001 | Full brand theming and custom CSS | target | partial | `src/core/features/page-settings/service.ts`, `src/core/features/public-snapshot/branding.ts`, `tests/e2e/public-contract.test.mjs` |
| I18N-001 | Pages in several languages | target | missing | — |
| I18N-002 | Translated updates | target | missing | — |
| COMP-001 | States and their order | released | done | `tests/e2e/public-contract.test.mjs` |
| COMP-002 | Grouping and order | released | done | `tests/e2e/public-contract.test.mjs` |
| COMP-003 | Append-only state history | released | done | `tests/e2e/public-contract.test.mjs` |
| COMP-004 | State note | released | done | `tests/e2e/public-contract.test.mjs` |
| COMP-005 | Internal components | released | done | `tests/e2e/public-contract.test.mjs` |
| COMP-006 | Component state is claimed, not set | released | done | `tests/e2e/app-api.test.mjs` |
| COMP-007 | Deletion | released | done | `tests/e2e/public-contract.test.mjs` |
| COMP-008 | Monitor claims from measured evidence | target | missing | — |
| COMP-009 | Component bulk editing and descriptions | target | partial | `src/core/features/components/service.ts`, `tests/e2e/public-contract.test.mjs` |
| DEP-001 | Vendor components that follow vendor status | target | missing | — |
| DEP-002 | Vendor state never silently becomes the buyer's outage | target | missing | — |
| DEP-003 | Vendor watch for the team | target | missing | — |
| UPTIME-001 | Definition | released | done | `tests/e2e/public-contract.test.mjs` |
| UPTIME-002 | Downtime weights | released | done | `tests/e2e/public-contract.test.mjs` |
| UPTIME-003 | Short history | released | done | `tests/e2e/public-contract.test.mjs` |
| UPTIME-004 | Corrections | released | done | `tests/e2e/public-contract.test.mjs` |
| UPTIME-005 | Stated method | released | done | `tests/e2e/public-contract.test.mjs` |
| UPTIME-006 | Daily record | released | done | `tests/e2e/public-contract.test.mjs` |
| UPTIME-007 | Measured uptime bars | target | missing | — |
| UPTIME-008 | Public performance metrics | target | missing | — |
| UPTIME-009 | Availability reports | target | missing | — |
| INCIDENT-001 | Lifecycle | released | done | `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |
| INCIDENT-002 | Impact | released | done | `tests/e2e/publishing-contract.test.mjs` |
| INCIDENT-003 | Reference | released | done | `tests/e2e/publishing-contract.test.mjs`, `tests/reference-storage/references.test.mjs` |
| INCIDENT-004 | Published updates are immutable | released | done | `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |
| INCIDENT-005 | Reopening | released | done | `tests/e2e/publishing-contract.test.mjs` |
| INCIDENT-006 | Overdue update | released | done | `tests/e2e/publishing-contract.test.mjs` |
| INCIDENT-007 | Deletion | released | done | `tests/e2e/publishing-contract.test.mjs` |
| INCIDENT-009 | Retroactive incidents | released | done | `tests/e2e/publishing-contract.test.mjs` |
| INCIDENT-008 | Internal notes | released | done | `tests/e2e/publishing-contract.test.mjs` |
| INCIDENT-010 | Update due | released | done | `tests/e2e/update-reminders.test.mjs` |
| INCIDENT-011 | A named communication owner | target | partial | `src/core/features/incidents/reminders.ts`, `tests/e2e/update-reminders.test.mjs` |
| INCIDENT-012 | Run the incident from Slack or Teams | target | missing | — |
| UPDATE-001 | Template | released | done | `tests/e2e/publishing-contract.test.mjs`, `tests/reference-storage/incident-publishing.test.mjs`, `tests/reference-storage/migration.test.mjs` |
| UPDATE-002 | One rendering | released | done | `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |
| UPDATE-003 | Sets the lifecycle | released | done | `tests/e2e/publishing-contract.test.mjs` |
| UPDATE-004 | Preview | released | done | `tests/e2e/app-api.test.mjs` |
| UPDATE-005 | Drafts | released | done | `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |
| UPDATE-006 | Scheduled publish | released | done | `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |
| UPDATE-007 | Review | released | done | `tests/e2e/publishing-contract.test.mjs` |
| UPDATE-008 | Publish is atomic | released | done | `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |
| UPDATE-009 | Templates | released | done | `tests/e2e/publishing-contract.test.mjs` |
| UPDATE-010 | Audience variants of one update | target | missing | — |
| UPDATE-011 | Wording checks before publish | target | missing | — |
| MAINT-001 | Distinct from incidents | released | done | `tests/e2e/intake-references.test.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/reference-storage/references.test.mjs` |
| MAINT-002 | Automatic transitions | released | done | `tests/e2e/publishing-contract.test.mjs` |
| MAINT-003 | Component states | released | done | `tests/e2e/publishing-contract.test.mjs` |
| MAINT-004 | Overrun | released | done | `tests/e2e/publishing-contract.test.mjs` |
| MAINT-005 | Reminders | released | done | `tests/e2e/publishing-contract.test.mjs` |
| MAINT-006 | Rescheduling and cancellation | released | done | `tests/e2e/publishing-contract.test.mjs` |
| MAINT-007 | Maintenance calendar | target | missing | — |
| MAINT-008 | Maintenance from deploy pipelines | target | missing | — |
| SUB-001 | Subscribing | released | done | `tests/e2e/app-api.test.mjs`, `tests/e2e/delivery-contract.test.mjs` |
| SUB-002 | Confirmation | released | done | `tests/e2e/delivery-contract.test.mjs` |
| SUB-003 | Pending expiry | released | done | `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/public-contract.test.mjs` |
| SUB-004 | Component selection | released | done | `tests/e2e/delivery-contract.test.mjs` |
| SUB-005 | Cookieless subscriber tokens | released | done | `tests/e2e/delivery-contract.test.mjs` |
| SUB-006 | One-click unsubscribe | released | done | `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/rer-mail.test.mjs` |
| SUB-007 | Managing a subscription | released | done | `tests/e2e/delivery-contract.test.mjs` |
| SUB-008 | Unsubscribe integrity | released | done | `tests/e2e/delivery-contract.test.mjs` |
| SUB-009 | Webhook subscribers | released | done | `tests/e2e/delivery-contract.test.mjs` |
| SUB-010 | Failing destinations | released | done | `tests/e2e/delivery-contract.test.mjs` |
| SUB-011 | Operator view | released | done | `tests/e2e/delivery-contract.test.mjs` |
| SUB-012 | No enumeration | released | done | `tests/e2e/delivery-contract.test.mjs` |
| SUB-013 | SMS subscribers | target | missing | — |
| SUB-014 | Self-serve Slack subscriptions | target | partial | `src/core/features/subscribers/service.ts`, `src/core/features/channels/service.ts`, `tests/e2e/delivery-contract.test.mjs` |
| SUB-015 | Self-serve Microsoft Teams subscriptions | target | partial | `src/core/features/channels/teams.ts`, `tests/e2e/channels-and-presets.test.mjs` |
| SUB-016 | Preferences on every channel | target | partial | `src/core/features/subscribers/service.ts`, `tests/e2e/delivery-contract.test.mjs` |
| SUB-017 | Subscriber import and export | target | partial | `src/core/features/statuspage-import/`, `tests/e2e/statuspage-import.test.mjs` |
| NOTIFY-001 | What notifies subscribers | released | done | `tests/e2e/delivery-contract.test.mjs` |
| NOTIFY-002 | Delivery time | released | done | `tests/e2e/delivery-contract.test.mjs` |
| NOTIFY-003 | Retry | released | done | `tests/e2e/delivery-contract.test.mjs` |
| NOTIFY-004 | Delivery log, without tracking | released | done | `tests/e2e/delivery-contract.test.mjs`, `tests/reference-storage/capture-receipts.test.mjs` |
| NOTIFY-005 | At most once | released | done | `tests/e2e/delivery-contract.test.mjs`, `tests/reference-storage/capture-receipts.test.mjs` |
| NOTIFY-006 | Operator alerts | released | done | `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/update-reminders.test.mjs` |
| NOTIFY-007 | Channels are per update | released | done | `tests/e2e/delivery-contract.test.mjs` |
| NOTIFY-008 | Who the deployment emails | released | done | `tests/e2e/delivery-contract.test.mjs` |
| NOTIFY-010 | Mail headers | released | done | `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/rer-mail.test.mjs` |
| NOTIFY-009 | Delivery never blocks publication | released | done | `tests/e2e/delivery-contract.test.mjs` |
| NOTIFY-011 | Slack and Teams channels | released | done | `tests/e2e/channels-and-presets.test.mjs` |
| NOTIFY-012 | Channel posts | released | done | `tests/e2e/channels-and-presets.test.mjs` |
| NOTIFY-013 | Redundant email delivery | target | partial | `src/core/app/mail.ts`, `src/core/features/deliveries/service.ts`, `src/core/features/deliveries/sendgrid-events.ts`, `tests/e2e/sendgrid-provider.test.mjs` |
| NOTIFY-014 | SMS delivery | target | missing | — |
| NOTIFY-015 | Reach of each update | target | partial | `src/core/features/deliveries/service.ts`, `tests/e2e/delivery-contract.test.mjs` |
| NOTIFY-016 | Operator alerts beyond email | target | missing | — |
| INTAKE-001 | Authenticated requests | released | done | `tests/e2e/intake-references.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |
| INTAKE-002 | Alerts never publish | released | done | `tests/e2e/publishing-contract.test.mjs` |
| INTAKE-003 | Deduplication | released | done | `tests/e2e/publishing-contract.test.mjs` |
| INTAKE-004 | Recovery alerts | released | done | `tests/e2e/publishing-contract.test.mjs` |
| INTAKE-005 | Payload mapping | released | done | `tests/e2e/app-api.test.mjs`, `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |
| INTAKE-006 | Monitor presets | released | done | `tests/e2e/channels-and-presets.test.mjs` |
| INTAKE-007 | Preset recovery | released | done | `tests/e2e/channels-and-presets.test.mjs` |
| INTAKE-008 | Uptime preset | target | partial | `src/core/features/intake/service.ts`, `tests/e2e/publishing-contract.test.mjs` |
| INTAKE-009 | PagerDuty | target | partial | `src/core/features/intake/service.ts`, `tests/e2e/publishing-contract.test.mjs` |
| INTAKE-010 | Prometheus Alertmanager and Grafana Alerting | target | partial | `src/core/features/intake/service.ts`, `src/core/features/intake/alert-title.ts`, `tests/e2e/publishing-contract.test.mjs` |
| INTAKE-011 | New Relic, Datadog and Pingdom depth | target | partial | `src/core/features/intake/presets.ts`, `tests/e2e/channels-and-presets.test.mjs` |
| INTAKE-012 | Oncall | target | missing | — |
| AUTO-001 | Owner rules for what an alert may do | target | partial | `src/core/features/intake/policies.ts`, `src/core/features/intake/presets.ts`, `tests/e2e/channels-and-presets.test.mjs` |
| AUTO-002 | Flap guard and undo for automatic changes | target | missing | — |
| AUTO-003 | Every follow-up obligation is visible | target | partial | `src/core/features/incidents/reminders.ts`, `src/core/features/reports/service.ts`, `tests/e2e/update-reminders.test.mjs` |
| AUTO-004 | Post-incident report follow-up | target | partial | `src/core/features/reports/service.ts`, `tests/e2e/publishing-contract.test.mjs` |
| DRAFT-001 | Suggested update | released | done | `tests/e2e/incident-brief.test.mjs` |
| DRAFT-002 | Inputs | released | done | `tests/e2e/incident-brief.test.mjs`, `tests/e2e/publishing-browser.test.mjs` |
| DRAFT-004 | Incident brief | released | done | `tests/e2e/incident-brief.test.mjs` |
| DRAFT-003 | Absent or failing provider | released | done | `tests/e2e/incident-brief.test.mjs`, `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |
| TEAM-001 | Equal operators | released | done | `tests/auth-adoption/upgrade.test.mjs`, `tests/e2e/delivery-contract.test.mjs` |
| TEAM-002 | Management | released | done | `tests/auth-adoption/upgrade.test.mjs`, `tests/e2e/delivery-contract.test.mjs` |
| TEAM-003 | Attribution | released | done | `tests/e2e/delivery-contract.test.mjs` |
| TEAM-004 | Roles | target | missing | — |
| TEAM-005 | Access scoped to pages and audiences | target | missing | — |
| TEAM-006 | Enforced SSO and SCIM | target | partial | `src/core/platform/auth/config.ts`, `tests/auth-adoption/dependencies.test.mjs` |
| TEAM-007 | Audit log view | target | partial | `src/core/features/incidents/repository.ts`, `src/core/features/operators/repository.ts`, `tests/e2e/delivery-contract.test.mjs` |
| HIST-001 | Public history | released | done | `tests/e2e/public-contract.test.mjs` |
| HIST-002 | Post-incident report | released | done | `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |
| HIST-003 | Report due | released | done | `tests/e2e/publishing-contract.test.mjs` |
| HIST-004 | Export contents | released | done | `tests/e2e/export-import.test.mjs` |
| HIST-005 | Communication performance | target | missing | — |
| HIST-006 | Traffic spike alert without visitor tracking | target | missing | — |
| HIST-007 | Subscriber reporting | target | partial | `src/core/features/subscribers/service.ts`, `tests/e2e/delivery-contract.test.mjs` |
| AUD-001 | Several pages in one deployment | target | missing | — |
| AUD-002 | Private page access | target | missing | — |
| AUD-003 | Audiences for named customers | target | missing | — |
| AUD-004 | Audience subscribers | target | missing | — |
| AUD-005 | Isolation is proven, not assumed | target | missing | — |
| API-001 | Token-authenticated management API | target | partial | `src/core/features/incidents/routes.ts`, `src/core/features/maintenance/routes.ts`, `tests/e2e/app-api.test.mjs` |
| API-002 | Statuspage-compatible management API | target | missing | — |
| API-003 | Operator event webhooks | target | missing | — |
| API-004 | Terraform, GitHub Actions and config-as-code | target | missing | — |
| INTEG-001 | Incident context in the support desk | target | missing | — |
| MOBILE-001 | The operator desk works on a phone | target | partial | `tests/e2e/accessibility.test.mjs` |
| MOBILE-002 | Installable app with push | target | missing | — |
| SETUP-001 | Setup readiness | released | done | `tests/e2e/setup-readiness.test.mjs` |
| SETUP-002 | First-run setup | released | done | `tests/e2e/auth-adoption-journey.test.mjs` |
| ACCESS-001 | Owner-terminal sign-in | released | done | `tests/auth-adoption/dependencies.test.mjs`, `tests/auth-adoption/portability.test.mjs`, `tests/auth-adoption/upgrade.test.mjs` |
| MOVE-001 | Dry run first | released | done | `tests/betterstack/flow.test.mjs`, `tests/e2e/betterstack-browser.test.mjs`, `tests/e2e/instatus-browser.test.mjs` |
| MOVE-002 | Retroactive and silent | released | done | `tests/auth-adoption/cutover.test.mjs`, `tests/betterstack/flow.test.mjs`, `tests/e2e/sorry-import.test.mjs` |
| MOVE-003 | One import per source | released | done | `tests/e2e/statuspage-import.test.mjs` |
| MOVE-004 | Undo | released | done | `tests/e2e/sorry-import.test.mjs`, `tests/e2e/statuspage-import.test.mjs` |
| MOVE-005 | Old public addresses | released | done | `tests/e2e/sorry-import.test.mjs`, `tests/e2e/statuspage-import.test.mjs` |
| MOVE-006 | Cutover preview | released | done | `tests/auth-adoption/cutover.test.mjs`, `tests/e2e/cutover-browser.test.mjs`, `tests/e2e/sorry-import.test.mjs` |
| MOVE-007 | From Status.io | target | missing | — |
| MOVE-008 | From incident.io Status Pages | target | missing | — |
| MOVE-009 | Statuspage consumers keep working at cutover | target | partial | `src/core/features/statuspage-import/public-paths.mjs`, `src/core/features/public-snapshot/import-aliases.ts`, `tests/e2e/statuspage-import.test.mjs` |
| MOVE-010 | Every subscriber channel moves | target | missing | — |
| PORT-001 | Every new record travels | target | partial | `tests/e2e/export-import.test.mjs` |
| PORT-002 | Erasure reaches every new identifier | target | partial | `tests/e2e/subscriber-erasure.test.mjs`, `tests/auth-adoption/operator-erasure.test.mjs` |
| AGENT-001 | The public story matches responder evidence | target | partial | `src/core/features/brief/build.ts`, `src/core/features/ai/service.ts`, `tests/e2e/incident-brief.test.mjs` |
| AGENT-002 | The next-update promise is kept | target | partial | `src/core/features/incidents/reminders.ts`, `src/core/features/ai/service.ts`, `tests/e2e/update-reminders.test.mjs` |
| AGENT-003 | Audience-specific impact | target | partial | `src/core/features/incidents/service.ts`, `tests/reference-storage/incident-publishing.test.mjs` |
| AGENT-004 | Customer-visible recovery is checked before close | target | partial | `src/core/features/brief/build.ts`, `tests/e2e/incident-brief.test.mjs` |
| AGENT-005 | A post-incident report drafted from the record | target | missing | — |
| AGENT-006 | Unreported incidents surface early | target | missing | — |
| AGENT-007 | Translations drafted, never auto-published | target | missing | — |
| AGENT-008 | Scoped MCP tools for outside agents | target | missing | — |
| AGENT-009 | Maintenance notices drafted from change plans | target | missing | — |
