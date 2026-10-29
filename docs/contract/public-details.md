# Public status mechanisms

The contract contains acceptance and current status. This reference preserves the public formats, integration mappings, implementation limits and original mechanism prose.

## DOCS-001 — Public owner documentation

The app host serves `/docs` and each published `/docs/<slug>` page as public documentation built from repository Markdown selected by `docs/site.json`. Documentation is available without an operator session; the public page host does not serve it.

## PAGE-001 — Contents

`GET /` on the status page host returns, in one response: the overall status; every visible component with its current state and note; every unresolved incident with its 5 most recent published updates, newest first, and a link to that incident's page carrying all of them; every maintenance that is in progress and every scheduled maintenance starting within 14 days; and each visible component's uptime figure and daily record for the reporting window.

## PAGE-002 — Readable without script

The complete content of PAGE-001, and the subscribe form of SUB-001, are present and usable in the initial HTML response. With JavaScript disabled, every status, update, and timestamp is rendered and readable and the subscribe form submits. Script preserves the page’s configured time zone and its visible label; operator entry, timelines, previews and public timestamps use that same zone.

## PAGE-003 — Weight

At the component limit in `seed.json → limits`, the public page's initial HTML response is at most 50KB gzipped, and the page issues at most 4 further requests — stylesheet, font, logo, script — all to its own origin.

## PAGE-004 — Overall status

*Policy: `page.status-rollup.v1`; default: the overall status is the most severe current state among visible components, under the order in COMP-001.* It is shown as one labeled state at the top of the page. With every visible component Operational and no unresolved incident, that label reads as operational.

## PAGE-005 — Snapshot read path

Every change to the content in PAGE-001 writes a complete rendered snapshot of the public page, the Atom feed, and the widget payload to object storage. Serving those three surfaces reads the snapshot and issues no database query. A snapshot write that fails is retried until it succeeds and is reported as a failed job under BASE-OPS-004; the previous snapshot keeps serving until it does.

## PAGE-006 — Serving through a failure

When the database, the queue, or object storage is unreachable, the three surfaces in PAGE-005 return 200 — from the current snapshot, or from the cached response under the `stale-if-error` directive of PAGE-007 when the origin itself cannot answer. They return 503 only when no snapshot has ever been written. A response that could not be built from current data states the instant its content was generated and is labeled as the last known state; no failed read ever produces the all-clear of PAGE-004. `/health` still reports 503 per BASE-OPS-001; the public page's availability does not depend on it.

## PAGE-007 — Publish latency and caching

Stable public URLs validate the current snapshot generation on reuse with a generation ETag and `Cache-Control: public, max-age=0, stale-if-error=3600`. Immutable artifact bytes are cached by generation and artifact key; advancing the published generation makes previous cache entries ineligible for a healthy current response. An update, component state change, or maintenance transition is readable on the status page, history, incident and maintenance permalinks, Atom feed, widget and public JSON within 10 seconds of the request that caused it returning 200. An unreachable origin may use its retained response for the one-hour error window; the application also retains labeled last-known snapshots under PAGE-006.

## PAGE-008 — Public read paths are not rate limited

The public read paths marked `read` in `seed.json → deploy.publicPaths` never return 429. Requests from one address up to the `publicPageRequestsPerSecond` limit in `seed.json → limits` all return 200. **Supersedes BASE-ACCESS-003** for those paths only. A status page is read hardest at the moment it matters most, and a per-address limit would reject real readers behind one egress address during an incident — but the decisive reason is mechanical: RFC 6585 requires that a 429 is never stored by a cache, so rate limiting the read path converts a cacheable traffic spike into an uncacheable one and sends it all to the origin. Those paths share immutable generation bytes in the edge cache. Healthy requests validate the current generation without querying the database; artifact caching reduces object-byte reads, while validation requests still reach the Worker. The public write paths (`/subscribe`, `/unsubscribe`, `/manage`, `/api/intake/*`) stay rate limited under BASE-ACCESS-003.

## PAGE-009 — Time display

