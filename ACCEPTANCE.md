<!-- Generated from CONTRACT.md by contract-docs. Edit CONTRACT.md, then regenerate. -->

# Accept a Lamp installation

The primary journey: An operator sets up the page and components, accepts evidence, drafts and publishes an impact-first incident update, notifies the subscribers who follow it, keeps the next-update promise, verifies recovery and preserves the report and history.

## Progress

| Tier | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Core | 19 | 170 | 49 | 238 |
| Agent surface | 0 | 0 | 5 | 5 |
| Later | 0 | 0 | 0 | 0 |
| Full target | 19 | 170 | 54 | 243 |

Judged from the code and tests at commit `6a864865123712030b1b322d6ef40c48c91677ef` (29 October 2026); SUB-014 is rechecked on the landing candidate, with earlier clause judgments retained. Field proof register: 19 rows; 0 passed, 0 failed, 19 not run.

## Core

### Owner documentation

#### DOCS-001 — Public owner documentation

Core · published · **partial** · Cites BASE-DOCS-001

**Requirement.** Public owner guidance is available on the app host, including the selected published Markdown pages; it is separate from the status-page host.

**Acceptance.**
1. A visitor without an operator session can read the documentation index and each selected published page on the app host.
2. A selected page renders its repository Markdown, and documentation is absent from the public status-page host.

**Evidence.** `tests/e2e/start-runtime.test.mjs`
**Gap.** Old cited evidence asserts The unauthenticated documentation index returns HTTP 200; A representative selected VPAT page contains its released version and required chapter text; The selected VPAT page renders the version and chapter text held in its repository Markdown; The status-page host does not serve documentation. Unasserted: The documentation index’s usable guidance and navigation content are asserted.

### Public page

#### PAGE-001 — Contents

Core · published · **partial**

**Requirement.** One initial public response contains the complete status overview, current incident information and relevant maintenance, with component uptime.

**Acceptance.**
1. The response shows overall status and every visible component, with each current state and note.
2. Every unresolved incident shows its five most recent published updates, newest first, and a link to its complete permanent timeline.
3. Every maintenance in progress and each scheduled maintenance starting within 14 days appears.
4. Each visible component has its uptime figure and the daily record for the reporting window.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** Old cited evidence asserts Overall status appears; The total daily-mark count is between six times ninety and six times ninety-one. Unasserted: Every visible component is present; Each visible component’s current state is present; Each visible component’s exact note is present; Every unresolved incident appears; Five most recent updates are shown in newest-first order; Each incident links its complete permanent timeline; All in-progress maintenance appears; The 14-day scheduled-maintenance inclusion boundary is asserted; Daily-mark coverage is reconciled separately for every visible component; Each visible component uptime figure is asserted.

#### PAGE-002 — Readable without script

Core · published · **partial**

**Requirement.** The status overview and subscription remain usable without scripting, and scripting preserves the configured page time zone.

**Acceptance.**
1. The initial HTML contains all PAGE-001 content and the subscription form of SUB-001.
2. With scripting disabled, every status, update and timestamp is readable and the subscription form submits.
3. With scripting available, the configured time zone and its label remain unchanged; operator entry, timelines, previews and public timestamps use that zone.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** Old cited evidence asserts Initial HTML contains the overall Operational label; Initial HTML contains the representative component name; Initial HTML contains a timestamp; Initial HTML contains the subscription form. Unasserted: All PAGE-001 content is reconciled in initial HTML; Every status, update and timestamp is readable with scripting disabled; The public subscription form successfully submits without scripting; Public timestamp text remains in the configured zone; Operator entry uses the configured zone; Timeline timestamps use the configured zone; Preview timestamps use the configured zone.

#### PAGE-003 — Weight

Core · published · **done** · Cites BASE-PUBLIC-001

**Requirement.** The public page remains within its transfer and request budget at the component limit.

**Acceptance.**
1. At the declared component limit, the initial HTML is at most 50 KiB gzipped.
2. Initial loading issues at most four further requests for its stylesheet, font, logo and script, all to its own origin.

**Evidence.** `tests/e2e/public-contract.test.mjs` (owner maintains a complete catalogue and customers read, refresh, embed and retain its public story), loading `tests/e2e/helpers/public-capacity-journey.mjs` (publicCapacityJourney): 200 visible components with populated descriptions and notes, ten 1,440-point charts, gzip budget in all four templates, at most four allowed own-origin initial assets and zero third-party requests.
**Gap.** None.

#### PAGE-004 — Overall status

Core · published · **partial**

**Requirement.** The overall state is a single label at the top of the page, computed by the owner-replaceable rollup policy.

**Acceptance.**
1. The supplied rollup chooses the most severe visible component state in COMP-001 order.
2. The result appears as one labeled state at the top of the page.
3. With all visible components Operational and no unresolved incident, the label is operational.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** The cited evidence asserts the other audited outcomes; unasserted: The supplied rollup selects the most severe visible component state.

#### PAGE-005 — Snapshot read path

Core · published · **partial** · Cites BASE-OPS-004

**Requirement.** Public page, Atom feed and widget content are published as a complete retained snapshot, and remain available while publication recovers.

**Acceptance.**
1. Each change to PAGE-001 content produces a complete rendered public page, Atom feed and widget snapshot.
2. Serving those three surfaces reads the snapshot without any database query.
3. A failed snapshot write is retried until success; the prior snapshot continues serving during recovery.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/snapshot-retained.test.mjs`
**Gap.** Old cited evidence asserts A rendered public-page artifact exists; An Atom-feed artifact exists; A widget artifact exists; A failed build remains stale until a retry. Unasserted: Every PAGE-001 change triggers a complete snapshot; The public page remains readable without the database; The feed remains readable without the database; The widget remains readable without the database; The old publication body is read back while the unrecoverable replica failure is in force; Public snapshot reads issue no database query rather than merely surviving missing tables.

#### PAGE-006 — Serving through a failure

Core · published · **partial** · Cites BASE-OPS-001

**Requirement.** Public status continues to answer from retained content during primary storage, database or queue failure, with truthful stale labeling.

**Acceptance.**
1. When the database, queue or object storage is unreachable, the page, Atom feed and widget return successful current or retained content; an origin outage can use PAGE-007’s cached response.
2. Only an installation with no snapshot ever written returns unavailable instead of status content.
3. Content not built from current data identifies its generation instant and says Last known state; a failed read never invents an operational all-clear.

**Evidence.** `tests/e2e/public-contract.test.mjs`, `tests/e2e/public-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts The page body still contains Partially unavailable after database removal; Stale page content is labeled Last known state; The generation instant is visible in stale page content; The retained failure body contains Partially unavailable. Unasserted: The Atom feed survives database outage; The widget survives database outage; Page content survives queue outage; Atom feed content survives queue outage; Widget content survives queue outage; Page content survives object-storage outage; Atom feed content survives object-storage outage; Widget content survives object-storage outage; Origin outage uses the specified cached-response window; Page is unavailable only before first publication; Atom feed is unavailable only before first publication; Widget is unavailable only before first publication.

#### PAGE-007 — Publish latency and caching

Core · published · **partial**

**Requirement.** Publications become visible promptly through every public representation, and healthy reads validate the current generation.

**Acceptance.**
1. Stable public addresses validate the current generation when reused; unchanged content can be reused, while a newer generation makes older cached bytes ineligible for a healthy response.
2. An update, component-state change or maintenance transition reaches the page, history, incident and maintenance permanent pages, Atom feed, widget and public JSON within 10 seconds of the initiating successful request.
3. An unreachable origin can use retained content for one hour; retained last-known snapshots follow PAGE-006.

**Evidence.** `tests/e2e/public-contract.test.mjs`, `tests/e2e/public-contract.test.mjs`, `tests/e2e/snapshot-retained.test.mjs`
**Gap.** The cited evidence asserts the other audited outcomes; unasserted: Advancing a generation makes all earlier healthy cache entries ineligible; Update publication reaches public page within ten seconds; Update publication reaches history within ten seconds; Update publication reaches incident permanent page within ten seconds; Update publication reaches maintenance permanent page within ten seconds; Update publication reaches Atom feed within ten seconds; Update publication reaches widget within ten seconds; Update publication reaches public JSON within ten seconds; Component-state change reaches public page within ten seconds; Component-state change reaches history within ten seconds; Component-state change reaches incident permanent page within ten seconds; Component-state change reaches maintenance permanent page within ten seconds; Component-state change reaches Atom feed within ten seconds; Component-state change reaches widget within ten seconds; Component-state change reaches public JSON within ten seconds; Maintenance transition reaches public page within ten seconds; Maintenance transition reaches history within ten seconds; Maintenance transition reaches incident permanent page within ten seconds; Maintenance transition reaches maintenance permanent page within ten seconds; Maintenance transition reaches Atom feed within ten seconds; Maintenance transition reaches widget within ten seconds; Maintenance transition reaches public JSON within ten seconds; Origin-failure retention lasts exactly the promised one-hour window. Additional freshness assertions are in tests/e2e/helpers/public-freshness-flow.mjs, which the old Evidence cell did not cite.

#### PAGE-008 — Public read paths are not rate limited

Core · published · **partial** · Cites BASE-ACCESS-003

**Requirement.** Public status reads are exempt from per-caller rate limiting so shared customer egress stays usable during an incident. Supersedes `BASE-ACCESS-003` for those paths only. Public writes continue under that duty.

**Acceptance.**
1. All public reads up to the declared per-address capacity succeed and never return a rate-limit refusal.
2. Public reads share immutable generation content; healthy reads validate the current generation without querying the database, with artifact caching reducing object-byte reads.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** The cited evidence asserts the other audited outcomes; unasserted: Healthy generation validation performs no database query; Artifact caching reduces object-byte reads.

#### PAGE-009 — Time display

Core · published · **partial**

**Requirement.** Public timestamps and notifications use the configured time zone and offset. Under RL-1, the owner’s S4 exception permits a relative generation label while scripting runs.

**Acceptance.**
1. Every public and notification timestamp displays the configured time zone and UTC offset; page timestamps retain their exact ISO instant as machine-readable data.
2. With scripting available, the generation label is relative and refreshes while the page stays open; its tooltip retains the absolute configured-zone time and offset and its machine-readable value retains the instant.
3. Initial HTML and script-disabled readers see the absolute generation time; incident, maintenance, feed and notification timestamps remain absolute.

**Evidence.** `tests/e2e/public-contract.test.mjs`. The PAGE-014/PAGE-009 journey finds the relative generation label with the absolute zone-and-offset tooltip and ISO datetime (`tests/e2e/public-contract.test.mjs`, lines 622-627). Changed in 1.11.0 by the owner's S4 exception (DIVERGENCE.md "Public page clarity"): the generation time shows a relative label while script runs; RELEASE.json records the change.
**Gap.** Old cited evidence asserts Scripted public timestamp retains the exact instant; The initial scripted generation label is relative. Unasserted: Initial public timestamp text uses the configured zone and exact instant; Scripted public timestamp uses the configured zone and offset; Notification timestamps use the configured zone and offset; The generation tooltip preserves the absolute instant and configured zone; The relative label’s later refresh is asserted rather than only awaited; Initial public HTML retains absolute timestamps; Script-disabled generation text remains absolute; Maintenance, feed and notification text remains absolute.

#### PAGE-010 — Atom feed

Core · published · **partial**

**Requirement.** The Atom feed preserves published incident and maintenance history with permanent event identities.

**Acceptance.**
1. The feed validates as Atom 1.0.
2. It contains one entry for every published incident update and each scheduled, rescheduled, started, completed or cancelled maintenance notice from the last 12 months, newest first.
3. Each entry identifier remains stable from first publication and is never reused.

**Evidence.** `tests/e2e/public-contract.test.mjs`, `tests/e2e/public-contract.test.mjs`
**Gap.** The cited evidence asserts the other audited outcomes; unasserted: Full Atom 1.0 validation is asserted; Exactly one entry exists for each included event; Event identities are never reused.

#### PAGE-011 — Embeddable widget

Core · published · **partial** · Cites BASE-PUBLIC-002

**Requirement.** An embeddable banner shows overall status and an unresolved incident using the same public snapshot.

**Acceptance.**
1. Installing one script tag renders the overall state and any unresolved incident from PAGE-005 content.
2. The widget is at most 10 KiB gzipped and loads only from the installation’s own origin.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** Old cited evidence asserts The widget is at most ten KiB gzipped; The nonempty widget source contains neither XMLHttpRequest nor importScripts. Unasserted: The banner content asserts both overall state and unresolved incident; The widget performs no other foreign-origin or alternate network load; Every widget load is observed to stay on the installation origin.

#### PAGE-012 — Branding

Core · published · **partial**

**Requirement.** The owner configures branding and status artwork without changing source.

**Acceptance.**
1. Settings control page name, logo, accent color, time zone, hostname and footer-credit visibility.
2. The footer credit is the plain text Powered by Lamp, starts enabled, and disabling it performs no network action.
3. The logo is served from the installation’s origin.
4. The favicon combines the configured logo with a mark for the current overall state; Open Graph title and image state that overall status.

**Evidence.** `tests/e2e/public-contract.test.mjs`, `tests/e2e/public-contract.test.mjs`
**Gap.** Old cited evidence asserts Changing the page name reaches the public page; Footer credit begins enabled; Enabled credit displays Powered by Lamp; Disabling credit removes it. Unasserted: Logo is changed and read back; Accent color is changed and read back; Time zone is changed and read back; Hostname is changed and read back; Disabling credit has no network effect; The direct first-party logo response bytes are read back as the configured logo; Open Graph title states the current overall status.

#### PAGE-013 — Enforced isolation

Core · published · **partial** · Cites BASE-PUBLIC-001

**Requirement.** Public status has restrictive same-origin isolation and needs no CAPTCHA or consent banner. The exact header policy is documented in the public mechanisms record. The formats and configuration details are in [Public status mechanisms](docs/contract/public-details.md).

**Acceptance.**
1. Every public response has the documented own-origin default, script, style, image, connection, form and base policies, refuses framing, prevents content-type sniffing and uses the documented referrer policy.
2. The public page contains neither a CAPTCHA nor a consent banner.
3. The public page writes no visitor data to browser storage.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/public-contract.test.mjs`
**Gap.** Old cited evidence asserts The default-src directive names the own origin in the exact complete CSP; The script-src directive names the own origin in the exact complete CSP; The style-src directive names the own origin in the exact complete CSP; The img-src directive names the own origin in the exact complete CSP. Unasserted: A populated public page is checked for absence of CAPTCHA; A populated public page is checked for absence of consent banner; The public page writes no visitor data to browser storage.

#### PAGE-014 — Live refresh

Core · published · **partial** · Cites BASE-ACCESSIBILITY-001

**Requirement.** When scripting is available, public status refreshes in place without disturbing assistive announcements or the configured time zone.

**Acceptance.**
1. The page polls at most every 30 seconds and replaces the overall status and newest update in place.
2. The response has a fixed field set and its size does not grow with component count.
3. With scripting disabled, no automatic refresh occurs and the generation instant is shown.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** The cited evidence asserts the other audited outcomes; unasserted: The refresh response has exactly the fixed field set; The refresh response size does not grow with component count; Scripting-disabled content never refreshes itself.

### Components

#### COMP-001 — States and their order

Core · published · **partial**

**Requirement.** Components have one public state from a fixed vocabulary, and all severity comparisons use one order.

**Acceptance.**
1. The only component states are Operational, Degraded performance, Partially unavailable, Major outage and Under maintenance.
2. Severity is ordered Major outage, Partially unavailable, Degraded performance, Under maintenance, Operational.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** Old cited evidence asserts The component-state vocabulary is exact; Degraded performance outranks Under maintenance; Degraded performance outranks Operational; Major outage outranks Partially unavailable. Unasserted: Partially unavailable outranks Degraded performance; Under maintenance outranks Operational.

#### COMP-002 — Grouping and order

Core · published · **partial**

**Requirement.** Operators organize public components into ordered groups.

**Acceptance.**
1. A component belongs to at most one group.
2. Operators set group order and order within each group, and public rendering preserves both orders.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** The cited evidence asserts the other audited outcomes; unasserted: Multiple group membership is refused or excluded.

#### COMP-003 — Append-only state history

Core · published · **partial**

**Requirement.** Public-state history is attributable and append-only; a correction adds a superseding fact.

**Acceptance.**
1. Every public-state change appends previous state, new state, change instant and the causing operator or incident.
2. Prior entries are neither modified nor removed, including when UPTIME-004 corrects an interval by appending a superseding entry.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** Old cited evidence asserts A history row records the previous Operational state; The same history row records the new Operational state; The same history row records a standing-claim cause; A correction row names the operator. Unasserted: Every public-state change records the causing operator or incident; Prior history values are unchanged rather than only present.

#### COMP-004 — State note

Core · published · **partial**

**Requirement.** A bounded plain-text note accompanies a component’s public state.

**Acceptance.**
1. A new component note is empty by default.
2. A note of up to 250 characters appears beside that component’s state exactly as entered; a longer note is refused.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** The cited evidence asserts the other audited outcomes; unasserted: A new component’s omitted note defaults to empty.

#### COMP-005 — Internal components

Core · published · **partial**

**Requirement.** Internal components cannot affect or leak through public status.

**Acceptance.**
1. An internal component is absent from the page, Atom feed, widget and every uptime figure.
2. It never contributes to overall status.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** The cited evidence asserts the other audited outcomes; unasserted: Internal components are absent from every uptime figure; An internal severe claim leaves the public overall state unchanged.

#### COMP-006 — Component state is claimed, not set

Core · published · **partial**

**Requirement.** Incidents, maintenance and operator standing claims independently contribute to the component’s public state.

**Acceptance.**
1. An unresolved incident, in-progress maintenance or operator standing claim can claim a state; incident and maintenance attachment chooses a state per component.
2. The most severe active claim sets public state, and no active claim means Operational.
3. Resolving an incident, completing maintenance, attaching or detaching a component and setting or clearing a standing claim each recompute public state within ten seconds.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** The cited evidence asserts the other audited outcomes; unasserted: In-progress maintenance contributes its chosen claim; No claims gives Operational; Incident resolution recomputes public state within ten seconds; Maintenance completion recomputes public state within ten seconds; Component attachment recomputes public state within ten seconds; Component detachment recomputes public state within ten seconds; Setting a standing claim recomputes public state within ten seconds; Clearing a standing claim recomputes public state within ten seconds.

#### COMP-007 — Deletion

Core · published · **partial**

**Requirement.** Deleting a component removes its public state history and uptime while published communication retains its name.

**Acceptance.**
1. The component, its state history and every associated uptime figure disappear from the public page within ten seconds.
2. Published incident and maintenance updates keep the deleted component’s name.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** The cited evidence asserts the other audited outcomes; unasserted: Component and uptime disappearance is observed on the public page within ten seconds; Published maintenance history retains the deleted name.

### Uptime

#### UPTIME-001 — Definition

Core · published · **done**

**Requirement.** The public uptime figure derives from component-state history over the trailing ninety days.

**Acceptance.**
1. Each visible component shows the percentage of the ninety-day window not in a downtime state, using one-minute resolution.
2. The figure rounds down to two decimals so any downtime prevents a displayed 100.00%.

**Evidence.** `tests/e2e/public-contract.test.mjs` (owner maintains a complete catalogue and customers read, refresh, embed and retain its public story), loading `tests/e2e/helpers/public-capacity-journey.mjs` (publicCapacityJourney): public collection readback asserts the complete ninety-day partial boundary and 99.99 percent for a one-minute outage.
**Gap.** None.

#### UPTIME-002 — Downtime weights

Core · published · **partial**

**Requirement.** The owner-replaceable downtime policy weights affected minutes consistently with the displayed incident history.

**Acceptance.**
1. The supplied weights count Major outage and Partially unavailable as one downtime minute per minute, Degraded performance as one half, and Under maintenance as zero.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** The cited evidence asserts the other audited outcomes; unasserted: The supplied policy’s Major outage weight is asserted; The supplied policy’s Partially unavailable weight is asserted.

#### UPTIME-003 — Short history

Core · published · **partial**

**Requirement.** Uptime begins only where state evidence exists and labels short coverage honestly. Under RL-2, short coverage does not invent a whole day.

**Acceptance.**
1. If recorded history begins after the reporting-window start, uptime is computed from that first record.
2. Coverage under one day is labeled in elapsed hours and minutes, with less than 1 minute below a minute; from one day it uses whole days.
3. A component with no data says No data.

**Evidence.** `tests/e2e/public-contract.test.mjs`. First-day coverage reads in hours and minutes (`tests/e2e/public-contract.test.mjs`, line 405); whole-day labels apply from one day (`tests/e2e/public-contract.test.mjs`, line 452). Changed in 1.11.0 by the owner's S4 exception (DIVERGENCE.md "Public page clarity"): first-day coverage reads in hours and minutes, and a component with no data says No data; RELEASE.json records the change.
**Gap.** Old cited evidence asserts The public percentage denominator starts at the fixture’s first history record rather than inventing ninety days; Sub-day coverage is labeled in hours; Longer coverage is labeled in whole days; A zero-elapsed fixture displays No data. Unasserted: Minute-based short-coverage labels are asserted; Less-than-one-minute coverage labels are asserted.

#### UPTIME-004 — Corrections

Core · published · **partial** · Cites BASE-AUDIT-001

**Requirement.** An operator corrects a closed history interval with an attributable reason while retaining original facts.

**Acceptance.**
1. The operator supplies corrected state, closed interval and reason; omitting the reason is refused.
2. Correction appends a superseding history fact rather than changing the original.
3. Every affected uptime figure is recomputed within sixty seconds.
4. The audit records operator, interval and reason.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** Old cited evidence asserts The corrected state is retained; The stored correction retains the exact interval start; The stored correction retains the exact interval end; The reason is retained. Unasserted: Every affected figure is observed within sixty seconds.

#### UPTIME-005 — Stated method

Core · published · **partial**

**Requirement.** The initial public page explains uptime weights and window beside its figures; every published incident contributes through its component claims.

**Acceptance.**
1. Initial HTML names the selected weight of each state and the reporting-window length.
2. No published incident is invisible to uptime: publishing requires at least one claimed component.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** The cited evidence asserts the other audited outcomes; unasserted: Every state’s selected weight is asserted; Every published incident’s component claim affects the displayed uptime.

#### UPTIME-006 — Daily record

Core · published · **partial**

**Requirement.** The page displays each visible component’s daily record without inventing coverage before history begins.

**Acceptance.**
1. One daily mark covers each day of the reporting window for every visible component.
2. Any downtime day labels its weighted downtime minutes.
3. Days before tracking begins are labeled No data and visually distinct from a zero-downtime day.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** Old cited evidence asserts The aggregate mark count divided by two hundred lies between ninety and ninety-one; A day’s sixty downtime minutes are retained; Untracked days have null downtime; Tracked healthy days have zero downtime. Unasserted: The complete trailing daily-record length is reconciled for every component separately; The rendered downtime-day label contains its exact minute count; Rendered untracked days are visually distinct from healthy days.

### Incidents

#### INCIDENT-001 — Lifecycle

Core · published · **partial**

**Requirement.** An incident follows one public lifecycle.

**Acceptance.**
1. An incident has exactly one state: Investigating, Identified, Monitoring or Resolved.
2. A new incident starts in Investigating.
3. Only publishing an update changes the incident to the lifecycle that update selects.

**Evidence.** `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Asserted: Investigating; Identified; Resolved; starts Investigating; published lifecycle. Unasserted in old cited evidence: Monitoring; exactly one lifecycle; no unpublished lifecycle change.

#### INCIDENT-002 — Impact

Core · published · **partial**

**Requirement.** An incident retains the greatest component impact it has reached.

**Acceptance.**
1. Derived impact is the most severe state claimed on any attached component since opening.
2. Resolution retains that peak impact.
3. Without attached components the incident has no impact and cannot be published; UPDATE-001 governs the required attachment.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** Asserted: peak impact; resolved peak impact. Unasserted in old cited evidence: no-component impact absent; no-component publication refused.

#### INCIDENT-003 — Reference

Core · published · **partial**

**Requirement.** Every incident retains a permanent unique public reference.

**Acceptance.**
1. Each incident has an INC- reference followed by digits and a permanent public address containing it.
2. New manual and alert-intake incidents share one durable increasing sequence.
3. Existing references and public addresses remain unchanged.
4. Deletion, restart and failed creation never permit reference reuse; a failed creation may leave a gap.
5. Legacy timestamp-sized references do not choose the sequence’s starting point.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts numeric reference; The numeric-reference permalink returns that incident’s title; increasing sequence; legacy reference unchanged. Unasserted: manual and intake share sequence; public address unchanged.

#### INCIDENT-004 — Published updates are immutable

Core · published · **partial**

**Requirement.** Corrections add to the public record without changing earlier wording.

**Acceptance.**
1. Published updates cannot be edited or deleted.
2. A correction is a new publication identifying the update it corrects.
3. Original and correction remain on the public timeline in publication order.

**Evidence.** `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Asserted: original wording retained; correction identifies original; both updates retained. Unasserted in old cited evidence: published deletion refused; public publication order.

#### INCIDENT-005 — Reopening

Core · published · **partial**

**Requirement.** An erroneous resolution can be corrected without losing its history.

**Acceptance.**
1. Publishing Investigating reopens a resolved incident.
2. Resolution and reopening both remain on its public timeline.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** Asserted: reopened lifecycle; resolution retained; reopening retained. Unasserted in old cited evidence: both public.

#### INCIDENT-006 — Overdue update

Core · published · **partial**

**Requirement.** Operators distinguish a missed commitment from public incident wording.

**Acceptance.**
1. When the latest published next-update time passes without newer publication, the operator app marks the incident overdue.
2. The public page retains the committed time and contains no overdue label.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** Asserted: operator overdue; no public overdue label. Unasserted in old cited evidence: public committed time.

#### INCIDENT-007 — Deletion

Core · published · **partial** · Cites BASE-INPUT-001, BASE-OPS-005

**Requirement.** An incident can be removed from public history with a recorded reason.

**Acceptance.**
1. Deletion requires a reason and omitting it is refused.
2. The public page, history page and Atom feed remove the incident within ten seconds.
3. The deletion record identifies its operator, reason and time.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts missing reason refused. Unasserted: public page removal; history removal after demonstrated pre-deletion public visibility; Atom removal after demonstrated pre-deletion public visibility; ten-second removal; deletion actor; deletion reason; deletion time.

#### INCIDENT-008 — Internal notes

Core · published · **partial** · Cites BASE-ACCESS-002, BASE-ROLE-001

**Requirement.** Incident notes remain operator-only context.

**Acceptance.**
1. A signed-in operator can read internal incident notes.
2. Public page, Atom feed, widget, notifications and AI requests omit those notes.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts none of the audited outcomes. Unasserted: stored operator note read; populated note absent publicly after reading back the stored private note; populated note absent from Atom after reading back the stored private note; populated note absent from widget after reading back the stored private note; note absent from notifications; note absent from AI requests.

#### INCIDENT-009 — Retroactive incidents

Core · published · **partial**

**Requirement.** Operators record past incidents without replaying subscriber notifications.

**Acceptance.**
1. An operator opens incidents with historical update publication times.
2. Public timeline and history show those original times.
3. Component claims enter state history at those times and contribute to UPTIME-001.
4. No update of the retroactive incident notifies subscribers, including later current-time updates.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts first original time; resolution original time; history first time; history resolution time. Unasserted: public timeline original times.

#### INCIDENT-010 — Update due

Core · published · **partial**

**Requirement.** Reminder timing follows the published commitment.

**Acceptance.**
1. Unless the owner replaces the lead policy, an update becomes due ten minutes before its commitment.
2. Until newer publication or resolution, Overview and the incident list show its due time and an action opens its composer and brief.
3. Each commitment sends one due email and, after its time passes, one overdue email.
4. The scheduled trigger sends both without an open operator page.
5. Resolved incidents, newer publications and retroactive updates send neither.
6. A commitment already past when this behavior is introduced sends no reminder email.
7. The public page shows the committed time without due or overdue labels.

**Evidence.** `tests/e2e/update-reminders.test.mjs`
**Gap.** Asserted: before lead no reminder; due at lead; list due time; Overview due; one due email; one overdue email; scheduled trigger without browser; public commitment; no due or overdue label. Unasserted in old cited evidence: composer and brief action; resolved suppression; newer-publication suppression; retroactive suppression; old expired commitment silent.

### Updates

#### UPDATE-001 — Template

Core · published · **partial** · Cites BASE-INPUT-001, BASE-INPUT-002

**Requirement.** Updates describe customer impact and the next communication commitment in bounded plain-text fields.

**Acceptance.**
1. Publishing requires an attached component, affected-audience and customer-impact statements of at most 250 characters each, and a next-update time unless Resolved.
2. Resolved updates need no next-update time and show no next-update promise on any surface, including older stored resolved updates retaining a time.
3. Optional what-still-works and details statements accept at most 250 and 500 characters respectively.
4. Fields are plain text with no HTML or Markdown interpretation apart from UPDATE-013’s bare HTTPS links.
5. Omitting required fields, exceeding lengths or attaching no component refuses publication without changing state.
6. The next-update time is a commitment to communicate, never a resolution-time estimate.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/auth-adoption/upgrade.test.mjs`. Changed in 1.10.0 with UPDATE-013: a bare https:// URL in any field becomes a link, nothing else is interpreted; RELEASE.json records the change.
**Gap.** Old cited evidence asserts unresolved next-update time required; resolved needs no next-update time; A legacy resolved promise is absent from public renderer fields; A legacy resolved promise is absent from email renderer text. Unasserted: component required; affected audience required; customer impact required; what-still-works optional and bounded; details optional and bounded; HTML literal; Markdown literal; communication commitment not resolution estimate; legacy resolved time omitted by every public and notification surface.

#### UPDATE-002 — One rendering

Core · published · **partial**

**Requirement.** Wording stays consistent across public and delivery surfaces.

**Acceptance.**
1. Page, Atom feed, widget and email retain every populated update field.
2. Each surface omits fields the update does not carry.

**Evidence.** `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs`. Changed in 1.10.0 with UPDATE-013: every surface renders the same links from the shared renderer; RELEASE.json records the change.
**Gap.** Old cited evidence asserts Atom renders affected-audience wording; Atom renders customer-impact wording; Atom renders what-still-works wording; Atom renders details wording. Unasserted: The public root page renders every populated update field; Atom renders the populated next-update commitment; widget renders the populated next-update commitment; The email renders the populated affected-audience wording; The email renders the populated customer-impact wording; The email renders the populated what-still-works wording; The email renders the populated next-update commitment; absent fields omitted everywhere.

#### UPDATE-003 — Sets the lifecycle

Core · published · **done**

**Requirement.** Publication changes lifecycle and releases resolved claims together.

**Acceptance.**
1. Every publication sets the selected lifecycle.
2. Resolved publication records the incident end time.
3. Resolved publication recomputes every attached component under COMP-006.

**Evidence.** `tests/e2e/publishing-contract.test.mjs` (reviewed incident from private template to immutable updates, recovery, report and audited deletion): published Resolved lifecycle, persisted resolution instant and recomputed Operational component state.
**Gap.** None.

#### UPDATE-004 — Preview

Core · published · **partial**

**Requirement.** Before publication the composer previews the customer-facing update.

**Acceptance.**
1. The composer shows the update as the public page renders it.
2. The composer shows the update as the notification email renders it.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** Asserted: public preview customer impact; email preview customer impact. Unasserted in old cited evidence: composer displays the public preview; composer displays the email preview.

#### UPDATE-005 — Drafts

Core · published · **partial**

**Requirement.** Private drafts survive reload without reviving obsolete publication wording.

**Acceptance.**
1. An unpublished update appears on no public surface.
2. The last edit saves within two seconds and reload restores it unchanged.
3. Publication consumes the draft and starts an empty next-update draft with lifecycle prompts.
4. A stale tab cannot resurrect published wording or overwrite a newer acknowledged draft.
5. Draft writes, template application, scheduling and publication require the acknowledged draft version.
6. A fresh empty composer claims no save before native acknowledgement, and Publish needs a complete acknowledged draft.
7. Lost-acknowledgement reconciliation identifies the attempted write and preserves later workflow changes.

**Evidence.** `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts page excludes populated draft; Atom excludes populated draft; widget excludes populated draft; two-second save. Unasserted: Reload independently asserts unchanged audience; Reload independently asserts unchanged impact; Reload independently asserts unchanged what-still-works; Reload independently asserts unchanged lifecycle; After publication the next draft’s other wording fields are independently asserted empty; lifecycle prompts; stale tab cannot revive publication; stale tab cannot overwrite newer draft; draft write requires acknowledged version; template requires acknowledged version; schedule requires acknowledged version; publication requires acknowledged version; fresh draft not falsely saved; Publish requires acknowledged complete draft; attempted write identified; later workflow changes retained.

#### UPDATE-006 — Scheduled publish

Core · published · **partial**

**Requirement.** A scheduled update stays private until its committed publication time.

**Acceptance.**
1. A future-dated update publishes within 240 seconds after its time.
2. Before its time no public surface or notification carries it.
3. Under the owner’s review policy, an unreviewed due update stays a draft and raises a NOTIFY-006 operator notice.

**Evidence.** `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts After its scheduled trigger the specific incident permalink contains the scheduled draft’s unique wording; public privacy before time. Unasserted: 240-second bound; no early notification; review hold stays draft; operator notice for held schedule.

#### UPDATE-007 — Review

Core · published · **partial**

**Requirement.** The owner chooses whether a second operator reviews updates.

**Acceptance.**
1. Under required review, an author’s unreviewed update is refused until a different operator reviews it.
2. The update records reviewer and review time.
3. When review is not required the review policy does not hold publication.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** Asserted: part of the existing workflow. Unasserted in old cited evidence: unreviewed publication refused; reviewer recorded; review time recorded; review-disabled publication succeeds.

#### UPDATE-008 — Atomic publication and recipients

Core · published · **partial** · Cites BASE-OPS-003, BASE-OPS-004

**Requirement.** Publication commits its fixed recipient set before dispatching without holding publish. Its committed success starts PAGE-007’s visibility bound and NOTIFY-002’s delivery bound.

**Acceptance.**
1. The selected channels’ recipients and the update commit together before success is returned.
2. Narrowing selection afterwards preserves committed delivery; unsubscribing suppresses it under SUB-008.
3. Failed publication exposes no update and records no recipients.
4. Dispatch retries the committed set until success without blocking publication.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Asserted: update once; recipients once; no failed recipient. Unasserted in old cited evidence: narrowing preserves delivery; unsubscribe suppresses delivery; failed update not public; retry to success; dispatch does not block.

#### UPDATE-009 — Templates

Core · published · **partial**

**Requirement.** Operators save and apply reusable wording and component choices.

**Acceptance.**
1. A template retains UPDATE-001 fields, attached components with their claimed states, and lifecycle.
2. Applying it fills the composer and stages those choices without publishing.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** Asserted: lifecycle retained; details retained; no publication; not public. Unasserted in old cited evidence: other fields retained; components and claims retained; composer and staged choices.

### Scheduled maintenance

#### MAINT-001 — Distinct from incidents

Core · published · **partial**

**Requirement.** Maintenance has a window, components and its own durable reference.

**Acceptance.**
1. Maintenance records start, end and attached components and appears separately wherever incidents and maintenance share a surface.
2. Its SCH- reference has digits and new references increase independently of incidents and legacy timestamps.
3. Existing references remain unchanged; deletion, restart and failed creation never allow reuse, although failures may leave gaps.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Asserted: independent SCH sequence; legacy reference unchanged; SCH sequence survives restart. Unasserted in old cited evidence: window and attachments retained; separate incident/maintenance display; deleted and failed SCH reference never reused.

#### MAINT-002 — Automatic transitions

Core · published · **partial**

**Requirement.** Automatic maintenance follows its declared window.

**Acceptance.**
1. Scheduled moves to In progress within 240 seconds after start without an operator action.
2. In progress moves to Completed within 240 seconds after end without an operator action.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** Asserted: scheduled event starts; scheduled event completes. Unasserted in old cited evidence: 240-second start bound; 240-second completion bound.

#### MAINT-003 — Component states

Core · published · **partial**

**Requirement.** Maintenance temporarily contributes claims without discarding others.

**Acceptance.**
1. In progress maintenance claims Under maintenance on every attached component.
2. It contributes no claim before starting or after completion.
3. COMP-006 applies throughout, retaining preexisting operator and incident claims after the window.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** Asserted: Under maintenance during window; claim released on completion; no claim before start. Unasserted in old cited evidence: operator claim survives; incident claim survives; aggregate reconciles throughout.

