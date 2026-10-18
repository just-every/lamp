# CONTRACT.md — Lamp

This is the product Lamp is being built towards: a full replacement for Atlassian Statuspage, Better Stack Status Pages and Status.io that also goes past Instatus and incident.io Status Pages. A buyer of any of those products should be able to switch to Lamp. The document states the whole target and, clause by clause, how close the current build is.

## Product target

| | |
| --- | --- |
| Category | Status pages and incident communication |
| Incumbents a buyer switches from | Atlassian Statuspage, Better Stack Status Pages, Status.io |
| Up-and-comers it must also beat | Instatus, incident.io Status Pages |
| First buyer | A US software or SaaS business, priced in USD, that runs a public status page and tells its customers what is happening during an incident, and is moving off Atlassian Statuspage, Better Stack Status Pages or Status.io |

## How to read this contract

Lamp has two kinds of clause, and they look different on purpose.

*Released clauses* are bullet items whose bold lead is the clause ID and title. Each one is a guarantee of the current release and has at least one tagged test. `pnpm verify` refuses a released clause that has no planned tagged journey (`scripts/verification/check-plan.mjs`). `pnpm validate:release` requires `RELEASE.json` to record every released clause added, changed or removed since the previous snapshot in `release-history/`.

*Target clauses* are level-four headings (`#### AREA-NNN — Title.`) under each area's "target" heading. Each one gives the behaviour a buyer gets, its acceptance evidence (the journey or test through a public door that proves it) and its status: done, partial or missing, judged from the code and tests at the commit named in the status table. A target clause is not yet a release guarantee. The release that builds one moves it into bullet form with its tagged test and an `added` entry in `RELEASE.json`. When a target clause replaces released wording (for example TEAM-004 replaces TEAM-001's "There are no roles"), that release records the released clause as `changed` and removes the matching `seed.json → nonGoals` entry.

Every released clause has a stable ID and at least one tagged test; `pnpm verify` reports each as satisfied, overridden, or broken. Security, privacy, and operational guarantees are in `BASELINE.md`; a released clause here may supersede one of them by naming its `BASE-` ID (PAGE-008, SUB-003, and SUB-005 do; target clauses API-001 and AUD-002 will once released). Capacity and rate limits are in `seed.json → limits`. Times are p95 at those limits, except the scheduled publication and automatic maintenance transition bounds: those 240-second bounds are declared promises based on one local stress observation, not p95 measurements over independent runs or hosted Cron guarantees. Clauses marked *Policy* have a default that buyers may replace through the named extension point.

## Scope

Lamp is the status page and incident communication product for one business. It does the whole job the category's incumbents sell:

- *Pages.* A public status page, private pages behind SSO or IP allow-lists for staff, and audience-specific pages for named enterprise customers. They are served on the buyer's own domain from infrastructure that keeps answering when the reported service, or Lamp's primary host, is down, and at the read rate of an outage hour (PAGE-021).
- *Components that follow evidence.* Component state comes from operators, from accepted alerts, from Uptime monitors, monitoring tools and alert emails under explicit owner rules, and from the public status feeds of third-party vendors such as AWS, Cloudflare, Stripe and GitHub.
- *Incidents and maintenance.* Impact-first updates with templates, review, scheduled publication, next-update commitments, communication owners, post-incident reports and permanent history. Maintenance carries its own customer wording, takes updates during the window, and starts and completes itself only when the operator leaves that on (MAINT-009).
- *Distribution.* One publish reaches the page, the Atom and RSS feeds, the widget, badges, the public JSON API, email, SMS, webhooks (in Lamp's signed format or Statuspage's), Slack, Microsoft Teams and the page's X, Bluesky and Mastodon accounts. It carries the component state changes the update makes (UPDATE-012), and it reaches up to 25,000 subscribers, Statuspage's Enterprise size, within the stated delivery bounds (NOTIFY-020). Webhook subscribers also hear every public component status change. Subscribers choose components and events on every channel, can follow a single incident, and each audience receives its own wording.
- *Team.* Roles, SSO enforcement, SCIM, audit, a mobile operator desk and push reminders.
- *Follow-up and automation.* Reminders before a promised update lapses, escalation, maintenance that starts and ends itself, report-due follow-up, automatic component changes under owner rules, redundant delivery and a visible list of every pending obligation.
- *Integrations.* Uptime, Oncall, Datadog, PagerDuty, Jira Service Management, Opsgenie, Prometheus Alertmanager, Grafana, New Relic, UptimeRobot, Better Stack, Pingdom, SendGrid, Mailgun, Amazon SES, Postmark, Twilio, Plivo, Slack, Microsoft Teams, X, Bluesky, Mastodon, HappyToHelp, Zendesk, Intercom, Okta, Microsoft Entra ID, Google Workspace, GitHub Actions and Terraform.
- *Moving in.* Imports from Statuspage, Status.io, Better Stack, Instatus, incident.io and Sorry, with existing public addresses, feed readers, API consumers, webhook receivers and email-wired monitors kept working. Published postmortems and incident templates come across (MOVE-011), and private and audience pages land as private pages, never public ones (MOVE-012).
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

## Components

- **COMP-001 — States and their order.** A component's public state is exactly one of Operational, Degraded performance, Partially unavailable, Major outage, or Under maintenance. Those states are ordered by severity, most severe first: Major outage, Partially unavailable, Degraded performance, Under maintenance, Operational. Every clause that says "most severe" means this order.
- **COMP-002 — Grouping and order.** A component belongs to at most one group. Operators set the order of groups and of components within a group, and the public page renders them in that order.
- **COMP-003 — Append-only state history.** Every change to a component's public state appends an entry recording the previous state, the new state, the instant of the change, and the operator or incident that caused it. An entry is never modified or removed; a correction under UPTIME-004 appends a superseding entry rather than altering the one it corrects.
- **COMP-004 — State note.** A component has a note of at most 250 characters, empty by default. When it is not empty it is shown beside that component's state on the public page exactly as entered.
- **COMP-005 — Internal components.** A component marked internal is absent from the public page, the Atom feed, the widget, and every uptime figure, and never contributes to the overall status.
- **COMP-006 — Component state is claimed, not set.** Three things claim a state for a component: an unresolved incident, an in-progress maintenance, and an operator's standing claim set outside either. An incident or maintenance claims a state per attached component, chosen when the component is attached. A component's public state is the most severe of the states claimed for it, and Operational when nothing claims it. Resolving an incident, completing a maintenance, attaching or detaching a component, and setting or clearing an operator claim each recompute that component's state by this rule within 10 seconds.
- **COMP-007 — Deletion.** Deleting a component removes it and its state history from the public page and from every uptime figure within 10 seconds. Incidents and maintenance that referenced it keep the component's name in their published updates.

## Uptime

- **UPTIME-001 — Definition.** For each visible component the page shows the percentage of the reporting window during which the component was not in a downtime state, computed from COMP-003 state history at one-minute resolution and rounded down to two decimal places, so a window containing any downtime never shows 100.00%. The reporting window is 90 days.
- **UPTIME-002 — Downtime weights.** *Policy: `uptime.downtime-states.v1`; default: a minute in Major outage or Partially unavailable counts as one downtime minute, a minute in Degraded performance counts as half a downtime minute, and a minute in Under maintenance counts as none.* Degraded performance is not weighted at zero: most published incidents never get worse than it, and discarding them is what makes an uptime figure disagree with the incident history printed beneath it.
- **UPTIME-003 — Short history.** A component whose earliest state history entry is later than the start of the reporting window shows uptime computed from that entry, and the page labels the figure with the number of whole days it covers.
- **UPTIME-004 — Corrections.** An operator can correct a closed interval of a component's state history, stating the correct state for that interval and a reason. The correction appends to the history per COMP-003, recomputes every uptime figure it affects within 60 seconds, and records the operator, the interval, and the reason in the audit log. A request without a reason is rejected with 400.
- **UPTIME-005 — Stated method.** Beside the uptime figures the page names each state's weight under UPTIME-002 and the length of the window under UPTIME-001, in text present in the initial HTML. Because UPDATE-001 refuses to publish an update that claims no component, every published incident moves these figures; none of the incident history printed on the same page is invisible to them.
- **UPTIME-006 — Daily record.** The page shows one mark per day of the reporting window for each visible component. A day containing any downtime minute is labelled with the number of downtime minutes in that day. A day before the component's earliest state history entry is rendered as having no data and is visually distinct from a day with no downtime.

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

## Scheduled maintenance

- **MAINT-001 — Distinct from incidents.** A scheduled maintenance has a start time, an end time, and attached components. It has a reference of the form `SCH-` followed by digits, and is listed separately from incidents wherever both appear. New maintenance references use a durable, increasing `SCH-n` allocation sequence independent of incidents and legacy timestamp-sized references. Existing references remain unchanged; deletion, restart and failed creation never permit reuse, and failures may leave gaps.
- **MAINT-002 — Automatic transitions.** A scheduled maintenance moves from Scheduled to In progress within 240 seconds of its start time, and from In progress to Completed within 240 seconds of its end time, with no operator action. The 240-second bound is a declared promise based on one local stress observation with 20 updates and 20 maintenance starts due in the same cron minute on a single workerd process on a shared runner; it is not a p95 over independent runs or a hosted Cron guarantee.
- **MAINT-003 — Component states.** A maintenance claims Under maintenance for every attached component while it is In progress, and claims nothing before it starts or after it completes. A component's public state follows from COMP-006 throughout, so a state an operator or an incident claimed before the window is still claimed after it.
- **MAINT-004 — Overrun.** A maintenance still In progress 15 minutes after its end time is shown on the public page as running longer than planned, beside its original end time, until an operator completes it or extends the window.
- **MAINT-005 — Reminders.** *Policy: `maintenance.reminders.v1`; default: subscribers are notified when the maintenance is scheduled, 24 hours before the start time, when it moves to In progress, and when it moves to Completed.*
- **MAINT-006 — Rescheduling and cancellation.** Changing the window of a scheduled maintenance notifies every subscriber already notified about it. Cancelling it publishes a cancellation notice to those same subscribers, removes it from the upcoming list within 10 seconds, and keeps it in the maintenance history marked cancelled.

## Subscribers

- **SUB-001 — Subscribing.** Submitting an email address on the public page creates a pending subscription and sends one confirmation email to that address within 60 seconds. That address receives at most one confirmation email in any 24 hours however many times it is submitted, which is what bounds a subscription-bombing attack. Unsubscribing through a link emailed to the address proves it is the subscriber's own and restores that allowance, so re-subscribing after unsubscribing sends a fresh confirmation. A pending subscription receives no other notification. The form is a standard POST that works with script disabled, is rejected with 403 when the request carries `Sec-Fetch-Site: cross-site`, and carries no CSRF token, because with no cookie and no session there is no ambient authority to forge.
- **SUB-002 — Confirmation.** *Policy: `subscriber.confirmation.v1`; default: a subscription becomes active only when the link in the confirmation email is followed.*
- **SUB-003 — Pending expiry.** A pending subscription not confirmed within 72 hours is deleted, including the address it holds. **Supersedes BASE-DATA-002** for pending subscriptions only: the address was supplied by an unverified visitor who may not own it, so it is held only as long as confirmation is possible.
- **SUB-004 — Component selection.** A subscriber selects which components they want updates about, on the subscribe form or later on the management page, and the subscription follows exactly the components ticked (none ticked follows all), and is notified about an incident or maintenance only when it claims a state for at least one component in that selection. A subscription whose selection has never been narrowed follows every visible component, including components added after it was created. A subscription with a narrowed selection is unchanged when a component is added. When a component is attached to an unresolved incident, every subscriber who follows that component and has received no notification for that incident receives exactly one notification carrying its most recent published update, and then receives subsequent updates normally.
- **SUB-005 — Cookieless subscriber tokens.** A subscriber is identified on public surfaces only by an opaque token of at least 128 bits of entropy that addresses one subscription, is carried in the URL of a link the deployment emailed to that subscriber, grants no other capability, and is revoked when the subscription is deactivated or deleted. No cookie is set on any public surface. Responses on token-addressed paths carry `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. **Supersedes BASE-PUBLIC-001** for token-addressed paths only, which transmit the token on load rather than after a first interaction, because SUB-006 requires an unsubscribe that completes without any interaction on our page.
- **SUB-006 — One-click unsubscribe.** Every notification email carries a `List-Unsubscribe` header with a `mailto:` and an `https:` value, a `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header, and a visible unsubscribe link in the body. A POST to the `https:` value, with a body of `List-Unsubscribe=One-Click` in either multipart/form-data or application/x-www-form-urlencoded, deactivates that subscription and returns 200 with no redirect, no cookie, and no further interaction. Both headers are named in the message's DKIM `h=` tag, without which receivers decline to offer one-click at all. That endpoint's BASE-ACCESS-003 rate limit is counted per subscription token, never per source address, so one mailbox provider's shared egress cannot exhaust the limit for other subscribers.
- **SUB-007 — Managing a subscription.** The token URL in every notification opens a page that shows the subscription's channel and component selection and lets the subscriber change the selection or unsubscribe, without a session.
- **SUB-008 — Unsubscribe integrity.** After a subscription is deactivated, no notification is delivered to it. A notification committed before the deactivation and dispatched after it sends nothing and records the outcome as suppressed.
- **SUB-009 — Webhook subscribers.** An endpoint URL and a contact email address together subscribe as a webhook subscriber; the address exists so SUB-010 can say why the endpoint was deactivated. Each notification is a POST carrying `webhook-id`, `webhook-timestamp`, and `webhook-signature` headers, where the signature is a space-separated list of versioned HMAC-SHA256 values over `{webhook-id}.{webhook-timestamp}.{raw body}`, so a secret can be rotated without a gap. The body carries the incident, every update it has published, and each attached component's previous and new state, so a receiver that missed a delivery needs no prior state. It carries no subscriber address. A delivery succeeds only on a 2xx within 30 seconds; a redirect is a failure. A Slack incoming-webhook URL receives the same events with a Slack-formatted body.
- **SUB-010 — Failing destinations.** An address that hard-bounces once, or whose provider reports a spam complaint, is deactivated with that reason recorded. An address that soft-bounces on 5 consecutive notifications, and a webhook endpoint whose last 10 consecutive deliveries all failed under SUB-009, are deactivated with that reason recorded. Deactivating a webhook endpoint emails its contact address. A deactivated destination receives no further notification.
- **SUB-011 — Operator view.** Operators see every subscriber with channel, state of pending, active, or deactivated, component selection, and the reason and time of any deactivation. Deleting a subscriber deletes the address or endpoint it holds.
- **SUB-012 — No enumeration.** Submitting an address that already has a subscription returns the same status and body as submitting a new address and creates no second subscription. That address receives one email saying it is already subscribed, carrying its management link and nothing else.

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

## Alert intake

- **INTAKE-001 — Authenticated requests.** Each source is configured with one of two credentials. With a signing secret, a request is accepted only when the HMAC-SHA256 over its timestamp header and raw body matches and the timestamp is within 5 minutes of the deployment's clock; the signature is verified over the received bytes before they are parsed. With a bearer token, a request is accepted only when it presents that token, which exists because most monitoring tools — among them Datadog, Pingdom, and Uptime Kuma — cannot sign a webhook at all. A request with an absent, malformed, stale, or non-matching credential returns 401 and creates nothing.
- **INTAKE-002 — Alerts never publish.** *Policy: `alert.intake.v1`; default: an accepted alert creates or updates a draft incident within 30 seconds and changes no public surface. An operator publishes it under UPDATE-008.* A buyer who wants a monitored component to change state without waiting for a person replaces this policy; the narrative still waits for an operator, because no alert payload contains the UPDATE-001 fields.
- **INTAKE-003 — Deduplication.** Alerts carrying the same deduplication key produce one incident for as long as that incident is unresolved: an alert whose key matches an unresolved incident is recorded against that incident and creates no second one. A redelivery of a request already accepted creates no additional incident, draft, or alert record and returns the same status as the first delivery.
- **INTAKE-004 — Recovery alerts.** An alert marked as recovered for a deduplication key records the recovery time on the matching alert record and changes no public surface and no incident lifecycle state.
- **INTAKE-005 — Payload mapping.** Each source configures, as JSON paths into its own payload, which field supplies the deduplication key, which supplies the title, and which distinguishes a firing alert from a recovered one. A request whose payload lacks the configured deduplication-key path returns 400 and is recorded against that source where an operator can see it.
- **INTAKE-006 — Monitor presets.** A source can be a preset for Datadog, UptimeRobot, Better Stack or Pingdom, mapped to one component. Its endpoint accepts only that tool's documented alert payload (Datadog's webhook variables in the template Lamp shows, UptimeRobot's JSON webhook variables, Better Stack's incident webhook, Pingdom's state change webhook), authenticated by the source's token presented as a bearer header or as the endpoint's last path segment for tools that cannot send a header; the token is shown once, when Lamp generates it. A missing or wrong token returns 401 and records nothing; any other payload returns 400 and is recorded against the source. A firing alert creates or updates a draft incident attached to the mapped component, never a published one.
- **INTAKE-007 — Preset recovery.** A recovery from a preset closes the matching draft incident as Resolved when it was never published, leaving no public trace; an incident with a published update keeps its lifecycle and the recovery is recorded under INTAKE-004.

## Drafting

- **DRAFT-001 — Suggested update.** When an AI provider is configured, an operator can request a suggested update for an incident. The suggestion fills the composer's text fields it has text for, leaving any field it returns empty as the operator wrote it, is editable in every field, and is not published. Each filled field names the references of the DRAFT-004 brief it rests on; only references to what the brief knows are kept (an open question is not a source), and the composer shows each field's sources beside it, openable in the brief, or marks a field with none as written by the assistant with no source. A suggestion proposes no lifecycle and no next-update time, which remain the operator's commitment under UPDATE-001, and it changes no incident, public page, feed, or widget.
- **DRAFT-002 — Inputs.** A suggestion is built from the incident's accepted alerts, its published updates, its attached components customers can see and their claimed states, and the tone instructions configured in settings. Internal notes under INCIDENT-008 and internal components under COMP-001 are not sent. The provider receives exactly the brief of DRAFT-004, unchanged.
- **DRAFT-004 — Incident brief.** The operator's incident page, including the draft an alert creates, shows a brief built with no model. What we know lists each accepted alert with its time and source name, each published update, and each attached component customers can see with its claimed state. What we do not know yet lists plain questions computed from the incident's saved state: no component attached; no affected-audience or customer-impact statement yet; an unresolved draft with no next-update time; a draft raised by an alert and never published; a monitor recovery recorded while the latest published lifecycle is not Resolved; and a committed next-update time that has passed with no newer update. Every item carries a stable reference. One function builds the brief from the inputs of DRAFT-002 alone, and the page shows, collapsed, exactly what a suggestion request would send.
- **DRAFT-003 — Absent or failing provider.** AI calls go through `ai.provider.v1`. With no provider configured the composer shows no suggestion control and the deployment makes no AI request. When a configured provider fails or does not answer within 20 seconds, the composer shows the error and every other publish path behaves unchanged.

## Operators

- **TEAM-001 — Equal operators.** Every operator can create, edit, publish, and resolve every incident and maintenance, change every component, and manage subscribers. There are no roles. The only gate on publishing is UPDATE-007.
- **TEAM-002 — Management.** Operators are invited and removed in settings. The operator configured at setup can be removed only by themselves.
- **TEAM-003 — Attribution.** Every published update, component state change, maintenance change, history correction, and subscriber deletion records the operator who made it. That operator's name is shown in the operator app and on no public surface.

## History and reports