Every timestamp on a public surface or in a notification is rendered in the page's configured timezone with its UTC offset, and every timestamp on the page carries the same instant as an ISO 8601 value in a machine-readable attribute. Owner exception (S4, DIVERGENCE.md "Public page clarity — owner L10, 20 October 2026"): while script runs, the page's generation time shows a relative label, refreshed while the page is open. Its tooltip gives the absolute time in the configured timezone with its UTC offset, and its `datetime` keeps the ISO 8601 instant. The initial HTML and script-disabled readers see the absolute time. Incident, maintenance, feed and notification timestamps keep the absolute display.

## PAGE-010 — Atom feed

`/feed.atom` validates as Atom 1.0 and contains one entry for every published incident update and for every maintenance notice — scheduled, rescheduled, started, completed, canceled — from the last 12 months, ordered newest first. An entry's identifier is stable from first publication and is never reused.

## PAGE-011 — Embeddable widget

One script tag renders a banner showing the overall status and any unresolved incident, read from the PAGE-005 snapshot. The script is at most 10KB gzipped, loads only from the deployment's origin, and renders only on the host origins listed in settings per BASE-PUBLIC-002.

## PAGE-012 — Branding

Page name, logo, accent color, timezone, hostname, and a footer-credit toggle are set in settings without a code change. The footer credit is the plain static text `Powered by Lamp`, defaults on, and disabling it makes no network action. The logo is served from the deployment's own origin. The favicon composites a mark for the current overall status over the configured logo rather than replacing it, and the page carries Open Graph metadata whose title and image state the current overall status.

## PAGE-013 — Enforced isolation

Every public page response carries a `Content-Security-Policy` whose `default-src`, `script-src`, `style-src`, `img-src`, `connect-src`, `form-action`, and `base-uri` name only the deployment's own origin, and `frame-ancestors 'none'`, together with `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. The page contains no CAPTCHA and no consent banner, because it stores nothing on the visitor's device and loads nothing that would need either.

## PAGE-014 — Live refresh

When script is available the page re-reads `/api/public/status` at most every 30 seconds and updates the overall status and the newest update in place. That response is a fixed set of fields whose size does not grow with the number of components. The region it updates is an ARIA live region, so a change is announced without a reload. With script disabled the page does not refresh itself and states the instant its content was generated.

## PAGE-015 — Served independently of what it reports

The public page, feeds, widget, badges and public API are served on the buyer's custom domain. The owner adds a hostname, and Lamp provisions it as a Cloudflare custom hostname with an automatically issued TLS certificate and shows the exact DNS record to create. *Secondary origin.* Every snapshot generation (PAGE-005) is also copied, as static objects at the same paths, to a secondary origin the owner chooses on a separate provider. The supported secondaries are an AWS S3 bucket behind a CloudFront distribution that carries an ACM certificate for the buyer's hostname (independent of Cloudflare, and the recommended choice); a Backblaze B2 bucket behind a CDN that serves the buyer's hostname with its own certificate (Bunny.net or Fastly); and a second Cloudflare account. Setup states that a second Cloudflare account covers a failure of Lamp's Worker or account but not an outage of Cloudflare itself. Each copy carries the PAGE-006 "last known state" label and its generation instant. A secondary that falls more than two generations or 5 minutes behind is reported to operators under BASE-OPS-004 and listed in AUTO-003. *Failover topology.* Lamp does not operate DNS. The supported topology is health-checked failover at a DNS provider independent of Cloudflare: Amazon Route 53 failover routing (a primary record to the Cloudflare custom hostname with a health check, a secondary record to the secondary origin) or IBM NS1 Connect with an up/down monitor and a priority filter chain. Lamp's part is threefold. First, the primary serves `/__lamp/serving` on the buyer's hostname: it returns 200 only when the Worker can serve the current snapshot generation from object storage, and 503 otherwise. It needs no database, so a database outage, which PAGE-006 already survives, never triggers failover. Second, Settings → Independence shows the exact records and health-check settings for the chosen provider: an HTTPS check of `/__lamp/serving` every 10 seconds (Route 53 fast interval), failure threshold 3, record TTL 60 seconds. Third, a setup check verifies the arrangement end to end: the hostname resolves to the primary, the provider's secondary record names the secondary origin, the secondary answers TLS for the buyer's hostname (by SNI) with the newest generation, and the health check targets `/__lamp/serving`. Each failing step is named. With those settings the buyer's hostname serves the secondary within 180 seconds of the primary failing (30 seconds of detection, 60 seconds of TTL, and resolver margin). A primary too overloaded to answer the health check within the provider's response window counts as failing too (PAGE-021). Failback is automatic when the health check passes again. Lamp keeps writing each new generation to the secondary while the primary serves, so failback never shows older content than failover did. *What the secondary serves.* Read-only, at the same paths as the primary: the status page, history, incident and maintenance permalinks, the Atom and RSS feeds (PAGE-010, PAGE-017), the widget and embed variants (PAGE-011, PAGE-019), badges (PAGE-018), the Statuspage-compatible and native public APIs with their CORS headers (PAGE-016), and `/maintenance.ics` (MAINT-007), each labeled with its generation instant. Not served: subscribe, manage, unsubscribe, alert intake and the operator app. The secondary answers their paths with 503 and `Retry-After` and a page that says subscriptions are paused while the standby copy is serving, never a false success. Publishing and notification delivery need the primary. During failover the page shows the last published generation, and work committed before the outage is delivered under NOTIFY-009 when the primary returns.