#### MAINT-004 — Overrun

Core · published · **done**

**Requirement.** An overrun stays public until completion or extension.

**Acceptance.**
1. Fifteen minutes after its end, an In progress maintenance shows Running longer than planned beside its original end on the public page.
2. The indication remains until an operator completes it or extends the window.
3. Extension preserves start, changes end and removes the overrun indication.

**Evidence.** `tests/e2e/publishing-contract.test.mjs` (owner schedules, announces, starts, extends and completes maintenance without losing window or calendar history): root and permalink have no overrun before fifteen minutes, retain the original end beside the later warning, clear it on extension and completion, and preserve the start while updating the end.
**Gap.** None.

#### MAINT-005 — Reminders

Core · published · **partial**

**Requirement.** The owner may replace maintenance notice timing.

**Acceptance.**
1. Unless the owner replaces the reminder policy, subscribers are notified at scheduling, twenty-four hours before start, at In progress and at Completed.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts A scheduled maintenance notice record exists; A twenty-four-hour reminder notice record exists. Unasserted: The scheduling notice reaches subscribers; The twenty-four-hour reminder reaches subscribers; start subscriber notification; completion subscriber notification.

#### MAINT-006 — Rescheduling and cancellation

Core · published · **partial**

**Requirement.** Changed and cancelled maintenance tells its already-notified audience.

**Acceptance.**
1. A changed window notifies every subscriber already notified about the maintenance.
2. Cancellation publishes a cancellation notice to those same subscribers.
3. Cancellation removes the upcoming listing within ten seconds and retains the cancelled maintenance in history.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** Asserted: reschedule notice; cancel notice; cancelled record retained. Unasserted in old cited evidence: all previous recipients notified; same previous recipients notified; upcoming removal within ten seconds; public history labelled cancelled.

### Subscribers

#### SUB-001 — Subscribing

Core · published · **partial** · Cites BASE-PUBLIC-001

**Requirement.** Visitors subscribe their own email address through the public page and receive confirmation before incident communication begins.

**Acceptance.**
1. Submitting an email address creates a pending subscription and sends one confirmation to that address within 60 seconds.
2. Repeated submissions give that address at most one confirmation in any 24 hours.
3. Unsubscribing with an emailed link restores the confirmation allowance, so a new subscription sends a fresh confirmation.
4. A pending subscription receives no notification other than its confirmation.
5. The form works with scripting disabled, refuses a cross-site submission and needs no ambient session or form token.

**Evidence.** `tests/e2e/public-contract.test.mjs`, `tests/e2e/delivery-contract.test.mjs`
**Gap.** Old cited evidence asserts pending subscription; one captured confirmation envelope; captured envelope contains its confirmation link; concurrent confirmation reservation. Unasserted: confirmation recipient equals the submitted address; confirmation within 60 seconds; 24-hour expiry of confirmation allowance; unsubscribe restores the allowance immediately; absence of other notifications while pending; cross-site refusal asserted in tests/e2e/subscriber-isolation-helper.mjs outside the old Evidence set; no form token or ambient session requirement.

#### SUB-002 — Confirmation

Core · published · **done**

**Requirement.** Under the subscriber confirmation policy, only following the emailed confirmation link activates the subscription.

**Acceptance.**
1. A submitted subscription remains pending until its confirmation link is followed.
2. Following the confirmation link makes that subscription active.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`
**Gap.** None.

#### SUB-003 — Pending expiry

Core · published · **partial** · Cites BASE-DATA-002

**Requirement.** Unverified pending addresses are retained only while confirmation remains possible. Supersedes `BASE-DATA-002` for pending subscriptions because the submitting visitor may not own the address.

**Acceptance.**
1. An unconfirmed pending subscription and its address are deleted after 72 hours.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/public-contract.test.mjs`
**Gap.** Old cited evidence asserts a very old pending subscriber row is absent after expiry runs. Unasserted: expiry takes effect at the specified 72-hour boundary.

#### SUB-004 — Component selection

Core · published · **partial**

**Requirement.** Subscribers choose the components whose incident and maintenance communication they receive.

**Acceptance.**
1. The subscription form and management page preserve exactly the components ticked; no selection follows all visible components.
2. An incident or maintenance notifies a subscriber only when it claims a state for a selected component.
3. An unnarrowed subscription follows visible components added later, while a narrowed selection remains unchanged.
4. Attaching a component to an unresolved incident sends one latest-update catch-up to each eligible subscriber who has never received that incident; subsequent updates then arrive normally.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`
**Gap.** Old cited evidence asserts initial selected components; management selected or all; incident recipient selection; newly eligible catch-up recipient. Unasserted: maintenance recipient selection; all-components subscriber follows new components; narrowed selection unchanged by component creation.

#### SUB-005 — Cookieless subscriber tokens

Core · published · **partial** · Cites BASE-PUBLIC-001

**Requirement.** Emailed subscriber links carry opaque authority for one subscription, never a general login. Token pages allow token transmission on arrival required by one-click unsubscribe; this supersedes `BASE-PUBLIC-001` only for those token-addressed paths. The technical profile is specified in [Delivery details](docs/contract/delivery-details.md).

**Acceptance.**
1. A public subscriber token addresses one subscription, has at least 128 bits of entropy and grants no unrelated capability.
2. Deactivation or deletion revokes that subscription's tokens.
3. Token-page responses suppress referrers and indexing.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`
**Gap.** Old cited evidence asserts referrer suppression; indexing suppression. Unasserted: one-subscription scope and no unrelated capability; at least 128 bits of entropy; a previously usable management token is refused after unsubscribe; deletion revokes every token.

#### SUB-006 — One-click unsubscribe

Core · published · **partial** · Cites BASE-ACCESS-003, BASE-PUBLIC-001 · Register R-40

**Requirement.** Every notification offers standards-compatible one-click unsubscribe. Its public rate allowance belongs to the subscriber token, so one mailbox provider cannot exhaust another subscriber's allowance. The technical profile is specified in [Delivery details](docs/contract/delivery-details.md).

**Acceptance.**
1. Notification email contains the mail and web unsubscribe values, the one-click declaration and a visible unsubscribe link.
2. Both supported form encodings deactivate that subscription with a successful empty response, no redirect and no further interaction.
3. The message signature covers both unsubscribe headers.
4. One token's rate allowance never consumes another token's allowance, including requests from one mailbox provider.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/rer-mail.test.mjs`
**Gap.** Old cited evidence asserts mail unsubscribe value is present; web unsubscribe value is present; one-click declaration; URL-encoded deactivation. Unasserted: visible unsubscribe link in notification body; multipart form deactivation; DKIM coverage of both unsubscribe headers; per-token allowance independence.

#### SUB-007 — Managing a subscription

Core · published · **done**

**Requirement.** The emailed management link lets a subscriber manage its own channel and component selection without an operator session.

**Acceptance.**
1. Opening the management link shows the subscription channel and saved component selection.
2. The subscriber can change its component selection and unsubscribe there without a session.

**Evidence.** `tests/e2e/delivery-contract.test.mjs` (Subscriber consent, selected publication, channel delivery, export and erasure), loading `tests/e2e/helpers/subscriber-preferences-flow.mjs` (subscriberPreferencesFlow): the captured emailed management link opens in a script-free browser without an operator session, visibly identifies the email channel and distinguishes saved selected and unselected components. Native form submission changes component selection and a fresh read retains it. The same page unsubscribes the subscriber; the former management link refuses reads and replayed writes, leaving the entire subscription unchanged.
**Gap.** None.

#### SUB-008 — Unsubscribe integrity

Core · published · **done**

**Requirement.** Opt-out takes effect for queued communication as well as future publications.

**Acceptance.**
1. A deactivated subscription receives no later notification.
2. A notification committed before deactivation but dispatched afterwards sends nothing and records suppression.

**Evidence.** `tests/e2e/delivery-contract.test.mjs` (Subscriber consent, selected publication, channel delivery, export and erasure), loading `tests/e2e/helpers/subscriber-add-flow.mjs` (subscriberAddFlow) and `tests/e2e/helpers/subscriber-queued-unsubscribe.mjs` (subscriberQueuedUnsubscribe): an active recipient is committed before public one-click unsubscribe; the same queued delivery becomes suppressed through Queue redelivery with zero later sends.
**Gap.** None.

#### SUB-009 — Webhook subscribers

Core · published · **partial** · Cites BASE-OPS-003, BASE-INPUT-002 · Rules D-2

**Requirement.** A webhook destination and contact address receive complete, authenticated published events. The contact address exists for destination-deactivation notices. Slack incoming-webhook destinations receive Slack's message form; all others receive Lamp's form. The technical profile is specified in [Delivery details](docs/contract/delivery-details.md).

**Acceptance.**
1. A destination and contact address create one webhook subscription.
2. Current and retiring signing secrets each verify the same complete event, allowing rotation without a gap.
3. The body includes the incident, every published update and every attached component's previous and new state, without a subscriber address.
4. Only a successful receiver response within 30 seconds counts as delivery; redirects fail.
5. Slack text keeps each bare secure-web URL bracketed with punctuation outside, never a labelled link; rich-text link labels are their URLs and each field reassembles unchanged.
6. Lamp-form update fields equal the published text byte for byte.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`. Lamp-format door: tests/e2e/delivery-contract.test.mjs:631 and tests/e2e/publishing-contract.test.mjs:92. Slack-URL door: tests/e2e/publishing-contract.test.mjs:94-100, called at tests/e2e/publishing-contract.test.mjs:432 within the test at :394. Native controlled receiver; no live Slack acceptance is claimed.
**Gap.** Old cited evidence asserts two active signature values; exact-body signature; incident reference; subscriber address absent. Unasserted: webhook subscription creation read back; both rotation signatures verify; complete update array; complete previous/new component states; 30-second receiver deadline; rich-text URL labels equal their URLs on a nonempty set of link elements; Slack bracket and punctuation asserted in tests/e2e/helpers/update-link-evidence.mjs outside the old Evidence set; all Lamp fields are asserted in tests/e2e/helpers/update-component-flow.mjs outside the old Evidence set.

#### SUB-010 — Failing destinations

Core · published · **partial**

**Requirement.** Destinations with permanent or repeated delivery failures deactivate with a recorded reason and receive no later notification.

**Acceptance.**
1. One hard bounce deactivates the address and records the hard-bounce reason.
2. One spam complaint deactivates the address and records that reason.
3. Five consecutive soft-bounced notifications deactivate the address with that reason.
4. Ten consecutive failed webhook deliveries deactivate the endpoint with that reason and email its contact.
5. A deactivated destination receives no further notification.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`
**Gap.** Old cited evidence asserts hard bounce deactivates the subscriber; hard-bounce reason is recorded; spam complaint deactivates the subscriber; spam-complaint reason is recorded. Unasserted: a fresh notification after the complaint is suppressed; post-deactivation pending webhook backlog sends nothing.

#### SUB-011 — Operator view

Core · published · **partial** · Cites BASE-DATA-003

**Requirement.** Operators inspect all subscribers, their consent state and selected components, including deactivation facts.

**Acceptance.**
1. Every subscriber is reachable, including records beyond the first page.
2. The view shows channel, pending/active/deactivated state, component selection, and deactivation reason and time.
3. Deleting a subscriber erases its email address or endpoint.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`
**Gap.** Old cited evidence asserts the expected 101st fixture subscriber appears on the second page; channel; deactivated state; the operator list preserves the exact selected component identifiers. Unasserted: the complete subscriber identity set reconciles across all pages; pending and active states visible in operator view.

#### SUB-012 — No enumeration

Core · published · **partial**

**Requirement.** The public subscription form does not disclose whether an address is already subscribed.

**Acceptance.**
1. Existing and new addresses receive identical status and body without creating another subscription.
2. An existing address gets one management-only email and no extra message content.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`
**Gap.** Old cited evidence asserts same status; same body; the existing-address email contains its management link; repeated submissions send no second management email per address. Unasserted: duplicate subscription absence; only management content in email.

### Notifications

#### NOTIFY-001 — What notifies subscribers

Core · published · **partial**

**Requirement.** The notification-event policy covers incident and maintenance communication, with NOTIFY-017 adding opted-in component changes.

**Acceptance.**
1. An incident notifies on its first published update, each later update and resolution.
2. Scheduled maintenance notifies according to MAINT-005.
3. A component change outside incident or maintenance notifies nobody unless the subscriber opted into NOTIFY-017.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`
**Gap.** Old cited evidence asserts only the previously described delivered slice. It does not assert: first incident notification; subsequent incident notification; resolution notification; maintenance lifecycle notification events; component change silence or opted-in replacement.

#### NOTIFY-002 — Delivery time

Core · published · **partial** · Cites BASE-MAIL-001

**Requirement.** At the installation's stated subscriber capacity, every eligible update email reaches provider acceptance within five minutes after successful publication.

**Acceptance.**
1. A complete capacity-sized recipient set is accepted within five minutes of successful publication.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`
**Gap.** Old cited evidence asserts 1000 recipient-capture records exist for the event; 1000 attempts carry provider identifiers; 1000 messages reach the capture adapter; five-minute measured bound. Unasserted: every expected eligible recipient has a provider acceptance without a missing recipient hidden by duplicates.

#### NOTIFY-003 — Retry

Core · published · **partial** · Cites BASE-OPS-004, BASE-MAIL-001

**Requirement.** A retryable notification failure gets five retries with exponential backoff over one hour, then a terminal failure against subscriber and update.

**Acceptance.**
1. A retryable failure produces five retries after the first attempt.
2. The retry schedule backs off exponentially across one hour.
3. Exhaustion records failure against the affected subscriber and update.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`
**Gap.** Old cited evidence asserts six total attempts; durable failed outcome; the failure event identifies the expected delivery; the failure event identifies the expected notification event. Unasserted: exponential backoff timing over one hour.

#### NOTIFY-004 — Delivery log, without tracking

Core · published · **partial** · Cites BASE-MAIL-001

**Requirement.** The notification log exposes delivery facts for each recipient and supports channel, outcome and update filtering plus CSV. It adds subscription-communication fields to the Base mail-outcome duty.

**Acceptance.**
1. Each notification records subscriber, channel, update, queue time, outcome and outcome time.
2. Outcomes distinguish queued, delivered, bounced, complained, suppressed and failed.
3. Messages contain no tracking pixel or tracked link.
4. Each channel, outcome and update filter returns matching rows, and the complete CSV matches those filters.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/delivery-contract.test.mjs`
**Gap.** Old cited evidence asserts outcome field; queued outcome; delivered outcome; bounced outcome. Unasserted: subscriber field readback; channel field readback; update field readback; queue time readback; outcome time readback; complained outcome readback; message pixel absence; tracked-link absence; the outcome filter returns all and only matching rows throughout its result set; channel filter reconciliation; update filter reconciliation; all 101 distinct expected destinations occur once and match the full filtered view.

#### NOTIFY-005 — At most once

Core · published · **partial** · Cites BASE-OPS-003 · Rules D-1

**Requirement.** Each published update has at most one notification to a subscriber on each selected channel.

**Acceptance.**
1. Retrying publication or redelivering the queue job never sends that subscriber the update twice on one channel.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/delivery-contract.test.mjs`
**Gap.** Old cited evidence asserts repeated capture leaves one recipient record; repeated capture leaves one dispatcher job; two intended healthy-delivery scenarios produce two healthy-host requests in aggregate. Unasserted: the concurrently dispatched delivery alone produces exactly one request; email queue redelivery never resends.

#### NOTIFY-006 — Operator alerts

Core · published · **partial** · Cites BASE-OPS-004

**Requirement.** Operators receive one email per communication obligation or terminal delivery event.

**Acceptance.**
1. Each next-update-due event sends at most one email.
2. Each overdue incident sends at most one email.
3. Maintenance overrun, a scheduled update held for review, and an alert-created draft incident each send at most one operator email.
4. Terminal notification failure sends at most one operator email.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/update-reminders.test.mjs`
**Gap.** Old cited evidence asserts due email once; overdue email once; one terminal-failure alert queued. It does not assert: maintenance overrun email once; scheduled review hold email once; alert-created draft email once; actual terminal-failure operator email count.

#### NOTIFY-007 — Channels are per update

Core · published · **partial**

**Requirement.** Operators choose subscriber channels independently for each update while every public surface receives it.

**Acceptance.**
1. The selected subscriber channels, including an empty selection, determine the committed recipient set and remain in the delivery log.
2. The public page, Atom feed and widget always receive the update and cannot be deselected.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`
**Gap.** Old cited evidence asserts one stored channel selection is email; empty selection produces no notifications. Unasserted: the complete recipient channel set equals exactly the selected channels; page mandatory publication; Atom mandatory publication; widget mandatory publication.

#### NOTIFY-008 — Who the deployment emails

Core · published · **partial** · Cites BASE-DATA-004, BASE-MAIL-001

**Requirement.** Installation email reaches only operators, pending subscriber confirmations or active subscribers, using the configured sender through the supported mail-sender extension.

**Acceptance.**
1. Only an operator, a pending address for its single confirmation or an active subscriber can receive email.
2. Every notification uses the configured From address through the mail-sender extension.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`
**Gap.** Old cited evidence asserts active subscriber destination; configured From address. It does not assert: operator-only mail authorization; pending single-confirmation restriction.

#### NOTIFY-010 — Mail headers

Core · published · **partial** · Cites BASE-MAIL-001 · Register R-40

**Requirement.** Notification email identifies the page, avoids automatic replies and threads incident updates. Setup and deployment require reachable DKIM and DMARC records for the configured sender; aligned DKIM suffices without SPF on the From domain. The technical profile is specified in [Delivery details](docs/contract/delivery-details.md).

**Acceptance.**
1. List identity, archive and help headers identify the page; the automatic-message declaration avoids vacation replies.
2. Every update after the first names the first email in both threading headers.
3. Setup and deployment refuse a missing reachable configured DKIM key or DMARC policy and name the missing record.
4. Aligned DKIM is accepted without SPF on the From domain.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/rer-mail.test.mjs`
**Gap.** Old cited evidence asserts List-Id is present; List-Archive is present; List-Help is present; page identity. Unasserted: setup missing DKIM refusal; deployment missing DKIM refusal; setup missing DMARC refusal; deployment missing DMARC refusal; missing record named; aligned DKIM without From-domain SPF.

#### NOTIFY-009 — Delivery never blocks publication

Core · published · **partial** · Cites BASE-MAIL-001, BASE-OPS-004

**Requirement.** Delivery failure never withholds a committed public update; its notification set resumes when the failed channel recovers.

**Acceptance.**
1. Publication succeeds despite a failing mail provider, queue or subscriber endpoint.
2. The public page, feed and widget meet PAGE-007 despite the failure.
3. Recovery delivers the original committed notification set under NOTIFY-003.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`
**Gap.** Old cited evidence asserts only the previously described delivered slice. It does not assert: mail provider failure publish; queue failure publish; endpoint failure publish; public page survives delivery failure; feed survives delivery failure; widget survives delivery failure; recovery preserves and delivers committed set.

#### NOTIFY-011 — Slack and Teams channels

Core · published · **partial** · Cites BASE-SECRET-001

**Requirement.** Operators connect Slack and Microsoft Teams publication channels, selecting components; no selection follows all visible components. The technical profile is specified in [Delivery details](docs/contract/delivery-details.md).

**Acceptance.**
1. A Slack or Teams destination is saved with its component selection.
2. The destination URL is stored encrypted and never returned or shown again after saving.
3. Only each provider's documented webhook hosts are accepted.

**Evidence.** `tests/e2e/channels-and-presets.test.mjs`
**Gap.** Old cited evidence asserts the created Slack channel response reports the expected provider host; no URL in list; stored ciphertext; nonprovider host refused. Unasserted: the Slack destination and selected components are persisted; the Teams destination is persisted with all-visible component selection; saved component selections read back; no saved URL on other API responses.

#### NOTIFY-012 — Channel posts

Core · published · **partial** · Cites BASE-OPS-003

**Requirement.** Selected Slack and Teams channels receive one publication for the affected visible components, committed with the incident update.

**Acceptance.**
1. Publishing with chat selected atomically commits one post per following channel.
2. A publication retry or repeated delivery pass never posts twice.
3. A retroactive update posts to no channel.

**Evidence.** `tests/e2e/channels-and-presets.test.mjs`
**Gap.** Old cited evidence asserts one Slack send; one Teams send; unrelated channel silent. It does not assert: atomic update/post commit; publication retry duplicate absence; retroactive publication silence.

### Alert intake

#### INTAKE-001 — Authenticated requests

Core · published · **partial** · Cites BASE-INPUT-001

**Requirement.** A monitoring source accepts only requests authenticated by its configured signing secret or bearer token. Signed requests authenticate the received bytes before parsing. Datadog, Pingdom and Uptime Kuma can use the bearer alternative.

**Acceptance.**
1. Only a valid HMAC-SHA256 over the timestamp and exact received body, with a timestamp within five minutes of the installation clock, is admitted for a signing-secret source.
2. Only the configured bearer token is admitted for a bearer source.
3. An absent, malformed, stale or non-matching credential returns 401 and creates no record.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** The cited HMAC journey asserts signed admission and wrong-signature refusal. It does not assert the five-minute boundary, bearer admission, absent/stale credential cases or unchanged complete records after refusal; intake-byte and preset helpers carrying these assertions are outside this clause’s old Evidence set.

#### INTAKE-002 — Alerts never publish

Core · published · **partial** · Cites BASE-AGENT-006, BASE-AGENT-007

**Requirement.** The source-specific intake policy controls accepted alerts. Under the held intake policy an alert remains a private draft until publication; AUTO-001 carries component-specific alternatives. An agent publication carries external and live classes decided by company policy.

**Acceptance.**
1. Under the held intake policy an accepted alert creates or updates a draft within 30 seconds.
2. That intake changes no public page, feed, widget or other public surface.
3. Publication follows UPDATE-008 and supplies every UPDATE-001 narrative field; an alert payload alone is not a completed narrative.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** The cited journey asserts a private draft and page exclusion. It does not measure the 30-second create/update bound or compare all public surfaces. The class/policy wording carries no promotion.

#### INTAKE-003 — Deduplication

Core · published · **partial** · Cites BASE-OPS-003

**Requirement.** Unresolved alert keys and redelivered requests retain one incident and one set of alert work.

**Acceptance.**
1. Distinct deliveries with the same key attach to the same unresolved incident instead of creating another.
2. Redelivery of an accepted request returns its original status and adds no incident, draft or alert record.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** Equal incident identifiers and accepted replay status are asserted. Complete incident, draft and alert-record inventories are not compared across replay, leaving the absence of all additional records unasserted.

#### INTAKE-004 — Recovery alerts

Core · published · **partial**

**Requirement.** A recovery alert adds evidence against its matching alert without publishing a resolution.

**Acceptance.**
1. A recovered event records its recovery time against the matching alert key.
2. Recovery changes no public surface and no incident lifecycle state.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** Unchanged lifecycle and zero updates are asserted. Recovery timestamp readback and complete public-artifact equality are not asserted.

#### INTAKE-005 — Payload mapping

Core · published · **partial** · Cites BASE-INPUT-001

**Requirement.** A generic source maps its own payload fields to its alert key, title and firing/recovered state, with rejected mapping reasons visible against the source.

**Acceptance.**
1. Saving source-specific JSON paths makes key, title and state interpretation follow those fields.
2. A payload missing its configured deduplication-key path returns 400 and is recorded against the source with an operator-visible reason.

**Evidence.** `tests/e2e/public-contract.test.mjs`, `tests/e2e/incident-brief.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts Configured key path controls acceptance; Configured generic firing state is read back; Missing key returns 400; Visible rejected mapping reason. Unasserted: Configured title read back; Configured generic recovered state is read back.

#### INTAKE-006 — Monitor presets

Core · published · **partial** · Cites BASE-INPUT-001

**Requirement.** Datadog, UptimeRobot, Better Stack and Pingdom presets accept their documented alert payloads and map each source to one component. Providers can use the bearer header or token-address form when unable to send a header.

**Acceptance.**
1. Each documented firing payload creates or updates a private draft attached to its mapped component.
2. The generated credential is shown once and omitted from subsequent listings.
3. Missing or wrong credentials return 401 and record nothing.
4. Another provider’s payload returns 400 and is recorded as invalid against the source.
5. Firing alerts have no published update and change no public surface.

**Evidence.** `tests/e2e/channels-and-presets.test.mjs`
**Gap.** All four mapped private drafts, token redaction, credential status refusals, invalid receipts and public-status exclusion are asserted. Complete record inventories after authentication refusal and every public representation after intake are not compared.

#### INTAKE-007 — Preset recovery

Core · published · **partial**

**Requirement.** Preset recovery closes only unpublished drafts. Published incidents retain their lifecycle and receive evidence under INTAKE-004.

**Acceptance.**
1. Each preset’s recovery resolves its matching never-published draft without publishing any update or public trace.
2. A published incident retains its lifecycle and records the recovery evidence.

**Evidence.** `tests/e2e/channels-and-presets.test.mjs`
**Gap.** Private draft resolution, zero updates and published lifecycle are asserted. Public-artifact absence after recovery and the published recovery record are not read back.

### Drafting

#### DRAFT-001 — Suggested update

Core · published · **partial** · Cites BASE-AGENT-006, BASE-AGENT-007

**Requirement.** A configured model supplies editable update suggestions from DRAFT-004’s brief. Suggestion generation is standard work; any agent publication or next-update commitment carries its computed external, live or commitment classes under company policy.

**Acceptance.**
1. Requesting a suggestion fills only nonempty suggested text fields, leaves empty results as previously written, and every field remains editable.
2. Each filled field cites only known brief references; an open question or unknown reference is removed and unsourced text is marked assistant-written with no source.
3. Each field’s sources appear beside it and open the corresponding brief item.
4. The suggestion proposes neither lifecycle nor next-update time.
5. Generation leaves saved incident, public page, feed and widget unchanged and unpublished.

**Evidence.** `tests/e2e/incident-brief.test.mjs`
**Gap.** Old cited evidence asserts Known references retained; Unknown and question references removed; Suggestion result has no lifecycle field; Suggestion result has no next-update field. Unasserted: Nonempty fields filled and empty results preserved; Every field editable; Unsourced text visibly marked; Sources beside fields open brief.

#### DRAFT-002 — Inputs

Core · published · **partial** · Cites BASE-DATA-004

**Requirement.** Suggestion requests use the same visible incident brief as the operator: accepted alerts, published updates, attached public components and their claims, plus configured tone instructions.

**Acceptance.**
1. The provider receives the DRAFT-004 brief unchanged.
2. Internal notes and internal components are absent from the provider request even when present on the incident.
3. Configured tone instructions are included with the request.

**Evidence.** `tests/e2e/incident-brief.test.mjs`, `tests/e2e/publishing-browser.test.mjs`
**Gap.** The exact brief and exclusion of populated internal notes/components are asserted. The configured tone instructions are not read back from the provider request in the old Evidence set.

#### DRAFT-004 — Incident brief

Core · published · **partial**

**Requirement.** The incident page, including alert-created drafts, shows a model-free brief of facts and computed open questions. A collapsed view shows exactly what the suggestion would send.

**Acceptance.**
1. Known facts list every accepted alert with time and source, every published update and every attached public component with its claimed state.
2. Questions identify no attached component, missing audience or customer-impact wording, an unresolved draft without next-update time, and an alert-raised draft never published.
3. Questions also identify monitor recovery while the latest published lifecycle is unresolved, and a passed commitment without a newer update.
4. Every fact and question has a stable reference.
5. The brief is built without a model from the DRAFT-002 inputs alone.
6. The operator page’s collapsed view equals the suggestion input.

**Evidence.** `tests/e2e/incident-brief.test.mjs`
**Gap.** Old cited evidence asserts Alert count; Alert source record.; Alert time; The brief lists exactly the attached public component names. Unasserted: No-component question; Building brief sends no model request; Collapsed page matches model input.

#### DRAFT-003 — Absent or failing provider

Core · published · **partial** · Cites BASE-OPS-004

**Requirement.** AI provider failure remains separate from normal publication. Adapter details are in [intake details](docs/contract/intake-details.md).

**Acceptance.**
1. Without a configured provider, no suggestion control appears and no AI request is made.
2. A provider failure or lack of response within 20 seconds produces a visible composer error.
3. All other publication paths remain usable after provider failure or timeout.

**Evidence.** `tests/e2e/incident-brief.test.mjs`, `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** The old Evidence asserts no-provider suppression, visible failure, timeout error before 21 seconds and ordinary publication after both failures. It does not assert the exact 20-second bound or every other publication path. Agent-policy parity remains a new SURFACE obligation; these product-source statuses are not promoted.

### Operators

#### TEAM-001 — Equal operators

Core · published · **done** · Cites BASE-ACCESS-004

**Requirement.** Every operator has one role and server-enforced access under TEAM-004. Review under UPDATE-007 applies in addition to publish permissions.

**Acceptance.**
1. Every active operator has the product privileges assigned to their TEAM-004 role.
2. Incident, maintenance, component and subscriber operations enforce that role on the server.
3. UPDATE-007 review remains additional to role-based publish permissions.

**Evidence.** `tests/auth-adoption/upgrade.test.mjs` (ACCESS-001 ACCESS-002 TEAM-001 TEAM-002 upgrade preserves identities, history and subscriber authority and destroys legacy credentials); `tests/e2e/publishing-browser.test.mjs` (TEAM-001 TEAM-004 TEAM-007 — operator role changes, server permissions and audit), loading `tests/e2e/helpers/operator-roles-flow.mjs` (operatorRolesFlow), proves server-enforced access under TEAM-004.
**Gap.** None.

#### TEAM-002 — Management

Core · published · **partial** · Cites BASE-SIGNIN-001

**Requirement.** Settings manages operator invitations and removal. The operator established during setup retains the self-removal protection.

**Acceptance.**
1. A Settings invitation admits the invited operator into Lamp.
2. Settings can remove an operator.
3. Only the setup operator can remove their own protected setup identity.

**Evidence.** `tests/auth-adoption/upgrade.test.mjs`, `tests/e2e/delivery-contract.test.mjs`
**Gap.** Old cited evidence asserts Native operator-removal route durably deactivates the identity; Native operator-removal route anonymizes the email; Another owner cannot revoke setup owner; Self-removal succeeds. Unasserted: Settings invitation outcome; Settings removal is completed through the browser; Other owner cannot delete setup owner while still active.

#### TEAM-003 — Attribution

Core · published · **partial** · Cites BASE-OPS-005, BASE-AUDIT-001

**Requirement.** Lamp’s publication, state, maintenance, correction and subscriber-deletion records expose the acting operator privately.

**Acceptance.**
1. A published update, component state change, maintenance change, history correction and subscriber deletion each records the operator who acted.
2. The acting operator’s name appears in the operator app and no public surface.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`
**Gap.** The old Evidence asserts subscriber-deletion audit attribution. It does not assert the listed publication, component, maintenance and correction actors, private display names or their absence from public representations. Assertions in other files cannot be added to carried-done Evidence in this rewrite.

#### TEAM-004 — Roles

Core · published · **done** · Cites BASE-ROLE-001, BASE-AUDIT-001, BASE-OPS-005

**Requirement.** Lamp defines Owner/Admin, Communicator, Responder and Viewer product privileges and keeps its last Owner recoverable. This replaces TEAM-001’s common owner role; review under UPDATE-007 remains additional.

**Acceptance.**
1. Owners and Admins manage settings, team, integrations, pages and billing-relevant providers; Communicators publish, resolve, schedule maintenance and manage subscribers.
2. Responders draft, write internal notes and attach components without publish rights; Viewers only read, including private pages.
3. A Responder’s publish is refused while a Communicator publishes that same draft, and a Viewer cannot change Settings.
4. The setup operator is an Owner and the last Owner cannot be demoted or removed.
5. Every role refusal has an audit record naming operator, requested action and time; role changes appear in the audit view with actor and time.
6. Only Owners and Admins can read the audit log; a Communicator is refused.

**Evidence.** `tests/e2e/publishing-browser.test.mjs` (TEAM-001 TEAM-004 TEAM-007 — operator role changes, server permissions and audit), loading `tests/e2e/helpers/operator-roles-flow.mjs` (operatorRolesFlow), proves Responder publish and schedule refusal, Communicator publication of the same saved draft and maintenance scheduling, Viewer settings and draft refusal, denied-route actor and time, role-change actor and time in the Owner and Admin audit view, Communicator JSON and CSV audit refusal and native auth escalation refusal. The same registration loads `tests/e2e/helpers/operator-roles-browser-flow.mjs` (operatorRolesBrowserFlow), proving Settings role selection, autosave and reload at 1440 and 390. `tests/e2e/publishing-contract.test.mjs` (linked operators run a whole private incident draft, preview and explicit publication through signed Slack and Teams), loading `tests/chat-desk/roles.mjs` (chatRoleFlow), proves signed Slack and Teams deny Responder publication and Viewer creation, retire previews across demotion and regrant and allow fresh Communicator publication. Its reviewed incident journey preserves independent review through real invited author/reviewer identities. `tests/e2e/delivery-contract.test.mjs` (Subscriber consent, selected publication, channel delivery, export and erasure), loading `tests/e2e/helpers/subscriber-csv-flow.mjs` (subscriberCsvFlow), proves Communicator subscriber management and reporting and native Member admission as a Viewer with owner-only batch-custody refusal and audit. `tests/e2e/helpers/subscriber-add-flow.mjs` proves attributed denial without changing business or prior audit rows. `tests/auth-adoption/upgrade.test.mjs` (ACCESS-001 ACCESS-002 TEAM-001 TEAM-002 upgrade preserves identities, history and subscriber authority and destroys legacy credentials) proves existing Owner identities, erased-session refusal and last-Owner removal/demotion refusal. `tests/auth-adoption/portability.test.mjs`, loading `tests/auth-adoption/role-portability.mjs` (restoredRole), preserves native role metadata without restored sessions or manager authority.
**Gap.** None.

### History and reports

#### HIST-001 — Public history

Core · published · **partial**

**Requirement.** Public history lists resolved incidents and completed maintenance for the last twelve months, grouped by month.

**Acceptance.**
1. Both kinds of completed record appear in their month and older records stay outside the twelve-month index.
2. Each record shows its start, end, duration, affected components and every published update.

**Evidence.** `tests/e2e/public-contract.test.mjs`
**Gap.** Old cited evidence asserts Resolved incident listed; Completed maintenance listed; Older record excluded; The public incident displays the expected elapsed duration. Unasserted: Month grouping asserted; The public history displays the incident’s opening instant; Maintenance start/end/duration; Every published update included.

#### HIST-002 — Post-incident report

Core · published · **partial**

**Requirement.** An operator attaches one report to a resolved incident with summary, timeline, cause and remediation, then publishes it to customers.

**Acceptance.**
1. The one report retains all four saved fields on that resolved incident.
2. Publication appears on its public incident page within ten seconds.
3. Subscribers are notified only on the channels selected for the report, using NOTIFY-007’s channel selection.

**Evidence.** `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts The saved report retains summary; The saved report retains timeline; The saved report retains cause; The saved report retains remediation. Unasserted: Ten-second bound; Selected report channels and omitted channels.

#### HIST-003 — Report due

Core · published · **partial**

**Requirement.** A sufficiently severe resolved incident without a report becomes visibly report-due under the replaceable report-due policy.

**Acceptance.**
1. Seven days after an incident that claimed Partially unavailable or Major outage resolves without a report, the operator app marks it as owing a report.

**Evidence.** `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts A representative Major-outage incident is listed as report-due after eight days; The severity rule is represented by another Major-outage report-due case. Unasserted: The operator report-due listing is asserted at the seven-day boundary.

#### HIST-004 — Export contents

Core · published · **partial** · Cites BASE-DATA-001

**Requirement.** Lamp’s export carries the complete status-page record graph and original uploaded images; Base supplies restore and equivalent re-export duties.

**Acceptance.**
1. The JSON includes every incident and update, component and its state history, maintenance and notices, subscriber channel/state, delivery record and post-incident report.
2. The JSON includes every setting and audit entry.
3. Every uploaded image is retained as its original bytes.

**Evidence.** `tests/auth-adoption/portability.test.mjs`
**Gap.** Old cited evidence asserts The exported incident table is populated; The exported update table is populated; The exported component table is populated; The exported component state-history table is populated. Unasserted: Every source incident record is present in the export; Every source update record is present in the export; Every source component record is present in the export; Every source component state-history record is present in the export; Every source maintenance record is present in the export; Every source subscriber record is present in the export; Every exported subscriber retains its expected source channel; Every exported subscriber retains its expected source state; Every source delivery record is present in the export; Every source post-incident report record is present in the export; The archive contains the full source entity graph; Every source setting is present with its expected source value; Every source audit entry is present with its complete source contents.