- **HIST-001 — Public history.** The history page lists resolved incidents and completed maintenance grouped by month for the last 12 months, each with start time, end time, duration, the components it affected, and every update it published.
- **HIST-002 — Post-incident report.** An operator can attach one post-incident report to a resolved incident, holding a summary, a timeline, a cause, and remediation. It appears on that incident's public page within 10 seconds of publishing, and notifies subscribers on the channels the operator selects for it in the same way NOTIFY-007 selects them for an update.
- **HIST-003 — Report due.** *Policy: `postmortem.due.v1`; default: an incident that claimed Partially unavailable or Major outage on any component and has no post-incident report 7 days after resolution is marked as owing one in the operator app.*
- **HIST-004 — Export contents.** The export contains every incident, update, component with its full state history, maintenance, subscriber with channel and state, notification delivery record, post-incident report, setting, and audit entry as JSON, and every uploaded image as its original file.

## Operator setup and recovery

- **SETUP-001 — Setup readiness.** Overview shows eight steps from saved server state: non-sample page name and branding, configured time zone, sender checked, first component, first published incident, public page opened through its protected check, reachable subscription form, and public address selected with custom-domain documentation. Open steps lead to their completion screen; all-complete collapses the checklist. Local development suppresses outgoing mail, offers no captured-mail inbox, and prepares automatic one-click owner entry without email (owner decision, 15 October 2026). To prove a subscriber notice was produced locally, publish to an active subscriber, let dispatch run, and inspect its `suppressed` outcome in Notifications or `GET /api/app/deliveries`; `notification_deliveries` records that outcome without a provider-acceptance claim. The local sender check explicitly reports suppression and requires a hosted installation to check provider authentication; that hosted check does not claim inbox delivery. Public GET paths remain database-free; protected operator actions retain the public-read checks. Choosing an address acknowledges that choice, not DNS validation, and the default deployment address is supported.
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

Sorry general notices may have no affected component and are carried as resolved informational history without outage claims; cancelled maintenance stays cancelled. Sorry additionally accepts keyless public JSON captures, including paginated components and notices plus full detail for every notice. Partial public previews name uncaptured details and cannot be applied. Subscribers come only from the authenticated API; eligible email rows are held inert without mail or confirmation expiry. A held row neither released nor undone is deleted with its address 30 days after the reviewed dry run, and Cutover states that date. After the hostname is live and the watch window closes, an explicit owner invitation action names the configured public origin, records that approval, and releases held rows into pending with a 72-hour window starting at release. Undo cannot recall mail or remove a released row as if it were still unchanged. Sorry numeric notice IDs and supplied notice paths redirect to surviving Lamp incidents or maintenance; `/notices`, `/history` and `/history/YYYY/month` (English month names) redirect to Lamp’s `/history/` while a Sorry import is retained.

## Data, security and portability

The guarantees in `BASELINE.md` apply to every clause, released and target. They cover security headers and sessions (BASE-ACCESS), input handling (BASE-INPUT), cookieless public surfaces (BASE-PUBLIC), export and import, erasure, retention and declared outbound flows (BASE-DATA), and health, migrations, idempotency, visible failure and audit (BASE-OPS). Released replacements, stated in each clause: PAGE-008 replaces BASE-ACCESS-003 for public read paths, SUB-003 replaces BASE-DATA-002 for pending subscriptions, and SUB-005 replaces BASE-PUBLIC-001 for token-addressed paths. Planned replacements, active only once released: API-001 for BASE-ACCESS-002 on `/api/v1/`, and AUD-002 for BASE-PUBLIC-001 on private-page hosts. The baseline report (`scripts/baseline/catalog.mjs`) counts a replacement only where a released clause states it with the word Supersedes, so target text never uses that form.

## Target clauses

### Public page — target

#### PAGE-015 — Served independently of what it reports.

The public page, feeds, widget, badges and public API are served on the buyer's custom domain. The owner adds a hostname, and Lamp provisions it as a Cloudflare custom hostname with an automatically issued TLS certificate and shows the exact DNS record to create.

*Secondary origin.* Every snapshot generation (PAGE-005) is also copied, as static objects at the same paths, to a secondary origin the owner chooses on a separate provider. The supported secondaries are an AWS S3 bucket behind a CloudFront distribution that carries an ACM certificate for the buyer's hostname (independent of Cloudflare, and the recommended choice); a Backblaze B2 bucket behind a CDN that serves the buyer's hostname with its own certificate (Bunny.net or Fastly); and a second Cloudflare account. Setup states that a second Cloudflare account covers a failure of Lamp's Worker or account but not an outage of Cloudflare itself. Each copy carries the PAGE-006 "last known state" label and its generation instant. A secondary that falls more than two generations or 5 minutes behind is reported to operators under BASE-OPS-004 and listed in AUTO-003.

*Failover topology.* Lamp does not operate DNS. The supported topology is health-checked failover at a DNS provider independent of Cloudflare: Amazon Route 53 failover routing (a primary record to the Cloudflare custom hostname with a health check, a secondary record to the secondary origin) or IBM NS1 Connect with an up/down monitor and a priority filter chain. Lamp's part is threefold. First, the primary serves `/__lamp/serving` on the buyer's hostname: it returns 200 only when the Worker can serve the current snapshot generation from object storage, and 503 otherwise. It needs no database, so a database outage, which PAGE-006 already survives, never triggers failover. Second, Settings → Independence shows the exact records and health-check settings for the chosen provider: an HTTPS check of `/__lamp/serving` every 10 seconds (Route 53 fast interval), failure threshold 3, record TTL 60 seconds. Third, a setup check verifies the arrangement end to end: the hostname resolves to the primary, the provider's secondary record names the secondary origin, the secondary answers TLS for the buyer's hostname (by SNI) with the newest generation, and the health check targets `/__lamp/serving`. Each failing step is named. With those settings the buyer's hostname serves the secondary within 180 seconds of the primary failing (30 seconds of detection, 60 seconds of TTL, and resolver margin). A primary too overloaded to answer the health check within the provider's response window counts as failing too (PAGE-021). Failback is automatic when the health check passes again. Lamp keeps writing each new generation to the secondary while the primary serves, so failback never shows older content than failover did.

*What the secondary serves.* Read-only, at the same paths as the primary: the status page, history, incident and maintenance permalinks, the Atom and RSS feeds (PAGE-010, PAGE-017), the widget and embed variants (PAGE-011, PAGE-019), badges (PAGE-018), the Statuspage-compatible and native public APIs with their CORS headers (PAGE-016), and `/maintenance.ics` (MAINT-007), each labelled with its generation instant. Not served: subscribe, manage, unsubscribe, alert intake and the operator app. The secondary answers their paths with 503 and `Retry-After` and a page that says subscriptions are paused while the standby copy is serving, never a false success. Publishing and notification delivery need the primary. During failover the page shows the last published generation, and work committed before the outage is delivered under NOTIFY-009 when the primary returns.

Acceptance: a custom-hostname journey shows the DNS record and certificate state, and serves `/` on that hostname. `/__lamp/serving` returns 200 with the database stopped and 503 with object storage stopped. Against a Route 53 test zone configured from Settings → Independence (hosted acceptance; locally, a DNS harness polling `/__lamp/serving` with the same interval, threshold and TTL), the primary Worker is stopped after a publish: resolving and fetching the buyer's hostname returns the secondary's newest generation, labelled, within 180 seconds. On the secondary, `/api/v2/summary.json`, `/feed.rss` and a badge return 200 with the same generation, and `POST /subscribe` returns 503 with `Retry-After`. Restarting the primary returns the hostname to it. The setup check names a missing secondary record. A failing mirror write shows as a failed job on Overview.

Status: **partial** — `src/core/app/host-dispatch.ts`, `src/core/features/page-settings/service.ts`, `tests/e2e/public-contract.test.mjs`. The configured hostname, isolated public-host routing and retained snapshots (PAGE-006) ship. Custom-hostname provisioning, the secondary origin, `/__lamp/serving`, the failover setup check and read-only standby serving do not.

#### PAGE-016 — Statuspage-compatible public API.

The public host serves `/api/v2/summary.json`, `/api/v2/status.json`, `/api/v2/components.json`, `/api/v2/incidents.json`, `/api/v2/incidents/unresolved.json`, `/api/v2/scheduled-maintenances.json`, `/api/v2/scheduled-maintenances/upcoming.json` and `/api/v2/scheduled-maintenances/active.json` with Statuspage v2 field names, ID formats, impact values and status indicators (`none`, `minor`, `major`, `critical`, `maintenance`). Lamp's Component states and lifecycle map onto those values in a documented table. The `scheduled-maintenances` responses carry each maintenance's MAINT-009 updates as `incident_updates` with their `body` and Statuspage's maintenance statuses (`scheduled`, `in_progress`, `verifying`, `completed`), together with `scheduled_for`, `scheduled_until`, `scheduled_auto_in_progress` and `scheduled_auto_completed`. Existing Statuspage clients, scripts and dashboards therefore switch by changing only the hostname. A Lamp-native `/api/public/v1/` serves the same records with complete incident timelines, post-incident reports and cursor pagination. Every response is read from the PAGE-005 snapshot with no database query, allows any origin under CORS, is cached under PAGE-007 and is never rate limited under PAGE-008. Internal components, internal notes and private-page records never appear.

Acceptance: a snapshot test validates every v2 response against Statuspage's published v2 schema fixtures, and an unmodified Statuspage client library reads a Lamp page. With the database unavailable, every path still returns 200 from the snapshot.

Status: **partial** — `src/core/features/public-snapshot/public-api.ts`, `tests/e2e/helpers/public-resources-flow.mjs`, `tests/e2e/snapshot-retained.test.mjs`. Statuspage v2 responses, stable imported IDs, an unmodified Statuspage embed client, and paginated native timelines and reports ship from retained snapshots. MAINT-009 wording, Verifying and per-window automation switches remain unbuilt; maintenance responses expose existing native lifecycle notices.

#### PAGE-017 — RSS and per-component feeds.

`/feed.rss` is a valid RSS 2.0 feed with exactly the entries, order and stable identifiers of the Atom feed in PAGE-010. `/history.rss` and `/history.atom` (the Statuspage paths) serve the same feeds on every installation, not only after an import. Each visible component also has `/components/<slug>/feed.atom` and `/components/<slug>/feed.rss`, carrying only the incidents and maintenance that claimed a state on that component. All feeds are snapshot artifacts.

Acceptance: the W3C feed validator accepts every feed. A component feed omits an incident that never touched that component. A feed reader polling `/history.rss` before and after a publish sees the new entry within PAGE-007's 10 seconds.

Status: **done** — `src/core/features/public-snapshot/feeds.ts`, `tests/e2e/helpers/public-resources-flow.mjs`. Ten actual dev Atom/RSS feeds validate with zero W3C errors or warnings; global aliases and component feeds retain event identity and share their snapshot.

#### PAGE-018 — Status badges.

`/badge.svg` renders a shields-style SVG with the overall status. `/components/<slug>/badge.svg` renders one component's state, and `/components/<slug>/uptime.svg` its uptime figure for the reporting window. `/badge.json` returns the shields.io endpoint schema, so README badges and dashboards can embed status without script. Badges are snapshot artifacts of at most 2KB, use the page's state colours with a text label so colour is never the only signal, and are cached by generation under PAGE-007.

Acceptance: a test fetches each badge after a component change and finds the new label within 10 seconds. shields.io's endpoint badge renders `/badge.json`. With the database unavailable, badges are served from the snapshot.

Status: **partial** — `src/core/features/public-snapshot/badges.ts`, `tests/e2e/helpers/public-resources-flow.mjs`, `tests/e2e/snapshot-retained.test.mjs`. Overall and component SVGs and shields endpoint JSON ship, update with the snapshot and serve without the database. The shields.io hosted rendering check has not been run.

#### PAGE-019 — Embed variants.