## PAGE-016 — Statuspage-compatible public API

The public host serves `/api/v2/summary.json`, `/api/v2/status.json`, `/api/v2/components.json`, `/api/v2/incidents.json`, `/api/v2/incidents/unresolved.json`, `/api/v2/scheduled-maintenances.json`, `/api/v2/scheduled-maintenances/upcoming.json` and `/api/v2/scheduled-maintenances/active.json` with Statuspage v2 field names, ID formats, impact values and status indicators (`none`, `minor`, `major`, `critical`, `maintenance`). Lamp's Component states and lifecycle map onto those values in a documented table. The `scheduled-maintenances` responses carry each maintenance's MAINT-009 updates as `incident_updates` with their `body` and Statuspage's maintenance statuses (`scheduled`, `in_progress`, `verifying`, `completed`), together with `scheduled_for`, `scheduled_until`, `scheduled_auto_in_progress` and `scheduled_auto_completed`. Existing Statuspage clients, scripts and dashboards therefore switch by changing only the hostname. A Lamp-native `/api/public/v1/` serves the same records with complete incident timelines, post-incident reports and cursor pagination. Every response is read from the PAGE-005 snapshot with no database query, allows any origin under CORS, is cached under PAGE-007 and is never rate limited under PAGE-008. Internal components, internal notes and private-page records never appear.

## PAGE-017 — RSS and per-component feeds

`/feed.rss` is a valid RSS 2.0 feed with exactly the entries, order and stable identifiers of the Atom feed in PAGE-010. `/history.rss` and `/history.atom` (the Statuspage paths) serve the same feeds on every installation, not only after an import. Each visible component also has `/components/<slug>/feed.atom` and `/components/<slug>/feed.rss`, carrying only the incidents and maintenance that claimed a state on that component. All feeds are snapshot artifacts.

## PAGE-018 — Status badges

`/badge.svg` renders a shields-style SVG with the overall status. `/components/<slug>/badge.svg` renders one component's state, and `/components/<slug>/uptime.svg` its uptime figure for the reporting window. `/badge.json` returns the shields.io endpoint schema, so README badges and dashboards can embed status without script. Badges are snapshot artifacts of at most 2KB, use the page's state colors with a text label so color is never the only signal, and are cached by generation under PAGE-007.

## PAGE-019 — Embed variants