### Operator setup and recovery

#### SETUP-001 — Setup readiness

Core · published · **partial** · Cites BASE-MAIL-001

**Requirement.** Setup asks the owner nothing Lamp can do itself. Overview reports the real public page and subscription checks, with an address-specific explanation and action when a check fails.

**Acceptance.**
1. Every change republishes the public page; Lamp checks that rendered page and its real subscription form after publication and on each minute check.
2. Changing the hosted sender checks its provider authentication, and the check repeats daily.
3. Overview shows the public address, publication time and page/form check times; Review page opens the preview and its checks, and Change address opens Settings.
4. A failed check makes the line amber with a short reason and one action, and results remain attached to the address actually checked.
5. The deployment address is the public address unless the owner chooses an optional custom domain.
6. Local development suppresses outgoing mail, has no captured-mail inbox and gives the owner one-click entry without email.
7. Publishing to an active subscriber locally records a suppressed delivery visible in Notifications without representing it as provider acceptance.
8. The local sender reads as email off, and public reading remains database-free.

**Evidence.** `tests/e2e/publishing-browser.test.mjs`
**Gap.** Old cited evidence asserts Form check is at or after publication; Overview shows the public address; Publication time is present; Checked page/form wording is visible. Unasserted: Lamp actually reads the rendered public page after publication; Lamp actually inspects the rendered subscription form after publication; Every change republishes; Each minute scheduled check repeats; Changing the hosted sender authenticates against its provider; Sender check repeats daily; Page/form check times are displayed; Review page opens the preview and checks; Change address opens Settings; Failure has one corrective action; Results belong to the address actually checked after address changes; A custom domain is optional; Local outgoing mail is suppressed; No captured-mail inbox exists; Automatic one-click local owner entry needs no email; A subscriber publication records a suppressed outcome; Suppressed outcome is visible in Notifications; Suppressed outcome is not provider acknowledgement; Public reading makes no database query.

#### SETUP-002 — First-run setup

Core · published · **partial** · Cites BASE-INPUT-001

**Requirement.** First-run setup begins with the owner's website and lets them edit what the site supplied before confirming the installed page. The original setup decisions are recorded in RULINGS.md.

**Acceptance.**
1. Every operator document sends a signed-in owner with no saved first-run completion to setup; a signed-out setup visitor signs in and returns there.
2. Lamp reads the public website once without running scripts, refusing private and loopback addresses at every redirect, and fills only observed page name, tagline, PNG mark, accent and navigation components, plus the browser time zone.
3. A linked Statuspage, Instatus or Better Stack page, or the site's status subdomain, supplies its own components and groups instead of navigation guesses, labeled with their source.
4. Bring its incident history too starts unselected; when selected it imports only resolved incidents and their updates at original times, silently through Move in, without active incidents, maintenance or subscribers.
5. A status feed with no components changes none; an unreadable site or omitted website leaves editable plain defaults with one calm explanation.
6. Confirming stores the edited settings, PNG mark and components and durably marks setup complete; all remain editable in Settings.
7. After completion setup opens the app; migration marks installations with a pre-existing operator complete, and rerunning setup never clears that completion.

**Evidence.** `tests/e2e/auth-adoption-journey.test.mjs`, `tests/e2e/website-onboarding.test.mjs`
**Gap.** Old cited evidence asserts No website script request occurs; Reload makes no second site read; Observed page name is stored; Observed tagline is stored. Unasserted: Every operator document gates incomplete first run; Signed-out setup returns through sign-in to setup; Every redirect refuses private/loopback destinations; Instatus and Better Stack linked/subdomain source selection; History imports no maintenance; History imports no subscriber; Omitted website leaves editable plain defaults; A status feed with no components changes none; Completion durably persists; All settings remain editable after completion; Every pre-existing operator installation is migration-complete; Completed setup redirects to app.

#### ACCESS-001 — Owner-terminal sign-in

Core · published · **partial** · Cites BASE-ACCESS-001, BASE-ACCESS-002, BASE-SECRET-001

**Requirement.** An owner with installation database authority can issue a one-use terminal sign-in link for an existing active operator without creating another account. Command details are documented in [terminal access](docs/contract/operations-details.md).

**Acceptance.**
1. Issuing a terminal link requires the installation's session secret from the command environment and refuses a missing secret by name.
2. The issued link uses the native hashed twenty-minute single-use flow, prints its raw value exactly once and records sign-in link created from the command line.
3. Issuance creates neither an operator nor a session; consuming the link creates the Base session.
4. Unknown, deactivated and erased operators receive the same refusal.

**Evidence.** `tests/auth-adoption/dependencies.test.mjs`, `tests/auth-adoption/portability.test.mjs`, `tests/auth-adoption/upgrade.test.mjs`
**Gap.** The old cited evidence proves provider linking, identity upgrade and archive continuity, but contains no terminal-link issuance, one-time stdout, missing-secret, expiry or actor-refusal assertions. The relevant terminal-link browser assertions are in tests/e2e/publishing-browser.test.mjs, outside this clause's old Evidence set. Unasserted outcomes: The command reads the session secret only from its environment; Missing secret is refused by name; Hashed twenty-minute link; Single-use consumption; Exactly one stdout raw-link copy; Terminal-link creation audit event; No account is created by issuance; No session is created by issuance; Consumption creates the Base session; Unknown operator gets the common refusal; Deactivated operator gets the common refusal; Erased operator gets the common refusal.

#### ACCESS-002 — Optional identity-provider sign-in

Core · published · **partial** · From ACCESS-001 · Cites BASE-SIGNIN-001 · Register R-80, R-81, R-82

**Requirement.** The installation can add optional OpenID Connect sign-in through Auth, Google, Microsoft or Okta while keeping email magic links available. This replaces the earlier SSO exclusion; SCIM and role synchronization are separate target work.

**Acceptance.**
1. The optional provider is unused until the owner links it and enables sign-in.
2. Auth, Google, Microsoft and Okta sign-in can be linked while native email access remains usable.

**Evidence.** `tests/auth-adoption/dependencies.test.mjs`, `tests/auth-adoption/portability.test.mjs`, `tests/auth-adoption/upgrade.test.mjs`
**Gap.** The cited dependency journey asserts optional provider discovery, linked/enabled state, provider redirect and retained email access against one standards fixture. It does not complete sign-in for the full named provider set. Unasserted outcomes: Auth standards sign-in completes; Google standards sign-in completes; Microsoft standards sign-in completes; Okta standards sign-in completes.

### Moving in

#### MOVE-001 — Dry run first

Core · published · **partial** · Cites BASE-SECRET-001

**Requirement.** Move in previews a switch from Statuspage, Better Stack, Instatus or Sorry before writing Lamp records, and applies only the exact source and page state the owner reviewed.

**Acceptance.**
1. The owner can supply a source API key and page identity or saved responses; source credentials are read once from the source's fixed origin and never stored.
2. The dry run counts every component, group, incident and its updates, maintenance window and subscriber as imported, changed, skipped or refused, with reasons, and writes no record.
3. Changing either the source or Lamp page after review refuses application and requires a fresh dry run.
4. A dry run names each excess subscriber over a SUB-020 channel capacity and refuses excess rows; an over-limit apply writes nothing until a narrowed review fits.

**Evidence.** `tests/e2e/statuspage-import.test.mjs`, `tests/e2e/cutover-browser.test.mjs`, `tests/e2e/cutover-browser.test.mjs`
**Gap.** Old cited evidence asserts Dry run leaves components unwritten; Changed source refuses apply; Changed target refuses apply and names the stale review; Stale-target refusal leaves no import job. Unasserted: Each named provider accepts API-key and saved-response input; Source credential is read once from fixed source origin; Source credential is never stored; Dry run counts every source category before application; Dry run leaves every other table unwritten; Each imported/changed/skipped/refused item has a named reason; Each channel capacity excess is named; Excess subscribers are refused during dry run; An over-limit apply writes nothing.

#### MOVE-002 — Retroactive and silent

Core · published · **partial**

**Requirement.** Imported incident and maintenance history is silent and preserves its original timing rather than replaying publication.

**Acceptance.**
1. Each incident update keeps its original publication time, and imported component state history derives from those times under INCIDENT-009.
2. Past maintenance is completed; import creates no lifecycle maintenance notice and queues no incident or maintenance notification.
3. Preview, apply, resume, job reads and Cutover checks send no mail.
4. Imported email subscribers remain pending for the separate invitation action.

**Evidence.** `tests/e2e/statuspage-import.test.mjs`, `tests/e2e/statuspage-import.test.mjs`, `tests/e2e/sorry-import.test.mjs`
**Gap.** Old cited evidence asserts Sorry incident update timestamps equal source times; Past Sorry maintenance is completed; Imported Better Stack maintenance has no native notice; Import queues no notification delivery. Unasserted: Complete imported component history derives from original update times; Concurrent repeated applies send no mail; Preview sends no mail; Every resume sends no mail; Cutover checks send no mail; Each imported email subscriber is pending.

#### MOVE-013 — Explicit imported invitations

Core · published · **partial** · From MOVE-002 · Cites BASE-MAIL-001

**Requirement.** The owner explicitly invites eligible imported email subscribers, without replaying past incidents or extending their original confirmation deadline.

**Acceptance.**
1. Only the signed-in owner's explicit invitation action sends a confirmation, with no past incident content.
2. Repeated or concurrent invitation batches hand each eligible address to transport at most once.
3. Statuspage, Better Stack and Instatus invitations expire seventy-two hours from import review even when sending is delayed; expired subscribers cannot be invited and SUB-003 removes unconfirmed addresses.
4. A proven failure before submission can be retried; an interrupted or uncertain submitted attempt remains claimed and is not automatically resubmitted.

**Evidence.** `tests/e2e/statuspage-import.test.mjs`, `tests/e2e/statuspage-import.test.mjs`, `tests/e2e/sorry-import.test.mjs`
**Gap.** Old cited evidence asserts Signed-out invitation action is refused; Concurrent and repeated batches produce exactly 57 transport messages; Those 57 transport messages have 57 distinct recipients; All 57 transport messages carry distinct idempotency identities. Unasserted: Invitation contains confirmation but no past incident text; That message is proved to exclude the expired recipient; Instatus-specific original deadline and expiry.

#### MOVE-003 — One import per source

Core · published · **partial** · Cites BASE-OPS-003

**Requirement.** Repeating an imported source never imports its already-owned records again, including across source imports.

**Acceptance.**
1. Repeating the same source reports already imported, preserves record counts and public aliases, and creates no notification work.
2. A record already imported is not imported again from another source.

**Evidence.** `tests/e2e/statuspage-import.test.mjs`
**Gap.** Old cited evidence asserts Repeated source reports already imported; Repeated source preserves component count; Repeated source preserves component-group count; Repeated source preserves incident count. Unasserted: Repeated source leaves every existing record content unchanged; Repeated source creates no other notification work; Cross-source imports preserve global record identity.

#### MOVE-004 — Undo

Core · published · **partial**

**Requirement.** Undo removes unchanged imported records, retains edits and their dependencies, and explains each retained record without sending notifications.

**Acceptance.**
1. Undo removes every unchanged record created by the import.
2. A record an operator or subscriber changed, and every record it still needs, survives undo with a named explanation.
3. Undo sends no notification.

**Evidence.** `tests/e2e/sorry-import.test.mjs`, `tests/e2e/statuspage-import.test.mjs`
**Gap.** Old cited evidence asserts Untouched Sorry undo returns the component count to baseline; Untouched Sorry undo returns the component-group count to baseline; Untouched Sorry undo returns the incident count to baseline; Untouched Sorry undo returns the maintenance count to baseline. Unasserted: Untouched undo removes every other imported record kind; Every required dependent component survives undo; Every required dependent group identity survives undo; Undo names the specific retained incident and its explanation; Undo names the specific retained maintenance and its explanation; Undo creates no outbound notification work.

#### MOVE-005 — Old public addresses

Core · published · **partial**

**Requirement.** The moved public hostname keeps safe imported incident, maintenance and feed addresses working from the same public snapshot. Source-specific address rules are documented in [import continuity](docs/contract/operations-details.md).

**Acceptance.**
1. An imported incident, maintenance or supplied shortlink permanently redirects on the public host to that surviving Lamp record; maintenance has a permanent page.
2. Sorry numeric and supplied notice paths reach the corresponding record, and its notice/history/month listings redirect to Lamp history while the import remains.
3. Statuspage and Instatus history Atom addresses and Better Stack's source Atom address serve Lamp's feed, including an import with no incident history, until complete undo removes the import.
4. Redirects and feeds use the page's versioned snapshot with no database query; reapply creates no duplicate alias, and conditional undo removes only aliases for removed records.
5. Unsafe addresses, native-route collisions and conflicting destinations are named and refused on new imports; a retained old source names unusable aliases without withholding the snapshot.
6. Missing shortlinks are not invented, source-owned shortlink hosts remain outside Lamp control, and Better Stack report paths remain unavailable unless an unchanged saved source webhook supplies an exact matching shortlink.
7. Better Stack maintenance messages remain historical updates and create no native lifecycle notice or replayed notification.

**Evidence.** `tests/e2e/sorry-import.test.mjs`, `tests/e2e/statuspage-import.test.mjs`
**Gap.** Old cited evidence asserts Public imported addresses permanently redirect to their target; Native record page contains imported title; Aliases are absent on operator host; Sorry notice redirects to matching incident. Unasserted: Instatus source Atom serves native feed; Better Stack source Atom serves native feed; Feed aliases exist with no incident history; Complete undo removes feed alias; Aliases and feeds make no database query; The refusal names the rejected address itself; Every native-route collision is named/refused; Retained legacy unusable aliases warn without suppressing snapshot; Missing shortlinks are never fabricated; A source-owned hostname is outside Lamp control; Better Stack reports get aliases only from exact unchanged matching webhook shortlinks; Better Stack maintenance messages retain original historical updates; Better Stack history creates no lifecycle notice; Better Stack history creates no replayed notification.

#### MOVE-006 — Cutover preview

Core · published · **partial**

**Requirement.** Cutover previews old-to-new addresses and reader limits before and after import, and checks the public addresses the owner selected without claiming DNS or inbox proof.

**Acceptance.**
1. The dry run and saved import show up to twenty-five old incident/maintenance addresses, proposed or surviving permalinks, unavailable addresses and source-host limits.
2. The preview lists source feeds, unsupported JSON/RSS/widget readers and eligible invitations with their original expiry deadline.
3. An Opens check follows redirects without credentials and verifies both the final native address and successful HTML; failures remain visible.
4. The ordered guide covers import, preview, explicit invitations, hostnames/custom domains, rechecking and retaining the source through the confirmation window.

**Evidence.** `tests/e2e/statuspage-import.test.mjs`, `tests/e2e/cutover-browser.test.mjs`, `tests/e2e/sorry-import.test.mjs`
**Gap.** Old cited evidence asserts Nonempty cutover rows have native targets; The large preview returns at most 25 rows; Its reported total exceeds the displayed row count; Eligible imported invitation count is complete. Unasserted: Its total equals the complete source address count; A nonempty large preview has an address in every row; A nonempty large preview has a source path in every row; A nonempty large preview has a native target in every row; Unavailable addresses are displayed; Source-host limits are displayed; Each source feed answer is displayed; JSON reader limitation is displayed; RSS reader limitation is displayed; Widget reader limitation is displayed; Original expiry deadline is displayed in Cutover; Opens requests omit credentials; Opens validates final native address; Opens validates successful HTML; Unreachable checks remain visibly failed; Guide orders import before preview; Guide orders explicit invitations and hostname instructions; Guide includes custom-domain steps; Guide includes rechecking; Guide retains source through confirmation window.

### Public page — target

#### PAGE-015 — Served independently of what it reports

Core · target · **partial**

**Requirement.** The buyer’s custom domain serves every public representation with an automatically provisioned certificate. The formats and configuration details are in [Public status mechanisms](docs/contract/public-details.md).

**Acceptance.**
1. The owner adds a hostname and receives the exact DNS record and certificate state.
2. The page, feeds, widget, badges and public API work on that hostname with automatically issued TLS.

**Evidence.** `src/core/app/host-dispatch.ts`, `src/core/features/page-settings/service.ts`, `tests/e2e/public-contract.test.mjs`
**Gap.** Configured hostname and isolated public routing are delivered; custom-hostname provisioning, certificate issuance and DNS-record guidance are absent.

#### PAGE-022 — Secondary snapshot mirror

Core · target · **missing** · From PAGE-015 · Cites BASE-OPS-004

**Requirement.** Each published generation is mirrored to the owner’s chosen secondary so its read-only content can survive the primary. The formats and configuration details are in [Public status mechanisms](docs/contract/public-details.md).

**Acceptance.**
1. The owner can choose AWS S3 with CloudFront and ACM, Backblaze B2 with Bunny.net or Fastly, or a second Cloudflare account; setup states which Cloudflare failures the latter covers.
2. The secondary contains every generation at the primary’s public paths, labeled Last known state with its generation instant.
3. Falling more than two generations or five minutes behind is visible in AUTO-003 and the operator failure view; a failed mirror write is shown as failed on Overview.

**Evidence.** `src/core/app/host-dispatch.ts`, `src/core/features/page-settings/service.ts`, `tests/e2e/public-contract.test.mjs`
**Gap.** The secondary origin, supported-provider setup, mirror writes and lag reporting are absent.

#### PAGE-023 — Independent DNS failover

Core · target · **missing** · From PAGE-015

**Requirement.** The owner can configure independently hosted DNS failover and verify it end to end without Lamp operating DNS. The exact health-check configuration is documented in the public mechanisms record. The formats and configuration details are in [Public status mechanisms](docs/contract/public-details.md).

**Acceptance.**
1. Settings provides Amazon Route 53 failover routing and IBM NS1 Connect up/down-monitor and priority-filter settings.
2. The primary serving probe succeeds only when it can serve the current object-storage generation, stays healthy during a database outage and fails when object storage is unavailable.
3. Setup checks primary resolution, the exact secondary record, secondary TLS for the buyer hostname and newest generation, and the serving-probe target; every failed step is named, including a missing secondary record.
4. With ten-second checks, failure threshold three and sixty-second TTL, the buyer hostname serves the labeled newest secondary generation within 180 seconds of primary failure; overload beyond the provider response window also fails over.
5. A local DNS harness uses the same check interval, threshold and TTL; a hosted run uses a configured Route 53 test zone.
6. Failback occurs when the primary probe recovers; ongoing mirror writes ensure it serves content no older than failover did.

**Evidence.** `src/core/app/host-dispatch.ts`, `src/core/features/page-settings/service.ts`, `tests/e2e/public-contract.test.mjs`
**Gap.** The serving probe, failover configuration, local DNS harness, setup check and failover/failback journey are absent.

#### PAGE-024 — Read-only standby surfaces

Core · target · **missing** · From PAGE-015

**Requirement.** The secondary serves the last published generation read-only during primary failure. The formats and configuration details are in [Public status mechanisms](docs/contract/public-details.md).

**Acceptance.**
1. The secondary serves page, history, incident and maintenance permanent pages, Atom/RSS feeds, widget/embed variants, badges, native and Statuspage-compatible APIs with their CORS behavior, and the maintenance calendar at the same public addresses and generation instant.
2. Subscription creation, management, unsubscribe, alert intake and operator-app requests return unavailable with retry guidance; the page says subscriptions are paused while standby serves, without reporting a false success.
3. During failover the page retains the last published generation; publishing and notification delivery use the primary, and work committed before failure is delivered when it returns.
4. A standby journey reads the summary API, RSS feed and badge from one generation and observes an unavailable subscription attempt with retry guidance.

**Evidence.** `src/core/app/host-dispatch.ts`, `src/core/features/page-settings/service.ts`, `tests/e2e/public-contract.test.mjs`
**Gap.** Read-only standby publication, write refusals, paused-subscription wording and failover delivery recovery are absent.

#### PAGE-016 — Statuspage-compatible public API

Core · target · **partial**

**Requirement.** Existing Statuspage consumers can move by changing only their hostname, and Lamp-native readers receive complete retained records. Exact addresses and field mappings are documented in the public mechanisms record. The formats and configuration details are in [Public status mechanisms](docs/contract/public-details.md).

**Acceptance.**
1. All eight Statuspage v2 representations retain documented field names, identifier formats, impact values and status indicators, with a shown mapping from Lamp states and lifecycle.
2. Maintenance representations contain MAINT-009 wording, update bodies, scheduled/in-progress/verifying/completed states, schedule bounds and per-window automatic-transition switches.
3. Native public reads include complete incident timelines and reports with cursor pagination.
4. Every representation is snapshot-backed, works without the database, allows cross-origin reads and follows PAGE-007 caching and PAGE-008 rate behavior.
5. Internal components, internal notes and private-page records are absent.
6. Every v2 response matches the official schema fixtures and an unmodified Statuspage client reads the page.

**Evidence.** `src/core/features/public-snapshot/public-api.ts`, `tests/e2e/public-contract.test.mjs`, `tests/e2e/snapshot-retained.test.mjs`
**Gap.** Statuspage v2 responses, stable imported IDs, an unmodified Statuspage embed client, and paginated native timelines and reports ship from retained snapshots. MAINT-009 wording, Verifying and per-window automation switches remain unbuilt; maintenance responses expose existing native lifecycle notices.

#### PAGE-017 — RSS and per-component feeds

Core · target · **partial**

**Requirement.** Atom and RSS readers see the same event identities and order, including global compatibility aliases and component-specific feeds.

**Acceptance.**
1. The RSS feed is valid RSS 2.0 and has exactly the Atom entries in the same order with the same stable identifiers.
2. The Statuspage history-feed aliases work on every installation without depending on an import.
3. Each visible component has Atom and RSS feeds containing only incident and maintenance events that claimed a state on it.
4. All feeds are snapshot artifacts; the W3C feed validator accepts each.
5. A reader polling the history RSS alias sees a newly published event within ten seconds.

**Evidence.** `src/core/features/public-snapshot/feeds.ts`, `tests/e2e/public-contract.test.mjs`
**Gap.** Old cited evidence asserts RSS parses without XML errors; RSS event identities equal Atom identities in order; The history RSS alias equals the native RSS feed; A populated Web application component feed contains the affected incident. Unasserted: RSS 2.0 semantic validation is asserted; Both history aliases work on an installation with no import; An unrelated component’s populated feed excludes the incident while retaining its own event; Both feed forms of every visible component reconcile all applicable incident and maintenance events; All feed variants are asserted snapshot-backed; The W3C validator accepts every feed; A newly published event is asserted in the polled history RSS alias within ten seconds.

#### PAGE-018 — Status badges

Core · target · **partial**

**Requirement.** Overall and component badges expose state and uptime to README and dashboard consumers without scripting.

**Acceptance.**
1. Overall-state, component-state and component-uptime SVG badges have text labels and page-matched colors, each at most 2 KiB.
2. The endpoint badge uses the shields.io endpoint schema and can be rendered by shields.io.
3. Badges are generation-cached snapshot artifacts and a component change appears in each badge within ten seconds.
4. With the database unavailable, the badges remain available from the snapshot.

**Evidence.** `src/core/features/public-snapshot/badges.ts`:7, `src/core/features/public-snapshot/state-colors.json`:1, `tests/e2e/public-contract.test.mjs`:75 (existing stable-feed/public-resource journey in `tests/e2e/public-contract.test.mjs`:755), `tests/e2e/snapshot-retained.test.mjs`:32. The public-door journey changes an isolated component through every state, fetches the overall/component/uptime SVGs and endpoint JSON within ten seconds, checks their labels, page-resolved colours, 2KB bound and generation caching. Its page-state-colour assertion fails against the published palette and passes with Partially unavailable amber. The retained-snapshot journey serves badges with the database unavailable. Hosted GETs on 23 October 2026 at 08:07:08 UTC returned HTTP 200 for status.run-lamp.com/badge.json, /badge.svg and the shields.io endpoint; shields rendered “status: Operational”. No hosted state changed; full bodies remain outside the distributed tree under ACCEPTANCE.md’s release evidence boundary.
**Gap.** Old cited evidence asserts Component-state SVG has the changed label; The component-state SVG stays within two KiB; The component-uptime SVG stays within two KiB; The component-state badge uses its page state color or no-data ink. Unasserted: Every shields.io endpoint field and a shields.io rendering are asserted; Database-unavailable badge serving is directly asserted.

#### PAGE-019 — Embed variants

Core · target · **partial** · Cites BASE-PUBLIC-002

**Requirement.** The owner can embed a banner, floating incident notice or compact labeled status dot, configured for position and colors.

**Acceptance.**
1. The floating notice is visible only during an unresolved incident or an in-progress maintenance; the owner can hide every variant when all services are operational.
2. All variants use the same snapshot payload, stay within ten KiB and the origin restrictions of PAGE-011.
3. An allowed origin renders every variant; an unlisted origin renders nothing.
4. A floating incident notice appears after publication and disappears on resolution, using the selected position and colors.

**Evidence.** `src/core/features/page-settings/ui/public-resources.tsx`, `tests/e2e/public-contract.test.mjs`, `tests/e2e/helpers/widget-privacy-flow.mjs`
**Gap.** Old cited evidence asserts The floating notice starts hidden without an incident; A floating incident notice appears on publication; The dot state equals the public snapshot state; Four status sections render after the four allowed-origin embed installations. Unasserted: A maintenance alone displays the floating notice; Every variant can be configured to hide when operational; Every variant stays within ten KiB; Each installed variant is individually identified as the banner, dot, floating notice or compatibility embed; The configured foreground and background colors are asserted; Resolution-driven disappearance is asserted rather than only awaited.

#### PAGE-020 — Accessible to the standard US buyers require

Core · target · **partial** · Cites BASE-ACCESSIBILITY-001, BASE-PUBLIC-003, BASE-DOCS-001 · Register R-1, R-2

**Requirement.** Public page, private page, subscription and email journeys use Base’s accessibility bar. The public footer links the app-host accessibility report; private-page coverage follows AUD-002.

**Acceptance.**
1. Component and incident states have text in addition to color.
2. The persistent status region announces changed customer facts, keeps generation clocks outside announcements, remains silent on unchanged refreshes and omits internal incident identifiers.
3. Public, history, incident, maintenance and subscription-management journeys apply the Base bar; the keyboard-only journey subscribes and manages a subscription.
4. The ITI VPAT 2.5 Rev 508 report names its release version, evaluation date and methods and contains Chapter 3 Functional Performance Criteria, Chapter 5 Software, Chapter 6 Support Documentation and the WCAG 2.x A and AA tables; release validation refuses an absent report, missing required chapters/tables or a wrong release version.
5. The public-footer link opens the same report on the app host.

**Evidence.** `tests/e2e/maintenance-timezone.test.mjs` (maintenance creation and correction use the page zone; public maintenance and keyboard subscription journeys are accessible), `tests/e2e/helpers/accessibility-subscription-flow.mjs` (accessibilitySubscriptionFlow), `tests/e2e/start-runtime.test.mjs` (release validation). At 1440/390 the public page, history, incident and maintenance permalinks and subscription management pass axe; keyboard-only subscribe/manage retains visible focus. The public footer's Accessibility (VPAT) link opens the app-host document. Release validation rejects absent reports, missing required Section 508/WCAG tables and the wrong release version. Private-page axe belongs to AUD-002 after the approved carve. The VPAT records its evaluation methods and criterion limits; no whole-product conformance is claimed.  Additional push-Verify evidence: `tests/e2e/delivery-contract.test.mjs` (Attributed operator additions, confirmed component scope, private management and opt-out), loading `tests/e2e/helpers/subscriber-add-flow.mjs` in the delivery shard, captures real confirmation, incident-update and maintenance-notice HTML at the Resend edge and audits every document with axe and no horizontal overflow at 1440/390. Each is a complete English HTML document with wrapping body text and no pre element. `tests/e2e/start-runtime.test.mjs` in the runtime shard proves the app-host VPAT document. The VPAT includes the measured email scope and the existing footer link. Additional push-Verify screen evidence: `tests/e2e/publishing-browser.test.mjs` (HIST-002 — AGENT-005 TEAM-007 HIST-007 — an operator publishes a report, browses audit history and reports subscribers), loading `tests/e2e/publishing-browser.test.mjs` in the composer shard, audits the complete report screen in generated, draft, published-operator and public-published states at 1440/390. Brief disclosures have 44-pixel targets. The existing capacity-refusal journey in `tests/e2e/statuspage-import.test.mjs` (MOVE-002 — SUB-017 and SUB-020 imports keep history silent, CSV dry runs write nothing, pending subscribers need explicit invitations, and capacity refuses excess without writes) in the imports-statuspage shard passes its unchanged strict axe, overflow and hydration checks at both widths; the same Atom/RSS links use existing public utility navigation for stable targets without stylesheet changes. `tests/e2e/public-contract.test.mjs` (PAGE-013 PAGE-014 PAGE-008 PAGE-009 PAGE-003, public shard) proves the persistent role=status, aria-live=polite, aria-atomic=true region exists on first load; real operator publication, update and resolution change its customer-facing text at 1440/390 after the public snapshot is ready; unchanged polls and relative-time renders do not mutate the announcement; internal incident ids are absent. The default page keeps its generation clock outside the announcement and changes announcement text only when the public facts change. The two widths retain axe and overflow checks. This is browser live-region delivery evidence; incomplete VPAT criterion evaluations still prevent whole-product conformance. Proposal pending ct judgment. The existing `tests/e2e/public-contract.test.mjs` (PAGE-013 PAGE-014 PAGE-008 PAGE-009 PAGE-003, public shard) additionally asserts the same persistent polite/atomic live region, published incident text and resolution, unchanged-refresh silence, and exclusion of internal incident ids on Calm headline, Uptime-history-led and Regions map at 1440/390, with axe and overflow checks. Generation clocks stay outside every announcement; unchanged public facts retain their existing nodes. Regions reserves space for all state labels and refreshes map content in place, so incident state changes preserve the live region. This narrows the browser gap only; manual criterion evaluation and actual assistive-technology conformance remain unproved. Proposal pending ct judgment.
**Gap.** Public, email and operator browser accessibility slices and the app-host report are delivered. The full Base keyboard and accessibility-tree journeys remain unproved; private-page work follows AUD-002. Manual screen-reader evaluation and criterion-complete VPAT proof remain not run in R-1 and R-2.

#### PAGE-021 — Public read capacity of the hosted page

Core · target · **partial** · Cites BASE-OPS-004 · Register R-3

**Requirement.** The public read workload remains usable during outage-hour demand, including publication while under load. Exact hosted provider measurements are separately published.

**Acceptance.**
1. A declared-hardware seeded run sustains 2,000 requests per second for ten minutes across the page, summary API, live status, Atom feed and overall badge; it also runs a 5,000-per-second burst for sixty seconds and 200-per-second traffic from one address.
2. Every response succeeds without rate-limit or server errors; p95 time to first byte is at most 300 ms for the two APIs and badge and 500 ms for page and feed.
3. A publish five minutes into the run appears on every surface within ten seconds and public database-query count stays zero.
4. The run retains generation caching and fixed per-request origin work; primary overload beyond the DNS health response window triggers PAGE-023.
5. The release replaces the estimated local capacity with its recorded measured sustained capacity and does not label an unmeasured hosted rate as proven.

**Evidence.** `src/core/features/public-snapshot/routes.ts`, `tests/e2e/public-contract.test.mjs`
**Gap.** Generation-cached public reads and a local ten-requests-per-second floor are delivered. The declared-hardware sustained, burst, single-address, latency, concurrent-publication and zero-query scale run is absent; hosted measurements in R-3 remain not run.

### Theming and languages — target

#### THEME-001 — Full brand theming

Core · target · **partial** · Cites BASE-INPUT-003, BASE-PUBLIC-001

**Requirement.** The owner configures palette, typography, header art, links and layout in Settings without editing source.

**Acceptance.**
1. Background, surface, text, link and per-state colors can be changed, and invalid WCAG AA contrast pairs below 4.5:1 are refused with the offending pair named.
2. The owner chooses a bundled font or uploads a WOFF2 font served from the page’s own origin, and adds a header image and custom header and footer links.
3. Layout choices include groups collapsed or expanded, uptime bars shown or hidden per component and the number of history days displayed.
4. The next snapshot reflects every changed field and remains within PAGE-003’s transfer budget.

**Evidence.** `src/core/features/page-settings/service.ts`, `src/core/features/public-snapshot/branding.ts`, `tests/e2e/public-contract.test.mjs`
**Gap.** PAGE-012 branding is delivered. Full palette, contrast-refusal feedback, fonts, header image, custom links and layout choices are absent.

#### THEME-002 — Owner stylesheet

Core · target · **missing** · From THEME-001 · Cites BASE-INPUT-002

**Requirement.** Owner CSS changes the status page while retaining its size and isolation guarantees.

**Acceptance.**
1. Imported CSS, foreign-origin resources, executable expressions and behavior directives are refused, with the offending rule named.
2. Accepted CSS is scoped to the public page and included in its snapshot stylesheet; PAGE-003 and PAGE-013 continue to hold.

**Evidence.** `src/core/features/page-settings/service.ts`, `src/core/features/public-snapshot/branding.ts`, `tests/e2e/public-contract.test.mjs`
**Gap.** Custom CSS acceptance, refusal feedback, scoping and snapshot stylesheet integration are absent.

#### THEME-003 — Custom header and footer markup

Core · target · **missing** · From THEME-001 · Cites BASE-INPUT-002, BASE-PUBLIC-001

**Requirement.** Custom header and footer markup appears in the initial snapshot without relaxing public isolation. The detailed element and attribute allow-list is in the public mechanisms record. The formats and configuration details are in [Public status mechanisms](docs/contract/public-details.md).

**Acceptance.**
1. Each header and footer is limited to eight KiB and is sanitized to the documented element and attribute allow-list on save.
2. Script, event handlers, inline style, forms, frames and foreign resources are removed; links and image sources obey the documented allowed destinations.
3. A save reports each removal, and the accepted markup is readable without scripting under PAGE-013.

**Evidence.** `src/core/features/page-settings/service.ts`, `src/core/features/public-snapshot/branding.ts`, `tests/e2e/public-contract.test.mjs`
**Gap.** Custom header/footer markup editing, sanitization removal reports and snapshot rendering are absent.

#### THEME-004 — A dark palette that passes the 4.5:1 check keeps every dashboard card (Uptime, Regions and the other status cards) readable

Core · target · **missing**

**Requirement.** A dark palette that passes the 4.5:1 check keeps every dashboard card (Uptime, Regions and the other status cards) readable.

**Acceptance.**
1. The contrast check a palette passes uses the same contrast measure as the cards.
2. No card keeps a fixed light background under a dark palette.
3. The check covers every card type on the public status page and the dashboard.
4. A palette that would leave any card below 4.5:1 is refused with that card named.
5. One public-door journey proves a dark palette on both pages at 1440 and 390.

**Evidence.** None.
**Gap.** Shared card contrast validation, dark card backgrounds, named-card refusal and the two-page public-door journey at 1440/390 are unproven.

#### THEME-005 — Turning the custom palette off never erases the owner's chosen colours

Core · target · **missing**

**Requirement.** Turning the custom palette off never erases the owner's chosen colours.

**Acceptance.**
1. Unticking the custom palette keeps all nine chosen colours stored.
2. The public page shows the default look while the custom palette is off.
3. Ticking the custom palette on again restores exactly the stored colours.
4. Saving other theme settings while the custom palette is off never clears the colours.
5. One public-door journey proves untick, save, reload and re-tick.

**Evidence.** None.
**Gap.** Preservation of all nine colours through untick, save, reload, other theme saves and re-tick, and the default public look while off, are unproven.

#### I18N-001 — Pages in several languages

Core · target · **missing**

**Requirement.** The owner enables translated public and private communication while each address remains stable for its chosen language.

**Acceptance.**
1. The shipped languages are American English and US Spanish first, then French, German, Brazilian Portuguese and Japanese; the owner chooses a default and additional languages.
2. Every fixed string on public and private pages, feeds, email, SMS and subscription pages is translated, and time display follows PAGE-009 in the locale’s format.
3. Each language has its own snapshot, alternate-language metadata and visible switcher; browser language preference suggests a link without silently changing a given address.
4. With English and Spanish enabled, the Spanish initial HTML is entirely translated without scripting and Spanish subscribers receive the Spanish email template.
5. Disabling a language removes its pages from the next snapshot.

**Evidence.** None.
**Gap.** Multi-language publication and templates are absent. This scope replaces the old manifest exclusion of multi-language pages.

#### I18N-003 — Subscriber language choice and reporting