Besides the PAGE-011 banner, the owner can choose a floating notice that appears in a corner of the host page only while an incident is unresolved or a maintenance is in progress (Statuspage's status embed), and a compact status dot with a label for site headers and footers. The owner sets position and colours. Every variant reads the same snapshot payload, stays within PAGE-011's 10KB and origin allow-list, and shows nothing at all when everything is operational, if the owner chooses.

Acceptance: a browser journey embeds each variant on an allow-listed origin and an origin that is not listed. Only the allow-listed origin renders, and the floating notice appears and disappears with the incident.

Status: **done** — `src/core/features/page-settings/ui/public-resources.tsx`, `tests/e2e/helpers/widget-variants-flow.mjs`, `tests/e2e/helpers/widget-privacy-flow.mjs`. Banner, floating notice and dot are configurable and refresh without cookies, referrers or visitor data; unlisted origins render nothing.

#### PAGE-020 — Accessible to the standard US buyers require.

Every public page, private page, subscription page and email meets WCAG 2.2 AA. Each release publishes a VPAT in the ITI VPAT 2.5 Rev 508 edition, `docs/accessibility/vpat.md`, which names the release version it describes, its evaluation date and the methods used. It is served at `/docs/accessibility/vpat` (DOCS-001) and linked from the public page footer, so enterprise and public-sector buyers can procure Lamp. Component and incident states are never conveyed by colour alone, and the live region of PAGE-014 is announced by screen readers.

Acceptance: the accessibility suite runs axe at 1440 and 390 widths on the public page, history, incident permalink, maintenance permalink, subscription management and a private page with no serious or critical finding. A keyboard-only journey subscribes and manages a subscription. `pnpm validate:release` refuses a release whose `docs/accessibility/vpat.md` is absent, lacks the Section 508 chapters (Chapter 3 Functional Performance Criteria, Chapter 5 Software, Chapter 6 Support Documentation, and the WCAG 2.x A and AA tables), or names a version other than the one `RELEASE.json` releases. `GET /docs/accessibility/vpat` on the app host returns that document.

Status: **partial** — `tests/e2e/accessibility.test.mjs`. An accessibility suite covers the public and operator documents. There is no VPAT, no release check for one, and no WCAG 2.2 AA conformance claim across every surface.

#### PAGE-021 — Public read capacity of the hosted page.

A status page takes its heaviest traffic during the outage it reports. The hosted deployment on the owner's Cloudflare account serves the public read paths (PAGE-008) at the rate a mid-size SaaS sees in that hour. It sustains 2,000 requests per second for 10 minutes, spread across `/`, `/api/v2/summary.json` (PAGE-016), `/api/public/status` (PAGE-014), `/feed.atom` (PAGE-010) and `/badge.svg` (PAGE-018). It also absorbs a burst of 5,000 requests per second for 60 seconds, and serves 200 requests per second from one address, which is one company's egress during an incident. At those rates every response is 200, with no 429 and no 5xx. The p95 time to first byte, measured from US-East and US-West clients outside Cloudflare, is at most 300 ms for `/api/public/status`, `/api/v2/summary.json` and `/badge.svg`, and at most 500 ms for `/` and `/feed.atom`. A publish during the run still reaches every surface within PAGE-007's 10 seconds. These reads stay generation-cached at the edge (PAGE-007), query no database (PAGE-005) and are never rate limited (PAGE-008), so the work at the origin per request does not grow with traffic.

Load and failover are linked. A primary too slow to answer `/__lamp/serving` within the DNS provider's health-check response window (2 seconds for Route 53) counts as failed, so PAGE-015 fails the hostname over when the primary is overloaded as well as when it is down. The release that ships this clause replaces the local `seed.json → limits.publicPageRequestsPerSecond` value of 10 with the sustained hosted rate measured by its acceptance run, marks it `estimate: false` and records that run as the evidence. PAGE-008's promise then holds at that rate.

Acceptance: a hosted load run against a test installation on Cloudflare (not Miniflare), driven by k6 from US-East and US-West runners outside Cloudflare, holds the sustained, burst and single-address rates above on the five paths. Every response is 200, and the run's p95 for each path is within its bound. A publish 5 minutes into the run is readable on all five paths within 10 seconds. During the run the database's query count for public reads stays at zero. The run's k6 summary, the deployment identity and the commit are recorded as release evidence (ACCEPTANCE.md, release evidence boundary).

Status: **partial** — `src/core/features/public-snapshot/routes.ts`, `tests/e2e/public-contract.test.mjs:572`. Generation-cached, database-free and unthrottled public reads ship (PAGE-005, PAGE-007, PAGE-008). They are measured only as a local Miniflare floor of 10 requests per second (`seed.json → limits`). There is no hosted load run and no stated hosted rate.

### Theming and languages — target

#### THEME-001 — Full brand theming and custom CSS.

In Settings, without a code change, the owner sets background, surface, text, link and per-state colours (Lamp checks each pair against WCAG AA contrast before saving), a font from the bundled set or an uploaded WOFF2 served from the page's own origin, a header image, custom header and footer links, custom header and footer HTML, and layout choices: groups collapsed or expanded, uptime bars shown or hidden per component, and how many days of history appear on the page. Owner CSS is accepted when it contains no `@import`, no `url()` to another origin, no `expression()` and no `behavior`. It is scoped to the page and shipped inside the snapshot stylesheet, so PAGE-003 and PAGE-013 still hold. Custom header and footer HTML (at most 8KB each) is sanitized on save to an allow-list of elements (`a`, `p`, `span`, `strong`, `em`, `br`, `ul`, `ol`, `li`, `nav`, `img`) and attributes (`href` to https or the page's own paths, `class`, `alt`, `src` to an image uploaded to the page's own origin). No script, event-handler attribute, `style` attribute, form, iframe or external resource survives, so the CSP of PAGE-013 needs no exception. The sanitized markup is rendered into the snapshot, so it is present without script.

Acceptance: a settings journey changes every theme field, and the next snapshot shows them. CSS with `@import` or an external `url()` is refused with 400 and the offending rule named. Header HTML containing `<script>`, an `onclick` attribute and an external `<img>` saves with all three removed, and the save response lists each removal. A colour pair below 4.5:1 is refused. The page weight check of PAGE-003 passes with custom CSS present.

Status: **partial** — `src/core/features/page-settings/service.ts`, `src/core/features/public-snapshot/branding.ts`, `tests/e2e/public-contract.test.mjs`. Name, logo, accent colour, timezone, hostname, favicon and footer credit (PAGE-012) ship. Full palette, fonts, layout options and custom CSS do not.

#### I18N-001 — Pages in several languages.

The owner picks a default language and any additional languages from a shipped set. American English and US Spanish come first, then French, German, Brazilian Portuguese and Japanese. Every fixed string on public and private pages, in feeds, in emails and SMS, and on subscription pages is translated. Times follow PAGE-009 in each locale's format. Each language has its own snapshot under `/<lang>/` with `hreflang` alternates and a visible language switcher. Accept-Language suggests a language through a link and never silently changes what a URL serves. Each subscriber has a language, chosen when subscribing and changeable from SUB-007's page.

Acceptance: with English and Spanish enabled, `/es/` renders every fixed string in Spanish, in the initial HTML and without script. A Spanish-language subscriber's email uses the Spanish template. Turning a language off removes its pages from the next snapshot.

Status: **missing**. Released `seed.json → nonGoals` excludes multi-language pages; this clause replaces that exclusion.

#### I18N-002 — Translated updates.

Each update can carry its text in every enabled language. The composer shows each language beside the default, and preview (UPDATE-004) renders each one. When a language has no text, the operator either supplies it or explicitly chooses "publish in the default language for this language", which is recorded on the update. Notifications go out in each subscriber's language. Translation never delays the default-language publication: the operator can publish the default language first and add translations as a correction-free addition, marked "translation added at" on that language's timeline.

Acceptance: a publish with English and Spanish text sends Spanish email to Spanish subscribers and English email to the rest. A publish with no Spanish text and no explicit choice is refused with 400, naming the language. Adding the Spanish text later notifies nobody a second time, and NOTIFY-005 still holds.

Status: **missing**.

### Components — target

#### COMP-008 — Monitor claims from measured evidence.

A component can be linked to one or more Uptime monitors, or to a monitor or alert in another tool through its intake source: the presets of INTAKE-006 and INTAKE-008 to INTAKE-012 and INTAKE-014, and the component's automation email address (INTAKE-013). A linked monitor becomes a fourth kind of claimant in COMP-006, beside incidents, maintenance and operators. When an AUTO-001 rule allows it, a confirmed failure claims the state the rule names, and the confirmed recovery releases that claim. Each claim records the monitor or source, the evidence instant and the rule in COMP-003's history. Unknown or stale monitor evidence never claims Operational, and it never releases a claim another claimant holds.

Acceptance: an Uptime signed failure for a monitor linked under an "automatic" rule moves the component to the named state on the page within 30 seconds and appends a history entry naming the monitor. The signed recovery releases the claim, while an operator's standing claim on the same component survives. A component whose rule only drafts changes no public state.

Status: **missing**. Released COMP-006 names three claimants; the release that ships this clause records COMP-006 as changed.

#### COMP-009 — Component bulk editing and descriptions.

Operators create, edit, reorder and delete components and groups in bulk, through a table view and CSV import. Each component has an optional public description (at most 500 characters, plain text), shown on the page behind a disclosure, and a start date from which its uptime is shown (UPTIME-003).

Acceptance: a CSV of 50 components with groups and descriptions imports through a dry run that writes nothing, then applies. The page renders the new order, and the descriptions open without script through `<details>`.

Status: **done** — `src/core/features/components/catalogue-routes.ts`, `src/core/features/components/ui/catalogue-drawer.tsx`, `tests/e2e/helpers/catalogue-history-flow.mjs`.

#### COMP-010 — Shown only while affected.

A visible component can be marked "show only when not Operational", which is Statuspage's `only_show_if_degraded`. While its public state is Operational it is left out of the page's component list, the widget and the component lists in the feeds, and its uptime figure and daily record are not shown. When any claim gives it another state, it appears in its group within PAGE-007's 10 seconds. It disappears again when its state returns to Operational. Its state history (COMP-003) and uptime (UPTIME-001) are kept throughout, and its state always counts toward the overall status (PAGE-004). Unlike an internal component (COMP-005), it is public whenever it is affected. PAGE-016 serves it with `only_show_if_degraded: true` and lists it only while it is not Operational, as Statuspage does. Imports from Statuspage keep the flag (MOVE-001).

Acceptance: a component marked "show only when not Operational" is absent from `/`, `/feed.atom` and `/api/v2/components.json` while Operational. An incident claiming Degraded performance on it makes it appear on all three within 10 seconds, with `only_show_if_degraded: true` in the API. Resolving the incident removes it again. A Statuspage fixture component with `only_show_if_degraded: true` imports with the flag set.

Status: **done** — `src/core/features/public-snapshot/component-visibility.ts`, `tests/e2e/helpers/catalogue-history-flow.mjs`, `tests/e2e/statuspage-import.test.mjs`.

### Third-party dependencies — target

#### DEP-001 — Vendor components that follow vendor status.

An operator adds a third-party component from a catalogue: AWS, Google Cloud, Microsoft Azure, Cloudflare, Fastly, Vercel, Stripe, GitHub, Twilio, SendGrid, Okta, Auth0, Atlassian, Slack, Zoom, Shopify, Datadog, PagerDuty, OpenAI and Anthropic. They can also add any page that publishes the Statuspage v2 API, an RSS or Atom status feed, or a JSON status endpoint with configured paths. Lamp's scheduled trigger reads each followed vendor at most every 2 minutes, with GET requests to that vendor's public status origin only. It maps the vendor's state for the chosen vendor components onto COMP-001's states through a shown table, and records every vendor change in COMP-003's history, attributed to the vendor feed. Vendor origins are declared in `seed.json → externals`. Every catalogue entry ships with a recorded fixture of that vendor's public status format and its mapping table, and `pnpm validate:release` refuses a catalogue entry that lacks either.

Acceptance: against a recorded Statuspage-format fixture and a recorded AWS Health RSS fixture, a vendor change appears on the vendor component within 4 minutes, and the history entry names the feed. A vendor feed that returns 500 three times shows "vendor status unavailable since" with the time, and never shows Operational. A generated check iterates the whole catalogue and, for each of the 20 vendors, maps that vendor's recorded samples for every state its format defines (operational, degraded, outage and maintenance where offered) onto the expected COMP-001 states; removing one vendor's fixture fails `pnpm validate:release`.

Status: **missing**.

#### DEP-002 — Vendor state never silently becomes the buyer's outage.

A vendor component is labelled "reported by <vendor>" and links to the vendor's own page. By default it claims nothing on the buyer's own components and does not move the overall status. The owner can mark own components as depending on a vendor component and choose, per dependency, one of three behaviours: show only; draft an incident on the dependent components from a saved "upstream provider" template; or include the vendor component in the overall status rollup (PAGE-004). A vendor recovery never resolves a buyer incident; it is shown in that incident's brief as evidence.

Acceptance: with a default dependency, a vendor outage leaves the buyer's components and overall status unchanged. With "draft", it creates one private draft attached to the dependent components and changes no public surface. A vendor recovery adds a brief entry and leaves the draft unresolved.

Status: **missing**.

#### DEP-003 — Vendor watch for the team.

Operators can follow a vendor component without showing it publicly; DEP-001 internal vendor components honour COMP-005. A followed vendor's state change sends one operator alert to email, the operator Slack or Teams channel and push (NOTIFY-016), deduplicated by vendor incident, so the team hears about upstream trouble before customers report it.

Acceptance: an internal vendor component's outage sends exactly one operator alert per vendor incident, and nothing appears on the public page, feed or API.

Status: **missing**.

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

### Incidents — target

#### INCIDENT-011 — A named communication owner.

Every unresolved incident has a communication owner: the operator who opened it, until someone takes it over or it is reassigned. INCIDENT-010's due and overdue reminders go first to the owner by email, push (MOBILE-002) and the operator chat channel. When the commitment is 10 minutes overdue (*Policy: `incident.escalation.v1`*), the reminder goes to every operator with publish rights and, when Oncall is linked, to Oncall's current on-call responder for the affected service. An incident with no active owner (for example, the owner was removed) is flagged as unowned on Overview. The owner's name is never public (TEAM-003).

Acceptance: with a commitment passing, the owner alone gets the due reminder. Ten minutes after the time, every communicator and the linked Oncall escalation receive one escalation. Taking over an incident moves later reminders to the new owner.

Status: **partial** — `src/core/features/incidents/reminders.ts`, `tests/e2e/update-reminders.test.mjs`. Due and overdue reminders ship to operators. Owners, escalation and the Oncall handoff do not.

#### INCIDENT-012 — Run the incident from Slack or Teams.

The Lamp Slack app and Teams app let a linked operator open a draft incident (`/lamp incident` in Slack, the `incident` command or message extension in Teams), attach components with their claimed states, change the state each attached component claims with the update (UPDATE-012), write the update fields of UPDATE-001, see the UPDATE-004 preview and publish. Every action keeps the same validation, review (UPDATE-007), role checks (TEAM-004) and attribution as the web desk, and nothing publishes without an explicit Publish click by a linked operator. An operator links a Slack user or a Microsoft Entra ID user to their Lamp operator once, from the operator app. Slack requests are accepted only with a valid `X-Slack-Signature` over the raw body within 5 minutes. Teams activities are accepted only with a Bot Framework bearer token whose signature verifies against the Bot Framework OpenID metadata keys and whose audience is Lamp's bot app ID. The Teams app shows the draft and preview as Adaptive Cards, and each step is an `Action.Execute` invoke.

Acceptance: a recorded Slack interaction payload opens a draft, a second publishes it after preview, and the incident appears on the page attributed to the linked operator. A payload from an unlinked Slack user is refused and creates nothing, and a payload with a wrong signature returns 401. Recorded Bot Framework activity fixtures, signed with a test key served from a fake OpenID metadata edge, do the same in Teams: a message-extension invoke opens a draft, an `Action.Execute` attaches two components with their states, the next returns the preview card that UPDATE-004's renderer produced, and a Publish invoke publishes it, attributed to the linked operator. A later `Action.Execute` that sets one attached component from Major outage to Degraded performance publishes that change with the update, writing one history entry, as UPDATE-012 states. An activity from an unlinked Entra ID user is refused and creates nothing, and one whose token has the wrong audience or an invalid signature returns 401.

Status: **missing**.

#### INCIDENT-013 — Impact set by the operator.

An operator can set an incident's impact explicitly, in Statuspage's vocabulary (none, minor, major, critical), above or below the impact INCIDENT-002 derives from component claims. The incident then shows that impact on every public surface, in the PAGE-016 `impact` field and in notifications, and the operator app shows both the set and the derived impact. Setting or clearing it is attributed (TEAM-003) and appended to the incident's internal timeline. Component states, the overall status (PAGE-004) and uptime (UPTIME-001) still come only from claims, so an impact override never changes a figure. Imports from Statuspage keep each incident's recorded impact this way. The release that ships this clause records INCIDENT-002 as changed.

Acceptance: an incident whose components claim only Degraded performance, set to impact "major", shows major on the page and in `/api/v2/incidents.json`, while the component and uptime figures are unchanged. Clearing the override returns the derived impact, and both changes appear on the internal timeline with the operator.

Status: **done** — `src/core/features/incident-impact/`, `migrations/core/0031_incident_impact.sql`, `tests/e2e/helpers/incident-impact-flow.mjs`. Operators set or clear an attributed impact independently of claims; public snapshots, APIs and committed notifications carry it while component states and uptime remain claim-derived.

### Updates — target

#### UPDATE-010 — Audience variants of one update.

An update can carry, for each audience (AUD-003) the incident is visible to, its own affected-audience, customer-impact and what-still-works text. The public page and public subscribers get the public text, and each audience's page and subscribers get that audience's text. Preview (UPDATE-004) shows every variant. A variant with no text uses the public text, and that choice is shown before publish. Lifecycle, components and next-update time are shared across variants, so one commitment is kept once.

Acceptance: one publish with a public text and an "Enterprise EU" variant renders each text on its own page. Each subscriber receives exactly one message with their audience's text. The public page, feed and API never contain the variant's words (AUD-005).

Status: **missing**.

#### UPDATE-011 — Wording checks before publish.

Before publish, the composer checks each field without a model and lists findings beside the field: a promise of a resolution time (which UPDATE-001 forbids presenting), an internal hostname or IP address, an email address, a word from the owner's blocked-terms list (customer names, codenames), and a field longer than the reader-friendly length the owner sets. Findings never block publication. Each one names the rule, and the operator can dismiss it.

Acceptance: an impact statement containing "fixed in 10 minutes" and `db-prod-3.internal` shows two findings with their rules, and publishing still succeeds when the operator dismisses them.

Status: **done** — `src/core/features/incidents/wording-checks.ts`, `tests/e2e/publishing-contract.test.mjs`. Deterministic per-field findings name six rules, respect saved owner terms and length, can be dismissed, and never block publish.

#### UPDATE-012 — Component states change with the update.

An incident's state per component changes with the updates that tell customers about it, as Statuspage's component selector on every incident update does: Investigating with Major outage, Identified with Partial outage, Monitoring with Degraded performance, then Resolved.

*In the composer.* The composer lists every component attached to the incident with the state the incident claims on it now, and a selector per component for the state this update sets. The choices are Major outage, Partially unavailable, Degraded performance and Operational. Operational keeps the component attached, so its subscribers still hear this incident, but the incident claims nothing on it. The same draft can attach further components with their states, which ships today, and can stage the release of a component "with this update" instead of detaching it at once. These staged changes belong to the draft. They are saved and versioned with it (UPDATE-005), appear on no public surface before publish, are part of what a reviewer approves (UPDATE-007), and are applied at the scheduled time by a scheduled publish (UPDATE-006). A staged change that conflicts with a newer change to the same attachment is refused with 409 at publish, as `publicationComponentsGuard` already refuses stale attachments. A Resolved update releases every claim (UPDATE-003), and its selectors show that.

*One commit, no intermediate state.* Publishing commits the update and every staged state change, attachment and release in UPDATE-008's single transaction. Each component whose public state changes as a result gets exactly one COMP-003 entry, from its old state to its new one, at the update's publication instant and attributed to the incident and operator. A component whose public state does not change, because another claimant (COMP-006) still holds a more severe state, gets none. No surface ever shows a state between the old and the new: the page, the history, the permalinks, the feeds, the widget, badges, `/api/public/status` and the PAGE-016 API move from the old generation to the new one in a single snapshot generation (PAGE-005). Uptime (UPTIME-001, UPTIME-002) weights each minute by the state in force, so stepping down from Major outage to Degraded performance counts half a downtime minute from the publication instant. The incident's impact keeps the most severe state it ever claimed (INCIDENT-002) or the operator's override (INCIDENT-013). A retroactive update (INCIDENT-009) may carry state changes too: they are written into the history at its past publication time and notify no one.

*Shown with the update.* UPDATE-002's renderer shows each change the update made, for example "API: Major outage → Degraded performance", on the incident timeline, the history, the feeds, email, Slack and Teams posts, and SMS where it fits NOTIFY-014's two segments. Preview (UPDATE-004) shows the changes before publish.

*One notification.* Each subscriber receives one notification per update per channel (NOTIFY-005), and it carries both the text and the state changes. SUB-009's body already carries each attached component's previous and new state. In SUB-018's Statuspage format, the incident body's `incident.components` carry the new statuses. NOTIFY-017 sends no separate `component_update` for a change that lands with an update. A subscription that selected component status changes but not incidents (SUB-016) receives the change as one `component_update` from the old state to the new one. A Statuspage-format webhook can opt into Statuspage's habit of a `component_update` for incident-driven changes as well, and then receives exactly one per changed component after the incident body, from old to new, never by way of `operational`.

*Every door.* Applying a template (UPDATE-009) stages its states for components already attached instead of skipping them. An AUTO-001 "claim and publish" rule changes states through the same path. The Slack and Teams desk (INCIDENT-012) offers the same selectors. API-001's publish takes a per-component state map. API-002's Statuspage `PATCH /v1/pages/{page_id}/incidents/{incident_id}` honours the `components` map of component IDs to Statuspage statuses (`major_outage`, `partial_outage`, `degraded_performance`, `operational`) and applies it with the update in one commit. The release that ships this clause records COMP-006 as changed: an incident's claimed state is chosen when the component is attached and may then change with each published update.

Acceptance: an incident claims Major outage on API, and a webhook subscriber in Statuspage format and an email subscriber follow API. Publishing a Monitoring update that sets API to Degraded performance produces exactly one COMP-003 entry, Major outage → Degraded performance, at the publication instant. A poll of `/api/v2/components.json` and `/api/public/status` every second across the publish never reads `operational`. The uptime minute after the publish is weighted as Degraded performance. The SUB-018 webhook-receiver fixture receives exactly one incident body, whose `components` show API as `degraded_performance`, and no `component_update`. The email shows "API: Major outage → Degraded performance" beside the update text, as the preview did. With a second incident claiming Partially unavailable on API, the same step-down writes one history entry, Major outage → Partially unavailable, because the page's status for API changes, and the page shows Partially unavailable; with a second incident still claiming Major outage on API, it writes no history entry and the page keeps showing Major outage. A recorded Statuspage `PATCH /v1/pages/{page_id}/incidents/{incident_id}` with `incident[status]=monitoring` and a `components` map does the same through API-002. A draft whose staged change was reviewed, followed by a second operator detaching API, is refused with 409 at publish.

Status: **partial** — `migrations/core/0027_update_component_changes.sql`, `src/core/features/incidents/publication-repository.ts`, `tests/e2e/helpers/review-update-flow.mjs`. Native drafts stage state changes, attachments and releases; review, scheduling and templates keep the choices. One transaction publishes claims, aggregate history, immutable timeline changes and recipients; mail and signed webhooks retain the published changes after later recovery. Gap: management-token and Statuspage write APIs, automation, chat desks, SMS and component-only/Statuspage webhook subscriptions are not built. Overlap history follows aggregate changes; the acceptance sentence asking for no entry when Major changes to Partial needs clarification.

#### UPDATE-013 — Links in update text.

Update fields stay plain text (UPDATE-001), with one addition: a bare `https://` URL in any field becomes a link. Nothing else is interpreted. No markup, no link text and no other scheme is accepted, and `http:`, `javascript:` and `data:` URLs stay plain text. On the page, history, permalinks and feeds the link is an `<a>` whose visible text is the URL itself, with `rel="nofollow noopener ugc"`, so a reader always sees where it goes. Following a link is a navigation the reader chooses, so PAGE-013's CSP needs no exception. Notification email carries it as a link in the HTML part and as the URL in the text part, with no click-tracking redirect (NOTIFY-004). Slack posts carry it as `<url>`, Teams Adaptive Cards as a link, SMS as the URL, and webhook bodies as the unchanged text. Trailing punctuation is not part of the link. UPDATE-011's checks flag a URL to an internal hostname or IP address. The release that ships this clause records UPDATE-001 and UPDATE-002 as changed.

Acceptance: an update whose impact statement contains `See https://help.example.com/kb/123.` renders on the page as a link to `https://help.example.com/kb/123` with the full URL as its text and the period outside it, in the email's HTML part as the same link, in the text part as the URL, and in the Slack fixture body as `<https://help.example.com/kb/123>`. `javascript:alert(1)` and `<a href="https://x.test">x</a>` render as literal text. The email's link points directly at the URL.

Status: **partial** — `src/core/shared/update-links.ts`, `tests/e2e/helpers/review-update-flow.mjs`, `tests/e2e/channels-and-presets.test.mjs`. Bare HTTPS links render directly in public pages, history, permalinks, Atom/RSS, email HTML, Slack and Teams. Other schemes and markup remain literal; generic webhooks stay raw. Gap: SMS is not built; Slack/Teams real clients pass recorded network-edge fixtures, but live provider acceptance awaits sandbox credentials.

### Scheduled maintenance — target

#### MAINT-007 — Maintenance calendar.

Each page serves `/maintenance.ics`, an iCalendar feed of scheduled and in-progress maintenance with a stable UID per maintenance. A reschedule (MAINT-006) updates the same event, and a cancellation marks it cancelled. Each event's description carries the maintenance's current MAINT-009 wording. Subscribers can add the feed to Google Calendar, Outlook or Apple Calendar, and every maintenance email carries an `.ics` attachment for that window.

Acceptance: the feed validates as RFC 5545. Rescheduling keeps the UID and raises SEQUENCE. A cancelled maintenance carries `STATUS:CANCELLED`.

Status: **missing**.

#### MAINT-008 — Maintenance from deploy pipelines.

The management API (API-001), the published GitHub Action and the Terraform provider (API-004) can create, start early, extend, update (MAINT-009) and complete a maintenance window, with its wording and automation switches and the same notices as MAINT-005 and MAINT-006. A pipeline can then open a window with auto-complete off when a deploy starts and close it when the deploy finishes, however long the deploy runs.

Acceptance: a GitHub Actions workflow run against a test installation opens a window with auto-complete off, the page shows it in progress, and the workflow's final step completes it. Subscribers receive the notices MAINT-005 names, once each.

Status: **missing**.

#### MAINT-009 — Maintenance has its own wording and updates.

As in Statuspage, where a maintenance shares an incident's fields and statuses (Scheduled, In progress, Verifying, Completed), a Lamp maintenance tells customers what the window means for them and is kept current while it runs.

*Wording.* Beside its title and window, a maintenance carries UPDATE-001's fields: an affected-audience statement and a customer-impact statement of at most 250 characters each, required for every maintenance scheduled after the release that ships this clause, and optional what-still-works (250 characters) and details (500 characters) statements. All are plain text with UPDATE-013's links. Every maintenance notice renders the wording beside the window through UPDATE-002's renderer: scheduled, 24-hour reminder, started, verifying, completed, rescheduled and cancelled (MAINT-005, MAINT-006). The surfaces are the page, the maintenance permalink, history, the Atom and RSS feeds, `/maintenance.ics` (MAINT-007), PAGE-016's `scheduled-maintenances` responses, email, SMS, Slack, Teams and both webhook formats (SUB-009, SUB-018). The composer saves maintenance drafts as UPDATE-005 saves update drafts and previews each notice before it is scheduled (UPDATE-004). A maintenance created before that release keeps its title-only notices; nothing is backfilled.

*Updates during the window.* An operator publishes a maintenance update with a state (Scheduled, In progress, Verifying or Completed) and the same wording fields, and chooses its channels under NOTIFY-007, including none. A published maintenance update is immutable and is corrected as INCIDENT-004 corrects an incident update. It commits atomically with its recipient set (UPDATE-008) and notifies each selected subscriber once (NOTIFY-005). Publishing In progress before the start time starts the window early. Verifying keeps MAINT-003's Under maintenance claims and tells readers the work is done and being checked. Completed completes the window and releases its claims, as the existing complete action does. The latest update's wording is the maintenance's current wording on every surface, and earlier updates stay on its timeline. Changing the wording of a window that has not started is a Scheduled update, which notifies only the channels the operator selects.

*Automation chosen per window.* Auto-start and auto-complete are two switches on each maintenance, defaulting to the page's setting, which is on for both, as MAINT-002 behaves today. With auto-start off, a window reaching its start time stays Scheduled, its operators get one NOTIFY-006 alert that the start is due (and a NOTIFY-016 push), and it starts only when an operator publishes In progress. With auto-complete off, a window reaching its end time stays In progress (or Verifying) and sends no Completed notice. From 15 minutes after its end it is shown as running longer than planned beside its original end time (MAINT-004), raises one NOTIFY-006 overrun alert and stays on AUTO-003's follow-up list until an operator completes it. Imports keep Statuspage's `scheduled_auto_in_progress` and `scheduled_auto_completed` for windows not yet over, and keep each imported maintenance message as a maintenance update with its original time and status, silently under MOVE-002.

*Every door.* API-001's maintenance endpoints take the wording, updates and switches. API-002's Statuspage maintenance create and update map `incident[body]` into the wording (impact statement, then details, as API-002 maps an incident body), `incident[status]` (`scheduled`, `in_progress`, `verifying`, `completed`) into a maintenance update, `scheduled_auto_in_progress` and `scheduled_auto_completed` into the switches, `scheduled_remind_prior` into the 24-hour reminder, and `deliver_notifications` into channel selection. The GitHub Action and Terraform provider (MAINT-008, API-004) and AGENT-009's drafts fill the same fields. The release that ships this clause records MAINT-001, MAINT-002, MAINT-004 and MAINT-005 as changed.

Acceptance: a maintenance scheduled with the impact statement "Between 02:00 and 02:30 ET the dashboard is read-only; API writes queue and replay" sends a scheduled email, a 24-hour reminder and a start notice that each contain that statement beside the window, matching the composer's preview, and the same text appears on the maintenance permalink, in its Atom entry and in `/maintenance.ics`. An operator's In progress update "Migration running, about 10 more minutes", with only email selected, reaches each email subscriber of those components once and no webhook subscriber, and appears on the maintenance permalink, the Atom feed and `/api/v2/scheduled-maintenances/active.json`. A Verifying update shows Verifying on the page while the components stay Under maintenance. With auto-complete off, the window is still In progress 20 minutes after its end time, shows the overrun label beside its original end, has raised exactly one overrun alert and has sent no Completed notice; an operator's Completed update then sends exactly one. With auto-start off, the window is still Scheduled 5 minutes after its start time and one start-due alert was sent. A recorded Statuspage maintenance create with a `body` and `scheduled_auto_completed=false` produces the same wording and switch through API-002. A Statuspage fixture maintenance with two messages imports both as updates with their original times and sends nothing.

Status: **partial** — `src/core/features/maintenance/routes.ts`, `src/core/features/maintenance/repository.ts`, `tests/e2e/publishing-contract.test.mjs:900`, `tests/e2e/publishing-contract.test.mjs:933`. An operator can complete a window early or after an overrun, exactly once, and every lifecycle notice is a stored record of its kind (MAINT-004, MAINT-005). A maintenance has only a title, a window and components (`maintenanceSchema` is `.strict()`), and every notice body is its reference and title (`src/core/features/maintenance/service.ts`). There are no in-window updates, no Verifying state and no per-window automation switches, and imported Statuspage maintenance messages survive only as historical text (`import_maintenance_updates`).

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

Every subscription on every channel (email, SMS, webhook, Slack, Teams, and audience subscriptions under AUD-004) selects components (SUB-004) and event kinds: incidents, maintenance, component status changes (NOTIFY-017), or any combination, and optionally only incidents whose impact reaches Partially unavailable or worse. Webhook subscriptions start with component status changes selected, as Statuspage's do; other channels start without them. A subscription may instead follow a single incident (SUB-019). The SUB-007 management page edits all of these without a session.

Acceptance: an SMS subscriber who chose "maintenance only" receives the maintenance start and nothing for an incident on the same component. An email subscriber who chose "Partially unavailable or worse" receives nothing for a Degraded incident and is notified when it escalates.

Status: **partial** — `src/core/features/subscribers/service.ts`, `tests/e2e/delivery-contract.test.mjs`. Component selection on subscriptions ships. Event-kind and impact-threshold preferences do not.

#### SUB-017 — Subscriber import and export.

An operator imports subscribers from CSV (email, phone, webhook URL, components, language) through a dry run that counts what would be created, skipped or refused, and writes nothing. Imported subscribers are pending and receive one confirmation invitation only when the owner explicitly sends invitations, as MOVE-002 does for move-in imports. A file that would take a channel over its SUB-020 limit dry-runs with the excess named and those rows refused, and its apply is refused until the file fits. Operators export the subscriber list with channel, state, components and consent time as CSV. An operator can also add one subscriber from Subscribers → Add subscriber: an email address, a phone number, or a webhook URL with its contact address, with its components. The added subscriber goes through the same confirmation as a self-service sign-up on that channel (SUB-001, SUB-009, SUB-013), the operator's add is the explicit action that sends its one confirmation, and the SUB-011 view and the audit log record who added it. API-001's subscriber create does the same.

Acceptance: a CSV with 100 rows, 3 malformed, dry-runs as 97 created and 3 refused with reasons, then applies as 97 pending subscriptions. Sending invitations sends at most one each. The export CSV has 97 rows. An operator adds `noc@customer.example` for two components through the one-row form: exactly one confirmation is sent, and once confirmed the address receives an update on those components and none on a third. The subscriber list names the operator who added it.

Status: **partial** — `src/core/features/statuspage-import/`, `tests/e2e/statuspage-import.test.mjs`. Move-in imports bring email subscribers in as pending (MOVE-002). CSV import and subscriber export do not exist.

#### SUB-018 — Statuspage-format webhooks.

Each webhook subscription has a body format: Lamp's (SUB-009) or Statuspage's. Webhook subscribers imported from Statuspage (MOVE-010) get the Statuspage format, and anyone subscribing a new endpoint can choose it. In the Statuspage format, an incident notification is the documented `{meta, page, incident}` body. `meta` carries `unsubscribe` (the subscription's SUB-006 link) and `documentation`. `page` carries `id`, `status_indicator` and `status_description` with PAGE-016's values. `incident` carries Statuspage's incident fields (`id`, `name`, `status`, `impact`, `shortlink`, `created_at`, `updated_at`, `resolved_at`, `components`) and the complete `incident_updates` array, each update with `id`, `body`, `status` and `created_at`. A maintenance notice is the same `{meta, page, incident}` body with the maintenance statuses, `scheduled_for`, `scheduled_until` and MAINT-009's updates in `incident_updates`. A component change is the `{meta, page, component_update, component}` body: `component_update` carries `id`, `component_id`, `created_at`, `old_status` and `new_status`, and `component` carries `id`, `name`, `status` and `created_at`. Statuses use Statuspage's values (`operational`, `degraded_performance`, `partial_outage`, `major_outage`, `under_maintenance`), which map one to one onto COMP-001. IDs are the imported Statuspage IDs where a record was imported, and stable Lamp IDs in the same format otherwise, matching PAGE-016. The UPDATE-001 fields render into `body` through UPDATE-002's renderer. A Statuspage-format delivery also carries SUB-009's `webhook-*` signature headers, which receivers that do not check them ignore, and carries no subscriber address. Delivery success, retry, at-most-once and failure rules are SUB-009, NOTIFY-003, NOTIFY-005 and SUB-010.

Acceptance: a Statuspage webhook-receiver fixture, a receiver that validates Statuspage's documented incident and component-update bodies field by field and is kept unmodified, accepts every Lamp delivery in a journey that publishes an incident's first update, a second update and its resolution, and changes a component outside any incident. It receives three incident bodies, each with the complete `incident_updates` array, and one `component_update` whose `old_status` and `new_status` match the change. The same deliveries verify under SUB-009's signature scheme.

Status: **partial** — `src/core/features/deliveries/service.ts`, `tests/e2e/delivery-contract.test.mjs`. Signed Lamp-format webhooks carrying the incident, every published update and each component's previous and new state ship (SUB-009). The Statuspage format and per-subscription format choice do not.

#### SUB-019 — Follow one incident.

Every incident permalink carries a "Get updates on this incident" form in its initial HTML. It offers email, SMS where SUB-013 is enabled, and webhook endpoint with contact address. The form is a standard POST that works without script (PAGE-002), and it follows SUB-001's confirmation, one-confirmation-per-24-hours limit and `Sec-Fetch-Site` rule, SUB-002's confirmation policy, SUB-003's pending expiry and SUB-012's no-enumeration response. An incident subscription notifies only for that incident: each later published update, its resolution and, when the owner leaves "include the post-incident report" on, the HIST-002 report. It never notifies for another incident, maintenance or component change. It ends after the resolution is delivered, or, with the report included, when the report is published or 30 days after resolution, whichever comes first. A reopening (INCIDENT-005) before it ends is notified. When it ends, Lamp sends nothing more and deletes the address within 24 hours unless the same address holds another subscription. The SUB-007 page for its token shows "Following INC-n" and unsubscribes it at once. Operators see incident subscribers on the incident and in SUB-011's list. The management API lists, creates and deletes them (API-001), as Statuspage's incident-subscriber endpoints do (API-002). Imports from Statuspage bring the incident subscribers of unresolved incidents in as pending under MOVE-002's invitation rules.

Acceptance: with script disabled, a visitor subscribes an email address from INC-7's permalink and confirms it. That address receives INC-7's next update and its resolution, nothing for INC-8 on the same component, nothing for a maintenance, and nothing after the resolution; its address is gone 24 hours later. Submitting the same address again returns SUB-012's response. A cross-site POST returns 403.

Status: **missing**.

#### SUB-020 — Subscriber limits are stated, enforced and reported.

The deployment's subscriber limits are the ones NOTIFY-020 qualifies: 25,000 subscriptions across all channels, of which at most 2,500 are webhook endpoints and at most 1,000 are Slack and Teams subscriptions together. Pending, active and incident (SUB-019) subscriptions count. Deactivated and deleted ones do not. Settings → Subscribers shows each channel's count against its limit.

*Sign-ups at the limit.* When a channel is full, the subscribe form (SUB-001, SUB-019) still answers every address the same way, so SUB-012's no-enumeration holds. It returns 409 with a page saying the page cannot take new subscriptions on that channel right now, linking the Atom and RSS feeds (PAGE-010, PAGE-017), and it creates no subscription and sends no mail. Operators receive one alert at 80% and one at 100% of each channel's limit (NOTIFY-006, NOTIFY-016), and the full channel is listed on Follow-ups (AUTO-003) until it is below the limit again. Nothing over the limit is ever accepted and then silently left undelivered.

*Imports at the limit.* MOVE-001's dry run, the move-in imports (MOVE-007, MOVE-008, MOVE-010) and SUB-017's CSV dry run count, per channel, the subscribers that would take the deployment over its limit. They name the excess (for example "email would reach 25,212, over the 25,000 limit by 212") and list the excess rows as refused with the reason "over the subscriber limit". An apply that would exceed a limit is refused and writes nothing. The owner narrows the import by leaving out channels, components, or subscribers they choose, and then a fresh dry run fits. A Statuspage Business list of 5,000 subscribers and an Enterprise list of 25,000 fit with no narrowing. The release that ships this clause records MOVE-001 as changed.

Acceptance: in a fixture already holding 25,000 subscriptions, a script-free POST of a new address returns 409 with the full-page message, creates nothing and sends nothing, and an existing address gets the same response. The 80% and 100% operator alerts are each sent once. A Statuspage fixture import of 300 subscribers into an installation 100 below the limit dry-runs with "over the 25,000 limit by 200" and 200 rows refused for that reason, and its apply is refused. Leaving out the email channel makes a fresh dry run fit, and that apply succeeds.

Status: **missing**. The released limit of 1,000 subscribers (`seed.json → limits`) is a delivery-time qualification only. Nothing counts subscriptions against it, refuses a sign-up or import over it, or alerts on it.

### Notifications — target

#### NOTIFY-013 — Redundant email delivery.

The owner configures a primary and a secondary email provider from SendGrid, Mailgun, Amazon SES, Postmark and Resend, each authenticated for the From domain (NOTIFY-010). A notification whose primary send keeps failing with retryable errors for 5 minutes, or for which the primary reports an outage, is sent through the secondary. Lamp sends it there once, under NOTIFY-005's one-notification-per-update guarantee and the same Message-ID, so a subscriber never receives it twice. The delivery log records which provider accepted each message. A provider's signed delivery events (bounce, complaint, delivered) are verified for each configured provider.

Acceptance: with the primary's fake edge returning 503, a publish is accepted by the secondary within 7 minutes, and the log shows the provider. Restoring the primary sends nothing a second time. Each provider's signed bounce fixture deactivates the address (SUB-010).

Status: **partial** — `src/core/app/mail.ts`, `src/core/features/deliveries/service.ts`, `src/core/features/deliveries/sendgrid-events.ts`, `tests/e2e/sendgrid-provider.test.mjs`. One selectable provider with durable retries and SendGrid signed events ships. A secondary provider, failover and other providers' events do not.

#### NOTIFY-014 — SMS delivery.

SMS notifications go through Twilio or Plivo from the owner's registered 10DLC campaign or verified toll-free number. When both are configured, the other is used if the first fails retryably. Delivery receipts arrive through the provider's signed status callbacks (`X-Twilio-Signature`, Plivo's V3 signature) and record delivered, undelivered or failed (NOTIFY-004). Settings shows the estimated cost of the next publish in USD, from subscriber counts and the provider's rate the owner enters, and a monthly SMS spend cap. A publish that would pass the cap sends the SMS part only after an operator confirms. Every eligible SMS for a publish is accepted by the provider within the time Settings states for the owner's registered throughput (subscriber count divided by the campaign's messages per second, plus 60 seconds), and NOTIFY-018 reports any message that misses it.

Acceptance: through Twilio test credentials, a publish to 3 SMS subscribers records 3 delivered receipts from signed callbacks. An unsigned callback is refused with 401. A publish over the cap queues SMS until confirmed, and the page, email and feeds are not delayed (NOTIFY-009).

Status: **missing**.

#### NOTIFY-015 — Reach of each update.

The update view shows, live, how many subscribers it was committed to on each channel (UPDATE-008), and how many were delivered, bounced, suppressed or failed. The incident view shows the total reached for the whole incident. The figures come from the NOTIFY-004 log and describe delivery, never reading.

Acceptance: after a publish to 10 email and 2 webhook subscribers, with one email bouncing, the update view shows 10/2 committed and 9 delivered, 1 bounced and 2 delivered, matching the CSV export.

Status: **done** — `src/core/features/communication-performance/repository.ts`, `src/core/features/communication-performance/ui/incident-reach.tsx`, `tests/e2e/helpers/communication-performance-flow.mjs`. The incident panel shows each update and distinct incident reach from committed email/webhook delivery rows, with separate provider acceptance, signed email delivery outcomes and CSV. Its own visible polling leaves the composer untouched; imported source delivery is labelled unknown.

#### NOTIFY-016 — Operator alerts beyond email.

Every NOTIFY-006 operator alert, along with DEP-003 vendor alerts and HIST-006 traffic alerts, can also go to an operator Slack or Teams channel and to installed operator devices through web push (MOBILE-002), each at most once per event. Operator alerts carry incident references and links to the operator app, and no subscriber data.

Acceptance: an overdue incident produces exactly one email, one Slack post to the operator channel and one push per subscribed device.

Status: **missing**.

#### NOTIFY-017 — Component status changes reach webhook subscribers.

Every change of a visible component's public state notifies the subscriptions that selected component status changes (SUB-016) and follow that component (SUB-004). Webhook subscriptions have that selection by default. The change may come from any claimant in COMP-006 and COMP-008: an operator's claim, an incident or maintenance attaching, resolving or completing, a monitor or alert-source claim under an AUTO-001 rule, the automation email of INTAKE-013, or a vendor component following its feed (DEP-001). Each change is one notification carrying the previous and new state, the instant and the claimant kind (never an operator's name, TEAM-003). It goes out as SUB-018's `component_update` body or SUB-009's body with a `component.changed` event type. Only committed changes notify: a claim that AUTO-002's flap guard holds back sends nothing, and an undo sends one change back. A change that lands with an incident update (UPDATE-012) is carried in that update's notification, and no separate component notification is sent for it, except to a subscription that selected component changes but not incidents, or a Statuspage-format webhook that opted into component updates for incident-driven changes; each of those receives exactly one `component_update` from the old state to the new one. Internal components (COMP-005) never notify. Retroactive state history (INCIDENT-009, MOVE-002) and history corrections (UPTIME-004) notify no one. This replaces NOTIFY-001's default that a component change outside an incident or maintenance notifies no one, for subscriptions that select component changes. The release that ships it records NOTIFY-001 as changed.

Acceptance: a webhook subscriber following component API receives exactly one `component_update` for each of an operator claim, a monitor claim under a "claim" rule, an automation-email claim and a vendor-feed change, each with the right old and new status. An email subscriber who did not select component changes receives none. A 60-second flap held by AUTO-002 sends nothing. An internal component's change sends nothing.

Status: **missing**. Released NOTIFY-001 notifies no one for a change outside an incident or maintenance.

#### NOTIFY-018 — Delivery time on every channel.

At the subscriber limits in `seed.json → limits`, which NOTIFY-020 raises to 25,000 subscriptions with 2,500 webhook endpoints and 1,000 Slack and Teams subscriptions, every eligible notification for a published update or a component change is accepted by its receiver within 5 minutes of the publish request returning 200: a 2xx from each webhook endpoint (SUB-009, SUB-018), from Slack for each Slack subscription and channel post (SUB-014, NOTIFY-012), and from Microsoft for each Teams subscription and channel post (SUB-015, NOTIFY-012). SMS follows NOTIFY-014's stated throughput bound. An endpoint that fails is retried under NOTIFY-003 and does not hold back other deliveries. The delivery log records, per update and channel, the time the last eligible delivery was accepted, and Overview reports any channel that missed its bound under BASE-OPS-004.

Acceptance: at the webhook, Slack and Teams subscriber limits of NOTIFY-020, on the hosted deployment and against fake edges that answer 200, every delivery for one publish is accepted within 5 minutes, and the log's per-channel completion times show it. With one webhook endpoint answering 500, the others still complete within the bound, and the failing one shows as in retry.

Status: **partial** — `src/core/features/deliveries/service.ts`, `tests/e2e/delivery-contract.test.mjs`. NOTIFY-002's 5-minute bound ships and is tested for email at the subscriber limit. No bound is stated or tested for webhooks, Slack, Teams or SMS.

#### NOTIFY-019 — Notification email the owner can brand.

Per page, the owner sets the sender display name, a reply-to address, a subject prefix, the header logo (uploaded and served from the page's own public host, so email never loads a third-party image) and plain-text header and footer lines for notification email, and previews the result through UPDATE-004's email preview. The From address stays the authenticated address of NOTIFY-008 and NOTIFY-010. The custom footer is the owner's own plain text, which they may edit or clear. The required unsubscribe link (SUB-006), the management link (SUB-007), and any other link required by this contract or applicable law are always appended outside that footer and cannot be removed by a footer edit. The List headers (NOTIFY-010) are also mandatory. Every supported edit surface, including Settings, templates, page-data restore and API overrides, preserves these requirements; an attempt to send a notice without the required links is refused with the missing requirement named. Clearing a plain-text footer is allowed and is never a reason for refusal. The owner may add a postal address line, which Lamp suggests for CAN-SPAM-sensitive lists. Each audience page (AUD-001) can carry its own settings.

Acceptance: after the owner sets a display name, a subject prefix `[Acme status]` and a footer line, the next notification carries `From: "Acme status" <configured address>`, a subject starting `[Acme status]` and the footer, together with the unsubscribe link and the List headers. The same notification carries `Reply-To:` with the configured reply-to address, and its HTML part shows the header logo as an image from the page's public host with the page name as its alt text, while the text part carries no image reference. Clear the plain-text footer and send another notification: the custom footer is absent, while its text and HTML parts still carry the required unsubscribe and management links, any other required links remain present, and the List headers remain intact. Through every supported edit surface (Settings, templates, page-data restore and API overrides), try to suppress each required link and send: the attempt is refused with the missing required link named. A logo URL on another host cannot be saved.

Status: **partial** — `src/core/shared/email-branding.ts`, `src/core/features/page-settings/ui/email-branding-settings.tsx`, `tests/e2e/helpers/email-branding-worker-flow.mjs`, `tests/e2e/helpers/email-branding-browser-flow.mjs`, `tests/e2e/page-data.test.mjs`. Display name and Reply-To work with SendGrid and Resend. Subject prefixes, uploaded same-host logos, plain-text headers/footers, shared preview, immutable retry envelopes and page-data export/restore ship. Managed mail supports subject/logo/wording but owns From and does not accept Reply-To; Settings and restore refuse unsupported identity settings. Audience-specific settings await AUD-001. Provider transport is proven against network-edge fixtures, not live inbox receipt.

#### NOTIFY-020 — Delivery at Statuspage Business and Enterprise scale.

Lamp is built for the subscriber counts Statuspage sells: 5,000 on Business and 25,000 on Enterprise. The deployment's limits (SUB-020) are 25,000 subscriptions across all channels, including up to 2,500 webhook endpoints and up to 1,000 Slack and Teams subscriptions together, plus the operator channel posts of NOTIFY-012. At those counts, on the hosted deployment, the bounds of NOTIFY-002 and NOTIFY-018 hold for every publish. Every eligible email is accepted by the mail provider, and every webhook, Slack and Teams delivery by its receiver, within 5 minutes of the publish request returning 200. SMS follows NOTIFY-014's throughput bound. The same holds for a maintenance notice (MAINT-005) and a component change (NOTIFY-017).

*How the bound is met.* Dispatch fans out across queue consumers in parallel instead of draining one ordered list, and Lamp's own dispatch sustains at least 150 provider acceptances per second. It uses each provider's batch send where one exists (SendGrid personalizations, Mailgun batch sending, Amazon SES `SendBulkEmail`, Postmark batch), and each recipient still gets their own message, unsubscribe token and headers (SUB-005, SUB-006, NOTIFY-010). A second publish while the first is still dispatching meets its own bound, and the two never interleave out of order for one subscriber. NOTIFY-005's at-most-once and UPDATE-008's fixed recipient set hold at every count.

*The provider account's own rate.* The account's sending rate belongs to the owner's provider, not to Lamp: new Amazon SES accounts, for example, start at a low per-second quota. Settings → Email shows the sending rate the owner enters, or reads it where the provider's API exposes it (SES `GetSendQuota`). When that rate cannot deliver the current subscriber count within 5 minutes, Settings and Overview say so, with the time it can meet and the rate needed, before the next incident and not during it. The delivery log records each publish's per-channel completion time (NOTIFY-018), and Overview reports any publish that missed its bound under BASE-OPS-004.

The release that ships this clause raises `seed.json → limits.subscribers` to 25,000 and adds the webhook and chat limits, each with its hosted run recorded as evidence and `estimate: false`. NOTIFY-002's text then holds at the new limit.

Acceptance: a hosted run on a test installation on Cloudflare, with Cloudflare Queues and D1 (not Miniflare), publishes to 5,000 and then to 25,000 email subscribers. Fake provider edges outside Cloudflare accept each send in 100 ms with no quota. In the same publish go 2,500 webhook endpoints, and 1,000 Slack and Teams subscriptions against fake edges that answer 200. For each count, every delivery is accepted within 5 minutes of the publish returning 200, as the log's per-channel completion times show. No recipient receives two messages. A second publish 60 seconds after the first also completes within 5 minutes of its own request. With the fake provider's quota set to 20 per second, Settings shows that 25,000 subscribers need 21 minutes at that rate before any publish. The run's summary, the deployment identity and the commit are recorded as release evidence.

Status: **partial** — `src/core/features/deliveries/service.ts`, `tests/e2e/delivery-contract.test.mjs:942`. Durable queued email delivery ships, with the 5-minute bound qualified only locally at 1,000 subscribers under a 10-per-second fake quota (`seed.json → limits`). There is no hosted run, no qualification above 1,000, no provider batch sending, and no check of the provider account's rate.

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

A source can be an Oncall preset. It maps Oncall services to components, and Oncall's signed incident events (opened, acknowledged, escalated, resolved) and its responder timeline entries flow into the matching Lamp draft or incident as brief evidence (DRAFT-004). Under an AUTO-001 rule an opened event can also claim component state, and its resolution releases the claim (COMP-008). Each Lamp publication posts back to the Oncall incident's timeline, and INCIDENT-011's escalation is delivered through Oncall's paging when it is linked. Lamp never pages anyone itself.

Acceptance: a signed Oncall "opened" fixture creates a draft, a later timeline entry appears in the brief with its time and author role, and a Lamp publish sends one timeline post to Oncall's fake edge. Under a "claim" rule the same opened event moves the mapped component to the rule's state, and the resolved event releases it.

Status: **missing**.

#### INTAKE-013 — Email automation for each component.

Every component has its own automation email address, as Statuspage's components do, so monitors that can only send mail (Pingdom email alerts, CloudWatch alarms through SNS email, New Relic email, cron scripts) change component state with no webhook. Mail is received by a Cloudflare Email Worker on an inbound subdomain the owner chooses (for example `automation.status.example.com`), whose MX records Settings shows and a setup check verifies. The address is `c-<token>@<inbound domain>`, where the token addresses one component and carries at least 128 bits of entropy. It is shown in the component's Automation panel, can be rotated (the old address is refused from then on), and is stored only as a hash. The semantics are Statuspage's. A subject containing the word `DOWN` claims Major outage, and one containing `UP` releases the claim; the words match whole and in capitals, and when a subject holds both, the first one decides. The Automation panel states this rule beside the address, and a message whose subject holds only a lower-case or mixed-case `down` or `up` is refused with the reason "keyword not in capitals", so a monitor sending `Down` is visible on the source instead of silently doing nothing. Statuspage's address suffixes, as in `c-<token>+partial_outage@` and `c-<token>+degraded_performance@`, claim those states instead, and a suffixed address never releases a claim, so recovery needs the plain address. Pingdom's alert subjects ("DOWN alert: …", "UP alert: …") parse with no extra setup. Mail is processed in the order received and deduplicated by `Message-ID`. While an unresolved incident or in-progress maintenance claims the component, a message changes nothing and is recorded as ignored, as Statuspage ignores it. The component's AUTO-001 rule decides what an accepted message does: draft, claim, or claim and publish. AUTO-002's flap guard applies as to any source. The owner can also require that the sending domain pass DMARC alignment, or limit senders to listed addresses or domains. A message to an unknown or rotated token, from a refused sender, or with neither keyword is rejected during the SMTP session and records nothing on any component; refused and unparsed messages are counted on the source with their reason, without storing message bodies. Cutover (MOVE-006) lists each imported Statuspage component's old `automation_email` beside its new Lamp address, so the owner can repoint every monitor. The release that ships this clause records MOVE-006 as changed.

Acceptance: an inbound-mail fixture with subject `DOWN alert: api is DOWN` sent to component API's address claims Major outage within 30 seconds under a "claim" rule. The same message under a "draft" rule creates a private draft attached to API and changes no public state. `UP` to the plain address releases the claim, and `UP` to the `+partial_outage` address releases nothing. A message to an address with a wrong token is rejected at SMTP and records nothing. A message while an incident claims API is recorded as ignored. A message with subject `api is Down` is refused and counted with the reason "keyword not in capitals". After a Statuspage fixture import, Cutover lists each component's old and new automation address.

Status: **missing**. Lamp has no inbound email path.

#### INTAKE-014 — Jira Service Management and Opsgenie.

A source can be a Jira Service Management (JSM) Operations preset or an Opsgenie preset. It accepts the alert webhook that JSM's and Opsgenie's outgoing Webhook integration sends for the alert actions Create, Acknowledge, AddNote, Escalate and Close. It is authenticated by the source's bearer token, which those integrations send as a custom header (INTAKE-001), and it deduplicates by `alertId` (INTAKE-003). The owner maps alerts to components by alert tags (for example `component:api`), by `entity`, or by JSM affected service, with matchers like INTAKE-010's. An alert matching several components attaches all of them, and an alert matching none is recorded against the source as unmapped. Create creates or updates a draft (or acts under the component's AUTO-001 rule). Acknowledge and Escalate become brief entries with time and responder role. AddNote becomes an internal note (INCIDENT-008), so a responder's note is never sent to a model or shown publicly unless an operator copies it. Close records recovery under INTAKE-004 and INTAKE-007. When the owner connects JSM Operations API credentials (Atlassian site, account email and API token) or an Opsgenie API key, each Lamp publication on the linked incident adds one note to the JSM or Opsgenie alert with the update's text and permalink. With "close alert on resolve" on, the operator's Resolved publication also closes the alert. Responders in JSM then see what customers were told, as Statuspage's JSM integration shows them.

Acceptance: a recorded JSM alert-Create webhook tagged `component:api` creates a draft attached to API, and the same body with a wrong token returns 401 and records nothing. A recorded Acknowledge appears in the brief, and a recorded AddNote appears as an internal note and not in DRAFT-004's brief. A publish on the linked incident sends exactly one add-note request to the JSM fake edge with the update text and permalink, and a Resolved publish with "close alert on resolve" sends one close request. An Opsgenie fixture does the same against Opsgenie's fake alert API.

Status: **partial** — `src/core/features/intake/service.ts`, `tests/e2e/publishing-contract.test.mjs`. A bearer-token generic source with JSON-path mapping (INTAKE-001, INTAKE-005) can receive a JSM or Opsgenie webhook sent with a custom header. There is no preset, no tag or service mapping, no note handling and no note back to JSM or Opsgenie.

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

The owner can require single sign-on for every operator: OpenID Connect through Auth, Okta, Microsoft Entra ID or Google Workspace, or SAML 2.0 with signed assertions for SAML-only IdPs such as AD FS. Email magic links are then disabled except for one recorded break-glass Owner path, which ACCESS-001's terminal sign-in keeps. A SCIM 2.0 endpoint provisions and deprovisions operators from the identity provider and maps IdP groups to TEAM-004 roles. A deprovisioned operator's sessions end within 60 seconds. Every SCIM change is audited.

Acceptance: with SSO enforced, a magic-link request for a non-owner returns the SSO notice and sends no mail. A SCIM `PATCH active=false` ends that operator's session, and their next request returns 401. A SCIM group change from Communicators to Responders removes publish rights.

Status: **partial** — `src/core/platform/auth/config.ts`, `tests/auth-adoption/dependencies.test.mjs`. Optional OIDC sign-in through Base (ACCESS-001) ships, off by default. Enforcement, break-glass and SCIM do not. When shipped, this replaces ACCESS-001's "SCIM and role synchronization remain out of scope".

#### TEAM-007 — Audit log view.

Owners and Admins see the audit log of BASE-OPS-005 in the operator app. It covers every publication, state change, correction, deletion, rule change, role change, token use and erasure, and is filterable by actor, action and time and exportable as CSV. Entries for erased people show the anonymised reference (BASE-DATA-003).

Acceptance: after a publish, a correction, a role change and a subscriber erasure, the audit view lists all four with actor and time, and the CSV export matches the filtered view.

Status: **partial** — `src/core/features/audit-log/`, `migrations/core/0033_audit_log.sql`, `tests/e2e/helpers/audit-log-flow.mjs`, `tests/auth-adoption/operator-erasure.test.mjs`. Settings provides actor, action and UTC-date filters, pagination and matching CSV; erased actors retain only their anonymised reference. Publications, corrections, subscriber/operator erasures, component state history and maintenance notices are covered. Role-restricted access and role/rule/management-token events await TEAM-004, AUTO-001 and API-001; component/group deletion attribution is not yet recorded.

### History and reports — target

#### HIST-005 — Communication performance.

Operators see, per incident and per month: the time from the first accepted alert to the first public update, the share of next-update commitments kept on time, time to resolve, subscribers reached per channel (NOTIFY-015), the delivery failure rate and reports owed. These are exportable as CSV. They measure the team's communication against its own promises.

Acceptance: a fixture month with three incidents, one of which missed a commitment by 4 minutes, reports 2 of 3 kept, with each incident's time to first update matching its timeline.

Status: **done** — `src/core/features/communication-performance/service.ts`, `src/core/features/communication-performance/ui/communication-performance.tsx`, `tests/e2e/helpers/communication-performance-flow.mjs`. Overview and incident panels expose accepted-alert latency, promise counts, resolution duration, distinct subscriber reach, labelled delivery failure denominators and reports owed, with matching CSV. Calendar cohorts use the configured page timezone; actual native publication times prevent later backdating from improving promise or latency results, and absent alert/source delivery facts remain unknown.

#### HIST-006 — Traffic spike alert without visitor tracking.

Lamp counts requests per minute to the public read paths in an aggregate counter that stores no address, user agent, cookie or path beyond the surface name. It does not use the database, so PAGE-005 holds. When the count exceeds the owner's multiple (default 3×) of the trailing 7-day same-hour baseline and no incident is unresolved, operators get one alert: customers may be seeing a problem before monitoring does. The counter is not visitor analytics (see Vane).

Acceptance: a synthetic burst of 5× baseline with no open incident sends exactly one operator alert. The same burst during an unresolved incident sends none. The stored counter rows contain only surface, minute and count.

Status: **missing**.

#### HIST-007 — Subscriber reporting.

Operators see subscriber counts by channel, state, component, audience and language, with growth over time and the deactivation reasons of SUB-010. The counts are exportable as CSV.

Acceptance: a fixture with mixed channels reports counts equal to the SUB-011 list totals, and the trend shows each day's net change.

Status: **partial** — `src/core/features/subscribers/service.ts`, `tests/e2e/delivery-contract.test.mjs`. The operator subscriber list with channel, state, selection and deactivation reason ships (SUB-011). Counts, trends and export do not.

#### HIST-008 — Complete browsable history.

The public history covers every resolved incident and completed maintenance back to the earliest record, including imported history (MOVE-002), not only HIST-001's last 12 months. `/history` keeps HIST-001's 12 months and links to earlier months at `/history/YYYY-MM`. Each month page is a snapshot artifact with links to the previous and next month that hold records, works without script, and is served under PAGE-007 and PAGE-008. Every incident permalink stays reachable from a month page. The paths differ from the Sorry aliases of MOVE-005 (`/history/YYYY/month`), which keep redirecting. The release that ships this clause records HIST-001 as changed.

Acceptance: after a Statuspage fixture import with incidents from three years ago, `/history/` links to an earlier month, and following previous-month links reaches the oldest imported incident, with script disabled. With the database unavailable, every month page returns 200 from the snapshot.

Status: **done** — `src/core/features/public-snapshot/history.ts`, `tests/e2e/helpers/catalogue-history-flow.mjs`, `tests/e2e/snapshot-retained.test.mjs`.

### Audiences and private pages — target

#### AUD-001 — Several pages in one deployment.

One deployment serves a public page and any number of private pages and audience pages. Each has its own hostname or path, branding (THEME-001), languages (I18N-001) and component set drawn from the same shared components. An incident or maintenance is visible on the pages the operator chooses, and one publish updates every page it is visible on. Each page has its own snapshot, feed, widget, badges and API (PAGE-005, PAGE-016 to PAGE-018).

Acceptance: an incident visible on the public page and on "Staff" appears on both after one publish. An incident visible only on "Staff" appears on no public surface. Each page's snapshot serves with the database unavailable.

Status: **missing**. Replaces the released `seed.json → nonGoals` exclusions of more than one page per deployment and of private or audience-scoped pages.

#### AUD-002 — Private page access.

A private page admits a visitor who passes the access methods the owner chose for it. The methods are: OIDC sign-in through Auth, Okta, Microsoft Entra ID or Google Workspace, or SAML 2.0 sign-in (SP-initiated, signed assertions, for IdPs such as AD FS that offer only SAML), optionally restricted to IdP groups; an emailed single-use link to an allow-listed address or email domain; or a source address in an IP allow-list (CIDR, IPv4 and IPv6). A visitor who fails sees a sign-in page that reveals nothing about the page except its name. An admitted visitor gets an HttpOnly, Secure, SameSite=Lax session cookie, signed so the Worker verifies it without a database read. That keeps PAGE-006's serving-through-failure on private pages. Private responses carry `Cache-Control: private, no-store` and are never stored in a shared edge cache. When shipped, this clause replaces BASE-PUBLIC-001's no-cookie rule for private-page hosts only, because a private page needs a session; public surfaces keep SUB-005. The release that ships it states that replacement in the released clause's own `Supersedes` form.

Acceptance: a signed-out request to a private page returns its sign-in page with no incident text. Each access method admits an allowed visitor and refuses another; a SAML response with an unsigned or wrongly signed assertion is refused. With the database unavailable, an admitted visitor still reads the last snapshot. No private response is cacheable by a shared cache.

Status: **missing**.

#### AUD-003 — Audiences for named customers.

An audience is a named group of customers, such as "Acme Corp" or "Enterprise EU". Its members come from email domains, IdP group claims, an explicit list or a CSV import. Each audience has the components that matter to it, a page (AUD-001) and its own update wording (UPDATE-010). Operators decide, for each incident, which audiences see it. Audience members see only their components and the incidents shared with them.

Acceptance: a member of "Acme Corp" signs in and sees the two components and one incident shared with Acme, and does not see an incident shared only with "Enterprise EU".

Status: **missing**.

#### AUD-004 — Audience subscribers.

Signed-in audience members, and admitted visitors of a private page that serves no audience (a staff page), can subscribe on any SUB-016 channel from their page. A subscription belongs to the page it was made on and receives only incidents and maintenance visible there. Their notifications carry their audience's wording and are never sent to public subscribers. Public subscribers never receive audience-only incidents. Unsubscribe and management follow SUB-006 and SUB-007.

Acceptance: an audience-only update notifies the audience's subscribers and no public subscriber. A combined update sends each subscriber exactly one message with their own wording. A staff-page subscriber receives a staff-only incident, and no public subscriber does.

Status: **missing**.

#### AUD-005 — Isolation is proven, not assumed.

No private component, private incident, audience wording, audience member or private subscriber ever appears in a public snapshot, feed, widget, badge, public API response or public notification. Private snapshots are written under a separate storage prefix that public routes cannot read.

Acceptance: a canary test writes unique strings into every private field, publishes, and searches every public artifact, response and outgoing public notification for them: zero matches. A crafted public request for a private snapshot key returns 404.

Status: **missing**.

### Management API and infrastructure as code — target

#### API-001 — Token-authenticated management API.

`/api/v1/` exposes pages, components, groups, incidents (create draft, publish an update under UPDATE-001's validation, resolve), maintenance, templates, subscribers (create, import, delete), audiences, metrics push and automation rules. An OpenAPI 3.1 document is served at `/api/v1/openapi.json`. Owners and Admins issue scoped tokens (`read`, `incidents:write`, `components:write`, `maintenance:write`, `subscribers:write`, `metrics:write`, `admin`). Each token is shown once, stored only as a hash, and has an expiry, a last-used time and an immediate revoke. Each token has its own rate limit with 429 and `Retry-After`. Every write is audited with the token's ID and issuing operator. Publication through a token still honours UPDATE-007 review and TEAM-004 roles: a token acts as its issuer, never with more rights. When shipped, this clause replaces BASE-ACCESS-002's session requirement for `/api/v1/` only. The release that ships it states that replacement in the released clause's own `Supersedes` form.

Acceptance: a `components:write` token changes a component's state, and the change is attributed to the token. The same token's incident publish returns 403. A revoked token returns 401 within 10 seconds. The OpenAPI document validates, and a generated client completes an incident lifecycle.

Status: **partial** — `src/core/features/incidents/routes.ts`, `src/core/features/maintenance/routes.ts`, `tests/e2e/app-api.test.mjs`. Session-authenticated operator APIs exist for the app. There are no tokens, no public versioned API and no OpenAPI document. Replaces the released `seed.json → nonGoals` exclusion of a token API.

#### API-002 — Statuspage-compatible management API.

A subset of the Statuspage REST v1 API (`/v1/pages/{page_id}/components` with component status `PATCH`, `/v1/pages/{page_id}/component-groups`, `/v1/pages/{page_id}/incidents` create and update, scheduled maintenance create and update with MAINT-009's mapping, `/v1/pages/{page_id}/subscribers` list, create and delete, `/v1/pages/{page_id}/incidents/{incident_id}/subscribers` (SUB-019), and metric data points `POST /v1/pages/{page_id}/metrics/{metric_id}/data` into UPTIME-008) accepts `Authorization: OAuth <token>` with an API-001 token. Incident create and update map Statuspage's fields onto Lamp's: `incident[status]` sets the lifecycle (INCIDENT-001); `incident[component_ids]` attaches components; the `components` map of component IDs to statuses sets each component's claimed state with the update (UPDATE-012); and `deliver_notifications=false` selects no subscriber channel (NOTIFY-007). `incident[body]` becomes the customer-impact statement. A body longer than that statement's 250 characters fills it up to the last sentence or word boundary within the limit and continues, unchanged in its words, in the details statement, so bodies of up to 750 characters (UPDATE-001's combined length) are accepted. The affected-audience statement and the next-update interval come from defaults the owner sets on the compatibility token, so UPDATE-001's required fields always exist. Only a `body` longer than 750 characters is refused, with 422 naming the limit and the native fields, as Statuspage refuses invalid input. Existing scripts, CI steps and monitoring integrations written for Statuspage then work by changing the base URL. Lamp records which compatibility calls each token makes, so the owner can move them to `/api/v1/`.

Acceptance: the unmodified Statuspage component-status script from Atlassian's documentation, pointed at Lamp, changes the component state. A recorded `PATCH /v1/pages/{page_id}/incidents/{incident_id}` with `incident[status]=monitoring` and a `components` map steps a component from `major_outage` to `degraded_performance` with the update in one commit, as UPDATE-012's acceptance states. A recorded incident create with a 600-character `body` succeeds, and its impact and details statements together hold the whole body; a 900-character body gets 422 naming the limit. Recorded Statuspage API calls that create and delete a subscriber, create a component group and push metric data points succeed against Lamp and produce the same records the native API would. An unsupported Statuspage endpoint returns 404 with a body naming the Lamp equivalent.

Status: **missing**.

#### API-003 — Operator event webhooks.

Owners configure signed operator webhooks for private events that subscriber webhooks never carry: alert received, draft created, update published, component changed, maintenance changed, subscriber changed and rule fired. They use the signing scheme, retry, failure rules and at-most-once delivery of SUB-009, SUB-010 and NOTIFY-005. Internal automation (Zapier, Make, n8n, a data warehouse) can then follow the desk.

Acceptance: an alert followed by a publish delivers two signed events to a controlled receiver in order. A receiver that fails 10 times is deactivated, and the owner is emailed.

Status: **missing**.

#### API-004 — Terraform, GitHub Actions and config-as-code.

A published Terraform provider manages pages, components, groups, audiences, alert sources, templates and automation rules, with plan and apply against API-001. A `lamp.yaml` file applied with `rer`'s Lamp command shows a create/change/delete plan before applying it. Published GitHub Actions open and complete maintenance (MAINT-008) and draft an incident on a failed deploy: one private draft per workflow run, deduplicated by run ID, attached to the components the step names, with the run URL as an internal note (INCIDENT-008), and never published by the action. Configuration drift made in the UI shows up in the next plan.

Acceptance: `terraform apply` of a fixture configuration creates its components and groups, and a second plan shows no changes. A UI edit makes the next plan show exactly that change. A fixture workflow whose deploy job fails runs the published action, which creates one unpublished draft incident on the named components with the run URL in an internal note; re-running the failed job creates no second draft, and no subscriber is notified.

Status: **missing**.

### Integrations — target

#### INTEG-001 — Incident context in the support desk.

HappyToHelp, Zendesk and Intercom show support agents the active incidents and maintenance, with impact, components and permalink, beside each conversation. HappyToHelp and Intercom are connected through their apps and APIs; Zendesk through a Zendesk app. An agent can link a ticket or conversation to a Lamp incident. On resolution the agent sees the resolved update and the linked tickets are listed for follow-up. Lamp never messages customers through the desk itself. Linked-ticket counts appear in the incident brief as customer-report evidence (AGENT-006) without customer identities.

Acceptance: against recorded Zendesk and Intercom API fixtures and a HappyToHelp test installation, an active incident appears in the agent sidebar payload, a linked ticket raises the brief's customer-report count, and resolution lists that ticket.

Status: **missing**.

#### INTEG-002 — Updates posted to the page's social accounts.

As Statuspage posts incidents to Twitter, the owner can connect the page's own X account, and also a Bluesky or Mastodon account. X uses OAuth 2.0 with the `tweet.write` scope through the owner's X developer app, and the owner's X API tier and its cost are theirs. Bluesky uses an app password, and Mastodon an access token with `write:statuses`. Credentials are stored only encrypted, as NOTIFY-011's are. Social accounts are a channel the operator selects per update (NOTIFY-007), and they default to off for each new update unless the owner turns on "post by default". Each post holds the owner's prefix, the update's lifecycle and customer-impact statement, cut to the network's length at a word boundary, and the incident permalink. Every later update of the same incident replies to the previous post, so an incident is one thread. Maintenance notices post when the owner chooses. Posts are delivered at most once per update per account (NOTIFY-005), retried under NOTIFY-003 and recorded in the delivery log with the network's post ID (NOTIFY-004). A failing account never delays the page or other channels (NOTIFY-009), and its failure is an operator alert (NOTIFY-006), because posting integrations do fail. Retroactive updates and imports post nothing. Network origins are declared in `seed.json → externals` when shipped.

Acceptance: against recorded X, Bluesky and Mastodon API fixtures, a first update with the social channel selected creates one post per account with the prefix, impact text and permalink within the network's length. The second update is created as a reply to the first post's ID. An update with the channel deselected posts nothing. A fake X edge answering 503 retries and then records failed, and the page and email are not delayed.

Status: **missing**.

### Mobile — target

#### MOBILE-001 — The operator desk works on a phone.

At 390 px and 1440 px wide, an operator can sign in through the native terminal link, open a draft from an accepted signed alert, attach components, write an update, reload its saved draft, preview, publish, resolve, set a standing component claim and schedule maintenance. Accepted alert evidence stays private until the operator publishes. There is no horizontal scrolling, phone touch targets are at least 44 px, accessibility checks pass at every step, and the composer keeps its UPDATE-005 draft guarantees.

Acceptance: a native browser journey at 390×844 and at 1440 px signs in through the terminal link, accepts a signed alert into a private draft, attaches a component, saves customer wording, reloads and recovers the exact draft, previews the email, publishes and resolves the incident, sets a standing component claim and schedules maintenance. Check the persisted and visible result after publication, resolution, the claim and scheduling. There is no horizontal overflow, accessibility checks pass on every screen, and phone controls are at least 44×44 px.

Status: **done** — `src/core/app/client/ui/responsive.css`, `src/core/features/intake/ui/alerts-page.tsx`, `tests/e2e/helpers/phone-desk-flow.mjs`. Native terminal-link sign-in, signed-alert draft, attachment, autosave/reload, preview, publish, resolution, standing claim and maintenance scheduling pass at 390×844 and 1440 px, with accessibility, overflow and 44 px phone-control checks.

#### MOBILE-002 — Installable app with push.

The operator app is an installable progressive web app on iOS (16.4 and later), Android and desktop. An operator can enable web push per device for due and overdue commitments, alert drafts, escalations, delivery failures and vendor alerts (NOTIFY-016). A push contains the incident reference and opens its composer. It contains no subscriber data and, by the owner's choice, no update text. Lamp has no native store apps; the installed app is the mobile product.

Acceptance: a device with push enabled receives one push when an incident becomes due, and tapping it opens the composer. Removing the device stops further pushes.

Status: **missing**.

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

After a Statuspage import, everything that read the old page keeps working on the moved hostname: the Statuspage public API paths (PAGE-016), `/history.rss` and `/history.atom` (PAGE-017), and the embed script path `/embed/script.js`, which serves PAGE-019's floating notice. Webhook receivers keep their Statuspage bodies (SUB-018, MOVE-010), and email-wired monitors get a new address for each component (INTAKE-013). Cutover (MOVE-006) lists all of them as served instead of unsupported, with each component's old and new automation address. The Cutover guide also names how operating Lamp differs from Statuspage. A published update is never edited in place: a mistake is fixed by a correction update that names it, published with no channels selected when nobody should be notified again (INCIDENT-004, NOTIFY-007), and both stay on the timeline. Component states change with each update (UPDATE-012). Components shown only while degraded keep that behaviour (COMP-010).

Acceptance: after a Statuspage fixture import, an unmodified Statuspage client reads `/api/v2/summary.json`, a feed reader reads `/history.rss`, an old embed tag renders the notice, and the Statuspage webhook-receiver fixture of SUB-018 accepts the next publish. Cutover lists every one as served, and its guide contains the correction-update and component-state notes.

Status: **partial** — `src/core/features/statuspage-import/public-paths.mjs`, `src/core/features/public-snapshot/import-aliases.ts`, `tests/e2e/statuspage-import.test.mjs`. History and Atom aliases are served after import (MOVE-005). JSON API, RSS and embed compatibility are missing, and Cutover reports them as unsupported (MOVE-006).

#### MOVE-010 — Every subscriber channel moves.

Imports from Statuspage, Status.io and Better Stack bring webhook, Slack, Teams and SMS subscribers as well as email, each with its component selection, and Statuspage's incident subscribers of unresolved incidents (SUB-019). Nothing is sent to anyone before the owner's explicit action, and each channel then moves in its own way:

- *Webhooks.* An endpoint the source reports as an active, confirmed subscription is imported held, in the source's body format: Statuspage webhooks get SUB-018's Statuspage format, so the receivers keep parsing what they parsed. The owner's explicit "Activate imported webhooks" action, taken at cutover, makes every held endpoint active with no reply needed from the receiver. Statuspage receivers never had to answer a verification ping, and an unattended receiver could never pass one. Deliveries start with the next publish or component change (NOTIFY-017), and an endpoint that then fails is handled by SUB-010 and emails its contact address. An endpoint the source reports as unconfirmed comes in pending and is confirmed through its contact email address, under SUB-001's confirmation.
- *SMS.* Re-confirmed by a YES reply (SUB-013), because TCPA consent was given to the source's sender, not Lamp's.
- *Slack.* Re-confirmed by reinstalling Lamp's Slack app (SUB-014); a Slack incoming-webhook URL the source holds moves as a held webhook in Slack format.
- *Teams.* Re-confirmed by SUB-015's verification card.
- *Email.* Under MOVE-002 unchanged.

The confirmation windows of MOVE-002 apply to every pending channel. Every channel counts toward SUB-020's limits, and an import that would exceed one is refused at dry run with the excess named. Activated webhook endpoints are recorded with the import as their consent source, so MOVE-004's undo deactivates them.

Acceptance: a Statuspage fixture with email, webhook, SMS and incident subscribers dry-runs all four with counts. Before any owner action, a publish sends nothing to any imported subscriber. After "Activate imported webhooks", the Statuspage webhook-receiver fixture of SUB-018, which never answers a verification request, receives the next incident update and component change in Statuspage format. After invitations, the SMS subscriber is active only after replying YES. An endpoint the source reported as unconfirmed stays pending until its contact confirms.

Status: **missing**. Released imports carry email subscribers only (`src/core/features/statuspage-import/`).

#### MOVE-011 — Postmortems and templates move.

The Statuspage reader (API key or saved responses, MOVE-001) also reads each incident's postmortem and the page's incident templates. The explanation an old incident page carried and the first-update wording the team relies on both survive the move.

*Postmortems.* A postmortem the source published (`postmortem_body` with `postmortem_published_at` set) becomes that incident's HIST-002 post-incident report, published at its original time and silently under MOVE-002: no subscriber is notified, whatever `postmortem_notify_subscribers` said. Its text becomes plain text without losing words. Paragraphs and list items stay as lines, headings become lines of their own, links become their visible URLs under UPDATE-013, and images are named with their source URL and are never fetched or hot-linked. A Statuspage postmortem is one free-text body, so it fills the report's summary and leaves timeline, cause and remediation empty, which HIST-002's renderer omits; HIST-003 treats the report as published. An unpublished draft postmortem (a body with no publication time) is never published. It is kept as a private draft report on the incident, visible only to operators, and the dry run names it. MOVE-005's redirect from the old incident URL then lands on a Lamp permalink that shows the report, and PAGE-016's native API carries it.

*Templates.* Each incident template (`GET /v1/pages/{page_id}/incident_templates`, or a saved `incident-templates.json`) becomes an UPDATE-009 template with its name, title, lifecycle (`update_status`), components with their states and channel default (`should_send_notifications`). Template groups become template folders. The body is mapped into UPDATE-001's fields: its first paragraph becomes the customer-impact statement and the rest the details statement, and the affected-audience statement is set from the template's components ("Customers using API, Dashboard"). A body part that exceeds its field's limit is reported in the dry run with the template and field named. That template is imported with the field marked for the owner to shorten before it can be applied, and its text is never silently truncated.

*Counts and undo.* The dry run counts postmortems (imported, kept private or refused, with reasons) and templates (imported, or imported with a field to shorten) beside the other records, and the apply imports only what was reviewed. MOVE-003 never imports either twice, and MOVE-004's undo removes every imported report and template nobody has changed since, naming the ones it keeps. Status.io (MOVE-007) and incident.io (MOVE-008) imports carry their published post-incident text and templates by the same rules where their APIs expose them. The release that ships this clause records MOVE-001, MOVE-002 and MOVE-004 as changed, and `docs/moving-in.md` stops listing post-mortem text and templates as omitted.

Acceptance: a Statuspage fixture with two incidents, one with a published postmortem and one with a draft postmortem, and three incident templates dry-runs with "2 postmortems: 1 imported, 1 kept private; 3 templates: 3 imported" and writes nothing. After apply, no notification of any kind is queued. The old `/incidents/<id>` URL redirects to a Lamp permalink that shows the published postmortem's text with script disabled, and the draft's text appears on no public surface (page, permalinks, feeds, `/api/v2/*`, `/api/public/v1/`). Applying an imported template fills the composer with its components, states and wording and publishes nothing. Undo removes all five records. A separate fixture template whose body exceeds the details limit dry-runs with that template and field named, and its imported text is unchanged.

Status: **partial** — `src/core/features/statuspage-import/postmortems.ts`, `src/core/features/statuspage-import/templates.ts`, `tests/e2e/helpers/postmortem-template-import-flow.mjs`, `tests/e2e/helpers/imported-template-apply-flow.mjs`. Statuspage published reports retain original times, draft reports remain private, and templates retain metadata, component states and full oversized wording for shortening. Dry run, silent apply, repeat and conditional undo cover both. Gap: Status.io and incident.io readers are not built.

#### MOVE-012 — Private and audience pages move as private.

A Statuspage private page (staff sign-in) or audience-specific page moves into Lamp's private and audience pages (AUD-001 to AUD-005), never onto the public page.

*Reading visibility.* The Statuspage reader reads the page's visibility from the page record (`GET /v1/pages/{page_id}`: `viewers_must_be_team_members` and `ip_restrictions`) and, for an audience-specific page, its page-access groups and users (`/v1/pages/{page_id}/page_access_groups` and `/v1/pages/{page_id}/page_access_users`). It reads them through the API key, or from saved `page.json`, `page-access-groups.json` and `page-access-users.json`. A saved import without `page.json` is refused with the missing visibility evidence named, as the Better Stack reader already refuses one. Visibility is never assumed to be public.

*Where records land.* A private source is imported as an AUD-001 private page, with its IP restrictions as an AUD-002 IP allow-list. An audience-specific source is imported as an AUD-001 page with one AUD-003 audience per page-access group, each with that group's components and with the group's users as explicit members by email. Each incident and maintenance keeps the visibility it had: on the private page, or for each audience whose group includes one of its components. Subscribers of the source page come in as AUD-004 subscribers of the Lamp page they belong to, under MOVE-010's channel rules and MOVE-002's invitations. No subscriber of a private or audience page becomes a public subscriber.

*Never public by accident.* The dry run refuses to import a private or audience-specific source into the public page and names the reason ("the source page requires sign-in; choose or create a private page"), offering the private target instead. During dry run, apply, resume and undo, no private record reaches a public snapshot, feed, widget, badge, public API response or public notification (AUD-005). MOVE-005's old-address redirects for private incidents are served only on the private page's host, behind its sign-in.

*Access before go-live.* Statuspage's team-member sign-in and SSO do not transfer. Cutover (MOVE-006) therefore lists, for each imported private page, the AUD-002 access method the owner must configure (an OIDC or SAML IdP, a magic-link email domain, or the imported IP allow-list) and the IdP groups that would match the imported audiences. Until one method is configured and its setup check passes, the private page serves only its sign-in page and admits nobody: it fails closed. Undo (MOVE-004) removes the imported pages, audiences, members and subscribers that nobody changed, naming what it keeps. The release that ships this clause records MOVE-001 and MOVE-006 as changed.

Acceptance: a Statuspage fixture whose page has `viewers_must_be_team_members: true` dry-runs into a new private page, and is refused with its reason named when the public page is chosen as the target. After apply, AUD-005's canary search of every public artifact, response and notification finds none of its incident text. A signed-out request to the private page gets the sign-in page with no incident text, and the page admits nobody until an access method passes its setup check; once an OIDC method is configured, a fixture IdP user reads the imported history. A fixture with `ip_restrictions` imports that allow-list. An audience-specific fixture with two page-access groups imports two audiences; each audience's member sees only that group's components and incidents, and its subscribers receive no public-only update. Saved files without `page.json` are refused. Undo removes the pages, audiences and members.

Status: **partial** — `src/core/features/statuspage-import/betterstack/read.ts`, `src/core/features/statuspage-import/instatus/normalize.ts`, `src/core/features/statuspage-import/sorry/read.ts`, `tests/betterstack/reader.test.mjs:47`. The Better Stack, Instatus and Sorry readers refuse private, password-protected, IP-restricted and audience-scoped sources rather than publishing them. The Statuspage reader reads no visibility at all (`docs/moving-in.md`), so a private Statuspage page would import as public, and private and audience pages (AUD-001 to AUD-005) are not built.

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

**What the agent does:** it continuously compares the latest published update of each unresolved incident with the evidence Lamp holds, and flags where they disagree. The flags are: *stale* (evidence changed and nothing has been published since); *contradictory* (the public update says Monitoring while a linked monitor is still failing, or says one region while evidence shows three, or a resolved update while an alert is still firing); and *incomplete* (evidence shows another component failing that the incident does not name). For each flag it drafts a correction update in the composer. **Data:** accepted alerts, Uptime evidence (COMP-008), Oncall timeline entries (INTAKE-012), PagerDuty acknowledgements (INTAKE-009), Jira Service Management and Opsgenie acknowledgements and escalations (INTAKE-014), automation-email claims (INTAKE-013), vendor feeds (DEP-001), support-ticket counts (INTEG-001) and the published timeline: everything in DRAFT-002's brief and none of the internal notes. **Human control:** flags and drafts are private. A named operator edits and publishes any correction. A contradiction can still be resolved only by an operator recording an override reason (AGENT-004).

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

**What the agent does:** for a resolved incident it drafts HIST-002's report. The summary and timeline come from alerts, published updates, Oncall, PagerDuty, Jira Service Management and Opsgenie timeline entries and the measured outage window. Cause and remediation are left as marked prompts with the evidence that bears on them, never invented. Every timeline line cites its source. **Data:** the brief's sources and the measured window; no internal notes. **Human control:** the report stays a draft until an operator edits and publishes it, and the cause and remediation must be written by a person.

Acceptance: a resolved fixture incident yields a draft whose timeline lines each cite a brief reference, with cause and remediation empty and flagged. Publishing an untouched cause field is refused with 400.

Status: **missing**.

#### AGENT-006 — Unreported incidents surface early.

**What the agent does:** with no incident open, it watches for signs that customers are already affected: a traffic spike (HIST-006), a cluster of support conversations about one product area (INTEG-001), a vendor outage on a dependency (DEP-002), or early monitor evidence: an Uptime monitor linked to a component (COMP-008) reporting failing vantages or latency above its degraded threshold while its own failure confirmation has not yet been met, read from the same signed evidence as INTAKE-008. When the signs line up, it proposes a private draft incident naming the likely components and the evidence. **Data:** aggregate counts and categories only, no customer messages or identities. **Human control:** the proposal reaches communicators as an operator alert. Nothing is public until a person publishes, and a dismissed proposal records who dismissed it and why.

Acceptance: a fixture with a 4× traffic spike and five support conversations tagged "login" in 10 minutes produces one private proposal naming the sign-in component and both signals, and changes no public surface. A second fixture, with two of five Uptime vantages failing on the sign-in monitor below its confirmation and a traffic spike, produces one proposal citing the monitor evidence with its time.

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

**What the agent does:** from a linked GitHub pull request, deploy plan or change ticket, it drafts a maintenance notice. The notice gives the affected components and the window, and fills MAINT-009's wording fields: the affected audience, the expected customer impact in plain words, what will still work and details. It proposes auto-complete off when the change plan names a verification step. **Data:** the linked change's title, description and labels, and the component catalogue. **Human control:** the notice is a draft until a communicator schedules it. The agent never schedules or starts a window itself.

Acceptance: a fixture pull request labelled `db-migration` with a stated window yields a draft maintenance on the database component with that window and a customer-impact statement in MAINT-009's field, unscheduled until an operator saves it.

Status: **missing**.

## Honest boundaries

What Lamp does not do, and how a buyer gets it:

| Not in Lamp | How the buyer gets it |
|---|---|
| Running probes, synthetic checks or measuring uptime itself | [Uptime](https://github.com/just-every/run-uptime) measures, and Lamp consumes its signed evidence (COMP-008, UPTIME-007); Datadog, Pingdom, New Relic and Prometheus feed in through presets. |
| Paging, on-call schedules and escalation of responders | [Oncall](https://github.com/just-every/run-oncall), PagerDuty, Jira Service Management or Opsgenie; Lamp hands them communication deadlines (INCIDENT-011), takes in their alerts and timelines, and posts each publication back (INTAKE-009, INTAKE-012, INTAKE-014). |
| Being the support desk | [HappyToHelp](https://github.com/just-every/run-happytohelp), Zendesk or Intercom, with Lamp's incident context (INTEG-001). |
| Visitor analytics or email open tracking | [Vane](https://github.com/just-every/run-vane) for site analytics; Lamp keeps only aggregate request counts (HIST-006) and delivery outcomes (NOTIFY-004). |
| Logs, metrics storage and APM | The buyer's observability tool; Lamp shows at most 10 aggregated public metrics (UPTIME-008). |
| Operating SMS carriers or guaranteeing inbox or handset arrival | Twilio or Plivo, and SendGrid, Mailgun, Amazon SES, Postmark or Resend; Lamp records accepted, delivered, bounced and failed separately, and never claims a person read a message. The owner registers their own 10DLC campaign or toll-free number and pays carrier fees in USD. |
| Operating DNS, or protection from an outage of every provider at once | The buyer's health-checked DNS provider (Amazon Route 53 or IBM NS1 Connect) switches the hostname to PAGE-015's secondary origin on a separate provider; Lamp supplies the health endpoint, the records and the setup check. Publishing and subscription changes wait for the primary. A buyer who needs a contractually independent standby keeps a separately operated status host. |
| Compliance certification of private pages (SOC 2, HIPAA, FedRAMP) | Private pages are access control (AUD-002), not certification. Lamp signs no BAA, and protected health information does not belong in updates. |
| Native App Store or Google Play apps | The installable app with push (MOBILE-002) is the mobile product. |
| Publishing machine translations or agent text unreviewed | Never; agent text is always a draft (Push further). |
| Paid plans, billing and sales tax | Lamp is owner-run; provider costs (Twilio, Plivo, email providers, Cloudflare) are billed to the owner directly by those providers in USD. |

## Status

Judged from the code and tests at commit `16d853b92b6e78cd259891ea708ce848323ae7f8` (18 October 2026).

| Clauses | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Published | 104 | 0 | 0 | 104 |
| Target and push further | 10 | 40 | 44 | 94 |
| All | 114 | 40 | 44 | 198 |

| Clause | Title | Kind | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| `DOCS-001` | Public owner documentation | published | done | `tests/e2e/start-runtime.test.mjs` |  |
| `PAGE-001` | Contents | published | done | `tests/e2e/app-api.test.mjs` |  |
| `PAGE-002` | Readable without script | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `PAGE-003` | Weight | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `PAGE-004` | Overall status | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `PAGE-005` | Snapshot read path | published | done | `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/snapshot-retained.test.mjs` |  |
| `PAGE-006` | Serving through a failure | published | done | `tests/e2e/app-api.test.mjs`, `tests/e2e/public-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |  |
| `PAGE-007` | Publish latency and caching | published | done | `tests/e2e/app-api.test.mjs`, `tests/e2e/public-contract.test.mjs`, `tests/e2e/snapshot-retained.test.mjs` |  |
| `PAGE-008` | Public read paths are not rate limited | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `PAGE-009` | Time display | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `PAGE-010` | Atom feed | published | done | `tests/e2e/app-api.test.mjs`, `tests/e2e/public-contract.test.mjs` |  |
| `PAGE-011` | Embeddable widget | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `PAGE-012` | Branding | published | done | `tests/e2e/app-api.test.mjs`, `tests/e2e/public-contract.test.mjs` |  |
| `PAGE-013` | Enforced isolation | published | done | `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/public-contract.test.mjs` |  |
| `PAGE-014` | Live refresh | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `PAGE-015` | Served independently of what it reports | target | partial | `src/core/app/host-dispatch.ts`, `src/core/features/page-settings/service.ts`, `tests/e2e/public-contract.test.mjs` | The configured hostname, isolated public-host routing and retained snapshots (PAGE-006) ship. Custom-hostname provisioning, the secondary origin, `/__lamp/serving`, the failover setup check and read-only standby serving do not. |
| `PAGE-016` | Statuspage-compatible public API | target | partial | `src/core/features/public-snapshot/public-api.ts`, `tests/e2e/helpers/public-resources-flow.mjs`, `tests/e2e/snapshot-retained.test.mjs` | Statuspage v2 responses, stable imported IDs, an unmodified Statuspage embed client, and paginated native timelines and reports ship from retained snapshots. MAINT-009 wording, Verifying and per-window automation switches remain unbuilt; maintenance responses expose existing native lifecycle notices. |
| `PAGE-017` | RSS and per-component feeds | target | done | `src/core/features/public-snapshot/feeds.ts`, `tests/e2e/helpers/public-resources-flow.mjs` | Ten actual dev Atom/RSS feeds validate with zero W3C errors or warnings; global aliases and component feeds retain event identity and share their snapshot. |
| `PAGE-018` | Status badges | target | partial | `src/core/features/public-snapshot/badges.ts`, `tests/e2e/helpers/public-resources-flow.mjs`, `tests/e2e/snapshot-retained.test.mjs` | Overall and component SVGs and shields endpoint JSON ship, update with the snapshot and serve without the database. The shields.io hosted rendering check has not been run. |
| `PAGE-019` | Embed variants | target | done | `src/core/features/page-settings/ui/public-resources.tsx`, `tests/e2e/helpers/widget-variants-flow.mjs`, `tests/e2e/helpers/widget-privacy-flow.mjs` | Banner, floating notice and dot are configurable and refresh without cookies, referrers or visitor data; unlisted origins render nothing. |
| `PAGE-020` | Accessible to the standard US buyers require | target | partial | `tests/e2e/accessibility.test.mjs` | An accessibility suite covers the public and operator documents. There is no VPAT, no release check for one, and no WCAG 2.2 AA conformance claim across every surface. |
| `PAGE-021` | Public read capacity of the hosted page | target | partial | `src/core/features/public-snapshot/routes.ts`, `tests/e2e/public-contract.test.mjs` | Generation-cached, database-free and unthrottled public reads ship (PAGE-005, PAGE-007, PAGE-008). They are measured only as a local Miniflare floor of 10 requests per second (`seed.json → limits`). There is no hosted load run and no stated hosted rate. |
| `THEME-001` | Full brand theming and custom CSS | target | partial | `src/core/features/page-settings/service.ts`, `src/core/features/public-snapshot/branding.ts`, `tests/e2e/public-contract.test.mjs` | Name, logo, accent colour, timezone, hostname, favicon and footer credit (PAGE-012) ship. Full palette, fonts, layout options and custom CSS do not. |
| `I18N-001` | Pages in several languages | target | missing |  | Released `seed.json → nonGoals` excludes multi-language pages; this clause replaces that exclusion. |
| `I18N-002` | Translated updates | target | missing |  | Not built. |
| `COMP-001` | States and their order | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `COMP-002` | Grouping and order | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `COMP-003` | Append-only state history | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `COMP-004` | State note | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `COMP-005` | Internal components | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `COMP-006` | Component state is claimed, not set | published | done | `tests/e2e/app-api.test.mjs` |  |
| `COMP-007` | Deletion | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `COMP-008` | Monitor claims from measured evidence | target | missing |  | Released COMP-006 names three claimants; the release that ships this clause records COMP-006 as changed. |
| `COMP-009` | Component bulk editing and descriptions | target | done | `src/core/features/components/catalogue-routes.ts`, `src/core/features/components/ui/catalogue-drawer.tsx`, `tests/e2e/helpers/catalogue-history-flow.mjs` |  |
| `COMP-010` | Shown only while affected | target | done | `src/core/features/public-snapshot/component-visibility.ts`, `tests/e2e/helpers/catalogue-history-flow.mjs`, `tests/e2e/statuspage-import.test.mjs` |  |
| `DEP-001` | Vendor components that follow vendor status | target | missing |  | Not built. |
| `DEP-002` | Vendor state never silently becomes the buyer's outage | target | missing |  | Not built. |
| `DEP-003` | Vendor watch for the team | target | missing |  | Not built. |
| `UPTIME-001` | Definition | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `UPTIME-002` | Downtime weights | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `UPTIME-003` | Short history | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `UPTIME-004` | Corrections | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `UPTIME-005` | Stated method | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `UPTIME-006` | Daily record | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `UPTIME-007` | Measured uptime bars | target | missing |  | Not built. |
| `UPTIME-008` | Public performance metrics | target | missing |  | Not built. |
| `UPTIME-009` | Availability reports | target | missing |  | Not built. |
| `INCIDENT-001` | Lifecycle | published | done | `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |  |
| `INCIDENT-002` | Impact | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `INCIDENT-003` | Reference | published | done | `tests/e2e/publishing-contract.test.mjs`, `tests/reference-storage/references.test.mjs` |  |
| `INCIDENT-004` | Published updates are immutable | published | done | `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |  |
| `INCIDENT-005` | Reopening | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `INCIDENT-006` | Overdue update | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `INCIDENT-007` | Deletion | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `INCIDENT-009` | Retroactive incidents | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `INCIDENT-008` | Internal notes | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `INCIDENT-010` | Update due | published | done | `tests/e2e/update-reminders.test.mjs` |  |
| `INCIDENT-011` | A named communication owner | target | partial | `src/core/features/incidents/reminders.ts`, `tests/e2e/update-reminders.test.mjs` | Due and overdue reminders ship to operators. Owners, escalation and the Oncall handoff do not. |
| `INCIDENT-012` | Run the incident from Slack or Teams | target | missing |  | Not built. |
| `INCIDENT-013` | Impact set by the operator | target | done | `src/core/features/incident-impact/`, `migrations/core/0031_incident_impact.sql`, `tests/e2e/helpers/incident-impact-flow.mjs` | Operators set or clear an attributed impact independently of claims; public snapshots, APIs and committed notifications carry it while component states and uptime remain claim-derived. |
| `UPDATE-001` | Template | published | done | `tests/e2e/publishing-contract.test.mjs`, `tests/reference-storage/incident-publishing.test.mjs`, `tests/reference-storage/migration.test.mjs` |  |
| `UPDATE-002` | One rendering | published | done | `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |  |
| `UPDATE-003` | Sets the lifecycle | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `UPDATE-004` | Preview | published | done | `tests/e2e/app-api.test.mjs` |  |
| `UPDATE-005` | Drafts | published | done | `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |  |
| `UPDATE-006` | Scheduled publish | published | done | `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |  |
| `UPDATE-007` | Review | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `UPDATE-008` | Publish is atomic | published | done | `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |  |
| `UPDATE-009` | Templates | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `UPDATE-010` | Audience variants of one update | target | missing |  | Not built. |
| `UPDATE-011` | Wording checks before publish | target | done | `src/core/features/incidents/wording-checks.ts`, `tests/e2e/publishing-contract.test.mjs` | Deterministic per-field findings name six rules, respect saved owner terms and length, can be dismissed, and never block publish. |
| `UPDATE-012` | Component states change with the update | target | partial | `migrations/core/0027_update_component_changes.sql`, `src/core/features/incidents/publication-repository.ts`, `tests/e2e/helpers/review-update-flow.mjs` | Native drafts stage state changes, attachments and releases; review, scheduling and templates keep the choices. One transaction publishes claims, aggregate history, immutable timeline changes and recipients; mail and signed webhooks retain the published changes after later recovery. Gap: management-token and Statuspage write APIs, automation, chat desks, SMS and component-only/Statuspage webhook subscriptions are not built. Overlap history follows aggregate changes; the acceptance sentence asking for no entry when Major changes to Partial needs clarification. |
| `UPDATE-013` | Links in update text | target | partial | `src/core/shared/update-links.ts`, `tests/e2e/helpers/review-update-flow.mjs`, `tests/e2e/channels-and-presets.test.mjs` | Bare HTTPS links render directly in public pages, history, permalinks, Atom/RSS, email HTML, Slack and Teams. Other schemes and markup remain literal; generic webhooks stay raw. Gap: SMS is not built; Slack/Teams real clients pass recorded network-edge fixtures, but live provider acceptance awaits sandbox credentials. |
| `MAINT-001` | Distinct from incidents | published | done | `tests/e2e/intake-references.test.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/reference-storage/references.test.mjs` |  |
| `MAINT-002` | Automatic transitions | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `MAINT-003` | Component states | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `MAINT-004` | Overrun | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `MAINT-005` | Reminders | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `MAINT-006` | Rescheduling and cancellation | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `MAINT-007` | Maintenance calendar | target | missing |  | Not built. |
| `MAINT-008` | Maintenance from deploy pipelines | target | missing |  | Not built. |
| `MAINT-009` | Maintenance has its own wording and updates | target | partial | `src/core/features/maintenance/routes.ts`, `src/core/features/maintenance/repository.ts`, `tests/e2e/publishing-contract.test.mjs` | An operator can complete a window early or after an overrun, exactly once, and every lifecycle notice is a stored record of its kind (MAINT-004, MAINT-005). A maintenance has only a title, a window and components (`maintenanceSchema` is `.strict()`), and every notice body is its reference and title (`src/core/features/maintenance/service.ts`). There are no in-window updates, no Verifying state and no per-window automation switches, and imported Statuspage maintenance messages survive only as historical text (`import_maintenance_updates`). |
| `SUB-001` | Subscribing | published | done | `tests/e2e/app-api.test.mjs`, `tests/e2e/delivery-contract.test.mjs` |  |
| `SUB-002` | Confirmation | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `SUB-003` | Pending expiry | published | done | `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/public-contract.test.mjs` |  |
| `SUB-004` | Component selection | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `SUB-005` | Cookieless subscriber tokens | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `SUB-006` | One-click unsubscribe | published | done | `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/rer-mail.test.mjs` |  |
| `SUB-007` | Managing a subscription | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `SUB-008` | Unsubscribe integrity | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `SUB-009` | Webhook subscribers | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `SUB-010` | Failing destinations | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `SUB-011` | Operator view | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `SUB-012` | No enumeration | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `SUB-013` | SMS subscribers | target | missing |  | Released `seed.json → nonGoals` excludes SMS; this clause and NOTIFY-014 replace that exclusion. |
| `SUB-014` | Self-serve Slack subscriptions | target | partial | `src/core/features/subscribers/service.ts`, `src/core/features/channels/service.ts`, `tests/e2e/delivery-contract.test.mjs` | A subscriber can register a Slack incoming-webhook URL as a webhook subscriber (SUB-009), and operators add Slack channels (NOTIFY-011). Slack app sign-up does not exist. |
| `SUB-015` | Self-serve Microsoft Teams subscriptions | target | partial | `src/core/features/channels/teams.ts`, `tests/e2e/channels-and-presets.test.mjs` | Operator-configured Teams channels ship (NOTIFY-011, NOTIFY-012). Subscriber-owned Teams subscriptions do not. |
| `SUB-016` | Preferences on every channel | target | partial | `src/core/features/subscribers/service.ts`, `tests/e2e/delivery-contract.test.mjs` | Component selection on subscriptions ships. Event-kind and impact-threshold preferences do not. |
| `SUB-017` | Subscriber import and export | target | partial | `src/core/features/statuspage-import/`, `tests/e2e/statuspage-import.test.mjs` | Move-in imports bring email subscribers in as pending (MOVE-002). CSV import and subscriber export do not exist. |
| `SUB-018` | Statuspage-format webhooks | target | partial | `src/core/features/deliveries/service.ts`, `tests/e2e/delivery-contract.test.mjs` | Signed Lamp-format webhooks carrying the incident, every published update and each component's previous and new state ship (SUB-009). The Statuspage format and per-subscription format choice do not. |
| `SUB-019` | Follow one incident | target | missing |  | Not built. |
| `SUB-020` | Subscriber limits are stated, enforced and reported | target | missing |  | The released limit of 1,000 subscribers (`seed.json → limits`) is a delivery-time qualification only. Nothing counts subscriptions against it, refuses a sign-up or import over it, or alerts on it. |
| `NOTIFY-001` | What notifies subscribers | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `NOTIFY-002` | Delivery time | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `NOTIFY-003` | Retry | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `NOTIFY-004` | Delivery log, without tracking | published | done | `tests/e2e/delivery-contract.test.mjs`, `tests/reference-storage/capture-receipts.test.mjs` |  |
| `NOTIFY-005` | At most once | published | done | `tests/e2e/delivery-contract.test.mjs`, `tests/reference-storage/capture-receipts.test.mjs` |  |
| `NOTIFY-006` | Operator alerts | published | done | `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/update-reminders.test.mjs` |  |
| `NOTIFY-007` | Channels are per update | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `NOTIFY-008` | Who the deployment emails | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `NOTIFY-010` | Mail headers | published | done | `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/rer-mail.test.mjs` |  |
| `NOTIFY-009` | Delivery never blocks publication | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `NOTIFY-011` | Slack and Teams channels | published | done | `tests/e2e/channels-and-presets.test.mjs` |  |
| `NOTIFY-012` | Channel posts | published | done | `tests/e2e/channels-and-presets.test.mjs` |  |
| `NOTIFY-013` | Redundant email delivery | target | partial | `src/core/app/mail.ts`, `src/core/features/deliveries/service.ts`, `src/core/features/deliveries/sendgrid-events.ts`, `tests/e2e/sendgrid-provider.test.mjs` | One selectable provider with durable retries and SendGrid signed events ships. A secondary provider, failover and other providers' events do not. |
| `NOTIFY-014` | SMS delivery | target | missing |  | Not built. |
| `NOTIFY-015` | Reach of each update | target | done | `src/core/features/communication-performance/repository.ts`, `src/core/features/communication-performance/ui/incident-reach.tsx`, `tests/e2e/helpers/communication-performance-flow.mjs` |  |
| `NOTIFY-016` | Operator alerts beyond email | target | missing |  | Not built. |
| `NOTIFY-017` | Component status changes reach webhook subscribers | target | missing |  | Released NOTIFY-001 notifies no one for a change outside an incident or maintenance. |
| `NOTIFY-018` | Delivery time on every channel | target | partial | `src/core/features/deliveries/service.ts`, `tests/e2e/delivery-contract.test.mjs` | NOTIFY-002's 5-minute bound ships and is tested for email at the subscriber limit. No bound is stated or tested for webhooks, Slack, Teams or SMS. |
| `NOTIFY-019` | Notification email the owner can brand | target | partial | `src/core/shared/email-branding.ts`, `src/core/features/page-settings/ui/email-branding-settings.tsx`, `tests/e2e/helpers/email-branding-worker-flow.mjs`, `tests/e2e/helpers/email-branding-browser-flow.mjs`, `tests/e2e/page-data.test.mjs` | Display name and Reply-To work with SendGrid and Resend. Subject prefixes, uploaded same-host logos, plain-text headers/footers, shared preview, immutable retry envelopes and page-data export/restore ship. Managed mail supports subject/logo/wording but owns From and does not accept Reply-To; Settings and restore refuse unsupported identity settings. Audience-specific settings await AUD-001. Provider transport is proven against network-edge fixtures, not live inbox receipt. |
| `NOTIFY-020` | Delivery at Statuspage Business and Enterprise scale | target | partial | `src/core/features/deliveries/service.ts`, `tests/e2e/delivery-contract.test.mjs` | Durable queued email delivery ships, with the 5-minute bound qualified only locally at 1,000 subscribers under a 10-per-second fake quota (`seed.json → limits`). There is no hosted run, no qualification above 1,000, no provider batch sending, and no check of the provider account's rate. |
| `INTAKE-001` | Authenticated requests | published | done | `tests/e2e/intake-references.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |  |
| `INTAKE-002` | Alerts never publish | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `INTAKE-003` | Deduplication | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `INTAKE-004` | Recovery alerts | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `INTAKE-005` | Payload mapping | published | done | `tests/e2e/app-api.test.mjs`, `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |  |
| `INTAKE-006` | Monitor presets | published | done | `tests/e2e/channels-and-presets.test.mjs` |  |
| `INTAKE-007` | Preset recovery | published | done | `tests/e2e/channels-and-presets.test.mjs` |  |
| `INTAKE-008` | Uptime preset | target | partial | `src/core/features/intake/service.ts`, `tests/e2e/publishing-contract.test.mjs` | A generic signed source with configurable timestamp and signature headers and JSON-path mapping (INTAKE-001, INTAKE-005) can receive Uptime's webhook. There is no preset, no monitor-to-component mapping and no test with Uptime's payload. |
| `INTAKE-009` | PagerDuty | target | partial | `src/core/features/intake/service.ts`, `tests/e2e/publishing-contract.test.mjs` | A bearer-token generic source with JSON-path mapping can receive PagerDuty webhooks sent with a custom header. There is no preset, no v3 signature check and no note back to PagerDuty. |
| `INTAKE-010` | Prometheus Alertmanager and Grafana Alerting | target | partial | `src/core/features/intake/service.ts`, `src/core/features/intake/alert-title.ts`, `tests/e2e/publishing-contract.test.mjs` | A generic bearer source reading one JSON path for key, title and state can take a single Alertmanager group. There are no label matchers, no per-alert fingerprints and no preset. |
| `INTAKE-011` | New Relic, Datadog and Pingdom depth | target | partial | `src/core/features/intake/presets.ts`, `tests/e2e/channels-and-presets.test.mjs` | Datadog, UptimeRobot, Better Stack and Pingdom alert presets ship (INTAKE-006). New Relic and metric ingestion do not. |
| `INTAKE-012` | Oncall | target | missing |  | Not built. |
| `INTAKE-013` | Email automation for each component | target | missing |  | Lamp has no inbound email path. |
| `INTAKE-014` | Jira Service Management and Opsgenie | target | partial | `src/core/features/intake/service.ts`, `tests/e2e/publishing-contract.test.mjs` | A bearer-token generic source with JSON-path mapping (INTAKE-001, INTAKE-005) can receive a JSM or Opsgenie webhook sent with a custom header. There is no preset, no tag or service mapping, no note handling and no note back to JSM or Opsgenie. |
| `AUTO-001` | Owner rules for what an alert may do | target | partial | `src/core/features/intake/policies.ts`, `src/core/features/intake/presets.ts`, `tests/e2e/channels-and-presets.test.mjs` | The replaceable `alert.intake.v1` policy and preset-to-component mapping ship. There are no per-component rules, automatic claims or template publication. |
| `AUTO-002` | Flap guard and undo for automatic changes | target | missing |  | Not built. |
| `AUTO-003` | Every follow-up obligation is visible | target | partial | `src/core/features/incidents/reminders.ts`, `src/core/features/reports/service.ts`, `tests/e2e/update-reminders.test.mjs` | Due and overdue incidents show on Overview, and owed reports are marked. A unified obligations list does not exist. |
| `AUTO-004` | Post-incident report follow-up | target | partial | `src/core/features/reports/service.ts`, `tests/e2e/publishing-contract.test.mjs` | Report-due marking ships (HIST-003). Reminders and waivers do not. |
| `DRAFT-001` | Suggested update | published | done | `tests/e2e/incident-brief.test.mjs` |  |
| `DRAFT-002` | Inputs | published | done | `tests/e2e/incident-brief.test.mjs`, `tests/e2e/publishing-browser.test.mjs` |  |
| `DRAFT-004` | Incident brief | published | done | `tests/e2e/incident-brief.test.mjs` |  |
| `DRAFT-003` | Absent or failing provider | published | done | `tests/e2e/incident-brief.test.mjs`, `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |  |
| `TEAM-001` | Equal operators | published | done | `tests/auth-adoption/upgrade.test.mjs`, `tests/e2e/delivery-contract.test.mjs` |  |
| `TEAM-002` | Management | published | done | `tests/auth-adoption/upgrade.test.mjs`, `tests/e2e/delivery-contract.test.mjs` |  |
| `TEAM-003` | Attribution | published | done | `tests/e2e/delivery-contract.test.mjs` |  |
| `TEAM-004` | Roles | target | missing |  | Replaces released TEAM-001's "There are no roles" and the `seed.json → nonGoals` roles exclusion when shipped. |
| `TEAM-005` | Access scoped to pages and audiences | target | missing |  | Not built. |
| `TEAM-006` | Enforced SSO and SCIM | target | partial | `src/core/platform/auth/config.ts`, `tests/auth-adoption/dependencies.test.mjs` | Optional OIDC sign-in through Base (ACCESS-001) ships, off by default. Enforcement, break-glass and SCIM do not. When shipped, this replaces ACCESS-001's "SCIM and role synchronization remain out of scope". |
| `TEAM-007` | Audit log view | target | partial | `src/core/features/audit-log/`, `migrations/core/0033_audit_log.sql`, `tests/e2e/helpers/audit-log-flow.mjs`, `tests/auth-adoption/operator-erasure.test.mjs` | Settings provides actor, action and UTC-date filters, pagination and matching CSV; erased actors retain only their anonymised reference. Publications, corrections, subscriber/operator erasures, component state history and maintenance notices are covered. Role-restricted access and role/rule/management-token events await TEAM-004, AUTO-001 and API-001; component/group deletion attribution is not yet recorded. |
| `HIST-001` | Public history | published | done | `tests/e2e/public-contract.test.mjs` |  |
| `HIST-002` | Post-incident report | published | done | `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs` |  |
| `HIST-003` | Report due | published | done | `tests/e2e/publishing-contract.test.mjs` |  |
| `HIST-004` | Export contents | published | done | `tests/e2e/export-import.test.mjs` |  |
| `HIST-005` | Communication performance | target | done | `src/core/features/communication-performance/service.ts`, `src/core/features/communication-performance/ui/communication-performance.tsx`, `tests/e2e/helpers/communication-performance-flow.mjs` |  |
| `HIST-006` | Traffic spike alert without visitor tracking | target | missing |  | Not built. |
| `HIST-007` | Subscriber reporting | target | partial | `src/core/features/subscribers/service.ts`, `tests/e2e/delivery-contract.test.mjs` | The operator subscriber list with channel, state, selection and deactivation reason ships (SUB-011). Counts, trends and export do not. |
| `HIST-008` | Complete browsable history | target | done | `src/core/features/public-snapshot/history.ts`, `tests/e2e/helpers/catalogue-history-flow.mjs`, `tests/e2e/snapshot-retained.test.mjs` |  |
| `AUD-001` | Several pages in one deployment | target | missing |  | Replaces the released `seed.json → nonGoals` exclusions of more than one page per deployment and of private or audience-scoped pages. |
| `AUD-002` | Private page access | target | missing |  | Not built. |
| `AUD-003` | Audiences for named customers | target | missing |  | Not built. |
| `AUD-004` | Audience subscribers | target | missing |  | Not built. |
| `AUD-005` | Isolation is proven, not assumed | target | missing |  | Not built. |
| `API-001` | Token-authenticated management API | target | partial | `src/core/features/incidents/routes.ts`, `src/core/features/maintenance/routes.ts`, `tests/e2e/app-api.test.mjs` | Session-authenticated operator APIs exist for the app. There are no tokens, no public versioned API and no OpenAPI document. Replaces the released `seed.json → nonGoals` exclusion of a token API. |
| `API-002` | Statuspage-compatible management API | target | missing |  | Not built. |
| `API-003` | Operator event webhooks | target | missing |  | Not built. |
| `API-004` | Terraform, GitHub Actions and config-as-code | target | missing |  | Not built. |
| `INTEG-001` | Incident context in the support desk | target | missing |  | Not built. |
| `INTEG-002` | Updates posted to the page's social accounts | target | missing |  | Not built. |
| `MOBILE-001` | The operator desk works on a phone | target | done | `src/core/app/client/ui/responsive.css`, `src/core/features/intake/ui/alerts-page.tsx`, `tests/e2e/helpers/phone-desk-flow.mjs` | Native terminal-link sign-in, signed-alert draft, attachment, autosave/reload, preview, publish, resolution, standing claim and maintenance scheduling pass at 390×844 and 1440 px, with accessibility, overflow and 44 px phone-control checks. |
| `MOBILE-002` | Installable app with push | target | missing |  | Not built. |
| `SETUP-001` | Setup readiness | published | done | `tests/e2e/setup-readiness.test.mjs` |  |
| `SETUP-002` | First-run setup | published | done | `tests/e2e/auth-adoption-journey.test.mjs` |  |
| `ACCESS-001` | Owner-terminal sign-in | published | done | `tests/auth-adoption/dependencies.test.mjs`, `tests/auth-adoption/portability.test.mjs`, `tests/auth-adoption/upgrade.test.mjs` |  |
| `MOVE-001` | Dry run first | published | done | `tests/betterstack/flow.test.mjs`, `tests/e2e/betterstack-browser.test.mjs`, `tests/e2e/instatus-browser.test.mjs` |  |
| `MOVE-002` | Retroactive and silent | published | done | `tests/auth-adoption/cutover.test.mjs`, `tests/betterstack/flow.test.mjs`, `tests/e2e/sorry-import.test.mjs` |  |
| `MOVE-003` | One import per source | published | done | `tests/e2e/statuspage-import.test.mjs` |  |
| `MOVE-004` | Undo | published | done | `tests/e2e/sorry-import.test.mjs`, `tests/e2e/statuspage-import.test.mjs` |  |
| `MOVE-005` | Old public addresses | published | done | `tests/e2e/sorry-import.test.mjs`, `tests/e2e/statuspage-import.test.mjs` |  |
| `MOVE-006` | Cutover preview | published | done | `tests/auth-adoption/cutover.test.mjs`, `tests/e2e/cutover-browser.test.mjs`, `tests/e2e/sorry-import.test.mjs` |  |
| `MOVE-007` | From Status.io | target | missing |  | Not built. |
| `MOVE-008` | From incident.io Status Pages | target | missing |  | Not built. |
| `MOVE-009` | Statuspage consumers keep working at cutover | target | partial | `src/core/features/statuspage-import/public-paths.mjs`, `src/core/features/public-snapshot/import-aliases.ts`, `tests/e2e/statuspage-import.test.mjs` | History and Atom aliases are served after import (MOVE-005). JSON API, RSS and embed compatibility are missing, and Cutover reports them as unsupported (MOVE-006). |
| `MOVE-010` | Every subscriber channel moves | target | missing |  | Released imports carry email subscribers only (`src/core/features/statuspage-import/`). |
| `MOVE-011` | Postmortems and templates move | target | partial | `src/core/features/statuspage-import/postmortems.ts`, `src/core/features/statuspage-import/templates.ts`, `tests/e2e/helpers/postmortem-template-import-flow.mjs`, `tests/e2e/helpers/imported-template-apply-flow.mjs` | Statuspage published reports retain original times, draft reports remain private, and templates retain metadata, component states and full oversized wording for shortening. Dry run, silent apply, repeat and conditional undo cover both. Gap: Status.io and incident.io readers are not built. |
| `MOVE-012` | Private and audience pages move as private | target | partial | `src/core/features/statuspage-import/betterstack/read.ts`, `src/core/features/statuspage-import/instatus/normalize.ts`, `src/core/features/statuspage-import/sorry/read.ts`, `tests/betterstack/reader.test.mjs` | The Better Stack, Instatus and Sorry readers refuse private, password-protected, IP-restricted and audience-scoped sources rather than publishing them. The Statuspage reader reads no visibility at all (`docs/moving-in.md`), so a private Statuspage page would import as public, and private and audience pages (AUD-001 to AUD-005) are not built. |
| `PORT-001` | Every new record travels | target | partial | `tests/e2e/export-import.test.mjs` | Export, clean restore and equivalent re-export cover every released record (HIST-004). Target entities are not built. |
| `PORT-002` | Erasure reaches every new identifier | target | partial | `tests/e2e/subscriber-erasure.test.mjs`, `tests/auth-adoption/operator-erasure.test.mjs` | Subscriber and operator erasure ship for released records. The identifiers that target clauses add are not built. |
| `AGENT-001` | The public story matches responder evidence | push-further | partial | `src/core/features/brief/build.ts`, `src/core/features/ai/service.ts`, `tests/e2e/incident-brief.test.mjs` | The model-free brief flags a monitor recovery with a non-resolved lifecycle and a passed commitment, and an operator can request a cited suggestion (DRAFT-001, DRAFT-004). Continuous comparison against responder, monitor and support evidence does not exist. |
| `AGENT-002` | The next-update promise is kept | push-further | partial | `src/core/features/incidents/reminders.ts`, `src/core/features/ai/service.ts`, `tests/e2e/update-reminders.test.mjs` | Due and overdue reminders and on-request suggestions ship. Automatic drafting before the deadline and owner escalation do not. |
| `AGENT-003` | Audience-specific impact | push-further | partial | `src/core/features/incidents/service.ts`, `tests/reference-storage/incident-publishing.test.mjs` | Each update carries an operator-written affected-audience statement (UPDATE-001). There are no audiences and no drafted variants. |
| `AGENT-004` | Customer-visible recovery is checked before close | push-further | partial | `src/core/features/brief/build.ts`, `tests/e2e/incident-brief.test.mjs` | The brief notes a recorded monitor recovery that has not been published as Resolved. There is no pre-close recovery check and no override. |
| `AGENT-005` | A post-incident report drafted from the record | push-further | missing |  | Not built. |
| `AGENT-006` | Unreported incidents surface early | push-further | missing |  | Not built. |
| `AGENT-007` | Translations drafted, never auto-published | push-further | missing |  | Not built. |
| `AGENT-008` | Scoped MCP tools for outside agents | push-further | missing |  | Not built. |
| `AGENT-009` | Maintenance notices drafted from change plans | push-further | missing |  | Not built. |