Besides the PAGE-011 banner, the owner can choose a floating notice that appears in a corner of the host page only while an incident is unresolved or a maintenance is in progress (Statuspage's status embed), and a compact status dot with a label for site headers and footers. The owner sets position and colors. Every variant reads the same snapshot payload, stays within PAGE-011's 10KB and origin allow-list, and shows nothing at all when everything is operational, if the owner chooses.

## PAGE-020 — Accessible to the standard US buyers require

Every public page, private page, subscription page and email meets WCAG 2.2 AA. Each release publishes a VPAT in the ITI VPAT 2.5 Rev 508 edition, `docs/accessibility/vpat.md`, which names the release version it describes, its evaluation date and the methods used. It is served at `/docs/accessibility/vpat` (DOCS-001) and linked from the public page footer, so enterprise and public-sector buyers can procure Lamp. Component and incident states are never conveyed by color alone, and the live region of PAGE-014 is announced by screen readers.

## PAGE-021 — Public read capacity of the hosted page

A status page takes its heaviest traffic during the outage it reports. The hosted deployment on the owner's Cloudflare account serves the public read paths (PAGE-008) at the rate a mid-size SaaS sees in that hour. It sustains 2,000 requests per second for 10 minutes, spread across `/`, `/api/v2/summary.json` (PAGE-016), `/api/public/status` (PAGE-014), `/feed.atom` (PAGE-010) and `/badge.svg` (PAGE-018). It also absorbs a burst of 5,000 requests per second for 60 seconds, and serves 200 requests per second from one address, which is one company's egress during an incident. At those rates every response is 200, with no 429 and no 5xx. The p95 time to first byte, measured from US-East and US-West clients outside Cloudflare, is at most 300 ms for `/api/public/status`, `/api/v2/summary.json` and `/badge.svg`, and at most 500 ms for `/` and `/feed.atom`. A publish during the run still reaches every surface within PAGE-007's 10 seconds. These reads stay generation-cached at the edge (PAGE-007), query no database (PAGE-005) and are never rate limited (PAGE-008), so the work at the origin per request does not grow with traffic. Load and failover are linked. A primary too slow to answer `/__lamp/serving` within the DNS provider's health-check response window (2 seconds for Route 53) counts as failed, so PAGE-015 fails the hostname over when the primary is overloaded as well as when it is down. The release that ships this clause replaces the local `seed.json → limits.publicPageRequestsPerSecond` value of 10 with the sustained hosted rate measured by its acceptance run, marks it `estimate: false` and records that run as the evidence. PAGE-008's promise then holds at that rate.

## THEME-001 — Full brand theming and custom CSS

In Settings, without a code change, the owner sets background, surface, text, link and per-state colors (Lamp checks each pair against WCAG AA contrast before saving), a font from the bundled set or an uploaded WOFF2 served from the page's own origin, a header image, custom header and footer links, custom header and footer HTML, and layout choices: groups collapsed or expanded, uptime bars shown or hidden per component, and how many days of history appear on the page. Owner CSS is accepted when it contains no `@import`, no `url()` to another origin, no `expression()` and no `behavior`. It is scoped to the page and shipped inside the snapshot stylesheet, so PAGE-003 and PAGE-013 still hold. Custom header and footer HTML (at most 8KB each) is sanitized on save to an allow-list of elements (`a`, `p`, `span`, `strong`, `em`, `br`, `ul`, `ol`, `li`, `nav`, `img`) and attributes (`href` to https or the page's own paths, `class`, `alt`, `src` to an image uploaded to the page's own origin). No script, event-handler attribute, `style` attribute, form, iframe or external resource survives, so the CSP of PAGE-013 needs no exception. The sanitized markup is rendered into the snapshot, so it is present without script.

## I18N-001 — Pages in several languages

The owner picks a default language and any additional languages from a shipped set. American English and US Spanish come first, then French, German, Brazilian Portuguese and Japanese. Every fixed string on public and private pages, in feeds, in emails and SMS, and on subscription pages is translated. Times follow PAGE-009 in each locale's format. Each language has its own snapshot under `/<lang>/` with `hreflang` alternates and a visible language switcher. Accept-Language suggests a language through a link and never silently changes what a URL serves. Each subscriber has a language, chosen when subscribing and changeable from SUB-007's page. Subscriber reporting (HIST-007) counts subscribers by language, in its current counts, daily trend and CSV.

## I18N-002 — Translated updates

Each update can carry its text in every enabled language. The composer shows each language beside the default, and preview (UPDATE-004) renders each one. When a language has no text, the operator either supplies it or explicitly chooses "publish in the default language for this language", which is recorded on the update. Notifications go out in each subscriber's language. Translation never delays the default-language publication: the operator can publish the default language first and add translations as a correction-free addition, marked "translation added at" on that language's timeline.

## COMP-001 — States and their order

A component's public state is exactly one of Operational, Degraded performance, Partially unavailable, Major outage, or Under maintenance. Those states are ordered by severity, most severe first: Major outage, Partially unavailable, Degraded performance, Under maintenance, Operational. Every clause that says "most severe" means this order.

## COMP-002 — Grouping and order

A component belongs to at most one group. Operators set the order of groups and of components within a group, and the public page renders them in that order.

## COMP-003 — Append-only state history

Every change to a component's public state appends an entry recording the previous state, the new state, the instant of the change, and the operator or incident that caused it. An entry is never modified or removed; a correction under UPTIME-004 appends a superseding entry rather than altering the one it corrects.

## COMP-004 — State note

A component has a note of at most 250 characters, empty by default. When it is not empty it is shown beside that component's state on the public page exactly as entered.

## COMP-005 — Internal components

A component marked internal is absent from the public page, the Atom feed, the widget, and every uptime figure, and never contributes to the overall status.

## COMP-006 — Component state is claimed, not set

Three things claim a state for a component: an unresolved incident, an in-progress maintenance, and an operator's standing claim set outside either. An incident or maintenance claims a state per attached component, chosen when the component is attached. A component's public state is the most severe of the states claimed for it, and Operational when nothing claims it. Resolving an incident, completing a maintenance, attaching or detaching a component, and setting or clearing an operator claim each recompute that component's state by this rule within 10 seconds.

## COMP-007 — Deletion

Deleting a component removes it and its state history from the public page and from every uptime figure within 10 seconds. Incidents and maintenance that referenced it keep the component's name in their published updates.

## COMP-008 — Monitor claims from measured evidence

A component can be linked to one or more Uptime monitors, or to a monitor or alert in another tool through its intake source: the presets of INTAKE-006 and INTAKE-008 to INTAKE-012 and INTAKE-014, and the component's automation email address (INTAKE-013). A linked monitor becomes a fourth kind of claimant in COMP-006, beside incidents, maintenance and operators. When an AUTO-001 rule allows it, a confirmed failure claims the state the rule names, and the confirmed recovery releases that claim. Each claim records the monitor or source, the evidence instant and the rule in COMP-003's history. Unknown or stale monitor evidence never claims Operational, and it never releases a claim another claimant holds.

## COMP-009 — Component bulk editing and descriptions

Operators create, edit, reorder and delete components and groups in bulk, through a table view and CSV import. Each component has an optional public description (at most 500 characters, plain text), shown on the page behind a disclosure, and a start date from which its uptime is shown (UPTIME-003).

## COMP-010 — Shown only while affected

A visible component can be marked "show only when not Operational", which is Statuspage's `only_show_if_degraded`. While its public state is Operational it is left out of the page's component list, the widget and the component lists in the feeds, and its uptime figure and daily record are not shown. When any claim gives it another state, it appears in its group within PAGE-007's 10 seconds. It disappears again when its state returns to Operational. Its state history (COMP-003) and uptime (UPTIME-001) are kept throughout, and its state always counts toward the overall status (PAGE-004). Unlike an internal component (COMP-005), it is public whenever it is affected. PAGE-016 serves it with `only_show_if_degraded: true` and lists it only while it is not Operational, as Statuspage does. Imports from Statuspage keep the flag (MOVE-001).

## DEP-001 — Vendor components that follow vendor status

An operator adds a third-party component from a catalog: AWS, Google Cloud, Microsoft Azure, Cloudflare, Fastly, Vercel, Stripe, GitHub, Twilio, SendGrid, Okta, Auth0, Atlassian, Slack, Zoom, Shopify, Datadog, PagerDuty, OpenAI and Anthropic. They can also add any page that publishes the Statuspage v2 API, an RSS or Atom status feed, or a JSON status endpoint with configured paths. Lamp's scheduled trigger reads each followed vendor at most every 2 minutes, with GET requests to that vendor's public status origin only. It maps the vendor's state for the chosen vendor components onto COMP-001's states through a shown table, and records every vendor change in COMP-003's history, attributed to the vendor feed. Vendor origins are declared in `seed.json → externals`. Every catalog entry ships with a recorded fixture of that vendor's public status format and its mapping table, and `pnpm validate:release` refuses a catalog entry that lacks either.

## DEP-002 — Vendor state never silently becomes the buyer's outage

A vendor component is labeled "reported by <vendor>" and links to the vendor's own page. By default it claims nothing on the buyer's own components and does not move the overall status. The owner can mark own components as depending on a vendor component and choose, per dependency, one of three behaviors: show only; draft an incident on the dependent components from a saved "upstream provider" template; or include the vendor component in the overall status rollup (PAGE-004). A vendor recovery never resolves a buyer incident; it is shown in that incident's brief as evidence.

## DEP-003 — Vendor watch for the team

Operators can follow a vendor component without showing it publicly; DEP-001 internal vendor components honor COMP-005. A followed vendor's state change sends one operator alert to email, the operator Slack or Teams channel and push (NOTIFY-016), deduplicated by vendor incident, so the team hears about upstream trouble before customers report it.

## UPTIME-001 — Definition

For each visible component the page shows the percentage of the reporting window during which the component was not in a downtime state, computed from COMP-003 state history at one-minute resolution and rounded down to two decimal places, so a window containing any downtime never shows 100.00%. The reporting window is 90 days.

## UPTIME-002 — Downtime weights

*Policy: `uptime.downtime-states.v1`; default: a minute in Major outage or Partially unavailable counts as one downtime minute, a minute in Degraded performance counts as half a downtime minute, and a minute in Under maintenance counts as none.* Degraded performance is not weighted at zero: most published incidents never get worse than it, and discarding them is what makes an uptime figure disagree with the incident history printed beneath it.

## UPTIME-003 — Short history

A component whose earliest state history entry is later than the start of the reporting window shows uptime computed from that entry, and the page labels the figure with the coverage: elapsed hours and minutes while it covers less than one whole day ("less than 1 minute" below a minute), and whole days from one day onward. A component with no data says No data (owner S4, DIVERGENCE.md "Public page clarity").

## UPTIME-004 — Corrections

An operator can correct a closed interval of a component's state history, stating the correct state for that interval and a reason. The correction appends to the history per COMP-003, recomputes every uptime figure it affects within 60 seconds, and records the operator, the interval, and the reason in the audit log. A request without a reason is rejected with 400.

## UPTIME-005 — Stated method

Beside the uptime figures the page names each state's weight under UPTIME-002 and the length of the window under UPTIME-001, in text present in the initial HTML. Because UPDATE-001 refuses to publish an update that claims no component, every published incident moves these figures; none of the incident history printed on the same page is invisible to them.

## UPTIME-006 — Daily record

The page shows one mark per day of the reporting window for each visible component. A day containing any downtime minute is labeled with the number of downtime minutes in that day. A day before the component's earliest state history entry is rendered as having no data and is visually distinct from a day with no downtime.

## UPTIME-007 — Measured uptime bars

For a component linked to an Uptime monitor (COMP-008), the owner chooses what the page shows: the claimed uptime of UPTIME-001, measured availability from the monitor's scheduled evidence, or both side by side. Measured figures are labeled with their source and method. Minutes with no fresh evidence (Uptime's Unknown) are shown as no data and are never counted as up. The daily record of UPTIME-006 marks each day's measured downtime minutes. Corrections under UPTIME-004 apply only to claimed figures; measured evidence is never rewritten.