Core · target · **missing** · From I18N-001

**Requirement.** Subscribers choose a communication language and reporting retains that choice.

**Acceptance.**
1. A subscriber chooses a language during subscription and can change it through subscription management.
2. HIST-007 current counts, daily trend and CSV separate subscribers by language, including English and Spanish in the fixture.
3. Subscriber CSV import accepts email, phone, webhook endpoint, components and language; a dry run counts created, skipped and refused rows without writing.

**Evidence.** None.
**Gap.** Subscriber language selection, management, reporting and language-aware CSV preview are absent.

#### I18N-002 — Translated updates

Core · target · **missing**

**Requirement.** Operators publish and later add translations without replaying notifications or delaying the default-language update.

**Acceptance.**
1. The composer shows every enabled language beside the default, and preview renders each one.
2. A missing translation requires supplied text or an explicit recorded choice to publish default-language text for that language; without either the publish is refused and names the language.
3. Publishing English and Spanish sends each subscriber the text in their chosen language.
4. The default language can publish first, and a later translation is a correction-free addition labeled with its addition time on that language timeline.
5. Adding a translation notifies nobody a second time and preserves NOTIFY-005.

**Evidence.** None.
**Gap.** Not built.

### Components — target

#### COMP-008 — Monitor claims from measured evidence

Core · target · **missing**

**Requirement.** Verified linked-monitor evidence becomes a fourth independent component-state claimant under the owner’s automation rules.

**Acceptance.**
1. A component links to Uptime monitors or another tool’s monitor/alert through INTAKE-006, INTAKE-008 to INTAKE-012, INTAKE-014 or its INTAKE-013 automation email.
2. When an AUTO-001 rule permits it, confirmed failure claims the named state and confirmed recovery releases only that source’s claim.
3. History identifies the monitor or source, evidence instant and rule.
4. Unknown or stale evidence neither claims Operational nor releases another claimant’s state.
5. A signed Uptime failure under an automatic rule appears publicly within thirty seconds, and recovery leaves any operator standing claim intact.
6. A draft-only rule changes no public state.

**Evidence.** None.
**Gap.** Linked-monitor claims are absent. COMP-006 remains the three-claimant published requirement until the release that adds this fourth claimant records the change.

#### COMP-009 — Component bulk editing and descriptions

Core · target · **partial**

**Requirement.** Operators maintain component and group catalogs in bulk through a table and reviewed CSV import.

**Acceptance.**
1. Bulk table and CSV operations create, edit, reorder and delete components and groups.
2. A CSV with fifty components, groups and descriptions previews without writing, then applies the reviewed catalog.
3. Public ordering matches the catalog and descriptions of at most 500 plain-text characters are readable in a script-independent disclosure.
4. An optional tracking start date controls the beginning of component uptime.

**Evidence.** `src/core/features/components/catalogue-routes.ts`, `src/core/features/components/ui/catalogue-drawer.tsx`, `tests/e2e/public-contract.test.mjs`
**Gap.** Old cited evidence asserts Preview reports fifty created components; Preview reports zero changed components; Preview reports zero deleted components; Preview reports two created groups. Unasserted: Table creation is asserted for components; Table creation is asserted for groups; Table editing is asserted for components; Table editing is asserted for groups; Table reordering is asserted for components; Table reordering is asserted for groups; Table deletion is asserted for components; Table deletion is asserted for groups; CSV creation is asserted for components; CSV creation is asserted for groups; CSV editing is asserted for components; CSV editing is asserted for groups; CSV reordering is asserted for components; CSV reordering is asserted for groups; CSV deletion is asserted for components; CSV deletion is asserted for groups.

#### COMP-010 — Shown only while affected

Core · target · **partial**

**Requirement.** A public component may appear only while affected, without losing its history or contribution to overall status.

**Acceptance.**
1. The owner can mark a component show only when not Operational. While operational it is absent from page, widget and feed component lists, uptime figure and daily record.
2. Any non-operational claim reveals it in its group within ten seconds; recovery hides it again.
3. State history and uptime are retained throughout and its state always contributes to overall status.
4. Statuspage-compatible component reads include its conditional-visibility flag and list it only while affected.
5. Statuspage imports preserve the flag.

**Evidence.** `src/core/features/public-snapshot/component-visibility.ts`, `tests/e2e/public-contract.test.mjs`, `tests/e2e/statuspage-import.test.mjs`
**Gap.** Old cited evidence asserts After recovery the conditional component is absent from the populated page; After recovery the conditional component is absent from the populated incident Atom feed; After recovery the conditional component is absent from the populated v2 component list; The affected component appears publicly. Unasserted: The widget omits an Operational conditional component; The uptime figure and daily record are hidden; Uptime is retained throughout; The conditional component always contributes to overall status.

### Third-party dependencies — target

#### DEP-001 — Vendor components that follow vendor status

Core · target · **missing** · Cites BASE-DATA-004

**Requirement.** Operators follow third-party status through a complete catalog and documented generic formats. The formats and configuration details are in [Public status mechanisms](docs/contract/public-details.md).

**Acceptance.**
1. The catalog includes AWS, Google Cloud, Microsoft Azure, Cloudflare, Fastly, Vercel, Stripe, GitHub, Twilio, SendGrid, Okta, Auth0, Atlassian, Slack, Zoom, Shopify, Datadog, PagerDuty, OpenAI and Anthropic.
2. Operators may also follow any Statuspage v2, RSS, Atom or configured JSON status source.
3. Each source is read at most every two minutes from its declared public status origin and its state mapping to COMP-001 is shown.
4. Every vendor change adds source-attributed component history; fixture changes in Statuspage and AWS Health RSS appear within four minutes.
5. After three failed vendor reads the page names the time vendor status became unavailable and never substitutes Operational.
6. Every catalog entry ships recorded format fixtures and a mapping table; release validation rejects a missing fixture or table.
7. For every state each of the twenty vendor formats offers, a generated catalog check asserts the expected mapped component state.

**Evidence.** None.
**Gap.** Not built.

#### DEP-002 — Vendor state never silently becomes the buyer's outage

Core · target · **missing**

**Requirement.** A followed vendor component informs the buyer’s response without resolving incidents on its behalf.

**Acceptance.**
1. Each vendor component names the reporting vendor and links its status page.
2. By default a vendor claims no buyer component state and does not move overall status.
3. Per dependency, the owner chooses show only, draft an incident on dependent components from the saved upstream-provider template, or include vendor state in overall rollup.
4. An outage under show only leaves buyer states unchanged; draft mode creates one private incident draft on the dependent components without changing public content.
5. Recovery adds evidence to the incident brief and leaves the buyer incident unresolved.

**Evidence.** None.
**Gap.** Not built.

#### DEP-003 — Vendor watch for the team

Core · target · **missing**

**Requirement.** The team can privately follow upstream trouble and receive one alert per vendor incident.

**Acceptance.**
1. An internal vendor component follows COMP-005 and remains off public surfaces.
2. A vendor-state change sends one operator alert by email, operator Slack or Teams and push, deduplicated by vendor incident.
3. An internal vendor outage emits exactly one alert per incident and appears on no public page, feed or API.

**Evidence.** None.
**Gap.** Not built.

### Uptime — target

#### UPTIME-007 — Measured uptime bars

Core · target · **missing**

**Requirement.** Linked monitor availability can be shown beside claimed uptime without rewriting measured evidence.

**Acceptance.**
1. The owner chooses claimed uptime, measured Uptime availability or both, with source and method labels.
2. Unknown or stale-evidence minutes are No data and are excluded from the availability denominator rather than counted as up.
3. Daily records identify measured downtime minutes.
4. History corrections affect claimed figures only and never rewrite measured evidence.
5. A ninety-day fixture with a thirty-minute outage and two-hour Unknown gap excludes the gap and leaves the neighboring claimed figure unchanged.

**Evidence.** None.
**Gap.** Not built.

#### UPTIME-008 — Public performance metrics

Core · target · **done**

**Requirement.** Public component metrics provide script-independent charts from monitored and pushed aggregate observations.

**Acceptance.**
1. Up to ten metrics show per-component charts from Uptime timings, read-only Datadog, New Relic, Pingdom or Prometheus-compatible queries, or management-API pushes.
2. A pushed series appears in the next snapshot and each provider fixture supplies the expected chart values.
3. Only aggregated points are retained: one-minute for the last day, hourly for thirty days and daily for ninety days.
4. Each chart is inline SVG with a text summary and works without scripting.
5. A source gap is a disconnected, labeled gap with the last-report instant rather than an interpolated line.
6. Ten charts retain PAGE-003’s transfer and request budget.

**Evidence.** `src/core/features/metrics/`, migration `migrations/core/0062_public_metrics.sql` (inventoried in RELEASE.json 1.11.0). `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow, called by the existing INTAKE-014 INTAKE-011 INTAKE-009 case in `tests/e2e/channels-and-presets.test.mjs`, notifications shard) asserts a pushed 160 ms series in the next public snapshot; sealed read-only Datadog, New Relic, Pingdom and Prometheus query fixtures fill inline charts with 42, 87, 60 and 12.5 ms; authenticated paired Uptime timing fills 123 ms, while a wrong signature or absent timing adds no point. A 20-minute gap has two disconnected SVG paths and a stopped/resumed timestamp label; a source that stays silent has its last-report timestamp label. `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow) asserts weighted hourly and daily sums and sample counts, retention just inside and outside the 1-day minute, 30-day hourly and 90-day daily boundaries, and expiry beyond 90 days. Hourly and daily history is stored; the public inline chart displays only the last 24 hours. Seven populated charts render with script disabled at 1440/390; enabled-script axe, overflow and hydration checks pass. `tests/e2e/public-contract.test.mjs` (publicCapacityJourney, called by PAGE-013 PAGE-014 PAGE-008 PAGE-009 PAGE-003 in `tests/e2e/public-contract.test.mjs`, public shard) pushes ten 1,440-point series beside 200 populated components, refuses an eleventh without insertion, and retains PAGE-003's 50 KiB gzip bound across default, calm, uptime and regions templates. The original browser check retains the four-request initial asset bound. `tests/e2e/helpers/metrics-flow.mjs` (metricSetupJourney in the same notifications registration) proves all six feed setups and native versioned-push routing with an anonymous 401, ordinary-edit autosave, sealed-key redaction after reload including Prometheus and the Datadog application-key field, and no clipping, overflow, serious axe finding or hydration mismatch at 1440/390 in component settings. `tests/auth-adoption/portability.test.mjs` (native rer archive, ownership-authority shard) preserves minute, hourly and daily aggregate sums and sample counts and requires query-key reconnect after restore without carrying plaintext or ciphertext. `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow, same notifications case) issues a metrics:write management token and pushes the 160 ms series through the versioned metrics-points management endpoint without an operator cookie; it asserts the next public snapshot, token/issuer audit attribution, hash-only storage, last-used time, a no-scope 403 with no sample/audit/usage change, and immediate revoked-token 401 with no such changes. Additive migration `migrations/core/0063_management_metric_tokens.sql` is inventoried in RELEASE.json. The native archive journey preserves token metadata but excludes bearer/hash authority and refuses the restored old bearer. Both ct retention and token-push repairs are proposals pending judgment; API-001 remains partial. Proposal pending ct's judge.  Preservation citations: `tests/e2e/helpers/public-capacity-journey.mjs` (publicCapacityJourney), loaded by the cited public catalogue journey; `tests/e2e/helpers/metric-setup-journey.mjs` (metricSetupJourney), loaded by the cited monitor journey.
**Gap.** None.

#### UPTIME-009 — Availability reports

Core · target · **partial**

**Requirement.** An operator downloads claimed component availability reports for calendar months and quarters using the same bounds and math as the public page.

**Acceptance.**
1. CSV and PDF reports include the claimed figure, total weighted downtime and every overlapping incident and maintenance for one selected component and month or quarter.
2. Uptime equals the page’s figure for the same window to two decimals, using aggregate state history, corrections and downtime weights.
3. Calendar bounds are start-inclusive and end-exclusive in the page time zone, and configured tracking dates retain that zone.
4. Current periods count elapsed tracked time; future periods and missing history say No data.
5. Maintenance keeps its zero downtime weight while overlapping scheduled, cancelled and completed windows retain their state labels.
6. Incident membership includes retained claim intervals masked by more severe claims, and older imported records use retained public attachments and history.

**Evidence.** `src/core/features/availability-reports/`, `src/core/features/public-snapshot/uptime.ts`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/public-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts CSV is an attached CSV document; PDF is an attached PDF document; The CSV summary contains the computed uptime; The CSV summary contains the expected weighted downtime. Unasserted: The CSV month and quarter incident lists are completely reconciled; The PDF month and quarter incident lists are completely reconciled; Complete maintenance membership is reconciled in the CSV report; Complete maintenance membership is reconciled in the PDF report; The complete quarter incident-membership set is reconciled; A current-period report stops at elapsed current time; Every overlapping scheduled maintenance retains its state label; Every overlapping cancelled maintenance retains its state label; Every overlapping completed maintenance retains its state label.

#### UPTIME-010 — Measured availability exports

Core · target · **partial** · From UPTIME-009

**Requirement.** Linked measured availability is included in component availability exports alongside the claimed figure.

**Acceptance.**
1. When UPTIME-007 and COMP-008 provide linked evidence, CSV and PDF reports add the measured availability for the same month or quarter without changing the claimed result.

**Evidence.** `src/core/features/availability-reports/`, `src/core/features/public-snapshot/uptime.ts`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/public-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** The original evidence does not assert this part’s complete outcome; unasserted: Linked measured availability appears in CSV; Linked measured availability appears in PDF; Claimed results remain unchanged when measured figures are added.

#### UPTIME-011 — Audience availability report sharing

Core · target · **partial** · From UPTIME-009

**Requirement.** A component availability report can be shared with the selected audience on its private page.

**Acceptance.**
1. The operator selects one AUD-003 audience and that audience receives the report and its page-matching numbers on its private page.

**Evidence.** `src/core/features/availability-reports/`, `src/core/features/public-snapshot/uptime.ts`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/public-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** The original evidence does not assert this part’s complete outcome; unasserted: The selected audience receives the report on its private page; The shared numbers equal the component page’s figures.

### Incidents — target

#### INCIDENT-011 — A named communication owner

Core · target · **partial** · Cites BASE-OPS-005

**Requirement.** Each unresolved incident has a private communication owner whose reminders follow responsibility.

**Acceptance.**
1. Its opener is owner until takeover or reassignment.
2. Due and overdue reminders reach the owner by email, MOBILE-002 push and operator chat.
3. Unless the owner replaces escalation policy, ten minutes overdue sends one escalation to every operator with publish rights and the affected service’s linked Oncall responder.
4. Overview flags an incident without an active owner as unowned.
5. The owner’s name is private under TEAM-003.
6. Takeover redirects later reminders to the new owner.

**Evidence.** `src/core/features/incidents/communication-owner.repository.ts`:7, `src/core/features/incidents/reminders.ts`:24, `tests/e2e/update-reminders.test.mjs`:79, `tests/e2e/publishing-contract.test.mjs`:7 `tests/e2e/update-reminders.test.mjs`, loaded by the same registered owner-reminders journey in push Verify’s notifications shard, now proves the overdue reminder reaches an explicitly opted-in operator Slack or Teams channel once with its incident reference and operator-app link.
**Gap.** An unresolved incident defaults to its opener as communication owner; private take-over and active-operator reassignment doors write an attributed audit entry atomically and refuse resolved incidents. Owner-only due/overdue email, one escalation per commitment at ten minutes overdue, and unowned fallback to every active operator ship; every operator has publish rights until TEAM-004. Overview and the composer show ownership privately, with takeover/reassignment and unowned journeys at 1440/390. The registered reminder journey covers owner movement, escalation, unowned fallback, audit JSON/CSV and public/email-renderer privacy. Gap: push (MOBILE-002) and Oncall's current on-call responder (INTAKE-012) remain unbuilt. The seed policy inventory registration is held by uip; the policy is replaceable through the typed extension mount without editing that held file.

#### INCIDENT-012 — Run the incident from Slack or Teams

Core · target · **partial** · Cites BASE-INPUT-001, BASE-ROLE-001, BASE-OPS-005

**Requirement.** A linked operator runs the web incident-communication job from Slack or Teams.

**Acceptance.**
1. Slack’s incident command and Teams’ incident command or message extension open a private incident draft.
2. The operator attaches components with their claimed states and changes each attached claim with the update under UPDATE-012.
3. Every UPDATE-001 field can be filled and the public and email preview matches UPDATE-004.
4. Web validation and the owner’s update-review policy apply; an explicit linked-operator Publish action publishes with that operator’s attribution.
5. Teams provides interactive cards for the draft, preview and actions.
6. A Teams step from Major outage to Degraded performance writes exactly one history entry matching the incident, publication instant and immutable update.

**Evidence.** `tests/e2e/public-contract.test.mjs` (COMP-006 UPDATE-004 PAGE-012 INCIDENT-012 — Component claims, saved drafts, settings and operator records), loading `tests/chat-desk/flow.mjs` (chatDeskFlow, chatDeskNativeFlow) in push Verify’s api shard, proves signed Slack and Teams private drafts, shared preview, explicit attributed publication and component-history changes, invalid signatures/audiences, and refusal of formerly linked actors after owner authority is revoked without any incident, draft, update or audit creation. `tests/e2e/channels-and-presets.test.mjs` (SUB-014 NOTIFY-011 NOTIFY-012 UPDATE-013 — Private channels deliver the selected publication once with literal text and punctuated links) loads `tests/e2e/publishing-contract.test.mjs` in notifications: the signed-in Settings control mints, links once through signed Slack and removes links at 1440/390, with axe, overflow and hydration assertions. `tests/auth-adoption/portability.test.mjs` (ACCESS-001 INTAKE-009 native rer archive restores owner continuity and subscriber authority without restoring sessions, provider approval or a sealed PagerDuty key), loaded by ownership-authority, asserts archive-policy exclusions of chat_link_codes, chat_previews and chat_requests, retains durable chat_links, and advances only its Date clock past the original ten-minute lifetime before an actual signed Slack request with the old code returns 409 and creates no temporary authority. Until TEAM-004, linked active operators act as owners under TEAM-001. No live workspace or tenant acceptance is claimed. Additional push-Verify evidence for the four ct findings: `tests/e2e/public-contract.test.mjs` (COMP-006 UPDATE-004 PAGE-012 INCIDENT-012 — Component claims, saved drafts, settings and operator records), loading `tests/chat-desk/flow.mjs` (chatDeskNativeFlow) in the api shard, (1) obtains the generated Slack composer and Teams message-extension card and drives their exposed action ids, values and component choices through open, save, preview and publish; asserts each visible card contains UPDATE-004's public heading, lifecycle and every field plus the shared renderer's email subject and complete plain-text preview, (2) asserts both Teams-attached component identities and Major outage claims in the staged draft and published incident, (3) asserts unlinked Slack and Entra actors leave incidents, incident_drafts, incident_updates and audit_entries unchanged, and (4) asserts the initial Major outage claim and exactly one new Major outage → Degraded performance history entry, matching the incident, publication time and immutable component transition of the returned published update.
**Gap.** Old cited evidence asserts Slack private draft; Teams private draft; Both selected Teams component identities are staged; Each selected Teams component is staged as Major outage. Unasserted: Slack component choices; Every required UPDATE-001 field is independently asserted present in that web-renderer field list; chat review parity.

#### INCIDENT-014 — Link and authenticate chat operators

Core · target · **partial** · From INCIDENT-012 · Cites BASE-ACCESS-004, BASE-ROLE-001, BASE-SECRET-001, BASE-DATA-001 · Register R-20

**Requirement.** Chat commands use an operator identity linked from the operator app.

**Acceptance.**
1. An operator links a Slack user or Microsoft Entra ID user from the operator app once.
2. Unlinked Slack and Entra users are refused without incident, draft, update or audit creation.
3. Slack accepts only authentic raw-body requests no older than five minutes; altered or wrongly signed requests are refused.
4. Teams accepts only an authentic Bot Framework token for Lamp’s bot application; wrong-audience and invalid-signature tokens are refused.
5. Revoking an operator’s authority refuses their formerly linked chat actor without record creation.
6. Durable chat identities survive archives; temporary link, preview and replay authority does not.

**Evidence.** `tests/e2e/public-contract.test.mjs` (COMP-006 UPDATE-004 PAGE-012 INCIDENT-012 — Component claims, saved drafts, settings and operator records), loading `tests/chat-desk/flow.mjs` (chatDeskFlow, chatDeskNativeFlow) in push Verify’s api shard, proves signed Slack and Teams private drafts, shared preview, explicit attributed publication and component-history changes, invalid signatures/audiences, and refusal of formerly linked actors after owner authority is revoked without any incident, draft, update or audit creation. `tests/e2e/channels-and-presets.test.mjs` (SUB-014 NOTIFY-011 NOTIFY-012 UPDATE-013 — Private channels deliver the selected publication once with literal text and punctuated links) loads `tests/e2e/publishing-contract.test.mjs` in notifications: the signed-in Settings control mints, links once through signed Slack and removes links at 1440/390, with axe, overflow and hydration assertions. `tests/auth-adoption/portability.test.mjs` (ACCESS-001 INTAKE-009 native rer archive restores owner continuity and subscriber authority without restoring sessions, provider approval or a sealed PagerDuty key), loaded by ownership-authority, asserts archive-policy exclusions of chat_link_codes, chat_previews and chat_requests, retains durable chat_links, and advances only its Date clock past the original ten-minute lifetime before an actual signed Slack request with the old code returns 409 and creates no temporary authority. Until TEAM-004, linked active operators act as owners under TEAM-001. No live workspace or tenant acceptance is claimed. Additional push-Verify evidence for the four ct findings: `tests/e2e/public-contract.test.mjs` (COMP-006 UPDATE-004 PAGE-012 INCIDENT-012 — Component claims, saved drafts, settings and operator records), loading `tests/chat-desk/flow.mjs` (chatDeskNativeFlow) in the api shard, (1) obtains the generated Slack composer and Teams message-extension card and drives their exposed action ids, values and component choices through open, save, preview and publish; asserts each visible card contains UPDATE-004's public heading, lifecycle and every field plus the shared renderer's email subject and complete plain-text preview, (2) asserts both Teams-attached component identities and Major outage claims in the staged draft and published incident, (3) asserts unlinked Slack and Entra actors leave incidents, incident_drafts, incident_updates and audit_entries unchanged, and (4) asserts the initial Major outage claim and exactly one new Major outage → Degraded performance history entry, matching the incident, publication time and immutable component transition of the returned published update.
**Gap.** Old cited evidence asserts Slack linked in Settings; A second redemption of the same successfully redeemed code is refused; After both transport link flows exactly two durable links exist; unlinked actor creates no incident. Unasserted: Entra linked from Settings.

#### INCIDENT-013 — Impact set by the operator

Core · target · **partial** · Cites BASE-OPS-005

**Requirement.** An operator overrides derived incident impact independently of component claims.

**Acceptance.**
1. An operator selects none, minor, major or critical above or below derived impact, or clears the override to restore it.
2. Every public surface, public incident API and notification shows the selected impact; the operator app shows both selected and derived impact.
3. Setting and clearing impact append the operator and change to the internal timeline.
4. Overrides change no component state, overall status or uptime figure.
5. Statuspage imports retain each recorded incident impact.

**Evidence.** `src/core/features/incident-impact/`, `migrations/core/0031_incident_impact.sql`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts above derived impact; none below derived impact; clear restores derived; The incident-specific permalink contains the overridden major impact. Unasserted: critical choice; The public page’s major-impact marker is bound to this overridden incident; The history page’s major-impact marker is bound to this overridden incident; notifications; Populated historical uptime day values remain unchanged by the override; current uptime figure unchanged; imported recorded impact.

### Updates — target

#### UPDATE-010 — Audience-specific updates

Core · target · **missing**

**Requirement.** One publication carries wording for each eligible audience.

**Acceptance.**
1. Each visible audience under AUD-003 may have its own affected-audience, customer-impact and what-still-works wording.
2. Public page and subscribers get public wording; each audience page and subscriber gets exactly one message with its own text.
3. Preview shows every variant and explicitly identifies empty variants using public text.
4. Lifecycle, components and next-update time remain shared.
5. Public page, feed and API omit private-audience words under AUD-005.

**Evidence.** None.
**Gap.** Not built.

#### UPDATE-011 — Deterministic wording checks

Core · target · **partial**

**Requirement.** The composer offers explainable dismissible findings without holding publication.

**Acceptance.**
1. Before publishing each field is checked without a model for resolution-time promises, internal hostnames, IP addresses, email addresses, owner-blocked terms and the owner’s reader-friendly length limit.
2. Each finding sits beside its field, names its rule and can be dismissed.
3. Findings never block publication, including combined resolution-time promise and internal-hostname findings.

**Evidence.** `src/core/features/incidents/wording-checks.ts`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Asserted: part of the existing workflow. Unasserted in old cited evidence: resolution-time promise finding; internal hostname finding; IP address finding; email address finding; owner-blocked term finding; owner length finding; beside field; rule named; dismissal; findings do not block.

#### UPDATE-012 — Stage component changes with an update

Core · target · **partial**

**Requirement.** An update draft stages the incident’s next per-component claims.

**Acceptance.**
1. The composer shows each attached component’s current incident claim and a selector for Major outage, Partially unavailable, Degraded performance or Operational.
2. Operational retains the attachment for subscribers but releases its incident claim.
3. The draft can attach more components or stage release with this update instead of immediate detachment.
4. Staged choices save and version with the draft, remain private, form part of the reviewed revision and apply at scheduled publication.
5. Conflicts with newer attachment changes refuse publication.
6. A Resolved update releases every claim and its selectors show that release.

**Evidence.** `migrations/core/0027_update_component_changes.sql`, `src/core/features/incidents/publication-repository.ts`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Native drafts stage state changes, attachments and releases; review, scheduling and templates keep the choices. One transaction publishes claims, aggregate history, immutable timeline changes and recipients; mail and signed webhooks retain the published changes after later recovery. Gap: management-token and Statuspage write APIs, automation, chat desks, SMS and component-only/Statuspage webhook subscriptions are not built. The acceptance's two overlap cases (one Major outage → Partially unavailable entry beside a Partially unavailable claimant; none while another claimant holds Major outage) have no named journey yet; history is written from the aggregate state.

#### UPDATE-014 — Publish component changes atomically

Core · target · **partial** · From UPDATE-012

**Requirement.** The update and staged component changes enter the record as one publication.

**Acceptance.**
1. All staged states, attachments, releases, update and recipients commit together under UPDATE-008.
2. Each public state change writes exactly one history entry from old to new at publication, attributed to incident and operator.
3. No aggregate state change means no history entry.
4. A Partially unavailable second claimant makes Major outage → Degraded performance write one Major outage → Partially unavailable entry; a Major outage second claimant makes it write none and retain Major outage.
5. Page, history, permalinks, feeds, widget, badges, public status and Statuspage-compatible APIs switch straight between snapshot generations without intermediate Operational state.
6. Uptime uses the state in force: Major outage → Degraded performance counts half a downtime minute after publication.
7. Incident impact keeps its historical peak or INCIDENT-013 override.
8. Retroactive updates place changes at their past publication instant and notify nobody.

**Evidence.** `migrations/core/0027_update_component_changes.sql`, `src/core/features/incidents/publication-repository.ts`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Native drafts stage state changes, attachments and releases; review, scheduling and templates keep the choices. One transaction publishes claims, aggregate history, immutable timeline changes and recipients; mail and signed webhooks retain the published changes after later recovery. Gap: management-token and Statuspage write APIs, automation, chat desks, SMS and component-only/Statuspage webhook subscriptions are not built. The acceptance's two overlap cases (one Major outage → Partially unavailable entry beside a Partially unavailable claimant; none while another claimant holds Major outage) have no named journey yet; history is written from the aggregate state.

#### UPDATE-015 — Component changes through every publication door

Core · target · **partial** · From UPDATE-012

**Requirement.** Every update door conveys the same component choices and tells subscribers once.

**Acceptance.**
1. Timeline, history, feeds, email, Slack and Teams show each previous → new change beside its wording; SMS does so within its two-segment limit and preview shows the same changes.
2. Each selected subscriber gets one update notification per channel carrying wording and changes.
3. Lamp webhooks carry each component’s old/new state; Statuspage-format incident bodies carry new statuses and no separate component-update event by default.
4. Component-only subscribers receive one old → new component-update event.
5. Opted-in Statuspage webhooks receive exactly one incident-driven component event per changed component after the incident body without intermediate Operational.
6. Templates stage states for already attached components; claim-and-publish automation and chat desks use the same choices.
7. Native management publication accepts per-component states.
8. Statuspage-compatible updates map their component statuses into the same atomic changes.

**Evidence.** `migrations/core/0027_update_component_changes.sql`, `src/core/features/incidents/publication-repository.ts`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Native drafts stage state changes, attachments and releases; review, scheduling and templates keep the choices. One transaction publishes claims, aggregate history, immutable timeline changes and recipients; mail and signed webhooks retain the published changes after later recovery. Gap: management-token and Statuspage write APIs, automation, chat desks, SMS and component-only/Statuspage webhook subscriptions are not built. The acceptance's two overlap cases (one Major outage → Partially unavailable entry beside a Partially unavailable claimant; none while another claimant holds Major outage) have no named journey yet; history is written from the aggregate state.

#### UPDATE-013 — Safe direct links in update text

Core · target · **partial**

**Requirement.** Only a bare HTTPS URL adds interpretation to plain update text.

**Acceptance.**
1. Any field makes a bare HTTPS URL a direct link with the URL itself as visible text.
2. Trailing periods, commas and closing parentheses stay outside it.
3. HTML, Markdown, labelled-link syntax and HTTP, JavaScript and data schemes stay literal.
4. Page, history, permalinks, Atom and RSS including source aliases and component feeds show the same links.
5. Public links keep nofollow, noopener and ugc protections without widening PAGE-013’s content restrictions.
6. UPDATE-011 flags internal-hostname and IP-address URLs.

**Evidence.** `src/core/shared/update-links.ts`, `src/core/features/channels/slack-message.ts`, `src/core/features/channels/messages.ts`, `src/core/features/incidents/wording-checks.ts`, `tests/e2e/helpers/update-link-evidence.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/channels-and-presets.test.mjs`, `tests/e2e/publishing-browser.test.mjs`
**Gap.** Old cited evidence asserts own URL visible; period outside; Trailing comma stays outside the direct link; Trailing closing parenthesis stays outside the direct link. Unasserted: Markdown remains literal on every public surface; labelled-link syntax remains literal on every public surface.

#### UPDATE-016 — Safe links in mail and chat

Core · target · **partial** · From UPDATE-013

**Requirement.** Mail and chat retain the same direct destinations and literal wording. SUB-013 and NOTIFY-014 retain the future SMS URL obligation, SUB-014/015 retain subscriber Slack/Teams, and MAINT-009 retains maintenance wording.

**Acceptance.**
1. Email HTML directly links each HTTPS URL as its own text with punctuation outside; plain text keeps every bare URL.
2. Email has no redirects, click tracking, open tracking or analytics tracking.
3. Slack posts use bare URL link text, punctuation outside and never labelled links.
4. Teams cards use the direct URL as link text with punctuation outside.
5. Other schemes and markup stay escaped literal text in Slack and Teams.

**Evidence.** `src/core/shared/update-links.ts`, `src/core/features/channels/slack-message.ts`, `src/core/features/channels/messages.ts`, `src/core/features/incidents/wording-checks.ts`, `tests/e2e/helpers/update-link-evidence.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/channels-and-presets.test.mjs`, `tests/e2e/publishing-browser.test.mjs`
**Gap.** Old cited evidence asserts Email text retains affected-audience wording; Email text retains customer-impact wording with its bare URL; Email text retains what-still-works wording with its bare URLs; Email text retains details wording with its bare URLs. Unasserted: Teams independently asserts literal HTTP-scheme text; Teams independently asserts retained escaped HTML markup.

#### UPDATE-017 — Safe link webhook formats

Core · target · **partial** · From UPDATE-013

**Requirement.** Webhook deliveries preserve fields in the recipient’s selected message form. SUB-018 retains the future Statuspage-format direct-link obligation.

**Acceptance.**
1. Lamp-format subscribers receive each field byte for byte with its bare URLs.
2. Slack incoming-webhook subscribers receive Slack message form: own-URL HTTPS links, punctuation outside, escaped literal markup and schemes, and rich text reassembling unchanged fields.
3. Both formats’ signatures verify over the exact delivered body.

**Evidence.** `src/core/shared/update-links.ts`, `src/core/features/channels/slack-message.ts`, `src/core/features/channels/messages.ts`, `src/core/features/incidents/wording-checks.ts`, `tests/e2e/helpers/update-link-evidence.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/channels-and-presets.test.mjs`, `tests/e2e/publishing-browser.test.mjs`
**Gap.** Old cited evidence asserts Slack fields reassemble; Slack link text equals URL; only HTTPS links; Slack-webhook text retains period punctuation outside its URL. Unasserted: Lamp fields byte-for-byte.

### Scheduled maintenance — target

#### MAINT-007 — Maintenance calendar

Core · target · **done**

**Requirement.** A public calendar tracks windows with stable identities; MAINT-009 owns event wording and MAINT-010 owns calendar-client use and email attachments.

**Acceptance.**
1. An RFC 5545 feed contains Scheduled and In progress maintenance with a stable UID per window.
2. Rescheduling updates the same event and increases its sequence.
3. Cancellation marks the event cancelled.
4. The empty calendar remains valid; events have identity and timestamp, and timezone definitions have required observance properties.
5. The calendar excludes internal-only windows and internal component identities.

**Evidence.** `tests/e2e/publishing-contract.test.mjs` (owner schedules, announces, starts, extends and completes maintenance without losing window or calendar history), `tests/e2e/helpers/calendar-assertions.mjs` (validateMaintenanceCalendar, loaded by that same maintenance journey), `tests/e2e/helpers/accessibility-subscription-flow.mjs`. The public retained /maintenance.ics response parses with Mozilla ical.js 2.2.1 as RFC 5545, uses CRLF and UTF-8 folding, and excludes internal-only maintenance and internal component names. Rescheduling keeps UID, raises SEQUENCE and changes the event window; cancellation yields STATUS:CANCELLED. Scheduled and in-progress events remain available; completed windows leave the feed. The public footer's Maintenance calendar link is proven at 1440/390. Wording is carried by MAINT-009 and calendar-client/email attachments by MISSING MAINT-010.  Additional push-Verify evidence: `tests/e2e/helpers/calendar-assertions.mjs` (assertEmptyCalendar, called by publishing-contract setup before any maintenance exists) strictly checks the empty public /maintenance.ics response for CRLF, VERSION, PRODID and a UTC VTIMEZONE component. The same strict validator requires UID and DTSTAMP on every VEVENT in maintenanceCalendarFlow. Repair proposal: `tests/e2e/helpers/calendar-assertions.mjs` (assertEmptyCalendar, loaded by the existing MAINT-007 Per-window automation case in `tests/e2e/publishing-contract.test.mjs`, publishing shard) asserts the actual empty /maintenance.ics response has TZID Etc/UTC, STANDARD/DAYLIGHT observance, DTSTART, +0000 TZOFFSETFROM and TZOFFSETTO, with balanced BEGIN/END boundaries. Each VTIMEZONE in both empty and populated feeds must have those required properties. Negative assertions reject component-free calendars, missing TZID, missing observance, missing DTSTART, either missing offset and mismatched observance boundaries with the specific reason. maintenanceCalendarFlow retains the UID/SEQUENCE reschedule and STATUS:CANCELLED assertions.  Current public lifecycle assertions are in the cited maintenance journey; `tests/e2e/helpers/public-capacity-journey.mjs` (publicCapacityJourney), loaded by `tests/e2e/public-contract.test.mjs`, asserts the footer calendar link at 1440 and 390.
**Gap.** None.

#### MAINT-008 — Maintenance from deploy pipelines

Core · target · **missing**

**Requirement.** API, GitHub Action and Terraform run the operator’s maintenance job.

**Acceptance.**
1. Management API, published GitHub Action and Terraform provider create, start early, extend, update and complete windows with their wording, switches and MAINT-005/006 notices.
2. A test-installation pipeline opens a window with auto-complete off at deploy start, shows it In progress and completes it in its final step however long deployment runs.
3. Subscribers receive each required notice once.

**Evidence.** None.
**Gap.** Not built.

#### MAINT-009 — Maintenance wording

Core · target · **partial**

**Requirement.** Maintenance tells customers the impact of its window using incident wording rules.

**Acceptance.**
1. Newly scheduled maintenance requires affected-audience and customer-impact statements of at most 250 characters each once this capability ships.
2. Optional what-still-works and details allow 250 and 500 characters with UPDATE-013 plain-text direct links.
3. Scheduled, twenty-four-hour reminder, started, verifying, completed, rescheduled and cancelled notices render current wording beside the window through UPDATE-002.
4. Page, permalink, history, Atom, RSS, calendar, public maintenance APIs, email, SMS, Slack, Teams and both webhook formats carry that same wording.
5. Existing windows retain title-only notices without backfill.
6. Calendar event descriptions carry current maintenance wording.
7. Statuspage-format maintenance webhooks retain lifecycle, scheduled start/end and all maintenance updates.

**Evidence.** `tests/e2e/publishing-contract.test.mjs` (MAINT-001 MAINT-002 MAINT-003 MAINT-004 MAINT-005 MAINT-006 MAINT-007 MAINT-009 MAINT-013 — owner schedules, announces, starts, extends and completes maintenance without losing window or calendar history). The native schedule accepts affected-audience and customer-impact wording; the public permalink and Atom feed contain the customer impact. `tests/e2e/rer-mail.test.mjs` (Sign in, confirm a reader, publish, recover frozen mail, inspect receipts, notify maintenance and opt out). The delivery list contains one scheduled, reminder and started notice, and the two latest sent maintenance messages contain audience and impact in text and HTML.
**Gap.** Required-wording refusal and length limits, optional wording, Verifying and other notice wording, calendar wording, remaining non-email surfaces and Statuspage-format bodies remain unbuilt or unproven. The deleted migration proof for legacy null wording and unchanged title-only notices has no equivalent assertion in the current tests; no-backfill preservation is unproven.

#### MAINT-011 — Maintenance drafts and previews

Core · target · **missing** · From MAINT-009

**Requirement.** Operators prepare and preview maintenance before scheduling it.

**Acceptance.**
1. Maintenance wording drafts save and restore under UPDATE-005.
2. Before scheduling, each notice has UPDATE-004’s preview.
3. Scheduled, twenty-four-hour reminder and start notices match the previewed statement beside the window.

**Evidence.** None.
**Gap.** Wording drafts and previews are unbuilt; notice-to-preview parity remains unproven. The surviving scheduling and mail journeys do not exercise a maintenance draft or preview.

#### MAINT-012 — Maintenance updates during the window

Core · target · **missing** · From MAINT-009

**Requirement.** Operators keep wording and lifecycle current without losing published history.

**Acceptance.**
1. An operator publishes Scheduled, In progress, Verifying or Completed with the wording fields and chosen channels, including none.
2. Published updates are immutable; corrections add a new update under INCIDENT-004.
3. Each update commits atomically with its recipient set and notifies each selected subscriber once.
4. In progress starts early; Verifying retains Under maintenance claims while saying work is being checked; Completed releases claims.
5. Latest wording appears on every surface and earlier updates remain on the timeline.
6. Before start, a wording change is a Scheduled update notifying only selected channels.
7. An email-only In progress update reaches each eligible component email subscriber once and no webhook subscriber, with identical text on permalink, Atom and public maintenance API.

**Evidence.** None.
**Gap.** Maintenance updates, Verifying lifecycle, channel-specific notices and update timelines are unbuilt. The surviving start, completion and window-edit journeys do not prove immutable wording updates or selected-channel publication.

#### MAINT-013 — Maintenance automation chosen per window

Core · target · **partial** · From MAINT-009

**Requirement.** Each window chooses whether time starts and completes its work.

**Acceptance.**
1. Separate auto-start and auto-complete switches inherit page settings, initially both on.
2. With auto-start off the window is still Scheduled five minutes after start, sends one start-due operator alert and NOTIFY-016 push, and starts only through In progress publication.
3. With auto-complete off it stays In progress or Verifying after end without a Completed notice.
4. Fifteen minutes after end it shows the overrun beside its original end, raises one operator alert and remains on AUTO-003’s list.
5. At twenty minutes overdue no Completed notice exists; the operator’s Completed update then releases claims and sends exactly one.

**Evidence.** `tests/e2e/publishing-contract.test.mjs` (MAINT-001 MAINT-002 MAINT-003 MAINT-004 MAINT-005 MAINT-006 MAINT-007 MAINT-009 MAINT-013 — owner schedules, announces, starts, extends and completes maintenance without losing window or calendar history). An elapsed window starts automatically, auto-complete off retains In progress after end, overrun is reported, manual completion releases component claims with one completed notice, and a second window completes automatically. `tests/e2e/maintenance-timezone.test.mjs` (MAINT-009 PAGE-020 — operator schedules, reschedules and publishes maintenance in its configured zone, then a customer subscribes by keyboard). The native form changes auto-start to off, the API reads back false, and reload retains the scheduled window with its Start action.
**Gap.** Page-default inheritance, auto-start-off at five minutes, exactly one start-due/overrun operator alert, NOTIFY-016 push, AUTO-003 listing, the precise fifteen/twenty-minute boundaries, Verifying and lifecycle through published maintenance updates remain unbuilt or unproven.

#### MAINT-014 — Maintenance wording through every write door

Core · target · **missing** · From MAINT-009

**Requirement.** Each maintenance door carries the same wording and lifecycle choices.

**Acceptance.**
1. Native management operations accept wording, updates and both switches.
2. Statuspage-compatible create/update maps body text to impact wording and details and maps Scheduled, In progress, Verifying and Completed to the corresponding maintenance updates.
3. Compatibility operations map auto-start, auto-complete, twenty-four-hour reminder and notification selection.
4. GitHub Action, Terraform and AGENT-009 drafts fill the same fields.
5. A recorded Statuspage create with wording and auto-complete disabled produces identical wording and switch through API-002.

**Evidence.** `tests/e2e/publishing-contract.test.mjs` (MAINT-001 MAINT-002 MAINT-003 MAINT-004 MAINT-005 MAINT-006 MAINT-007 MAINT-009 MAINT-013 — owner schedules, announces, starts, extends and completes maintenance without losing window or calendar history). The authenticated native scheduling door accepts affected-audience, customer-impact, auto-start and auto-complete fields; its window and completion doors are exercised. `tests/e2e/maintenance-timezone.test.mjs` (MAINT-009 PAGE-020 — operator schedules, reschedules and publishes maintenance in its configured zone, then a customer subscribes by keyboard). The native scheduling/rescheduling form persists a changed auto-start choice. This is native-door evidence only.
**Gap.** Native wording-update publication, management-token, Statuspage-compatible, GitHub Action, Terraform and agent wording/update doors and compatibility mappings are unbuilt or unproven.

#### MAINT-015 — Imported maintenance automation and updates

Core · target · **missing** · From MAINT-009

**Requirement.** Imports retain source window controls and customer history.

**Acceptance.**
1. Future and running Statuspage windows retain their automatic-start/completion choices.
2. Each source message becomes a maintenance update with its original time and lifecycle.
3. A two-message fixture imports both silently under MOVE-002.

**Evidence.** None.
**Gap.** Imported Statuspage automation and maintenance-message mapping are unbuilt. Native scheduling and owner SQL rollback/restore do not prove source switch preservation or silent two-message maintenance-update import.

#### MAINT-010 — Maintenance calendar clients and mail attachments

Core · target · **missing** · Register R-21

**Requirement.** Subscribers consume maintenance in their calendar clients.

**Acceptance.**
1. The public feed can be added to Google Calendar, Outlook and Apple Calendar.
2. Every maintenance email through the declared mail door including managed relay carries an RFC 5545 attachment with the feed’s UID and window.
3. Rescheduling updates the same UID and cancellation marks it cancelled.

**Evidence.** None.
**Gap.** Calendar-client use and maintenance-email .ics attachments carved from MAINT-007; not built.

### Subscribers — target

#### SUB-013 — SMS subscribers

Core · target · **partial** · From SUB-013 · Cites BASE-MAIL-001

**Requirement.** Visitors and operators add consenting mobile subscribers. US and Canadian numbers are accepted by default; the owner chooses any additional countries. SUB-021 governs SMS link rendering.

**Acceptance.**
1. A visitor submits a valid international-format number; malformed or disabled-country numbers are refused.
2. One opt-in text per number per 24 hours names the page, frequency, rates notice and HELP/STOP keywords.
3. Only a YES reply activates the subscription, retaining number, consent time, page and exact wording as TCPA evidence.
4. STOP, UNSUBSCRIBE, CANCEL, END and QUIT each deactivate immediately and send the single carrier-required confirmation; HELP returns the page and support contact.
5. A Twilio test-account journey subscribes a US number, confirms with YES and receives one selected-component notification; an unconfirmed number receives only its opt-in, and a STOP suppresses the next publish.
6. Messages fit at most two segments and always retain a permanent update link; component selection follows SUB-004.
7. A mixed email, phone and webhook CSV with components and language dry-runs with created, skipped and refused counts and no writes.
8. Operators add a single email, phone or webhook destination with contact address and selected components through the subscriber form.

**Evidence.** `tests/e2e/delivery-contract.test.mjs` (Attributed operator additions, confirmed component scope, private management and opt-out, delivery shard), loading `tests/e2e/helpers/sms-subscriber-flow.mjs` (smsSubscriberFlow) and `tests/e2e/delivery-contract.test.mjs` / `tests/e2e/delivery-contract.test.mjs` (smsBrowserFlow). At the synthetic Twilio HTTP edge, the native public form admits US/Canada E.164 numbers, rejects malformed and disabled-country numbers including non-US/Canada NANP numbers, and admits an owner-enabled country. Repeated opt-ins send one text per number per 24 hours naming the page, frequency, rates and HELP/STOP. Unsigned and wrong-signature replies return 401 without mutations or sends; signed YES records number, actual consent time, page and exact wording once. STOP, UNSUBSCRIBE, CANCEL, END and QUIT each deactivate immediately with one confirmation, including replay deduplication; HELP carries the page and support contact. A selected active number receives one publish, unconfirmed numbers receive only their opt-in, unrelated components send nothing and the next publication after STOP records suppression. Incident, maintenance and report SMS carry intact HTTPS URLs with punctuation outside, literal non-HTTPS schemes, no provider shortening/tracking fields and a complete permanent public link; an overlength update stays within two segments without a partial URL. Mixed email/phone/webhook CSV preview returns created/skipped/refused counts with no writes or sends; operator Add preserves phone components and sends one opt-in. Native browser assertions cover subscribe, Add, country Settings and the SMS composer control with axe, overflow, hydration and full-label checks at 1440/390. `tests/auth-adoption/upgrade.test.mjs` preserves populated 0064 subscriber/token/delivery history through additive `migrations/core/0065_sms_subscriptions.sql`; `tests/auth-adoption/portability.test.mjs` retains the six durable SMS tables; `tests/e2e/delivery-contract.test.mjs` erases SMS consent, replay authority and provider identifiers while preserving another subscriber. `tests/e2e/helpers/subscriber-add-flow.mjs` additionally proves that without provider configuration a valid public phone request returns 503 with no subscriber creation or fallback mail. Optional Twilio environment fields are labelled in setup and declared in seed.json; its nonGoals stay unchanged. Partial proposal, uncounted pending ct judgment.
**Gap.** Twilio test-account receipt pending (held-key Mac run); released seed.json nonGoals SMS exclusion is removed by the release that ships the full clause; page names or support contacts whose complete carrier wording exceeds two segments are refused rather than truncated.

#### SUB-021 — Literal links in SMS

Core · target · **partial** · From SUB-013 · Cites BASE-INPUT-002, BASE-MAIL-001

**Requirement.** SMS carrying incident, maintenance or post-incident-report wording preserves links across every subscription door, audience variant and language, including SUB-016, SUB-017, SUB-019, AUD-004, MOVE-010, UPDATE-010 and I18N-002. The technical profile is specified in [Delivery details](docs/contract/delivery-details.md).

**Acceptance.**
1. Every bare secure-web URL appears unchanged without a label, shortener, redirect or click tracking; punctuation remains outside.
2. Other URL schemes and markup remain plain text.
3. At the two-segment cut point a URL is complete or absent, never cut or changed; the permanent update link always remains.
4. Through Twilio test credentials, the cited secure-web URL reaches the subscriber intact with the trailing period outside; an overlength update stays within two segments with no partial URL and the permanent link.

**Evidence.** `tests/e2e/delivery-contract.test.mjs` (Attributed operator additions, confirmed component scope, private management and opt-out, delivery shard), loading `tests/e2e/helpers/sms-subscriber-flow.mjs` (smsSubscriberFlow) and `tests/e2e/delivery-contract.test.mjs` / `tests/e2e/delivery-contract.test.mjs` (smsBrowserFlow). At the synthetic Twilio HTTP edge, the native public form admits US/Canada E.164 numbers, rejects malformed and disabled-country numbers including non-US/Canada NANP numbers, and admits an owner-enabled country. Repeated opt-ins send one text per number per 24 hours naming the page, frequency, rates and HELP/STOP. Unsigned and wrong-signature replies return 401 without mutations or sends; signed YES records number, actual consent time, page and exact wording once. STOP, UNSUBSCRIBE, CANCEL, END and QUIT each deactivate immediately with one confirmation, including replay deduplication; HELP carries the page and support contact. A selected active number receives one publish, unconfirmed numbers receive only their opt-in, unrelated components send nothing and the next publication after STOP records suppression. Incident, maintenance and report SMS carry intact HTTPS URLs with punctuation outside, literal non-HTTPS schemes, no provider shortening/tracking fields and a complete permanent public link; an overlength update stays within two segments without a partial URL. Mixed email/phone/webhook CSV preview returns created/skipped/refused counts with no writes or sends; operator Add preserves phone components and sends one opt-in. Native browser assertions cover subscribe, Add, country Settings and the SMS composer control with axe, overflow, hydration and full-label checks at 1440/390. `tests/auth-adoption/upgrade.test.mjs` preserves populated 0064 subscriber/token/delivery history through additive `migrations/core/0065_sms_subscriptions.sql`; `tests/auth-adoption/portability.test.mjs` retains the six durable SMS tables; `tests/e2e/delivery-contract.test.mjs` erases SMS consent, replay authority and provider identifiers while preserving another subscriber. `tests/e2e/helpers/subscriber-add-flow.mjs` additionally proves that without provider configuration a valid public phone request returns 503 with no subscriber creation or fallback mail. Optional Twilio environment fields are labelled in setup and declared in seed.json; its nonGoals stay unchanged. Partial proposal, uncounted pending ct judgment.
**Gap.** Twilio test-account receipt pending (held-key Mac run); released seed.json nonGoals SMS exclusion is removed by the release that ships the full clause; page names or support contacts whose complete carrier wording exceeds two segments are refused rather than truncated.

#### SUB-014 — Self-serve Slack subscriptions

Core · target · **done** · Cites BASE-MAIL-001 · Register R-41

**Requirement.** A public visitor receives selected-component updates in their Slack workspace through Slack's own authorization step. The technical profile is specified in [Delivery details](docs/contract/delivery-details.md).

**Acceptance.**
1. The public page offers Get updates in Slack, reaches Slack authorization with only its incoming-webhook permission, and lets the visitor choose a channel and components.
2. The resulting subscriber is active and its webhook is stored encrypted.
3. The next eligible publication receives one UPDATE-002-rendered Slack post; secure-web URLs retain their own text with trailing punctuation outside.
4. App removal, revoked tokens and an archived-channel response each deactivate with that reason and prevent the next publication.
5. A recorded provider-schema OAuth exchange creates the subscription and its recorded app-uninstalled event removes it.

**Evidence.** `tests/e2e/channels-and-presets.test.mjs` (INTEG-002 SUB-014 SUB-015 NOTIFY-011 NOTIFY-012 UPDATE-013 — Private channels deliver the selected publication once with literal text and punctuated links), invoking `tests/e2e/helpers/self-serve-chat-flow.mjs` (selfServeChatFlow) and `tests/e2e/slack-subscriptions-helper.mjs` (prepareSlackSubscription, verifySlackPublication, removeSlackSubscription) in push Verify’s delivery shard. Point 1: the real public form has the Get updates in Slack submit control and offers the selected and unrelated visible components; incoming-webhook is the only OAuth scope; the recorded callback saves exactly the two selected component identities and the chosen Slack workspace and channel. Point 2: the subscriber is active with a nonempty encrypted webhook and no plaintext destination. Point 3: the next eligible publication produces exactly one Slack post, preserving the bare secure-web URL with trailing punctuation outside. Point 4: app_uninstalled, tokens_revoked and channel_is_archived each deactivate with that reason and suppress the next publication. Point 5: the real OAuth adapter matches the recorded request and response in `tests/fixtures/slack-subscriptions/oauth-exchange.json`; signed recorded events from `tests/fixtures/slack-subscriptions/events.json` remove the subscription. The journey also erases its subscriber-owned destination. These are synthetic provider-edge fixtures; live Slack tenant acceptance remains not run in R-41 and no live installation or release is claimed.
**Gap.** None.

#### SUB-015 — Self-serve Microsoft Teams subscriptions

Core · target · **partial** · Cites BASE-MAIL-001, BASE-INPUT-002 · Register R-41

**Requirement.** A public visitor subscribes a Microsoft Teams channel by supplying a documented Teams Workflows destination and confirming the card delivered there. The technical profile is specified in [Delivery details](docs/contract/delivery-details.md).

**Acceptance.**
1. Only Microsoft's documented webhook hosts are accepted; another host is refused without receiving a card.
2. A verification card reaches the channel, but receipt and opening its link leave the subscription pending until the visitor confirms.
3. Each eligible update arrives as an Adaptive Card using UPDATE-002's rendering.
4. Every secure-web link shows its URL with trailing punctuation outside; other schemes and markup are never links.
5. Component selection and SUB-010's failing-destination rules apply.

**Evidence.** Synthetic Workflows network-edge proof: `tests/e2e/channels-and-presets.test.mjs` (SUB-014 NOTIFY-011 NOTIFY-012 UPDATE-013 — Private channels deliver the selected publication once with literal text and punctuated links), `tests/e2e/helpers/self-serve-chat-flow.mjs` (selfServeChatFlow) and `tests/e2e/teams-subscriptions-helper.mjs`. A native public form sends a verification Adaptive Card; only channel confirmation activates the encrypted selected-component subscription, which receives the next publish. Non-Microsoft hosts return 400. Bare HTTPS links show the URL itself with punctuation outside. Other schemes and markup are asserted for the operator card in `tests/e2e/channels-and-presets.test.mjs`:135-146; the subscriber card proof asserts the Acceptance sentence’s HTTPS link. Ten failed deliveries deactivate the endpoint and the next publish skips it. Submission, channel confirmation and success screens pass axe, overflow and hydration checks at 1440/390. No live Teams call was made from this run.
**Gap.** Old cited evidence asserts non-Microsoft refusal; one verification card; card receipt pending; link open pending. Unasserted: the refused non-Microsoft destination receives no outbound card; component selection asserted in tests/e2e/helpers/chat-preferences-flow.mjs outside the old Evidence set.

#### SUB-016 — Preferences on every channel

Core · target · **partial**

**Requirement.** Subscribers choose components and event preferences consistently on every channel, including audience subscriptions.

**Acceptance.**
1. Email, SMS, webhook, Slack, Teams and AUD-004 audience subscriptions select any combination of incidents, maintenance and component status changes.
2. They may restrict incidents to Partially unavailable or worse, or follow one incident under SUB-019.
3. Webhook subscriptions initially select component changes; other channels initially do not.
4. The management page changes these preferences without an operator session.
5. A maintenance-only SMS subscriber receives the maintenance start and nothing for an incident on the same component.
6. An impact-filtered email subscriber receives nothing for a Degraded incident and is notified when it escalates.

**Evidence.** `tests/e2e/delivery-contract.test.mjs` (Attributed operator additions, confirmed component scope, private management and opt-out), `tests/e2e/helpers/subscriber-preferences-flow.mjs` (subscriberPreferencesFlow), `tests/e2e/delivery-contract.test.mjs` and `tests/e2e/helpers/webhook-format-browser-flow.mjs`. Public subscription, operator Add and session-free token management retain component, event-kind and impact-threshold preferences for email, webhook, Slack and Teams. The recorded email edge receives nothing for a Degraded incident and receives its escalation; maintenance-only email and webhook recipients receive maintenance notices and no incident. Webhooks default to component changes; other channels do not. Existing public, management and operator screens pass axe, overflow and hydration checks at 1440/390. `tests/e2e/helpers/chat-preferences-flow.mjs` (chatPreferencesFlow), within the existing private-channel journey in `tests/e2e/channels-and-presets.test.mjs`, proves maintenance-only Slack and Teams, incident suppression, retained-recipient rescheduling and cancellation, and configured-zone delivery. `tests/e2e/helpers/sms-subscriber-flow.mjs` (smsSubscriberFlow, loaded by the same existing delivery registration) proves a signed-YES SMS subscriber edits preferences on the session-free SUB-007 management page, receives the maintenance start and no incident on the same component. Partial Gap narrowing is a proposal pending ct judgment.
**Gap.** single-incident following waits for SUB-019; audience subscriptions wait for AUD-004. SMS component-only status notifications remain unbuilt.

#### SUB-017 — Subscriber import and export

Core · target · **partial** · Cites BASE-DATA-001, BASE-OPS-005

**Requirement.** Operators bring subscriber lists in or out through reviewable CSV and single-subscriber doors. SUB-013 owns phone intake, I18N-001 language intake and SUB-023 import-capacity refusals.

**Acceptance.**
1. CSV email and webhook rows, with components and contact addresses, dry-run as created, skipped or refused with reasons and no writes or sends.
2. A 100-row file with three malformed rows applies as 97 pending subscriptions; only the owner's explicit invitation action sends their confirmation, at most once each.
3. The export has all 97 rows with channel, state, components and consent time.
4. The one-row form and management API create an email or webhook subscriber with its components and contact address, send one channel confirmation and leave it pending until confirmed.
5. Adding the named customer address for two components delivers each selected component's update after confirmation and nothing for a third.
6. The subscriber list and audit retain the adding operator's identity.

**Evidence.** `tests/e2e/statuspage-import.test.mjs` (imports keep history silent, CSV dry runs write nothing, and pending subscribers receive only explicit owner invitations), `tests/e2e/helpers/subscriber-csv-flow.mjs`, `tests/e2e/delivery-contract.test.mjs` (Attributed operator additions, confirmed component scope, private management and opt-out), `tests/e2e/helpers/subscriber-add-flow.mjs`, `tests/e2e/delivery-contract.test.mjs`. Public operator CSV preview writes nothing and reports 97 created plus three reasoned refusals from 100 rows; apply creates 97 pending subscriptions without mail. Explicit invitations send 50, then 47, then zero, and CSV export retains 97 rows with channel, state, selections and consent time. The Add subscriber public door sends one confirmation; after confirmation its two selected components receive updates and a third does not. The private list and audit record the adding operator. At 1440/390 native browser journeys prove Add, attribution, dry run, apply, explicit idempotent invitations and CSV export. Phone, multi-language and over-limit obligations are carried by SUB-013, I18N-001 and SUB-020 after the approved carves; API-001 inherits its future door. Additional push-Verify evidence: `tests/e2e/statuspage-import.test.mjs` (MOVE-002 — SUB-017 and SUB-020 imports keep history silent, CSV dry runs write nothing, pending subscribers need explicit invitations, and capacity refuses excess without writes), loading `tests/e2e/helpers/subscriber-csv-flow.mjs` and `tests/e2e/delivery-contract.test.mjs` in the imports-statuspage shard. The authenticated owner-only batch-summary door returns each durable CSV batch and its remaining eligible invitations without destinations or tokens. Native reads prove 97 to 47 to zero remaining across existing bounded send actions, signed-out 401 and public-host 404; the existing public role policy refuses member invitations with 403 while the owner read returns 200. At 1440/390 two import batches remain selectable after reload, each sends only on the existing explicit action, and both retain zero remaining after another reload. The screen passes axe, overflow and hydration checks; the completed batch action is disabled. Additional phone-carve evidence: `tests/e2e/helpers/sms-subscriber-flow.mjs` (smsSubscriberFlow) and `tests/e2e/delivery-contract.test.mjs` (smsBrowserFlow), within the existing delivery registration, prove phone CSV dry-run counts with no writes and Add subscriber phone/component selection with one opt-in at 1440/390. Valid phones no longer receive the former SUB-013-unavailable refusal; SUB-017 status is unchanged.
**Gap.** Old cited evidence asserts dry run reports 97 created; dry run reports zero skipped; dry run reports three refused; dry-run rows and reasons. Unasserted: dry-run database comparison asserted in tests/e2e/helpers/subscriber-management-fixture.mjs outside the old Evidence set; the one-row form persists the webhook destination and contact; webhook API component selection is read back; the form persists the exact selected component identifiers.

#### SUB-018 — Statuspage-format webhooks

Core · target · **partial** · Rules D-2

**Requirement.** Each new webhook subscriber has a public self-service creation door with Lamp or Statuspage format choice, verification and abuse controls, as RL-102 requires. Private creation, CSV and token management remain available; existing formats change only explicitly. MOVE-010 owns imported formats. The technical profile is specified in [Delivery details](docs/contract/delivery-details.md).

**Acceptance.**
1. An eligible person creates a public webhook subscription and chooses Lamp or Statuspage format through the verified, abuse-controlled public door; private doors retain both choices and existing formats until explicitly changed.
2. The Statuspage incident body carries its documented metadata, page status, every incident field and the complete published-update array, with stable native or imported Statuspage-compatible identifiers.
3. Maintenance uses the documented incident-body shape, maintenance states, scheduled window and existing notices; MAINT-009 governs in-window text and updates.
4. Component statuses map one to one to COMP-001 and PAGE-016; NOTIFY-017 governs component-change bodies.
5. UPDATE-001 fields render with UPDATE-002 while retaining the update text unchanged, including a secure-web URL followed by its punctuation, without generated markup.
6. The unchanged official-schema receiver accepts first update, second update and resolution as three bodies, each with the complete published-update array.
7. Those deliveries verify through SUB-009's signature scheme and expose no subscriber address; SUB-009, NOTIFY-003, NOTIFY-005 and SUB-010 govern success, retries, duplicates and failure.

**Evidence.** `src/core/shared/statuspage-mapping.ts`, `src/core/shared/statuspage-records.ts`, `src/core/features/deliveries/statuspage-webhook.ts`, `src/core/features/deliveries/statuspage-webhook.repository.ts`, `src/core/features/subscribers/webhook-format.repository.ts`, `src/core/features/subscribers/ui/webhook-format.tsx`, `tests/e2e/helpers/statuspage-webhook-receiver.mjs`, `tests/e2e/helpers/statuspage-webhook-flow.mjs`, `tests/e2e/helpers/statuspage-webhook-maintenance.mjs`, `tests/e2e/delivery-contract.test.mjs` (the existing signed-webhook journey, extended and retitled; receiver authored from this clause and frozen before delivery implementation).
**Gap.** New webhook subscriptions choose Lamp or Statuspage through the operator add, legacy creation and optional CSV webhook_format doors; omission defaults new subscriptions to Lamp and preserves an existing recipient choice on legacy retry. The recipient management form changes the format inside its existing token-authorized transaction. A canonical subscriber column preserves it through technical archives and page-data JSON. The public API and webhook renderer use one status, stable native/imported ID and record projection. A strict controlled receiver accepts the three incident bodies with complete one/two/three-update arrays and existing maintenance notices/windows; exact-body HMAC signatures verify, unsubscribe links work, no subscriber address is present, and the impact text See https://help.example.com/kb/123. remains plain and unchanged. Browser proof in tests/e2e/delivery-contract.test.mjs and tests/e2e/helpers/webhook-format-browser-flow.mjs covers the private chooser and public management form at 1440 and 390. Component-change bodies and acceptance belong to NOTIFY-017; imported webhook format belongs to MOVE-010, and maintenance in-window wording/updates to MAINT-009, after the approved carves. Gap: The existing public subscribe form accepts email only, so there is no public webhook form in which to mount a format chooser. Operator creation, CSV and token-authorized management expose the choice. The public creation door and format chooser required by RL-102 remain unbuilt.

#### SUB-019 — Follow one incident

Core · target · **done** · From SUB-019 · Cites BASE-ACCESS-003, BASE-PUBLIC-001, BASE-DATA-003, BASE-OPS-003

**Requirement.** Every incident permalink provides a script-free single-incident subscription form; email, enabled SMS, and webhooks with a contact address are offered. SUB-022 governs its notification lifetime.

**Acceptance.**
1. The initial page offers email, enabled SMS and webhook destination with contact address and works without scripting.
2. SUB-001 confirmation, daily confirmation allowance and cross-site refusal; SUB-002 confirmation policy; SUB-003 pending expiry; and SUB-012 neutral responses apply.
3. With scripting disabled, an email visitor subscribes from one incident's permalink and confirms it; resubmitting gets the neutral response and cross-site submission is refused.
4. The token management page names the followed incident and unsubscribes at once; operators see these subscribers on the incident and subscriber list.
5. The management API lists, creates and deletes incident subscriptions, including the Statuspage-compatible incident-subscriber doors.
6. Unresolved Statuspage incidents import subscribers as pending under MOVE-002; these consume SUB-020 capacity, and a full channel creates and sends nothing while showing its usual full-channel response.

**Evidence.** Points 1 and 3: `tests/e2e/delivery-contract.test.mjs` (Owner-selected provider fallback preserves frozen notifications and reconciles delivery receipts), loading `tests/e2e/helpers/incident-follow-browser-flow.mjs` (incidentFollowBrowserFlow): script-free public email, configured SMS and webhook forms, confirmation, per-recipient report choice and 1440 and 390 screens. Point 2: the same file (Scoped incident subscriptions — native and Statuspage API consent, private reads and revoked writes), loading `tests/e2e/helpers/incident-follow-flow.mjs` (incidentFollowFlow), `tests/e2e/helpers/incident-follow-consent-flow.mjs` (incidentFollowConsentFlow); the same registration file (Subscriber consent, selected publication, channel delivery, export and erasure) loads `tests/e2e/helpers/incident-follow-sms-flow.mjs`: daily address allowance, pending expiry, neutral replies, cross-site refusal and signed channel consent. Point 4: incidentFollowFlow and incidentFollowBrowserFlow prove scoped token management, immediate unsubscribe and both operator views. Point 5: `tests/e2e/helpers/incident-subscription-api-flow.mjs` (incidentSubscriptionApiFlow), loaded by the same file (Scoped incident subscriptions — native and Statuspage API consent, private reads and revoked writes), proves native and Statuspage-compatible CRUD, explicit private read and write scopes, refusal of existing public-data readers, wrong-incident refusal and revoked-credential refusal without writes. Point 6: `tests/e2e/statuspage-import.test.mjs` (owner reviews provider history, imports silently, keeps public readers, invites deliberately and conditionally undoes), loading `tests/e2e/helpers/incident-subscriber-import-flow.mjs` (incidentSubscriberImportFlow) and `tests/e2e/helpers/imported-incident-live-flow.mjs`; incidentFollowFlow proves capacity refusal without subscriber writes or mail.
**Gap.** None.

#### SUB-022 — Single-incident subscription lifetime

Core · target · **done** · From SUB-019 · Cites BASE-DATA-003, BASE-OPS-003

**Requirement.** A single-incident subscriber hears only that incident's later communication, with an explicit option to include its post-incident report.

**Acceptance.**
1. Later updates and resolution arrive for the followed incident; another incident on the same component, maintenance and component changes send nothing.
2. Without the report option the subscription ends after resolution delivery; with it, it ends at report publication or 30 days after resolution, whichever comes first.
3. A reopening before the subscription ends is notified.
4. After ending, no more notification is sent and the address is deleted within 24 hours unless it has another subscription.
5. The script-free journey follows one incident through its next update and resolution, receives nothing for a second incident or maintenance and nothing after resolution, and reads address deletion 24 hours later.

**Evidence.** `tests/e2e/delivery-contract.test.mjs` (Scoped incident subscriptions — native and Statuspage API consent, private reads and revoked writes), loading `tests/e2e/helpers/incident-follow-flow.mjs` (incidentFollowFlow), `tests/e2e/helpers/incident-follow-lifecycle-flow.mjs` (incidentFollowLifecycleFlow), `tests/e2e/helpers/incident-follow-consent-flow.mjs` (incidentFollowConsentFlow); the same registration file (Subscriber consent, selected publication, channel delivery, export and erasure) loads `tests/e2e/helpers/incident-follow-sms-flow.mjs`. Point 1: only the followed incident delivers updates and resolution; other incidents, maintenance and component changes deliver nothing. Point 2: delivered resolution ends a follow without its report; report publication or the controlled 30-day deadline ends report following. Point 3: reopening before ending delivers; reopening afterwards does not. Point 4: scheduled erasure removes the ended scope within 24 hours, revokes old authority, preserves an independent subscription; `tests/e2e/helpers/incident-subscription-api-flow.mjs` (incidentSubscriptionApiFlow) proves captured confirmation and management links cannot resurrect or expose an erased follower. Point 5: `tests/e2e/helpers/incident-follow-browser-flow.mjs` (incidentFollowBrowserFlow), loaded by the same file (Owner-selected provider fallback preserves frozen notifications and reconciles delivery receipts), proves script-free INC-7 confirmation and management at 1440 and 390; `tests/e2e/helpers/incident-follow-browser-lifecycle.mjs` (incidentFollowBrowserLifecycle) keeps that same script-free recipient through its next update, exclusion cases, delivered resolution, later suppression and scheduled address deletion.
**Gap.** None.

#### SUB-020 — Subscriber limits are stated, enforced and reported

Core · target · **partial** · From SUB-020

**Requirement.** Subscriber admission and operator visibility respect the scale qualified by NOTIFY-020. SUB-023 owns import-capacity review.

**Acceptance.**
1. The installation admits at most 25,000 subscriptions total, including at most 2,500 webhooks and 1,000 Slack and Teams subscriptions together.
2. Pending, active and incident subscriptions count; deactivated and deleted ones do not.
3. Settings shows each channel count against its limit.
4. At full capacity, new and existing addresses receive the same script-free full-channel page with Atom and RSS alternatives.
5. The full channel creates nothing and sends no confirmation or management email.
6. Each channel's 80% and 100% crossings alert operators once.
7. A full channel remains in Follow-ups until below capacity; over-limit subscribers are never accepted then silently undelivered.

**Evidence.** `tests/e2e/statuspage-import.test.mjs` (MOVE-002 — SUB-017 and SUB-020 imports keep history silent, CSV dry runs write nothing, pending subscribers need explicit invitations, and capacity refuses excess without writes), `tests/e2e/helpers/subscriber-limits-flow.mjs` (subscriberLimitsFlow, subscriberChannelLimitsFlow) and `tests/e2e/delivery-contract.test.mjs` (subscriberLimitsBrowserFlow). A direct fixture-database setup inserts 24,998 subscriptions and two public opt-ins reach 25,000; script-free public POSTs for a new and an existing address return identical 409 pages with Atom/RSS links, create nothing and send nothing. Recorded operator mail receives each 80% and 100% alert once; full Follow-ups remain until below capacity. The 300-into-100-free import and CSV each name an excess of 200, refuse exactly those rows, and refuse apply without changing any application table or mail; narrowed fresh dry runs apply. A full installation also refuses a single-row import unchanged. Saved and recorded fixed-origin API responses with 5,000 and 25,000 subscribers fit without narrowing. Pending/active counts and webhook/chat sublimits are enforced atomically. Subscribers (/app/subscribers), Move in, Follow-ups and full-capacity public pages pass axe, overflow and hydration checks at 1440/390. This is fixture admission proof, not a 25,000-recipient delivery qualification.
**Gap.** Old cited evidence asserts total capacity; the full seeded webhook channel refuses another destination; freeing one webhook slot admits a pending subscriber; that pending subscriber exhausts the recovered webhook slot. Unasserted: the reported combined-chat count and limit are explicitly 1000; incident subscriptions consume capacity; deleted subscribers release capacity; each channel count in Settings browser assertions; no subscriber row in any other state is created; every channel crossing alert; the full-channel refusal creates no subscriber in another state.

#### SUB-023 — Import subscriber capacity

Core · target · **partial** · From SUB-020

**Requirement.** CSV and every move-in import calculate subscriber capacity before writing. Operators narrow channels, components or subscribers in a fresh review when the source exceeds capacity.

**Acceptance.**
1. Each dry run names the channel excess and marks excess rows refused with the over-limit reason.
2. An over-limit apply is refused and makes no changes; a fresh narrowed review must fit before apply succeeds.
3. A 5,000-subscriber Statuspage Business source and 25,000-subscriber Enterprise source fit without narrowing.
4. With 100 slots free, a 300-subscriber source reports excess 200, refuses those 200 rows and apply; removing email permits fresh review and successful apply.
5. The same excess/refusal behavior holds for a CSV until a fresh file fits.