## UPTIME-008 — Public performance metrics

Up to 10 public metrics, such as response time per region, error rate or queue depth, can be shown on the page as charts per component, as Statuspage system metrics do. They are fed by Uptime timings, by pulls from Datadog, New Relic, Pingdom or a Prometheus-compatible query endpoint using a read-only key the owner supplies, or by pushes through the management API (API-001). Lamp stores only aggregated points (1-minute for the last day, hourly for 30 days, daily for 90 days) and renders each chart as inline SVG in the snapshot with a text summary, so it works without script. A source that stops reporting shows a gap labeled with when data stopped, never an interpolated line.

## UPTIME-009 — Availability reports

Operators download, per component and for any month or quarter, an availability report with claimed and (where linked) measured uptime, every incident and maintenance that affected it, and total downtime minutes, as CSV and PDF. The report can be shared with one audience (AUD-003) on its private page. Customers with contractual SLAs then get the same numbers the page shows.

## THEME-004 and THEME-005 — Card contrast and saved colours

Enabled palettes use the same named card colour pairs for publication validation and public card painting; a pair below 4.5:1 refuses the save with the card, colours and measured contrast named. The operator overview retains its independent appearance, whose card pairs are included in that check. Unticking the custom palette retains all nine stored colours and publishes the default palette; enabling it again restores those exact colours. Themes written before the enabled flag infer it from whether a palette was stored.