**Evidence.** `tests/e2e/statuspage-import.test.mjs` (MOVE-002 — SUB-017 and SUB-020 imports keep history silent, CSV dry runs write nothing, pending subscribers need explicit invitations, and capacity refuses excess without writes), `tests/e2e/helpers/subscriber-limits-flow.mjs` (subscriberLimitsFlow, subscriberChannelLimitsFlow) and `tests/e2e/delivery-contract.test.mjs` (subscriberLimitsBrowserFlow). A direct fixture-database setup inserts 24,998 subscriptions and two public opt-ins reach 25,000; script-free public POSTs for a new and an existing address return identical 409 pages with Atom/RSS links, create nothing and send nothing. Recorded operator mail receives each 80% and 100% alert once; full Follow-ups remain until below capacity. The 300-into-100-free import and CSV each name an excess of 200, refuse exactly those rows, and refuse apply without changing any application table or mail; narrowed fresh dry runs apply. A full installation also refuses a single-row import unchanged. Saved and recorded fixed-origin API responses with 5,000 and 25,000 subscribers fit without narrowing. Pending/active counts and webhook/chat sublimits are enforced atomically. Subscribers (/app/subscribers), Move in, Follow-ups and full-capacity public pages pass axe, overflow and hydration checks at 1440/390. This is fixture admission proof, not a 25,000-recipient delivery qualification.
**Gap.** Old cited evidence asserts move-in excess named; move-in refused rows; CSV excess named; CSV refused rows. Unasserted: move-in database comparison asserted in tests/e2e/helpers/subscriber-management-fixture.mjs outside the old Evidence set; CSV database comparison asserted in tests/e2e/helpers/subscriber-management-fixture.mjs outside the old Evidence set; the narrowed apply persists all expected non-subscriber records; the over-limit apply creates no subscriber in another state; the email-free apply persists the expected source component; the fitting CSV apply actually stores one pending subscriber.

### Notifications — target

#### NOTIFY-013 — Redundant email delivery

Core · target · **partial** · Cites BASE-MAIL-001, BASE-OPS-003 · Rules D-1

**Requirement.** The owner selects primary and secondary providers from SendGrid, Mailgun, Amazon SES, Postmark and Resend, authenticated for the From domain. RL-101 requires safe failover around one durable Lamp notification identity with reconciled provider attempts. The technical profile is specified in [Delivery details](docs/contract/delivery-details.md).

**Acceptance.**
1. Safe explicit retryable non-acceptance lasting five minutes permits secondary submission; an outage before submission also permits switching under NOTIFY-005's identity rule.
2. Ambiguous acceptance stays pending for reconciliation without a second-provider send; a server error alone is never universal proof of non-acceptance.
3. Submitted Message-ID is preserved where supported; SES's assigned identifier is accepted and mapped to the durable Lamp identity.
4. Each provider's documented event authentication is verified honestly, including Postmark Basic authentication rather than a fabricated payload signature.
5. The log records the accepting provider; restoring the primary sends no duplicate.
6. Provider-specific safe-rejection fixtures complete secondary acceptance within seven minutes; each authenticated provider bounce fixture deactivates the address, while uncertain primary submission sends nowhere else.

**Evidence.** `tests/e2e/delivery-contract.test.mjs` (NOTIFY-013 NOTIFY-002 NOTIFY-004 NOTIFY-005 NOTIFY-007 NOTIFY-008 NOTIFY-010 — Durable email capture, delivery records and frozen headers), loading `tests/e2e/helpers/mail-failover-flow.mjs`, `tests/e2e/helpers/mail-provider-fixtures.mjs` and `tests/e2e/helpers/mail-settings-browser-flow.mjs` in push Verify’s delivery shard. Real public sign-in, subscription, confirmation, owner Settings, publish, scheduled and Queue doors use only provider network-edge fixtures. Resend 503 failures reach Mailgun, SES or Postmark once at six controlled minutes with a frozen submitted Message-ID, accepting-provider log and no replay after primary recovery; rapid Queue replays do not exhaust the failover deadline. Secondary sending defaults off and requires an explicit owner selection from deployment-connected providers. The production Settings selector and real delivery acceptance row run at 1440/390 with reload persistence, axe, overflow and hydration assertions. Accepted receipts survive disabled or removed secondary configuration, while unconfirmed routing and changed credentials deny a new provider submission. Mailgun HMAC and SES SNS signatures reject invalid fixtures and deactivate hard-bounced addresses; Postmark’s documented Basic authentication is proved without calling it a payload signature. Existing `tests/e2e/rer-mail.test.mjs` and Resend event assertions retain their signed callback coverage. Provider domain reads and disabled tracking are asserted, including explicit disabled SES VDM engagement metrics, no OPEN/CLICK destinations and the configured SNS feedback route. `tests/e2e/rer-mail.test.mjs` pins the stable non-incident Message-ID; populated technical archive journeys retain routing and owner selection.
**Gap.** Native provider adapters and controlled failover are evidenced. Reported-outage switching remains unbuilt; safe versus uncertain provider outcomes and reconciliation must meet RL-101 without treating every server error as rejection. Controlled fixtures do not prove mailbox receipt or exact-once mailbox delivery.

#### NOTIFY-014 — SMS delivery

Core · target · **partial** · From NOTIFY-014 · Cites BASE-MAIL-001, BASE-OPS-003 · Register R-42

**Requirement.** SMS notifications use Twilio or Plivo through the owner's registered 10DLC campaign or verified toll-free sender. NOTIFY-021 governs costs and caps. The technical profile is specified in [Delivery details](docs/contract/delivery-details.md).

**Acceptance.**
1. When both providers are configured, a retryable failure uses the other without duplicate notification effects.
2. Authenticated provider callbacks record delivered, undelivered or failed outcomes.
3. Every eligible message is provider-accepted within the displayed registered-throughput bound: subscriber count divided by campaign messages per second, plus 60 seconds; NOTIFY-018 reports missed bounds.
4. Through Twilio test credentials, a three-recipient publish records three delivered receipts; an unsigned callback is refused.
5. Both providers receive SUB-021's exact rendered text without shortening, click tracking or Lamp redirect; the three-recipient provider requests keep the cited secure-web URL intact.

**Evidence.** `tests/e2e/helpers/sms-delivery-receipts-flow.mjs` (smsDeliveryReceiptsFlow), loaded by the existing attributed-subscriber journey in `tests/e2e/delivery-contract.test.mjs`, push Verify delivery shard: a public publish sends exactly three requests through the Twilio network-edge fake with SUB-013 rendering unchanged, the full URL and outside period, and no shortening/tracking option or redirect; three signed callbacks record delivered receipts; fresh publications record undelivered and failed, while unsigned and wrong-signature callbacks return 401 and leave SMS storage and the delivery log unchanged; the operator log exposes subscriber, SMS channel, update, queue/outcome instants, channel/outcome/update filters and matching CSV rows, the delivered and SMS + Failed exports carrying each text's providerOutcome (delivered, undelivered, failed). `tests/e2e/delivery-contract.test.mjs` (smsBrowserFlow via smsBrowserRuntime in the same registration) matches SMS delivery-log rows to each filter's response by phone, pill state and provider outcome, and audits rows and filters at 1440/390 for axe, overflow, unclipped controls and hydration. PARTIAL PROPOSAL, uncounted pending ct judgment.
**Gap.** Twilio test-account receipt remains pending. Plivo callback signatures and retryable failover are unbuilt; the stated acceptance-time bound is unmeasured. The SMS non-goal exclusion remains until the release shipping the full clause. NOTIFY-021 separately carries the wholly absent cost and cap controls.

#### NOTIFY-021 — SMS cost and spend controls

Core · target · **missing** · From NOTIFY-014 · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-011

**Requirement.** Settings estimates the next SMS publication's USD cost from subscriber counts and the owner-entered provider rate, and exposes a monthly SMS spend cap. Agent sends carry external and money classes; company policy decides their disposition.

**Acceptance.**
1. The displayed estimate equals the eligible subscriber count and entered USD rate.
2. For a person publishing above the monthly cap, only SMS waits for that operator's confirmation while page, email and feeds continue; an agent call carries server-computed external and money facts and follows company policy.
3. A test-account publication above the cap queues SMS until the required person confirms under the held company policy, without delaying other channels.

**Evidence.** `tests/e2e/helpers/sms-delivery-receipts-flow.mjs` (smsDeliveryReceiptsFlow), loaded by the existing attributed-subscriber journey in `tests/e2e/delivery-contract.test.mjs`, push Verify delivery shard: a public publish sends exactly three requests through the Twilio network-edge fake with SUB-013 rendering unchanged, the full URL and outside period, and no shortening/tracking option or redirect; three signed callbacks record delivered receipts; fresh publications record undelivered and failed, while unsigned and wrong-signature callbacks return 401 and leave SMS storage and the delivery log unchanged; the operator log exposes subscriber, SMS channel, update, queue/outcome instants, channel/outcome/update filters and matching CSV rows, the delivered and SMS + Failed exports carrying each text's providerOutcome (delivered, undelivered, failed). `tests/e2e/delivery-contract.test.mjs` (smsBrowserFlow via smsBrowserRuntime in the same registration) matches SMS delivery-log rows to each filter's response by phone, pill state and provider outcome, and audits rows and filters at 1440/390 for axe, overflow, unclipped controls and hydration. PARTIAL PROPOSAL, uncounted pending ct judgment.
**Gap.** Settings cost estimation, the monthly SMS spend cap and its confirmation queue are all unbuilt. Existing Twilio consent and delivery fixtures do not deliver these controls.

#### NOTIFY-015 — Reach of each update

Core · target · **partial** · Cites BASE-MAIL-001

**Requirement.** Operators see live delivery reach for one update and the whole incident, derived from the delivery log.

**Acceptance.**
1. Each update shows committed recipient counts and delivered, bounced, suppressed and failed counts by channel.
2. The incident totals deduplicate recipients across updates and match delivery facts.
3. After ten email and two webhook recipients with one bounced email, the displayed figures match CSV.

**Evidence.** `src/core/features/communication-performance/repository.ts`, `src/core/features/communication-performance/ui/incident-reach.tsx`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts email committed10; email delivered9; email bounced1; webhook committed2. Unasserted: suppressed count reconciliation; failed count reconciliation; incident webhook totals and distinct recipient counts reconcile across updates; webhook CSV parity.

#### NOTIFY-016 — Operator alerts beyond email

Core · target · **partial**

**Requirement.** Operator communication alerts reach operator Slack and Teams channels and installed devices through web push, independently of subscriber distribution.

**Acceptance.**
1. Every NOTIFY-006 alert, vendor alert under DEP-003, traffic alert under HIST-006 and SUB-020 capacity alert can use each operator channel and device, at most once per event.
2. Alerts carry incident reference and operator-app link and omit subscriber data.
3. One overdue incident produces exactly one email, one Slack operator post and one push per subscribed device.

**Evidence.** `tests/e2e/update-reminders.test.mjs` (INCIDENT-010 — INCIDENT-011 NOTIFY-016 AGENT-002 AUTO-003 owner reminders, durable follow-ups, reasoned failure dismissal and Queue recovery follow the original commitment), loading `tests/e2e/update-reminders.test.mjs` in push Verify’s notifications shard. Repeated controlled overdue ticks produce exactly one email, one opted-in operator Slack post and one Teams post, carrying the incident reference and operator-app link. Subscriber destinations and publication-only operator channels receive no private alerts. A terminal subscriber failure is rendered without an address, subscriber identifier or provider error. A real public opt-in crosses the 80% capacity boundary and produces deduplicated capacity alerts with /app/subscribers; the same path carries SUB-020 capacity events. Migration 0060 leaves existing channels opted out. Owner/admin API controls and `tests/e2e/helpers/channel-deletion-flow.mjs` (operatorAlertSettingsBrowserFlow), loaded by the existing private-channels registration in `tests/e2e/channels-and-presets.test.mjs`, prove default-off creation, explicit opt-in and opt-out retained across reload at 1440/390, with axe, overflow and hydration assertions. Consent is checked again before queued sends; opting out prevents the queued Slack alert while still-consenting Teams receives its event.
**Gap.** Push to installed operator devices (MOBILE-002), DEP-003 vendor alerts and HIST-006 traffic alerts remain unbuilt.

#### NOTIFY-017 — Component status changes reach webhook subscribers

Core · target · **partial** · Cites BASE-OPS-003, BASE-INPUT-002

**Requirement.** Committed visible-component state changes notify subscriptions that selected changes and follow that component, including the default webhook selection. The technical profile is specified in [Delivery details](docs/contract/delivery-details.md).

**Acceptance.**
1. Operator, incident, maintenance, monitor, alert-source, automation-email and vendor-feed claims each produce one notification with previous/new state, time and claimant kind, never operator identity.
2. Only committed changes notify; a 60-second flap held under AUTO-002 sends nothing, and an undo sends one change back.
3. A change accompanying an incident update is carried in its normal notification without another send; component-only subscriptions and Statuspage subscriptions explicitly opting into incident-driven changes instead receive exactly one old-to-new component-change body.
4. Internal-component changes, retroactive history and history corrections send nothing.
5. Operator, monitor-rule, automation-email and vendor-feed fixtures each give a following webhook one correct change; an email without that preference receives none.
6. An unchanged strict Statuspage receiver validates all metadata, page, component-change and component fields for three incident publications and one outside-incident change, with complete incident-update arrays and correct old/new component status.

**Evidence.** Public-door proof: `tests/e2e/delivery-contract.test.mjs` (Statuspage receiver compatibility, signed webhook delivery, provider receipts and bounce suppression), `tests/e2e/helpers/statuspage-webhook-flow.mjs` and `tests/e2e/helpers/component-notification-flow.mjs` (componentNotificationFlow). The unchanged strict receiver accepts every component_update field for committed operator, incident publication/resolution/attachment/detachment and maintenance start/completion transitions. Lamp component.changed carries old/new state, instant and claimant kind without operator identity. Webhooks default to component changes; email without that selection, internal components, repeated unchanged claims and corrections stay silent. Incident carriers deduplicate normal Lamp subscriptions while component-only and explicitly opted-in Statuspage subscriptions receive exactly one old-to-new change. Browser preferences proof runs at 1440/390.
**Gap.** Monitor or alert-source claims under AUTO-001, automation email under INTAKE-013, vendor feeds under DEP-001 and AUTO-002’s flap guard are not built. Current claimants are operator standing claims, incidents and maintenance.

#### NOTIFY-018 — Delivery time on every channel

Core · target · **partial** · Cites BASE-MAIL-001, BASE-OPS-004

**Requirement.** At NOTIFY-020 scale, every eligible webhook, Slack and Teams update or component-change notification reaches its receiver within five minutes of successful publication; SMS follows NOTIFY-014's throughput bound.

**Acceptance.**
1. At qualified webhook and combined-chat limits, the hosted seeded fixture with successful fake receivers accepts every eligible delivery within five minutes.
2. Each update/channel completion time records the last eligible receiver acceptance.
3. One failing webhook is visibly retrying under NOTIFY-003 while every other receiver completes within the bound.
4. Overview reports each channel that missed its bound.

**Evidence.** `src/core/features/deliveries/service.ts`, `tests/e2e/delivery-contract.test.mjs`
**Gap.** NOTIFY-002's 5-minute bound ships and is tested for email at the subscriber limit. No bound is stated or tested for webhooks, Slack, Teams or SMS.

#### NOTIFY-019 — Notification email the owner can brand

Core · target · **partial** · From NOTIFY-019 · Cites BASE-MAIL-001, BASE-PUBLIC-001

**Requirement.** Owners brand notification mail per page and per audience page, while the sender stays authenticated under NOTIFY-008 and NOTIFY-010. NOTIFY-022 preserves required links independently of custom wording.

**Acceptance.**
1. The owner sets sender display name, reply-to address, subject prefix and plain-text header/footer, previews through UPDATE-004 and may clear the custom footer.
2. An uploaded logo is served from the public page's own host, has the page name as alternative text in HTML mail and is absent from plain-text mail; another host's logo URL cannot be saved.
3. The next message after branding has the configured display name, authenticated From address, reply-to, subject prefix, header, footer and logo.
4. Every AUD-001 audience page can keep its own branding settings.
5. An owner may add a postal address line, which Lamp suggests where postal identification is required.

**Evidence.** `src/core/shared/email-branding.ts`, `src/core/features/page-settings/ui/email-branding-settings.tsx`, `tests/e2e/rer-mail.test.mjs`, `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/page-data.test.mjs`
**Gap.** Display name and Reply-To work with SendGrid and Resend. Subject prefixes, uploaded same-host logos, plain-text headers/footers, shared preview, immutable retry envelopes and page-data export/restore ship. Managed mail supports subject/logo/wording but owns From and does not accept Reply-To; Settings and restore refuse unsupported identity settings. Audience-specific settings await AUD-001. Provider transport is proven against network-edge fixtures, not live inbox receipt.

#### NOTIFY-022 — Mandatory notification links

Core · target · **partial** · From NOTIFY-019

**Requirement.** Custom email branding cannot remove required communication links or list headers through any supported editing door.

**Acceptance.**
1. Unsubscribe, management and every other contractually or legally required link are appended outside the custom footer and survive any footer edit; mandatory list headers remain.
2. Clearing the custom plain-text footer succeeds, removes only that wording and keeps all required links in HTML/text plus mandatory headers.
3. Settings, templates, page-data restore and API overrides each refuse a missing required link and name the requirement.

**Evidence.** `src/core/shared/email-branding.ts`, `src/core/features/page-settings/ui/email-branding-settings.tsx`, `tests/e2e/rer-mail.test.mjs`, `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/page-data.test.mjs`
**Gap.** Display name and Reply-To work with SendGrid and Resend. Subject prefixes, uploaded same-host logos, plain-text headers/footers, shared preview, immutable retry envelopes and page-data export/restore ship. Managed mail supports subject/logo/wording but owns From and does not accept Reply-To; Settings and restore refuse unsupported identity settings. Audience-specific settings await AUD-001. Provider transport is proven against network-edge fixtures, not live inbox receipt.

#### NOTIFY-020 — Delivery at Statuspage Business and Enterprise scale

Core · target · **partial** · From NOTIFY-020 · Cites BASE-MAIL-001, BASE-OPS-003

**Requirement.** Lamp meets five-minute email and receiver-acceptance bounds at Statuspage Business and Enterprise counts. NOTIFY-023 specifies dispatch capacity and NOTIFY-024 provider-rate advice.

**Acceptance.**
1. Hosted Cloudflare Queues and D1 seeded runs publish to 5,000 then 25,000 email subscribers, plus 2,500 webhooks, 1,000 Slack and Teams subscriptions together and operator channel posts.
2. Against outside fake email edges acknowledging in 100 milliseconds without quota and successful fake webhook/chat edges, every eligible delivery is accepted within five minutes of successful publication.
3. The same bounds hold for maintenance notices and component changes; SMS follows NOTIFY-014's displayed throughput bound.
4. No recipient gets a duplicate, and UPDATE-008's fixed recipient set remains intact at each count.
5. A second publication 60 seconds after the first meets its own five-minute bound without reversing per-subscriber order.
6. The run summary records installation identity and exact commit as release evidence; release limits rise only with qualified counts and non-estimated measurement.

**Evidence.** `src/core/features/deliveries/service.ts`, `tests/e2e/delivery-contract.test.mjs`
**Gap.** Durable queued email delivery ships, with the 5-minute bound qualified only locally at 1,000 subscribers under a 10-per-second fake quota (seed.json → limits). There is no hosted run, no qualification above 1,000, no provider batch sending, and no check of the provider account's rate.

#### NOTIFY-023 — Dispatch throughput at subscriber scale

Core · target · **missing** · From NOTIFY-020 · Cites BASE-OPS-003

**Requirement.** Lamp's dispatcher sustains the admitted publication rate using parallel consumers and each provider's supported bulk route, retaining per-recipient identity. The technical profile is specified in [Delivery details](docs/contract/delivery-details.md).

**Acceptance.**
1. The dispatcher sustains at least 150 provider acceptances per second across parallel queue consumers.
2. SendGrid, Mailgun, Amazon SES and Postmark use documented batch routes where available.
3. Every recipient retains its own message, unsubscribe token and required headers even in a batch.
4. Overlapping publications retain subscriber order, NOTIFY-005 duplicate safety and UPDATE-008 recipient capture.

**Evidence.** `src/core/features/deliveries/service.ts`, `tests/e2e/delivery-contract.test.mjs`
**Gap.** Current queued email dispatch is proven locally at 1,000 recipients. Parallel scale qualification at 150 acceptances per second and provider batch routes are absent.

#### NOTIFY-024 — Provider sending-rate advice

Core · target · **missing** · From NOTIFY-020 · Cites BASE-OPS-004

**Requirement.** Before an incident, the operator sees whether the provider account can deliver the current subscriber population within the published bound.

**Acceptance.**
1. Settings shows the owner-entered sending rate or provider-reported rate when available, including SES quota inquiry.
2. If too low, Settings and Overview show achievable time and rate required for five minutes before publication.
3. With provider quota 20 per second and 25,000 subscribers, Settings reports 21 minutes before any publication.
4. Per-channel completion times are logged and Overview reports missed bounds.

**Evidence.** `src/core/features/deliveries/service.ts`, `tests/e2e/delivery-contract.test.mjs`
**Gap.** There is no provider-account sending-rate inquiry or entered-rate advice; the current 1,000-recipient local delivery qualification does not implement this capability.

### Alert intake — target

#### INTAKE-008 — Uptime preset

Core · target · **partial** · Cites BASE-INPUT-001, BASE-OPS-003, BASE-ACCESSIBILITY-001

**Requirement.** An Uptime source maps each monitor to one component and puts verified confirmed-failure and recovery evidence in the brief. AUTO-001 and COMP-008 must consume the same mappings and transitions before monitor claims ship; intake does not itself publish or claim state. Connection formats are in [intake details](docs/contract/intake-details.md).

**Acceptance.**
1. Pairing from Alerts generates an address without a typed secret; signing-secret connections remain available.
2. Only the paired key with a current timestamp, or the exact-body timestamp signature, admits an event; wrong keys, missing or stale timestamps and altered signed bytes create no receipt, draft or publication.
3. Monitors map one-to-one to components and equal incident keys from different monitors stay isolated. Unpicked monitors and test or drill events are refused with a visible receipt and no draft.
4. A signed default failure creates a private mapped draft and replay retains it.
5. The brief lists supplied failed vantages, error category and confirmed start time as confirmed evidence; absent optional context says not supplied rather than inventing an earlier failure.
6. Recovery is recorded, closes only a never-published draft and leaves published lifecycle unchanged.
7. At 1440 and 390 the saved monitor choice and private draft show the picked component and its vantages.

**Evidence.** `src/core/features/intake/uptime.ts`, `src/core/features/intake/service.ts`, `src/core/features/intake/ui/uptime-form.tsx`, `tests/e2e/channels-and-presets.test.mjs`, `tests/e2e/helpers/uptime-preset-flow.mjs`, `tests/e2e/helpers/uptime-pairing-flow.mjs`, `tests/e2e/helpers/intake-byte-flow.mjs`
**Gap.** Old cited evidence asserts Pairing asks for no secret; Signing-secret source retained; Wrong key refused; Missing timestamp refused. Unasserted: Authentication refusals create or change no draft record; Authentication refusals create no published update; Authentication refusals leave every other public artifact unchanged; Test and drill refusal plus visible receipt/no draft; Confirmed versus earlier unobserved time labeled.

#### INTAKE-009 — PagerDuty

Core · target · **partial** · From INTAKE-009 · Cites BASE-INPUT-001, BASE-OPS-003 · Register R-60

**Requirement.** A PagerDuty source accepts signed version-three incident events and maps services to components. Acknowledgments and escalations become timed responder evidence in the brief and report; publication notes are INTAKE-015.

**Acceptance.**
1. A source can be saved before its signing secret; until connected every inbound event is refused with no receipt, and inbound and outbound connection states remain distinct.
2. Exact-byte signatures admit triggered, acknowledged, escalated and resolved events; wrong or tampered signatures return 401 without receipts.
3. Exact service identifiers and names attach all matching components, requiring every supplied field; unsupported and unmapped signed events remain visible with their reasons.
4. Triggered events create a private linked draft; replay keeps that draft without another receipt.
5. Acknowledgments and escalations show event time and responder role in the brief and cited report timeline.
6. Resolution records recovery, closes only an unpublished draft and leaves published lifecycle and updates unchanged.
7. Private drafts and responder events publish no story; erasing a source removes credentials and receipts while preserving operator publications and drafted reports.

**Evidence.** `src/core/features/intake/`, `tests/e2e/channels-and-presets.test.mjs`, `tests/e2e/helpers/pagerduty-flow.mjs`, `scripts/installer/archive-policy.mjs`, `tests/auth-adoption/portability.test.mjs`
**Gap.** Old cited evidence asserts Disconnected intake no receipt; Inbound connection state; Outbound state; Wrong signature refused. Unasserted: Private drafts are absent from every other public story artifact; All supplied compound matcher fields required; Recovery receipt readback; Every public story artifact excludes private drafts.

#### INTAKE-015 — PagerDuty publication notes

Core · target · **partial** · From INTAKE-009 · Cites BASE-DATA-004, BASE-OPS-003, BASE-OPS-004 · Register R-60

**Requirement.** A connected PagerDuty account receives each Lamp publication as one incident note containing the public text and permalink. Optional credentials and note-author identity stay private; rejection never undoes publication. Connection details are in [intake details](docs/contract/intake-details.md).

**Acceptance.**
1. Each distinct publication adds at most one note to its linked incident containing all published text and permalink; replay adds none.
2. Without a connected REST key, publication succeeds and sends no note.
3. The key and note-author identity are sealed, never displayed and excluded from technical and native archives; restore requires reconnection.
4. Credentials reach only the documented PagerDuty note host and redirects are not followed.
5. A failed note is visible against the linked source without blocking publication.
6. The default note author is the source owner’s Lamp email and identifies a valid PagerDuty user.

**Evidence.** `src/core/features/intake/`, `tests/e2e/channels-and-presets.test.mjs`, `tests/e2e/helpers/pagerduty-flow.mjs`, `scripts/installer/archive-policy.mjs`, `tests/auth-adoption/portability.test.mjs`
**Gap.** Old cited evidence asserts PagerDuty note contains the public audience statement; PagerDuty note contains public customer impact; PagerDuty note contains public still-working text; PagerDuty note contains public details. Unasserted: Note-author sealed and redacted.

#### INTAKE-010 — Prometheus Alertmanager and Grafana Alerting

Core · target · **done** · Cites BASE-INPUT-001, BASE-OPS-003, BASE-ACCESSIBILITY-001 · Register R-61

**Requirement.** Alertmanager and Grafana sources accept their documented grouped examples with source bearer authentication. Exact owner-set label matchers attach every matching component, with group identity and alert fingerprints retained.

**Acceptance.**
1. The documented Alertmanager version-four and unmodified Grafana version-one two-alert examples each create one private draft attached to both matched components.
2. Unsupported versions, malformed groups and unmapped labels are refused with a visible reason and no incident identifier.
3. Concurrent replay retains one incident and exactly both member fingerprints and states.
4. Mixed or partial recovery records recovered members and keeps remaining firing members open, including one omitted by a later payload.
5. Complete recovery closes only an unpublished draft without publishing an update; a published incident keeps its lifecycle.
6. At 1440 and 390 the saved mappings, receipt and linked private draft retain both matched components.
7. The technical archive restores source configuration and grouped member evidence.

**Evidence.** `tests/e2e/channels-and-presets.test.mjs` (Connect monitors, review private alert drafts, publish and recover with durable integration evidence), loading `tests/e2e/helpers/grouped-alerts-flow.mjs` (groupedAlertsFlow): both configured browser components and their exact mappings survive reload, receipts open the private draft, and no public story exists at 1440 and 390. The cited native archive retains the source configuration and grouped member evidence.  Kept archive citation: `tests/auth-adoption/portability.test.mjs` (native rer archive restores owner continuity and subscriber authority), loading `tests/helpers/archive-history.mjs` (populateArchiveHistory); its archive and restored re-export equality retains the Alertmanager source and grouped fingerprints and states.
**Gap.** None.

#### INTAKE-011 — New Relic, Datadog and Pingdom depth

Core · target · **done** · From INTAKE-011 · Cites BASE-INPUT-001, BASE-ACCESSIBILITY-001 · Register R-62

**Requirement.** New Relic workflow alerts map the entity names in its displayed template to components. Metric connectors are INTAKE-016.

**Acceptance.**
1. The workflow template contains issue identifier, issue title, state and entity-name bindings without omission.
2. Exact saved entity names survive reload; an unmapped entity creates no incident.
3. An activated workflow creates a private draft on its mapped component; its closed event resolves that same draft without public updates.
4. The template and saved choices are usable at 1440 and 390.

**Evidence.** `tests/e2e/channels-and-presets.test.mjs` (Connect monitors, review private alert drafts, publish and recover with durable integration evidence), loading `tests/e2e/helpers/monitor-setup-journey.mjs` (monitorSetupJourney) and `tests/e2e/helpers/metric-setup-journey.mjs` (metricSetupJourney): complete New Relic workflow bindings and replacement template, saved exact entities, mapped private ACTIVATED and CLOSED on one incident, and accessible persisted provider forms at 1440 and 390.  Kept API and chart citations: `tests/e2e/helpers/operations-alerts-flow.mjs` (operationsAlertsFlow) and `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow), loaded by that same monitor registration, retain entity mapping, unmapped refusal and the Datadog, New Relic and Pingdom public chart observations.
**Gap.** None.

#### INTAKE-016 — Monitoring metric connectors

Core · target · **done** · From INTAKE-011 · Cites BASE-DATA-004, BASE-ACCESSIBILITY-001 · Register R-62

**Requirement.** Datadog, Pingdom and New Relic sources can feed UPTIME-008 public charts through owner-supplied read-only query credentials.

**Acceptance.**
1. Each provider’s read-only fixture query fills its public chart with the supplied value.
2. Query credentials are sealed and absent from operator and management metric listings.
3. At 1440 and 390 an owner configures each provider’s metric in component settings and its connection survives reload.

**Evidence.** `tests/e2e/channels-and-presets.test.mjs` (Connect monitors, review private alert drafts, publish and recover with durable integration evidence), loading `tests/e2e/helpers/metric-setup-journey.mjs` (metricSetupJourney): every provider connection and exact query survives reload, with sealed keys absent from the owner form at 1440 and 390.  Kept provider and secrecy citation: `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow), loaded by that same monitor registration, retains all three provider chart values, sealed credential storage and credential absence from operator and management listings.
**Gap.** None.

#### INTAKE-012 — Oncall

Core · target · **missing** · Cites BASE-DATA-004, BASE-OPS-003 · Register R-63

**Requirement.** An Oncall source maps services to components and brings signed incident events and responder-timeline entries into the matching brief. Lamp itself never performs paging.

**Acceptance.**
1. A signed opened event creates a private draft on the mapped component.
2. A later timeline entry appears with its time and author role.
3. Each publication adds one timeline post to the linked Oncall incident.
4. Under an owner’s claim rule, opened claims the configured component state and resolved releases it.
5. When linked, INCIDENT-011 escalation goes through Oncall paging.

**Evidence.** None.
**Gap.** The Oncall preset, signed timeline intake, publication feedback and linked escalation are not built.

#### INTAKE-013 — Email automation for each component

Core · target · **missing** · From INTAKE-013 · Cites BASE-INPUT-001, BASE-DATA-004

**Requirement.** Every component has an automation email address so Pingdom email alerts, CloudWatch through SNS email, New Relic email and cron scripts can use its AUTO-001 rule without a webhook. AUTO-002 provides the flap guard; interpretation and effects are INTAKE-017 and INTAKE-018.

**Acceptance.**
1. The owner chooses an inbound subdomain, Settings shows its mail-routing records and a setup check verifies them.
2. The Automation panel shows the component’s unique address and its exact case-sensitive subject rule together.
3. Rotation invalidates the old address; only the address-token hash is stored, with at least 128 bits of entropy.
4. The owner can require aligned sending-domain authentication or restrict senders to listed addresses or domains.

**Evidence.** None.
**Gap.** Lamp has no inbound email path, component address, rotation, mail-routing setup check or sender-policy controls.

#### INTAKE-017 — Automation email interpretation

Core · target · **missing** · From INTAKE-013 · Cites BASE-INPUT-001, BASE-OPS-003

**Requirement.** Automation email follows Statuspage’s documented component semantics, making incompatible capitalization and address suffixes visible.

**Acceptance.**
1. Whole capital DOWN and UP words claim Major outage and release the email claim; where both occur, the first decides.
2. Partial-outage and degraded-performance address suffixes claim those states and never release a claim, so recovery uses the plain address.
3. Pingdom’s documented DOWN alert and UP alert subjects work without extra parsing setup.
4. Lower-case or mixed-case down or up is refused and counted as “keyword not in capitals”.
5. Unknown or rotated tokens, refused senders and subjects with neither keyword are rejected during the mail session and record nothing on a component; refusals are counted with reasons without retaining bodies.
6. Messages are processed in received order and deduplicated by their mail identity.

**Evidence.** None.
**Gap.** Lamp has no mail interpretation, mail-session refusal, ordered processing or mail-identity deduplication.

#### INTAKE-018 — Automation email effects and cutover

Core · target · **missing** · From INTAKE-013 · Cites BASE-OPS-003

**Requirement.** Accepted automation mail follows the component’s rule while respecting an incident or maintenance claim already controlling it. Cutover helps owners repoint monitors.

**Acceptance.**
1. Under claim, accepted DOWN mail claims Major outage within 30 seconds and plain-address UP releases it.
2. Under draft, that mail creates a private draft on the component and changes no public state.
3. Mail while an unresolved incident or in-progress maintenance claims the component changes nothing and is recorded as ignored.
4. Claim-and-publish uses the saved publication template and AUTO-002 flap guard.
5. After Statuspage import, Cutover lists every component’s old automation address beside its new Lamp address.

**Evidence.** None.
**Gap.** No automation-mail effects or old/new address cutover mapping exists.

#### INTAKE-014 — Jira Service Management and Opsgenie

Core · target · **partial** · From INTAKE-014 · Cites BASE-INPUT-001, BASE-OPS-003, BASE-ACCESSIBILITY-001 · Register R-64

**Requirement.** JSM Operations and Opsgenie alert webhooks map alerts to components and retain responder evidence privately. Publication feedback is INTAKE-019; AUTO-001 governs component rules.

**Acceptance.**
1. The documented Create, Acknowledge, AddNote, Escalate and Close actions authenticate through the source bearer header; wrong tokens return 401 without changing incidents, drafts, updates, audit entries or receipts.
2. Alert identifiers deduplicate deliveries and distinct events; tag/entity and JSM affected-service matchers require all supplied fields and attach every match. Unmapped alerts are recorded against the source.
3. Create refreshes only untouched private drafts; operator-authored titles and fields remain authoritative.
4. Acknowledge and Escalate appear in the brief and cited report timeline with time and responder role.
5. AddNote becomes an internal note, absent from the brief, model input and public artifacts unless a person copies it.
6. Close records recovery and closes only a never-published draft; published lifecycle stays unchanged.
7. Late responder actions stay on the resolved incident without reopening, publication, subscriber notices or provider feedback.
8. At 1440 and 390 compound mappings and source choices persist; ordinary choices autosave and credentials have explicit Save.

**Evidence.** `src/core/features/intake/`, `tests/e2e/channels-and-presets.test.mjs`, `tests/e2e/helpers/operations-alerts-flow.mjs`, `tests/e2e/helpers/operations-alerts-flow.mjs`, `tests/auth-adoption/portability.test.mjs`, `migrations/core/0061_vendor_alert_presets.sql`
**Gap.** Old cited evidence asserts Wrong token 401; Wrong-token refusal preserves every incident row; Wrong-token refusal preserves every draft row; Wrong-token refusal preserves every published-update row. Unasserted: Repeated Create retains operator-authored still-working text and next-update time; Each brief summary time equals that action’s exact fixture timestamp; Unmapped reason read back; Recovery record read back; Credential replacement explicit Save asserted.

#### INTAKE-019 — Responder publication feedback

Core · target · **done** · From INTAKE-014 · Cites BASE-DATA-004, BASE-OPS-003 · Register R-64

**Requirement.** Optional JSM Operations or Opsgenie credentials send each Lamp publication to its linked alert and close that alert on a Resolved publication when enabled by the owner.

**Acceptance.**
1. Each publication sends one note with every public field and permalink to the linked provider alert; non-Resolved updates send no close request.
2. With close-on-resolve enabled, Resolved sends exactly one separately counted note and close request, with no repeated scheduled effect.
3. Provider credentials are sealed, never displayed and absent from native archives; the restored authenticated source asks to reconnect.
4. Atlassian sites use the documented HTTPS Atlassian domain and credentials reach only the intended fixed provider destination.

**Evidence.** `tests/e2e/channels-and-presets.test.mjs` — Connect monitors, review private alert drafts, publish and recover with durable integration evidence, via `tests/e2e/helpers/operations-alerts-flow.mjs` — operationsAlertsFlow: acceptance 1 linked publication note and public fields; 2 separately counted note and close with scheduled replay suppressed; 3 each provider key sealed in its persisted source row and listing redacted; 4 invalid Atlassian sites refused and original credentials reach only fixed provider destinations. `tests/auth-adoption/portability.test.mjs` — native rer backup restores the whole product without reviving temporary authority: acceptance 3 archive strips provider credentials and authenticated restored sources require reconnect.
**Gap.** None.

### Automation — target

#### AUTO-001 — Owner rules for what an alert may do

Core · target · **partial** · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-OPS-005

**Requirement.** For each component and source the owner selects draft, claim, or claim-and-publish behavior, with each component retaining its own rule. Agent calls carry standard for draft work, live for state claims and external plus live for public communication; company policy decides their disposition.

**Acceptance.**
1. Under draft, an alert changes nothing public.
2. Under claim, firing claims the configured public state within 30 seconds and recovery releases it, with no update or subscriber notification.
3. Under claim-and-publish, the saved operator-written template supplies every required field, the firing and Resolved texts publish through UPDATE-008 and the saved NOTIFY-007 channels notify exactly once.
4. Automatic publication names the rule and the owner who approved it, and the private timeline links the causing alert.
5. Rule edits appear in the audit view with actor and time.

**Evidence.** `tests/e2e/channels-and-presets.test.mjs` (AUTO-001 INTAKE-014 INTAKE-011 INTAKE-010 INTAKE-009 INTAKE-008 INTAKE-005 INTAKE-006 INTAKE-007 UPTIME-008 UPTIME-009 — Connect monitors, review private alert drafts, publish and recover with durable integration evidence; delivery shard), loading `tests/e2e/helpers/automation-rules-flow.mjs` (automationRulesFlow) and `tests/e2e/helpers/automation-rules-browser-flow.mjs` (automationRulesBrowserFlow). The native intake and operator journeys prove default and explicit draft silence; immediate configured claims and recovery without updates or subscriber deliveries; saved firing and Resolved template fields and selected channels exactly once through UPDATE-008 despite alert and Queue redelivery; private rule and approving-owner attribution; a working link from the incident timeline to the causing alert; and rule edits in the audit view with actor and time. Settings values survive reload, invalid approval and incomplete templates are refused, source erasure releases claims, and durable publication retries resume through Cron.
**Gap.** Agent calls still need server-computed standard, live and external classes, company-policy decisions and agent-for-person attribution under BASE-AGENT-006, BASE-AGENT-007 and BASE-AGENT-008. The held Base pin has no company-policy decision API. Agent automation stays unavailable; owner and admin approval remains the conservative default. SURFACE-002 and SURFACE-003 retain these inherited duties.

#### AUTO-002 — Flap guard and undo for automatic changes

Core · target · **done** · Cites BASE-OPS-005

**Requirement.** An automatic claim uses its rule’s firing delay and recovery hold to prevent flapping public changes. Operators can undo a claim or publication without erasing history.

**Acceptance.**
1. A 60-second firing followed by recovery changes nothing public under the default two-minute firing delay.
2. A three-minute firing claims state; recovery followed by refiring two minutes later retains it under the default five-minute recovery hold.
3. One Undo restores the previous state and appends the actor’s history and incident-timeline entry without deleting prior entries.

**Evidence.** `tests/e2e/channels-and-presets.test.mjs` (AUTO-001 INTAKE-014 INTAKE-011 INTAKE-010 INTAKE-009 INTAKE-008 INTAKE-005 INTAKE-006 INTAKE-007 UPTIME-008 UPTIME-009 — Connect monitors, review private alert drafts, publish and recover with durable integration evidence; delivery shard), loading `tests/e2e/helpers/automation-flap-flow.mjs` (automationFlapFlow). The controlled-clock native HTTP and scheduled journey proves a 60-second firing never changes public state under the default two-minute delay; a three-minute firing claims state; refiring two minutes into the five-minute recovery hold keeps one claim and history; and a full recovery hold releases it without subscriber delivery. Owner Undo for both claim and publication restores the prior aggregate state and appends the actor to component history and the private incident timeline while retaining all previous history and immutable updates. Anonymous and Responder Undo and rule edits are refused without product changes; repeated Undo, captured firing, scheduled replay and pending-source erasure cannot reapply the change. Revocation of an approving owner holds delayed work; an erased approver and captured alert cannot restore authority. `tests/e2e/helpers/automation-rules-browser-flow.mjs` (automationRulesBrowserFlow) proves persisted timing controls, native Undo and retained internal history at 1440, with the same changed screens captured at 1440 and 390.
**Gap.** None.

#### AUTO-003 — Every follow-up obligation is visible

Core · target · **partial** · Cites BASE-OPS-004, BASE-OPS-005

**Requirement.** Overview lists every durable Lamp obligation with its owner, due time, stop condition and failure state. This includes next updates, scheduled publications, maintenance transitions/reminders, reports owed, expiring import invitations, stale vendor feeds, secondary-origin lag, notification retries and SMS held by the spend cap. Only owners/operators see this list under the adopted scope.

**Acceptance.**
1. A fixture containing every named obligation lists each with its owner, due time, stop condition and failure state.
2. Stopping notification delivery shows the failed obligation and it survives repeated reads until completed or dismissed with a reason.
3. A reasoned dismissal records the reason and actor; an empty reason is refused and a later failed occurrence reappears.
4. Completion removes the obligation from the list.

**Evidence.** `src/core/features/overview/follow-ups/routes.ts`, `src/core/features/overview/follow-ups/repository.ts`, `src/core/features/overview/ui/follow-ups.tsx`, `tests/e2e/helpers/follow-ups-flow.mjs`, `tests/e2e/helpers/follow-ups-queue-flow.mjs`, `tests/e2e/helpers/follow-ups-notification-flow.mjs`, `tests/e2e/update-reminders.test.mjs`
**Gap.** The private panel aggregates next-update, scheduled publication, maintenance, report, imported invitation and notification obligations. Vendor-feed staleness, secondary-origin lag and SMS spend-cap carriers remain absent. Owner/operator access and reasoned dismissal are the adopted scope; no public exposure or outbound action is added.

#### AUTO-004 — Post-incident report follow-up

Core · target · **partial** · Cites BASE-OPS-003, BASE-OPS-005

**Requirement.** A report owed under HIST-003 sends its communication owner a due-day reminder and weekly follow-ups by email and opted-in operator channels until publication or a reasoned waiver. An unowned incident goes to active operators. Historical-only imported incidents remain silent until a live publication.

**Acceptance.**
1. Day seven after Major outage resolution sends one owner email and one post per opted-in operator channel; a repeated tick adds none and day fourteen sends the next reminder.
2. Reminders include the incident reference and private report link, no subscriber data, and go to neither subscribers nor publication-only channels.
3. Publishing a report stops later reminders.
4. A reasoned waiver stops later reminders, removes the owed mark and records operator, reason and time in one audit entry; a report can still be published later.
5. An empty waiver reason is refused with 400 and creates no waiver or reminder.
6. Retroactive-only imported incidents can owe reports privately but send no automatic reminder until a live update.

**Evidence.** `src/core/features/reports/repository.ts`, `src/core/features/reports/service.ts`, `src/core/features/reports/routes.ts`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/publishing-browser.test.mjs`, `tests/release/upgrade.test.mjs`, `tests/e2e/helpers/follow-ups-flow.mjs`, `tests/e2e/helpers/report-reminders-flow.mjs`
**Gap.** Old cited evidence asserts Owner email recipient; Operator channel count; Repeated day-seven tick has the expected exact email count; Repeated day-seven tick has the expected exact Slack/Teams counts. Unasserted: Waiver audit timestamp read back; Live publication starts reminders on previously historical import.

### Operators — target

#### TEAM-005 — Access scoped to pages and audiences

Core · target · **missing** · Cites BASE-ROLE-001

**Requirement.** Operators’ Lamp roles can be scoped to selected pages and audiences.

**Acceptance.**
1. A page-scoped operator sees and publishes only incidents visible on their allowed pages and sees only those pages’ subscribers.
2. A Communicator limited to Enterprise cannot read or publish a public-only incident and sees no public subscribers.

**Evidence.** None.
**Gap.** Page- and audience-scoped roles are not built.

#### TEAM-006 — Enforced SSO and SCIM

Core · target · **partial** · Cites BASE-SIGNIN-001, BASE-ROLE-001, BASE-OPS-005 · Register R-65

**Requirement.** Lamp’s owner can enforce standards sign-in through Auth, Okta, Microsoft Entra ID, Google Workspace or SAML-only providers such as AD FS, keeping ACCESS-001’s recorded terminal break-glass path. Provider groups map to TEAM-004 roles.

**Acceptance.**
1. With SSO enforced, a non-owner magic-link request shows the SSO notice and sends no mail; only the recorded break-glass Owner path remains.
2. A standards-provider deprovisioning ends that operator’s access within 60 seconds and their next request is refused.
3. A provider group change from Communicators to Responders removes publish rights.
4. Each provider lifecycle change is audited.

**Evidence.** `src/core/platform/auth/config.ts`, `tests/auth-adoption/dependencies.test.mjs`
**Gap.** Optional OIDC sign-in ships. Enforcement, break-glass enforcement, SAML-only provider coverage, SCIM lifecycle and group-to-role mapping remain absent; this replaces ACCESS-001’s SCIM/role-sync exclusion when shipped.

#### TEAM-007 — Audit log view

Core · target · **partial** · Cites BASE-AUDIT-001, BASE-OPS-005, BASE-DATA-003

**Requirement.** Owners and Admins inspect Lamp’s audit for publications, component and maintenance changes, corrections, deletions, rule/role changes, token use and erasures. Until TEAM-004 ships, all operators share owner access. That clause and AUTO-001/API-001 supply their own event families.

**Acceptance.**
1. After a publish, correction, component/group deletion and subscriber erasure, the view lists each with actor and time.
2. Actor, action and time filters and pagination retain the matching complete result; CSV equals the filtered view.
3. Component replacement/removal is recorded even when aggregate state is unchanged, and repeated subscriber tombstone erasure adds no successful-deletion event.
4. Import removals/replacements and pending-subscriber expiry record their actor atomically.
5. Logo removal/replacement, standing-claim removal without aggregate state change and archive-restored subscriber expiry retain the same audit obligations.

**Evidence.** `src/core/features/audit-log/`, `migrations/core/0033_audit_log.sql`, `src/core/features/components/deletion-audit.ts`, `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/public-contract.test.mjs`, `tests/auth-adoption/dependencies.test.mjs`, `src/core/features/channels/repository.ts`, `tests/e2e/helpers/channel-deletion-flow.mjs`, `src/core/features/page-settings/repository.ts`, `src/core/features/statuspage-import/targets.ts`, `src/core/features/subscribers/repository.ts`
**Gap.** Settings audit filters, pagination, CSV, many event families and anonymized references ship. Logo removal/replacement, standing-claim removal without aggregate change and archive-restored subscriber expiry proof remain absent; role, rule and token event authority belongs to TEAM-004, AUTO-001 and API-001. The original proof and mechanism record is preserved in intake details.

### History and reports — target

#### HIST-005 — Communication performance

Core · target · **partial**

**Requirement.** Per-incident and monthly communication reports measure the team’s own promises, using native publication facts so backdating cannot improve the results. Missing source facts remain unknown.

**Acceptance.**
1. Time from first accepted alert to first public update equals each incident’s timeline; a three-incident fixture has the expected five-, seven- and two-minute latencies.
2. For three commitments with one four-minute miss, two of three are kept; later backdating does not erase the miss.
3. Resolution duration and reports owed agree with each incident and monthly cohort.
4. Subscriber reach per channel and delivery failure rates use distinct recipient and explicit outcome denominators.
5. CSV agrees with the incident and monthly report values.
6. Monthly cohorts use the configured page time zone; absent accepted-alert and source-delivery facts remain unknown.

**Evidence.** `src/core/features/communication-performance/service.ts`, `src/core/features/communication-performance/ui/communication-performance.tsx`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts First latency; Second latency; Third latency; Two of three kept. Unasserted: Every incident CSV field and channel matches its report value; Every monthly CSV value equals the corresponding displayed monthly report value; Delivery failure rate exact denominator.

#### HIST-006 — Traffic spike alert without visitor tracking

Core · target · **partial** · From HIST-006 · Cites BASE-PUBLIC-001, BASE-OPS-003

**Requirement.** Aggregate traffic counts can alert operators before monitoring notices a problem, without becoming visitor analytics. The counter has no database dependency; configuration is HIST-009 and resolution evidence is HIST-010.

**Acceptance.**
1. Public read requests increment per-minute counters whose stored rows contain only surface, minute and count, with no address, user agent, cookie, query or raw path.
2. The public page, feed and widget still serve and record counters when no database is bound.
3. The baseline uses the previous seven complete UTC same-hour windows; missing hours after collection began count as zero, while absent or zero baselines never infer a spike.
4. A five-times-baseline burst with no unresolved incident creates exactly one stored operator alert and one provider request; the alert names the surface/minute, observed count, baseline mean and app link.
5. Repeated scheduled ticks and consecutive burst minutes create no extra alert or provider request.
6. The same fresh burst during an unresolved incident sends no alert.
7. Traffic alerts create no customer-facing incident or other public content.

**Evidence.** `src/core/features/traffic-alerts/`, `tests/e2e/helpers/traffic-alerts-flow.mjs`, `tests/e2e/helpers/traffic-resolution-flow.mjs` and `tests/e2e/helpers/traffic-alerts-runtime.mjs`, extended inside the existing INCIDENT-010 registration in `tests/e2e/update-reminders.test.mjs` (200/200 registrations before and after). The built production Worker receives 840 controlled public page requests across seven uneven same-hour baselines: a 5× minute stores exactly one native operator alert for that surface and minute, whose one provider request carries the minute's 10 requests, the 2-per-minute same-hour mean and the app link; repeated Cron and consecutive burst minutes add none. An identical fresh burst during a native unresolved incident adds no alert. A separate feed fixture proves a zero-traffic historical hour contributes zero after collection coverage; a cold-start surface stays unknown and sends no alert. Concurrent requests persist aggregate R2 shard rows containing only surface, minute and count, with no address, agent, cookie, query or raw path. Coalesced writes respect R2's same-object rate limit and each request owns its persistence continuation. A production Worker with no D1 binding serves page/feed/widget reads and persists its counter. Settings → Notifications defaults to 3×, marks an out-of-range multiple invalid without changing the stored value, autosaves serially, preserves invalid edits across tab changes and retains acknowledged values after reload at 1440/390, with axe, font-size, overflow and hydration checks. The inherited AGENT-004 recovery door reads current traffic as typed traffic evidence and refuses an unreasoned resolution with 409 while elevated. ct judged HIST-006 DONE-JUSTIFIED at 9e1301e331992add4badf8b5e9ded34bc88d1f26: the INCIDENT-010 journey via traffic-alerts-flow.mjs and traffic-resolution-flow.mjs asserts that surfaces without a same-hour baseline are listed as learning and never become evidence rows; elevated traffic refuses a backdated Resolved publication and retains its draft; an immediate override publishes, stays in the private timeline and audit under its operator and never reaches the public incident page; the reopened incident's next unreasoned resolution is refused again; a scheduled resolution that passed when scheduled is held at its due time by elevated traffic with its draft retained, then publishes without an override once traffic is near its usual level. Each of those assertions failed under a named mutation (historical skip, unknown-as-near, public reason, unattributed audit, remembered override, scheduled skip, near-as-elevated) and passed once restored (sd-lamp-hist006-2 evidence).
**Gap.** Old cited evidence asserts Stored keys only surface minute count; Visitor identifiers and raw path absent; No database binding; Public page responds 200 with no database binding. Unasserted: Public page retains its expected full content without the database; Atom feed retains its expected full content without the database; Widget retains its expected full content without the database; The feed counter records its no-database request; The widget counter records its no-database request; The provider message binds ten to the observed minute request count; The provider message binds two to the same-hour baseline mean; Traffic alerts create no customer-facing incident; Traffic alerts preserve public page, feed and widget bytes; Zero baseline never infers spike.

#### HIST-009 — Traffic alert configuration

Core · target · **partial** · From HIST-006 · Cites BASE-INPUT-001, BASE-ACCESSIBILITY-001

**Requirement.** The owner chooses the traffic multiple in Settings, with a default of three times the same-hour baseline. Invalid or unacknowledged edits never replace the saved setting.

**Acceptance.**
1. The installed default is three; the owner’s six-times setting suppresses a five-times burst and changing it to three allows that burst.
2. Invalid multiples are marked invalid and preserve the stored value; the invalid edit survives tab changes.
3. At 1440 and 390, acknowledged choices autosave serially and survive reload without overflow or hydration errors, under the Base accessibility bar.

**Evidence.** `src/core/features/traffic-alerts/`, `tests/e2e/helpers/traffic-alerts-flow.mjs`, `tests/e2e/helpers/traffic-resolution-flow.mjs` and `tests/e2e/helpers/traffic-alerts-runtime.mjs`, extended inside the existing INCIDENT-010 registration in `tests/e2e/update-reminders.test.mjs` (200/200 registrations before and after). The built production Worker receives 840 controlled public page requests across seven uneven same-hour baselines: a 5× minute stores exactly one native operator alert for that surface and minute, whose one provider request carries the minute's 10 requests, the 2-per-minute same-hour mean and the app link; repeated Cron and consecutive burst minutes add none. An identical fresh burst during a native unresolved incident adds no alert. A separate feed fixture proves a zero-traffic historical hour contributes zero after collection coverage; a cold-start surface stays unknown and sends no alert. Concurrent requests persist aggregate R2 shard rows containing only surface, minute and count, with no address, agent, cookie, query or raw path. Coalesced writes respect R2's same-object rate limit and each request owns its persistence continuation. A production Worker with no D1 binding serves page/feed/widget reads and persists its counter. Settings → Notifications defaults to 3×, marks an out-of-range multiple invalid without changing the stored value, autosaves serially, preserves invalid edits across tab changes and retains acknowledged values after reload at 1440/390, with axe, font-size, overflow and hydration checks. The inherited AGENT-004 recovery door reads current traffic as typed traffic evidence and refuses an unreasoned resolution with 409 while elevated. ct judged HIST-006 DONE-JUSTIFIED at 9e1301e331992add4badf8b5e9ded34bc88d1f26: the INCIDENT-010 journey via traffic-alerts-flow.mjs and traffic-resolution-flow.mjs asserts that surfaces without a same-hour baseline are listed as learning and never become evidence rows; elevated traffic refuses a backdated Resolved publication and retains its draft; an immediate override publishes, stays in the private timeline and audit under its operator and never reaches the public incident page; the reopened incident's next unreasoned resolution is refused again; a scheduled resolution that passed when scheduled is held at its due time by elevated traffic with its draft retained, then publishes without an override once traffic is near its usual level. Each of those assertions failed under a named mutation (historical skip, unknown-as-near, public reason, unattributed audit, remembered override, scheduled skip, near-as-elevated) and passed once restored (sd-lamp-hist006-2 evidence).
**Gap.** The cited journey asserts default and chosen thresholds, invalid-state retention, persisted reload, layout and hydration. It does not explicitly hold competing writes to assert serial autosave ordering.

#### HIST-010 — Traffic evidence at resolution

Core · target · **partial** · From HIST-006 · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-OPS-005

**Requirement.** The AGENT-004 recovery check incorporates current traffic without converting unknown baselines to passing evidence. An agent resolution carries external and live classes; company policy decides the step’s disposition, and any override retains truthful attribution.

**Acceptance.**
1. Only surfaces with a same-hour baseline are traffic evidence; unknown surfaces are listed as learning/not tracked.
2. Elevated traffic refuses unreasoned immediate and backdated resolutions with 409 and preserves the incident and draft.
3. A reasoned immediate override publishes, keeps its reason privately under the operator’s timeline and audit identity, and exposes no reason on the public incident page.
4. An override authorizes only its publication: a later resolution of a reopened incident is checked again.
5. A scheduled resolution is checked again when due; elevated traffic holds its publication and retains its draft.
6. When traffic returns near baseline, that retained schedule publishes without adding an override.

**Evidence.** `src/core/features/traffic-alerts/`, `tests/e2e/helpers/traffic-alerts-flow.mjs`, `tests/e2e/helpers/traffic-resolution-flow.mjs` and `tests/e2e/helpers/traffic-alerts-runtime.mjs`, extended inside the existing INCIDENT-010 registration in `tests/e2e/update-reminders.test.mjs` (200/200 registrations before and after). The built production Worker receives 840 controlled public page requests across seven uneven same-hour baselines: a 5× minute stores exactly one native operator alert for that surface and minute, whose one provider request carries the minute's 10 requests, the 2-per-minute same-hour mean and the app link; repeated Cron and consecutive burst minutes add none. An identical fresh burst during a native unresolved incident adds no alert. A separate feed fixture proves a zero-traffic historical hour contributes zero after collection coverage; a cold-start surface stays unknown and sends no alert. Concurrent requests persist aggregate R2 shard rows containing only surface, minute and count, with no address, agent, cookie, query or raw path. Coalesced writes respect R2's same-object rate limit and each request owns its persistence continuation. A production Worker with no D1 binding serves page/feed/widget reads and persists its counter. Settings → Notifications defaults to 3×, marks an out-of-range multiple invalid without changing the stored value, autosaves serially, preserves invalid edits across tab changes and retains acknowledged values after reload at 1440/390, with axe, font-size, overflow and hydration checks. The inherited AGENT-004 recovery door reads current traffic as typed traffic evidence and refuses an unreasoned resolution with 409 while elevated. ct judged HIST-006 DONE-JUSTIFIED at 9e1301e331992add4badf8b5e9ded34bc88d1f26: the INCIDENT-010 journey via traffic-alerts-flow.mjs and traffic-resolution-flow.mjs asserts that surfaces without a same-hour baseline are listed as learning and never become evidence rows; elevated traffic refuses a backdated Resolved publication and retains its draft; an immediate override publishes, stays in the private timeline and audit under its operator and never reaches the public incident page; the reopened incident's next unreasoned resolution is refused again; a scheduled resolution that passed when scheduled is held at its due time by elevated traffic with its draft retained, then publishes without an override once traffic is near its usual level. Each of those assertions failed under a named mutation (historical skip, unknown-as-near, public reason, unattributed audit, remembered override, scheduled skip, near-as-elevated) and passed once restored (sd-lamp-hist006-2 evidence).
**Gap.** Old cited evidence asserts Unknown surface not tracked; Only known surfaces evidence; All unknown surfaces learning; Backdated refusal. Unasserted: Every field of the retained incident and draft remains unchanged; The complete held scheduled draft retains its saved fields; Near-baseline scheduled publication creates no override audit or other override record.

#### HIST-007 — Subscriber reporting

Core · target · **partial**

**Requirement.** Subscriber reporting covers channel, state, component, audience, language, deactivation reasons and daily growth. Until audience and language capabilities exist, the report explicitly identifies those unavailable dimensions; AUD-004 and I18N-001 add them to current counts, trend and CSV.

**Acceptance.**
1. Mixed-channel current totals equal the complete SUB-011 subscriber list and its channel/state counts.
2. Component and deactivation-reason counts match the underlying population.
3. Current counts, daily trend and CSV include audience and language breakdowns when those capabilities ship; their absence is labeled explicitly until then.
4. Daily net change reconciles opening inventory, observed joins/leaves and closing inventory; confirmation never counts as a second join.
5. Import, channel moves, expiry, undo and erasure update anonymous growth facts atomically.
6. CSV equals the shown aggregates without destinations or subscriber identities.
7. Technical archives preserve observed facts; older archives start a restore baseline, and earlier daily history stays unknown.

**Evidence.** `src/core/features/subscriber-reporting/`, `migrations/core/0034_subscriber_reporting.sql`, `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/publishing-browser.test.mjs`, `tests/e2e/delivery-contract.test.mjs`, `tests/e2e/publishing-browser.test.mjs`, `tests/auth-adoption/portability.test.mjs`
**Gap.** Old cited evidence asserts Current total equals whole list; Each returned channel/state bucket equals the matching complete-list filter count; Component count; Deactivation reason. Unasserted: Every nonzero channel/state bucket is present in the report; Daily opening inventory matches its actual baseline or the previous day’s closing inventory; Daily closing inventory equals the actual eligible subscriber inventory; The channel move records its exact individual join and leave atomically; Erasure records its exact individual leave atomically; Import undo records its exact individual leave atomically; Every remaining displayed aggregate and CSV value agree; Audience count/trend/CSV; Language count/trend/CSV; Expiry facts update atomically; The source’s complete nonempty observed subscriber-reporting facts are present in that archive.

#### HIST-008 — Complete browsable history

Core · target · **partial** · Cites BASE-PUBLIC-001

**Requirement.** Public history stays browsable back to the earliest retained or imported record. The twelve-month index links to earlier populated months; every incident permalink stays reachable, with snapshot availability under PAGE-007/PAGE-008. Native month paths remain distinct from MOVE-005’s Sorry redirects.

**Acceptance.**
1. After a Statuspage fixture import older than three years, the index links to earlier months and previous-month navigation reaches the oldest imported incident with script disabled.
2. Adjacent populated months link backwards and forwards without loops or empty-month hops.
3. Each month shows every resolved incident and completed maintenance assigned by the configured page timezone, with all incident permalinks reachable.
4. With the database unavailable, every month page remains readable from its snapshot.
5. The native month path and Sorry month aliases retain their separate meanings.

**Evidence.** `src/core/features/public-snapshot/history.ts`, `tests/e2e/public-contract.test.mjs`, `tests/e2e/snapshot-retained.test.mjs`
**Gap.** Old cited evidence asserts Earlier month index link; Oldest imported incident reached; No navigation loop; A previous-month link exists during traversal to the oldest imported incident. Unasserted: Script-disabled navigation asserted; Every traversed intermediate month contains an incident or completed maintenance rather than an empty-month hop; Every completed maintenance and incident listed; Database unavailable month read.

### Audiences and private pages — target

#### AUD-001 — Several pages in one deployment

Core · target · **missing** · Cites BASE-ROLE-001

**Requirement.** One deployment provides public, private and named-audience pages over shared components, with each page retaining its own presentation and publication surfaces.

**Acceptance.**
1. Each page has its own hostname or path, branding, languages and component selection; THEME-001, THEME-002, THEME-003 and I18N-001 supply those capabilities.
2. One incident or maintenance publication updates every page the operator selected, and each selected page has its own snapshot, feed, widget, badges and public API.
3. Publishing one incident on the public page and Staff makes it visible on both after the same publication.
4. Publishing an incident only on Staff leaves every public surface free of that incident.
5. Each page still serves its own retained snapshot while the database is unavailable.

**Evidence.** None.
**Gap.** Multiple public, private and audience-scoped pages are not built. This replaces the earlier one-page and public-page-only exclusions when delivered.

#### AUD-002 — Private page access

Core · target · **missing** · Cites BASE-SIGNIN-001, BASE-ACCESS-002, BASE-ACCESSIBILITY-001 · Register R-80, R-81, R-82

**Requirement.** A private page admits visitors through the access methods its owner selected, while preserving Lamp's failure-tolerant reading and keeping its content out of shared caches. Supersedes `BASE-PUBLIC-001` only for the private-page session cookie; public surfaces retain SUB-005.

**Acceptance.**
1. The owner can choose OIDC through Auth, Okta, Microsoft Entra ID or Google Workspace, or SP-initiated SAML 2.0 with signed assertions, including AD FS, optionally restricted to identity-provider groups.
2. An owner can instead admit an allow-listed email address or email domain through a single-use emailed link, or an IPv4 or IPv6 address within an allowed CIDR range.
3. A visitor each selected access method allows reads the page; a visitor it excludes sees only the page name and sign-in screen, with no incident text.
4. An unsigned or wrongly signed SAML assertion is refused.
5. An admitted visitor still reads the last private snapshot while the database is unavailable.
6. The private-page session has HttpOnly, Secure and SameSite=Lax protections, and no private response is stored in a shared cache.

**Evidence.** None.
**Gap.** Private-page access, its configured access methods and retained reading without the database are not built.

#### AUD-003 — Audiences for named customers

Core · target · **missing** · Cites BASE-ROLE-001

**Requirement.** Named customer audiences select the components, pages and incident wording relevant to their members.

**Acceptance.**
1. Audience membership can come from email domains, identity-provider group claims, an explicit list or a CSV import.
2. An audience has its relevant components, its AUD-001 page and its UPDATE-010 wording; operators choose the incidents shared with it.
3. An Acme Corp member sees the two components and one incident shared with Acme, and no incident shared only with Enterprise EU.

**Evidence.** None.
**Gap.** Not built.

#### AUD-004 — Audience subscribers

Core · target · **missing** · Cites BASE-ROLE-001

**Requirement.** Audience and staff-page subscriptions belong to the page on which they were created and receive that page's own visible incidents, maintenance and wording.

**Acceptance.**
1. A signed-in audience member or admitted visitor of a staff page can subscribe on every SUB-016 channel and manage or unsubscribe through SUB-007 and SUB-006.
2. An audience-only update reaches its audience subscribers and no public subscriber.
3. A combined update sends each subscriber exactly one message with the wording for their own audience.
4. A staff-only incident reaches its staff-page subscribers and no public subscriber.
5. HIST-007 current counts, daily trends and CSV count audience and staff subscribers by page, and each total equals that page's subscriber list.

**Evidence.** None.
**Gap.** Not built.

#### AUD-005 — Isolation is proven, not assumed

Core · target · **missing** · Cites BASE-ROLE-001

**Requirement.** Private components, incidents, audience wording, audience members and private subscribers remain isolated from every public publication surface.

**Acceptance.**
1. A fixture containing unique text in every private field publishes no such text in the public snapshot, feed, widget, badge, public API or public notification.
2. A crafted public request for a private snapshot returns not found; public routes cannot retrieve private snapshot bytes.

**Evidence.** None.
**Gap.** Not built.

### Management API and infrastructure as code — target

#### API-001 — Token-authenticated management API

Core · target · **partial** · Cites BASE-ROLE-001, BASE-AUDIT-001, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007

**Requirement.** A scoped management API exposes pages, components, groups, incident drafts and publications, maintenance, templates, subscriber creation/import/deletion, audiences, metrics and automation rules. Supersedes `BASE-ACCESS-002` only for token-authenticated management requests. The management API is documented in [API details](docs/contract/operations-details.md).

**Acceptance.**
1. Owners and Admins can issue tokens scoped to reads, incident writes, component writes, maintenance writes, subscriber writes, metric writes or administration.
2. A token is shown once, held only as a hash, and has an expiry, last-used time and immediate revoke; a revoked token is refused within ten seconds.
3. A token has its own request limit and returns a retryable rate-limit response when exceeded.
4. A component-write token changes a component's state with the token's identity recorded; that token cannot publish an incident.
5. Each write is attributed to the token and its issuing operator in TEAM-007, including the component change visible in the audit view.
6. Incident publication follows UPDATE-001 validation and UPDATE-007 review. An agent publication carries the external and live classes computed from its recipients and affected service; the company's policy decides review or approval.
7. An OpenAPI 3.1 description validates and a generated client completes an incident lifecycle.

**Evidence.** `src/core/features/management-api/`, `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow in the existing notifications registration), `tests/auth-adoption/portability.test.mjs` (native rer archive, ownership-authority shard): scoped bearer next-snapshot push, no-scope refusal, token/issuer audit, hash-only storage, last-used time, immediate revoke and inert restored metadata. The read slice uses the same issuance, hash-only bearer authority, immediate revoke and last-used metadata: GET /api/v1/components returns components and groups to an explicit read token; a no-scope or metrics:write-only token receives 403, and a revoked read token receives 401 without usage changes. `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow, existing INTAKE-014 INTAKE-011 INTAKE-009 registration in `tests/e2e/channels-and-presets.test.mjs`, notifications shard) asserts each public-door result. `migrations/core/0064_management_read_tokens.sql` adds opt-in read metadata; `tests/auth-adoption/upgrade.test.mjs` (ACCESS-001 TEAM-001 TEAM-002 upgrade preserves identities, history and subscriber authority and destroys legacy credentials, ownership-upgrade shard) proves populated 0063 metadata survives without acquiring read scope. `tests/e2e/helpers/metrics-portability-flow.mjs` in the existing native archive registration (ownership-authority shard) retains read metadata and refuses its old bearer after restore. No Settings screen changes. Proposal pending ct judgment. `tests/e2e/helpers/metrics-flow.mjs` (metricsFlow, existing INTAKE-014 INTAKE-011 INTAKE-009 registration in `tests/e2e/channels-and-presets.test.mjs`, notifications shard) additionally asserts GET /api/v1/metrics returns the same sanitized metric definitions as the operator door to an explicit read bearer without a cookie; no-scope and metrics:write-only bearers receive 403; immediate revocation returns 401; refusals leave usage metadata unchanged. Datadog, New Relic, Pingdom and Prometheus query fixtures prove neither plaintext nor sealed provider credentials are returned. The existing read authorization, rate limit and final credential fence are shared; no scope or migration is added. Proposal pending ct judgment.
**Gap.** Read is built only for components, groups and metric definitions; the other read resources, components:write, incidents:write, maintenance:write, subscribers:write and admin scopes, OpenAPI 3.1 and a generated incident-lifecycle client remain unbuilt. Component-state token attribution, incident-publication refusal and audit-view acceptance remain unproved.

#### API-002 — Statuspage-compatible management API

Core · target · **missing** · Cites BASE-INPUT-001, BASE-ROLE-001

**Requirement.** Existing Statuspage management clients can move to Lamp by changing their base URL and using a Lamp API-001 token. The supported operations and field mappings are documented in [API details](docs/contract/operations-details.md).

**Acceptance.**
1. The compatibility API accepts Statuspage OAuth-style authorization for component status, component groups, incident creation and updates, scheduled maintenance, subscriber listing/creation/deletion, incident subscriptions and metric data points.
2. Atlassian's unmodified documented component-status script changes the corresponding Lamp component.
3. An incident update moving its lifecycle to Monitoring and a component from major outage to degraded performance commits both changes together under UPDATE-012.
4. The lifecycle, attached components, component claims and notification selection preserve the source call's meaning; audience and next-update values come from defaults the owner set on that token.
5. A 600-character incident body is retained in full across impact and details, split at a sentence or word boundary; only a body over 750 characters is refused, naming the limit and native fields.
6. Recorded calls creating and deleting subscribers, creating a group and pushing metrics produce the same records as the native API.
7. An unsupported operation names its Lamp equivalent, and Lamp records each token's compatibility operations so the owner can migrate them.

**Evidence.** None.
**Gap.** Not built.

#### API-003 — Operator event webhooks

Core · target · **missing** · Cites BASE-OPS-003, BASE-OPS-004

**Requirement.** Private operator-event webhooks let Zapier, Make, n8n and warehouses follow Lamp's desk without exposing those events to subscriber webhooks.

**Acceptance.**
1. Owners can subscribe to alert received, draft created, update published, component changed, maintenance changed, subscriber changed and rule fired.
2. Operator events follow SUB-009 signing, SUB-010 failures and NOTIFY-005 duplicate protection.
3. An alert followed by publication delivers those two signed events to a controlled receiver in order.
4. Ten receiver failures deactivate the destination and notify its owner by email.

**Evidence.** None.
**Gap.** Not built.

#### API-004 — Terraform provider

Core · target · **missing** · Register R-83

**Requirement.** A published Terraform provider manages Lamp pages, components, groups, audiences, alert sources, templates and automation rules through API-001.

**Acceptance.**
1. Applying a fixture configuration creates its components and groups, and the next plan has no changes.
2. Editing one configured value through the operator screen makes the next plan show exactly that drift.

**Evidence.** None.
**Gap.** Not built.

#### API-005 — Configuration file planning

Core · target · **missing** · From API-004

**Requirement.** A configuration file applied through the Lamp command shows its effects before applying them.

**Acceptance.**
1. A configuration-file change shows its create, change and delete plan before application.
2. The plan exposes configuration drift introduced through the operator screen.

**Evidence.** None.
**Gap.** Not built.

#### API-006 — Deployment workflow actions

Core · target · **missing** · From API-004 · Cites BASE-OPS-003

**Requirement.** Published GitHub Actions can open and complete MAINT-008 maintenance and prepare an incident after a failed deployment.

**Acceptance.**
1. A failed fixture workflow creates one private draft incident on the components named by its action, with the workflow URL in an internal note.
2. Repeating the same workflow run creates no second draft and sends no subscriber notification.
3. The maintenance actions open and complete their stated maintenance window.

**Evidence.** None.
**Gap.** Not built.

### Integrations — target

#### INTEG-001 — Incident context in the support desk

Core · target · **missing**

**Requirement.** HappyToHelp, Zendesk and Intercom show the relevant incident context beside support conversations, and ticket links contribute anonymous customer-report counts to the incident brief.

**Acceptance.**
1. HappyToHelp and Intercom apps and APIs and a Zendesk app show active incidents and maintenance with impact, components and permalink.
2. A support agent can link a conversation or ticket to an incident; resolution shows the resolved update and lists linked tickets for follow-up.
3. The support desk connection sends no message to customers, and incident-brief ticket counts contain no customer identities.
4. Recorded Zendesk and Intercom fixtures and a HappyToHelp test installation show an active incident in their sidebars, increase the brief count when a ticket is linked and list that ticket on resolution.

**Evidence.** None.
**Gap.** Not built.

#### INTEG-002 — Updates posted to the page's social accounts

Core · target · **partial** · Cites BASE-ACCESS-002, BASE-ACCESS-004, BASE-SECRET-001, BASE-PUBLIC-003, BASE-OPS-003, BASE-DATA-004

**Requirement.** Operators can distribute selected incident updates and maintenance notices to the page's own X, Bluesky and Mastodon accounts as threaded posts.

**Acceptance.**
1. The owner connects X through their own developer application and API tier, Bluesky through an app password and Mastodon through a posting token; the owner bears the network's API charges.
2. New updates leave social channels unselected unless the owner chose post by default; deselecting a channel posts nothing.
3. A selected first update produces one post per account containing the owner's prefix, lifecycle, customer-impact text and permalink within the network's length, cut at a word boundary.
4. Each later incident update replies to that account's previous post, and maintenance posts only when selected.
5. Posts follow NOTIFY-005 duplicate protection, NOTIFY-003 retry, NOTIFY-004 outcome logging and NOTIFY-006 operator failure alerts; the log retains the network post identity.
6. A failing X fixture retries and records failure without delaying the page or email, and retroactive updates and imports post nothing.

**Evidence.** Acceptance 1: `tests/e2e/channels-and-presets.test.mjs` (INTEG-002 SUB-014 SUB-015 NOTIFY-011 NOTIFY-012 UPDATE-013 — Private channels deliver the selected publication once with literal text and punctuated links), loading `tests/e2e/helpers/social-posts-flow.mjs` (socialPostsFlow); Acceptance 2: `tests/e2e/channels-and-presets.test.mjs` (INTEG-002 SUB-014 SUB-015 NOTIFY-011 NOTIFY-012 UPDATE-013 — Private channels deliver the selected publication once with literal text and punctuated links), loading `tests/e2e/helpers/social-posts-flow.mjs` (socialPostsFlow); Acceptance 3: `tests/e2e/channels-and-presets.test.mjs` (INTEG-002 SUB-014 SUB-015 NOTIFY-011 NOTIFY-012 UPDATE-013 — Private channels deliver the selected publication once with literal text and punctuated links), loading `tests/e2e/helpers/social-posts-flow.mjs` (socialPostsFlow); Acceptance 4: `tests/e2e/channels-and-presets.test.mjs` (INTEG-002 SUB-014 SUB-015 NOTIFY-011 NOTIFY-012 UPDATE-013 — Private channels deliver the selected publication once with literal text and punctuated links), loading `tests/e2e/helpers/social-posts-flow.mjs` (socialPostsFlow); `tests/e2e/helpers/social-browser-flow.mjs` (socialBrowserFlow), loaded by the same registration, proves controls and 1440/390 observations. Inherited authority and secrecy: the same socialPostsFlow asserts anonymous and revoked-session refusal, fresh-member refusal for connect, default and removal, encrypted storage, hidden credentials, and queued retry and replay refusal after disconnection. Only recorded provider edges are claimed.  The same socialBrowserFlow retains the Settings, new-incident selector, existing composer and maintenance choice observations at 1440 and 390.
**Gap.** Cited evidence asserts persisted token connections, Bluesky app-password exchange, Mastodon bearer posting, owner defaults/deselection, bounded prefixed content, threading, selected maintenance, duplicate suppression, five retries, terminal outcomes/operator alert, failure isolation and import/retroactive silence. Unasserted: X ownership of developer application and API tier; owner network API charges; exponential retry intervals across the exact promised hour; precise recipient account identity and queue time in social log; channel, outcome and update filters; complete filtered CSV; absence of tracking pixels and tracked links; exact equality between logged post identity and provider-returned identifier.

### Mobile — target

#### MOBILE-001 — The operator desk works on a phone

Core · target · **partial** · Cites BASE-ACCESSIBILITY-001

**Requirement.** The complete operator incident journey works at phone and desktop widths, retaining UPDATE-005 draft behavior and private accepted-alert evidence until publication.

**Acceptance.**
1. At 390 by 844 and 1440 pixels, the operator enters through the terminal sign-in link and opens a private draft from an accepted signed alert.
2. The operator attaches a component, writes customer wording, reloads the exact saved draft and previews the notification email.
3. Publication and resolution produce the persisted incident update and lifecycle visible to the operator.
4. Setting a standing component claim produces its persisted and visible result.
5. Scheduling maintenance produces its persisted and visible result.
6. Every journey screen fits without horizontal scrolling, and phone touch controls measure at least 44 by 44 pixels.

**Evidence.** `src/core/app/client/ui/responsive.css`, `src/core/features/intake/ui/alerts-page.tsx`, `tests/e2e/helpers/phone-desk-flow.mjs`
**Gap.** Native signed-alert, draft reload, publication and resolution assertions exist. The cited phone helper only waits on the visible standing-claim label and maintenance heading; it does not read back either persisted result. It also reads only the impact field after reload, rather than every saved draft field. Unasserted outcomes: The native terminal link signs in at both widths; Every other saved draft field survives reload; Email preview contains the expected complete notification; Publication has its complete visible result; Resolution has its complete visible result; Standing claim persisted and visible result; Scheduled maintenance persisted and visible result.

#### MOBILE-002 — Installable app with push

Core · target · **missing** · Cites BASE-ROLE-001

**Requirement.** Lamp's operator app installs as a progressive web app on iOS 16.4 and later, Android and desktop, with optional device-specific push reminders.

**Acceptance.**
1. An operator enables push per device for due and overdue commitments, alert drafts, escalations, delivery failures and vendor alerts.
2. A due incident produces one push containing its reference; opening it opens that incident's composer.
3. Pushes contain no subscriber data and omit update text when the owner chose that option.
4. Removing a device stops subsequent pushes.

**Evidence.** None.
**Gap.** Not built.

### Moving in — target

#### MOVE-007 — From Status.io

Core · target · **missing** · Cites BASE-SECRET-001

**Requirement.** Status.io components, history, maintenance and subscribers move through the same review, silent apply, repeat protection, undo and continuity rules as MOVE-001 to MOVE-006.

**Acceptance.**
1. The owner can supply a Status.io API identity/key or saved source responses; containers become groups or components, incident messages keep their times and maintenance keeps its windows.
2. Email, SMS and webhook subscribers are pending on their corresponding MOVE-010 channels.
3. A saved fixture dry-runs with counts and reasons, applies silently with original times, redirects old incident paths and undoes cleanly.
4. Published post-incident text and templates exposed by Status.io dry-run, import and undo under MOVE-011 and MOVE-014.

**Evidence.** None.
**Gap.** Not built.

#### MOVE-008 — From incident.io Status Pages

Core · target · **missing**

**Requirement.** Incident.io Status Pages components, groups, incidents with updates and maintenance move under MOVE-001 to MOVE-006 from a read-scoped source key or saved responses.

**Acceptance.**
1. A saved fixture dry-runs and applies with original times and silent history.
2. When incident.io provides no subscriber export, Cutover names that limitation and shows how to invite those subscribers from Lamp.
3. Published post-incident text and templates exposed by incident.io dry-run, import and undo under MOVE-011 and MOVE-014.

**Evidence.** None.
**Gap.** Not built.

#### MOVE-009 — Statuspage consumers keep working at cutover

Core · target · **partial**

**Requirement.** Statuspage public consumers and the operating guide remain useful at cutover. Webhook formats remain SUB-018/MOVE-010 obligations and email automation addresses remain INTAKE-013 obligations.

**Acceptance.**
1. After a Statuspage import, existing public-summary API clients, RSS and Atom readers and embed tags read the moved hostname, with the embed serving PAGE-019's floating notice.
2. Cutover lists these consumers as served and names webhook receivers and component automation addresses unavailable until their owning capabilities ship; when those ship it lists them as served with old/new automation addresses.
3. The Cutover guide explains correction updates rather than editing published history, selecting no channels to avoid another notice, component states changing with updates and degraded-only components retaining that behavior.

**Evidence.** `src/core/features/statuspage-import/public-paths.mjs`, `src/core/features/public-snapshot/import-aliases.ts`, `src/core/features/statuspage-import/operating-notes.ts`, `tests/e2e/statuspage-import.test.mjs`, `tests/e2e/cutover-browser.test.mjs`, `tests/e2e/public-contract.test.mjs`
**Gap.** Old cited evidence asserts Statuspage summary endpoint returns nonempty content; Source Atom equals native feed; RSS response is nonempty; Guide includes the correction-update note. Unasserted: An unmodified Statuspage client parses the summary; An old embed tag renders the floating notice after import; Each reader is listed served after import; Webhook and automation readers are unavailable before implementation; Shipped automation shows old/new component addresses.

#### MOVE-010 — Every subscriber channel moves

Core · target · **missing**

**Requirement.** Every subscriber channel moves with its component selection and source consent boundary, preserving source webhook formats without sending before the owner's explicit cutover action.

**Acceptance.**
1. Statuspage, Status.io and Better Stack imports include email, webhook, Slack, Teams and SMS subscribers, plus subscribers of unresolved Statuspage incidents.
2. A source-confirmed webhook is held in its source body format until the owner activates it at cutover; activation needs no receiver reply, and the next incident update and component change use that format.
3. An unconfirmed webhook remains pending until its contact confirms; delivery failures deactivate and notify the contact under SUB-010.
4. SMS needs a new YES consent, Slack needs reinstalling Lamp's app, Teams needs its verification card and email follows MOVE-013.
5. All pending channels keep the original confirmation windows and count toward SUB-020 limits; the dry run names and refuses an excess channel.
6. Activated webhooks retain the import as consent source, undo deactivates them, and Cutover lists activated Statuspage receivers as served.
7. A four-channel fixture sends nothing before owner action, then delivers source-format webhook incident and component events, and activates SMS only after YES.
8. A new webhook subscriber can choose the Statuspage format under SUB-018.

**Evidence.** None.
**Gap.** Released imports carry email subscribers only (src/core/features/statuspage-import/).

#### MOVE-011 — Postmortems move intact

Core · target · **partial**

**Requirement.** Published and draft post-incident reports from Statuspage survive with their original meaning, privacy and publication time. Other source readers retain the same rules under MOVE-007 and MOVE-008.

**Acceptance.**
1. A published source postmortem becomes its incident's published HIST-002 report at its original time, without any notification even when the source requested one.
2. All source words survive as plain text: paragraphs/list items retain separate lines, headings have their own lines, links expose their URLs, and images are named with source URLs without fetching or embedding them.
3. The source body fills summary; empty timeline, cause and remediation are omitted by the report renderer, and HIST-003 treats it as published.
4. An unpublished source report remains private and is named as such in the dry run; no page, permalink, feed or public API exposes its text.
5. The old incident address reaches a script-free Lamp report page, and the native public API contains the published report.
6. Dry run counts imported, private and refused reports with reasons and changes no records; application imports only the reviewed reports, repeat imports no duplicate, and undo removes unchanged reports while naming retained edits.

**Evidence.** `src/core/features/statuspage-import/postmortems.ts`, `src/core/features/statuspage-import/templates.ts`, `tests/e2e/helpers/postmortem-template-import-flow.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/statuspage-import.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts Imported report retains original publication time; The fixture source text markers survive in the summary; The ordinary source link URL survives; The HTML source link URL survives. Unasserted: Published report with source notify flag creates no notification of any kind; Every word of the complete source body survives; Paragraph/list item line boundaries survive; Heading line boundaries survive; Image URL is never fetched; Empty timeline/cause/remediation fields are omitted from rendered report; HIST-003 counts the imported report as published; Dry run writes no report or other native record; Apply imports only reviewed reports; Undo names the specific retained edited incident; Undo names the specific retained edited template; Undo names the specific retained edited component.

#### MOVE-014 — Incident templates move intact

Core · target · **partial** · From MOVE-011

**Requirement.** Statuspage incident templates retain their metadata, component claims and complete wording when moved to Lamp; exposed templates from Status.io and incident.io follow these rules in their own reader clauses.

**Acceptance.**
1. Each source template retains its name, title, lifecycle, components and states, channel default and source group as a Lamp folder.
2. The first body paragraph fills customer impact, remaining wording fills details, and the affected-audience statement names the template's components.
3. Oversized wording is named with its template and field in dry run, retained unchanged and marked for shortening before application.
4. Dry run counts imported templates and those needing shortening; application imports only reviewed templates and changes no public incident.
5. Applying an imported template fills the composer's components, states and wording without publication.
6. Repeating the import creates no duplicate; undo removes unchanged templates and preserves and names edited ones with needed components.

**Evidence.** `src/core/features/statuspage-import/postmortems.ts`, `src/core/features/statuspage-import/templates.ts`, `tests/e2e/helpers/postmortem-template-import-flow.mjs`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/statuspage-import.test.mjs`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Old cited evidence asserts Template source folder survives; Template title survives; Template channel default survives; Template component state survives. Unasserted: Every source lifecycle survives; All three original template names and source identities are preserved; Affected audience is derived from all selected component names; Every existing template content is unchanged by dry run; Application imports exactly the reviewed template plan; The retained template has a nonempty complete original component set after undo.

#### MOVE-012 — Private and audience pages move as private

Core · target · **partial** · Cites BASE-ROLE-001

**Requirement.** Private and audience-scoped Statuspage sources move only into corresponding Lamp private pages, with source visibility carried throughout review, application, reading and undo.

**Acceptance.**
1. Source page visibility, IP restrictions, page-access groups and users are read from the API or saved evidence; missing page visibility is refused rather than assumed public.
2. Private sources become private pages with their IP allow-list; audience sources create one audience per source group, retaining its components and explicit email members.
3. Incident, maintenance and subscriber visibility stays on its private page or selected audiences, and no private subscriber becomes public.
4. Choosing the public target for a private source is refused with a reason and a private-target alternative; dry run, apply, resume and undo expose no private artifact or notification.
5. Private incident redirects remain behind the private host's access control.
6. Cutover names the access method and group mappings to configure because source staff sign-in does not transfer; until a chosen method passes setup, the page admits nobody and exposes no incident text.
7. After configured OIDC admission, a fixture visitor reads the imported history; an IP-restricted fixture retains its allow-list and a two-group audience fixture isolates each group's components, incidents and notifications.
8. Undo removes untouched imported pages, audiences, members and subscribers and names those it keeps.

**Evidence.** `src/core/features/statuspage-import/betterstack/read.ts`, `src/core/features/statuspage-import/instatus/normalize.ts`, `src/core/features/statuspage-import/sorry/read.ts`, `tests/e2e/statuspage-import.test.mjs`
**Gap.** Better Stack, Instatus, Sorry and Statuspage readers refuse private or unknown visibility rather than publishing it. Importing those sources into private pages, audience membership, private admission, visibility-preserving subscribers and undo are not built.

### Data, security and portability — target

#### PORT-001 — Every new record travels

Core · target · **partial** · Cites BASE-DATA-001, BASE-SECRET-001

**Requirement.** Every record added by Lamp's target capabilities travels through its export and restore, while integration credentials stay behind and restored connections require authorization again.

**Acceptance.**
1. An archive includes pages, audiences/members/wording, roles/scopes, vendor components/history, monitor links/rules, metrics, translations, SMS consent and API-token metadata.
2. An archive of every target entity restores equivalently under Base export conformance.
3. API token hashes, SSO/SCIM secrets, Slack/Twilio/Plivo credentials and secondary-origin keys are absent from the archive.
4. Each restored integration is disabled until reconnected and reauthorized.

**Evidence.** `tests/auth-adoption/portability.test.mjs`, `scripts/installer/archive-policy.mjs`
**Gap.** Export, clean restore and equivalent re-export cover every released record (HIST-004). Built target records (Uptime and grouped intake sources and their mappings, PagerDuty sources) travel in the full-table archive, with the PagerDuty REST key written as NULL so the restored source asks to reconnect. Gap: Slack and Teams channel_destinations.sealed_url ciphertext travels in both archives (scripts/export.mjs, scripts/installer/archive-policy.mjs), and a restore with the same WEBHOOK_SIGNING_SECRET posts without reconnecting, so restored integrations are not all disabled until reconnected. Pages, audiences, roles, vendor components, metrics, translations, SMS consent and API-token metadata are not built.

#### PORT-002 — Erasure reaches every new identifier

Core · target · **partial** · Cites BASE-DATA-003

**Requirement.** Erasure reaches the identifiers introduced by Lamp's target capabilities while retaining anonymous delivery counts.

**Acceptance.**
1. Phone/SMS consent records, Slack and Teams installations, audience members, private-page sessions, API tokens and SCIM-provisioned operators are included in Base erasure conformance.
2. Erasing an SMS subscriber removes its number from every table and leaves only an anonymized delivery outcome.
3. Erasing an audience member ends that person's private-page session.

**Evidence.** `tests/e2e/delivery-contract.test.mjs`, `tests/auth-adoption/dependencies.test.mjs`
**Gap.** Subscriber and operator erasure ship for released records. The identifiers that target clauses add are not built.

### Push further — target

#### AGENT-001 — The public story matches responder evidence

Core · push-further · **partial** · Cites BASE-AGENT-006, BASE-AGENT-007

**Requirement.** An incident-story specialist compares unresolved incidents with responder evidence and prepares private correction flags. Company policy decides calls carrying the standard class for internal draft changes and external/live for a public correction.

**Acceptance.**
1. Within sixty seconds a public Monitoring update contradicted by a failing linked monitor gains a contradictory flag citing the monitor and evidence time, with its unpublished correction in the composer.
2. The comparison also flags stale evidence, conflicting regions or resolved updates with firing alerts, and unlisted affected components.
3. The evidence includes the brief's accepted alerts, Uptime, Oncall, PagerDuty, Jira Service Management, Opsgenie, automation-email claims, vendor feeds, support counts and published timeline, excluding internal notes.
4. Under the held company policy, corrections change no public surface until the operator publishes, and AGENT-004 records any recovery contradiction override.

**Evidence.** `src/core/features/brief/build.ts`, `src/core/features/ai/service.ts`, `tests/e2e/incident-brief.test.mjs`
**Gap.** The model-free brief flags a monitor recovery with a non-resolved lifecycle and a passed commitment, and an operator can request a cited suggestion (DRAFT-001, DRAFT-004). Continuous comparison against responder, monitor and support evidence does not exist.

#### AGENT-002 — The next-update promise is kept

Core · push-further · **partial** · Cites BASE-AGENT-006, BASE-AGENT-007

**Requirement.** The communication specialist prepares a cited private update before an existing commitment, without silently replacing operator work. Draft preparation carries standard; publication and changing a public commitment carry external and live, decided by company policy.

**Acceptance.**
1. Ten minutes before the committed update time, when no draft exists, one prepared draft restates known impact and names changed brief evidence or says plainly that nothing changed.
2. The communication owner receives one reminder linking the prepared draft; an unowned incident reaches every communicator.
3. Repeated triggers preserve one draft per incident and commitment, and an existing operator draft is never overwritten.
4. The private composer shows Lamp preparation and complete evidence with working source citations at phone and desktop widths.
5. With the held company policy, preparation changes no public commitment or published bytes and creates no subscriber notification or model request.
6. Without a subsequent publication the original commitment remains on the public page and the incident becomes overdue.

**Evidence.** `src/core/features/incidents/promise-draft.ts`:16, `src/core/features/incidents/promise-draft.repository.ts`:6, `src/core/features/incidents/reminders.ts`:24, `tests/e2e/update-reminders.test.mjs`:57, `tests/e2e/incident-brief.test.mjs`:86, `tests/e2e/update-reminders.test.mjs`:8
**Gap.** Old cited evidence asserts Ten-minute preparation trigger creates a draft before any later tick; Draft restates last public impact; Draft names changed evidence refs; No-change draft states nothing changed. Unasserted: A nonempty prepared evidence set is rendered completely in the private composer; Preparation preserves other published surface bytes; Company policy computes and permits the standard preparation call.

#### AGENT-003 — Audience-specific impact

Core · push-further · **partial** · Cites BASE-AGENT-006, BASE-AGENT-007

**Requirement.** An audience-impact specialist drafts each audience's wording from its components, regions and confirmed evidence. Audience-mapping authority carries access and variant publication carries external/live; company policy decides their disposition.

**Acceptance.**
1. An EU API incident creates an Enterprise EU draft naming that service and what its audience can and cannot do, and creates no variant for audiences without affected components.
2. Drafting reads audience definitions/component-region mappings and confirmed per-region evidence, without member identities.
3. Every variant passes UPDATE-011 private-name and identifier checks.
4. Under the held company policy, the named communicator accepts each exact variant before publication and the Owner or Admin handles audience-definition changes.

**Evidence.** `src/core/features/incidents/service.ts`, `tests/e2e/publishing-contract.test.mjs`
**Gap.** Each update carries an operator-written affected-audience statement (UPDATE-001). There are no audiences and no drafted variants.

#### AGENT-004 — Customer-visible recovery is checked before close

Core · push-further · **partial** · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AUDIT-001

**Requirement.** A recovery-check specialist shows evidence before a resolution, including linked monitor recovery holds, vendor dependencies, firing alerts, public traffic and support arrivals. A resolution or recovery override carries external and live; company policy decides the call. The recorded proof boundary is RL-7.

**Acceptance.**
1. Choosing Resolved with a failing linked monitor shows the failed item and its evidence time; under the held company policy, an unreasoned publication is refused.
2. An immediate reasoned override publishes Resolved and records the named operator's reason privately on the timeline and in the audit.
3. Every linked single-alert key and grouped member participates; reported recovery must precede the five-minute hold without a later firing receipt, and repeated group recovery restarts that hold.
4. A later firing alert or still-firing grouped member prevents a passing recovery result.
5. Immediate, historical and scheduled resolutions use the same check; a scheduled failure retains the draft when due, and an override authorizes only its current immediate publication.
6. Missing vendor, traffic, support or continuously sampled monitor evidence reads not tracked rather than passing; DEP-001, HIST-010, INTEG-001 and COMP-008 join this same check as their evidence becomes available.

**Evidence.** `src/core/features/brief/recovery-check.ts`, `src/core/features/incidents/recovery-repository.ts`, `src/core/features/incidents/publication-repository.ts`, `tests/e2e/incident-brief.test.mjs`, `tests/e2e/incident-brief.test.mjs`
**Gap.** Old cited evidence asserts The recovery response contains the linked firing item; That item names its source record.; That item carries a parseable evidence time; Unreasoned resolution is refused. Unasserted: Held company policy decides the resolution class; The audit actor equals the operator who published the override; Five-minute recovery threshold is applied at its boundary; Repeated grouped recovery restarts the hold; All linked alert keys participate; The same failing draft identity and wording are retained; Historical resolution follows the same recovery check; An override cannot authorize a later scheduled resolution; Missing vendor evidence is specifically not tracked; Missing traffic evidence is specifically not tracked; Missing support evidence is specifically not tracked; Missing continuous-monitor evidence is specifically not tracked.

#### AGENT-005 — A post-incident report drafted from the record

Core · push-further · **partial** · Cites BASE-AGENT-006, BASE-AGENT-007

**Requirement.** For a resolved incident, the report specialist drafts HIST-002 from cited evidence rather than inventing causes. Drafting carries standard and publication carries external; company policy decides their disposition. The original evidence boundary is RL-8.

**Acceptance.**
1. The report includes every held brief alert and published update, one source citation per timeline line, without internal notes.
2. Its window is labeled recorded from incident opening to published resolution, rather than monitor-measured downtime; measured monitor and responder timeline evidence joins the same cited generator when available.
3. Cause and remediation start as empty, flagged fields with prompts and related evidence rather than invented explanations.
4. Under the held company policy, the operator supplies cause and remediation; an empty field or untouched prompt refuses publication.
5. Drafting never replaces an existing operator report, and a saved draft remains private until publication.
6. Published report text is immutable and appears in the public incident record.

**Evidence.** `src/core/features/reports/draft.ts`, `src/core/features/reports/service.ts`, `src/core/features/reports/ui/report-editor.tsx`, `tests/e2e/publishing-contract.test.mjs`, `tests/e2e/publishing-browser.test.mjs`
**Gap.** Old cited evidence asserts The timeline represents every available alert reference; The timeline represents every available published-update reference; The timeline line count equals the total available source count; Every timeline line cites a real source record. Unasserted: Report explicitly labels recorded rather than measured downtime; An empty cause with completed remediation refuses publication; An untouched cause prompt with completed remediation refuses publication; An untouched remediation prompt with completed cause refuses publication; Held policy decides report publication class; The complete persisted report state is unchanged after the refused edit.

#### AGENT-006 — Unreported incidents surface early

Core · push-further · **missing** · Cites BASE-AGENT-006, BASE-AGENT-007

**Requirement.** An early-warning specialist correlates evidence of unreported customer impact into one private incident proposal. Draft creation carries standard and public publication carries external/live, with company policy deciding each call.

**Acceptance.**
1. With no incident open, the specialist correlates traffic spikes, clustered support categories, vendor outages and early signed Uptime vantage/latency evidence below confirmation.
2. A fourfold traffic spike and five login support conversations in ten minutes create one private proposal naming the sign-in component and both signals, with no public change.
3. Two of five failing sign-in monitor vantages below confirmation plus a traffic spike create one proposal citing the monitor evidence time.
4. Only aggregate categories and counts are read, with no customer message or identity; a dismissal records its actor and reason.
5. Under the held company policy the proposal alerts communicators and stays private until a person publishes.

**Evidence.** None.
**Gap.** Not built.

#### AGENT-007 — Translations drafted from the glossary

Core · push-further · **missing** · Cites BASE-AGENT-006, BASE-AGENT-007

**Requirement.** A translation specialist drafts every enabled-language update and report using the owner's glossary. Internal translation drafts carry standard; publication carries external and company policy decides it.

**Acceptance.**
1. With Spanish enabled, the composer receives a Spanish draft using the glossary's product and component names.
2. Under the held company policy, each language is accepted before publication or follows I18N-002's explicit default-language choice; publishing without Spanish acceptance follows that clause's refusal.

**Evidence.** None.
**Gap.** Not built.

#### AGENT-008 — Scoped MCP tools for outside agents

Core · push-further · **missing** · Cites BASE-AGENT-001, BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-009

**Requirement.** Outside agents can read components, incidents, briefs and subscriber counts, draft updates, propose maintenance and attach evidence through Lamp's scoped MCP jobs. Public publication carries external/live and follows the company's policy.

**Acceptance.**
1. A token restricted to reads and incident drafts creates an unpublished update visible in the composer.
2. That token is offered no publication tool; a broader owner-granted publication scope still follows the issuer's TEAM-004 rights and UPDATE-007 review under the company's policy.

**Evidence.** None.
**Gap.** Not built.

#### AGENT-009 — Maintenance notices drafted from change plans

Core · push-further · **missing** · Cites BASE-AGENT-006, BASE-AGENT-007

**Requirement.** A maintenance specialist turns a linked GitHub change, deployment plan or ticket into customer wording. Drafting carries standard and scheduling/starting carries external/live, with company policy deciding whether the step proceeds.

**Acceptance.**
1. The draft selects affected components and the stated window, and fills MAINT-009's audience, expected impact, what still works and details from the change title, description and labels.
2. A verification step in the plan causes the draft to propose automatic completion off.
3. A database-migration fixture yields a database maintenance draft with its stated window and customer-impact statement.
4. Under the held company policy the draft remains unscheduled until its communicator saves it.

**Evidence.** None.
**Gap.** Not built.

## Agent surface

### Agent surface

#### SURFACE-001 — Lamp jobs and records in the registry

Agent surface · target · **missing** · From new · Cites BASE-AGENT-002, BASE-AGENT-003, BASE-AGENT-006, BASE-AGENT-013 · Register R-100

**Requirement.** The incident communicator exposes the Core jobs in the tool table, and the Lamp records, specialist prompts and non-tool reasons below are its manifest.

**Acceptance.**
1. The discovered Lamp registry covers every Core clause by the table’s tool or its stated non-risk reason, including all split parts.
2. Incident, component, update, maintenance, subscriber, delivery, alert, report, import and audience links identify the same records the operator desk opens.
3. The specialist prompts prepare an incident story, keep an update commitment, check recovery, prepare a report and plan maintenance using those records.
4. The on-site agent guide and discovery manifest agree with the Lamp table, resource templates, event types and each computed-class fixture.

**Evidence.** None.
**Gap.** The Lamp MCP registry, server-computed risk classifiers and company-policy conformance journey are not built.

#### SURFACE-002 — Draft, exposure and sign-off classes

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008

**Requirement.** Lamp computes the standard, external and commitment classes from the proposed incident work and current publication and recipient records.

**Acceptance.**
1. A private incident, report, translation or maintenance draft and a reversible component edit carry standard with the touched-record count.
2. Publishing the same update to a public page carries external with public exposure; an audience publication carries only its actual recipient count and known or new counterparty facts.
3. A subscriber invitation, notification, report release and newly configured outside destination compute external from stored recipient and destination facts, including an unrecorded new destination.
4. A review or report sign-off carries commitment and its exact revision and relying counterparty. The company’s policy decides how an agent’s sign-off proceeds.
5. An outside-provider credential or intake-authentication change carries security and names the setting and provider; editing customer wording does not add that class.

**Evidence.** None.
**Gap.** The Lamp MCP registry, server-computed risk classifiers and company-policy conformance journey are not built.

#### SURFACE-003 — Authority, removal and provider-step classes

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008

**Requirement.** Lamp’s remaining computed classes describe authority changes, permanent removal and steps kept by an outside provider for a person.

**Acceptance.**
1. An operator, audience, subscriber-authority or application-grant change carries access, affected-person or grant count, and widening or narrowing direction.
2. Permanent erasure, irreversible history removal and an unrestorable import undo carry destructive with the actual removed-record count and dependencies.
3. A connection that the identity, mail, SMS or chat provider keeps for a person carries gated with that provider and step; an available company-credential API route is decided by the company’s policy for its other computed classes.
4. The same publication can carry external and commitment, and a credential connection can carry security and gated, without losing either class’s facts.
5. Changing an active automation rule, public hostname or failover configuration, or publishing a public component-state transition computes live with the affected running status service; the corresponding private draft does not.
6. An SMS dispatch computes money with amount, currency and the provider counterparty from the stored rate and recipient facts.

**Evidence.** None.
**Gap.** The Lamp MCP registry, server-computed risk classifiers and company-policy conformance journey are not built.

#### SURFACE-004 — Incident communication handoffs

Agent surface · target · **missing** · From new · Cites BASE-AGENT-003, BASE-AGENT-010

**Requirement.** The specialist follows operational evidence and emits customer-communication events with links to the records and evidence revisions involved.

**Acceptance.**
1. Accepted Uptime observations and Oncall responder changes link to the affected Lamp component or incident without confusing measured evidence with the operator’s claimed state.
2. Incident, update, maintenance, component, subscriber, delivery, report and import changes expose the resource and event types listed below.
3. An incident publication and a released report provide HappyToHelp or another subscribed support desk the exact published revision and its audience; private draft text stays within its audience.
4. An automation handoff uses the typed event and current records to compute the ensuing call’s class; wording embedded in evidence does not supply those facts.

**Evidence.** None.
**Gap.** The Lamp MCP registry, server-computed risk classifiers and company-policy conformance journey are not built.

#### SURFACE-005 — A stranger specialist runs an incident week

Agent surface · target · **missing** · From new · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-013

**Requirement.** Given only the installation address, the incident communicator completes a seeded week through Lamp’s MCP jobs under the all-autonomous and held company policies.

**Acceptance.**
1. The week reads a linked monitor alert, prepares a component incident and impact-first update, publishes the update to its intended audience, keeps the next-update commitment, verifies recovery and prepares and releases the incident report.
2. The same week schedules maintenance, processes email and SMS subscriber invitations and removal, and reads the resulting notification outcomes without calling provider acceptance a customer receipt.
3. Under the all-autonomous company policy every declared class completes the eligible Lamp work without a policy wait, policy refusal or human review step.
4. Under the held company policy standard work enters that policy’s review feed and calls in every other declared class wait for that policy’s named person; the resulting customer story and records equal the all-autonomous run.
5. The seeded week exercises a publication sign-off, an authority change, permanent removal, an authentication setting and a provider-kept consent step, so every computed Lamp class has a fixture and the provider-kept step remains truthfully attributed.

**Evidence.** None.
**Gap.** The Lamp MCP registry, server-computed risk classifiers and company-policy conformance journey are not built.

## Later

None.

## Field proof register

| ID | Proof | Clauses | State | Date | Receipt |
| --- | --- | --- | --- | --- | --- |
| R-1 | Human screen-reader pass on the operator, public, subscription and email journeys | PAGE-020 | not run |  |  |
| R-2 | Criterion-complete ITI VPAT 2.5 Rev 508 evaluation, dated for the released product | PAGE-020 | not run |  |  |
| R-3 | Owner Cloudflare outage-hour load receipt from US-East and US-West outside Cloudflare, with exact deployment/commit, k6 summary, sustained/burst/single-address rates, latency, zero public queries, publication and DNS failover | PAGE-021 | not run |  |  |
| R-20 | Live incident-desk acceptance in Slack workspaces and Microsoft Teams tenants. | INCIDENT-014 | not run |  |  |
| R-21 | Real Google Calendar, Outlook and Apple Calendar adoption receipts for the public maintenance feed. | MAINT-010 | not run |  |  |
| R-40 | Received real notification email with DKIM covering both unsubscribe headers and declared sending-domain authentication. | SUB-006, NOTIFY-010 | not run |  |  |
| R-41 | Slack and Microsoft Teams tenant acceptance of public subscriptions and published updates. | SUB-014, SUB-015 | not run |  |  |
| R-42 | Registered 10DLC or verified toll-free sender and real carrier receipt for Twilio and Plivo SMS. | NOTIFY-014 | not run |  |  |
| R-60 | Live PagerDuty account, provider note author and webhook/submission acceptance | INTAKE-009, INTAKE-015 | not run |  |  |
| R-61 | Live Alertmanager and Grafana deployment acceptance | INTAKE-010 | not run |  |  |
| R-62 | Live New Relic, Datadog and Pingdom connection acceptance | INTAKE-011, INTAKE-016 | not run |  |  |
| R-63 | Live Oncall tenant and paging handoff acceptance | INTAKE-012 | not run |  |  |
| R-64 | Live JSM Operations and Opsgenie tenant acceptance | INTAKE-014, INTAKE-019 | not run |  |  |
| R-65 | Real Auth, Okta, Entra ID, Google Workspace and AD FS vendor-tenant acceptance | TEAM-006 | not run |  |  |
| R-80 | Private-page and optional operator SSO against a real Okta tenant | AUD-002, ACCESS-002 | not run |  |  |
| R-81 | Private-page and optional operator SSO against a real Microsoft Entra tenant | AUD-002, ACCESS-002 | not run |  |  |
| R-82 | Private-page and optional operator SSO against a real Google Workspace tenant | AUD-002, ACCESS-002 | not run |  |  |
| R-83 | Terraform provider publication in its public registry | API-004 | not run |  |  |
| R-100 | Agent-client acceptance receipts in Claude, ChatGPT, Codex and Copilot. | SURFACE-001 | not run |  |  |
