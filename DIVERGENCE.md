# DIVERGENCE.md

Where this product did not fit the planted documents, what it needed instead, and why. Input to the later pass that decides what the shared docs missed. This historical record predates the edition-authoring conversion; the unified `AGENTS.md` now governs every author and fork.

## 1 — BASE-ACCESS-003 rate-limits the surface that must never be rate limited

**Baseline:** every public path "is rate-limited at the limits in `seed.json` and returns 429 when exceeded."

**The product:** a status page is read hardest at the moment it matters most. Traffic to it rises by an order of magnitude during the incident it exists to report, and much of that traffic arrives from a small number of egress addresses — one customer's office NAT, one partner's monitoring fleet. A per-address limit on the read path rejects real readers at exactly the moment the page is the only working thing the business has.

**What we did:** `PAGE-008` supersedes BASE-ACCESS-003 for the read paths only. The protection that replaces the limit is structural rather than per-caller: those paths serve a pre-rendered snapshot (`PAGE-005`), return identical bytes to every visitor between snapshots, and are cacheable, so a flood costs cache egress and never reaches the origin. Every public *write* path — subscribe, unsubscribe, manage, intake — stays under BASE-ACCESS-003.

**A second problem in the same clause.** BASE-ACCESS-003 says each public path "is rate-limited at the limits in `seed.json`" without saying what the limit is *keyed on*, and the obvious key — source address — is wrong for more than the read path. RFC 8058 one-click unsubscribes arrive from a mailbox provider's shared egress, so an address-keyed limit on `/unsubscribe` lets one provider's traffic exhaust the limit for every other subscriber behind it, breaking the one flow that must never fail. `SUB-006` keys that limit per subscription token instead, and `seed.json → deploy.publicPaths` carries a `rateLimitKey` the baseline does not know about.

**For the shared docs:** BASE-ACCESS-003 reads as though every public path is a write path. Most seeds have a public surface with the same shape — a booking page, a form, a widget — and the same argument applies to their read halves. Consider splitting it: read paths must be cacheable and identical between writes; write paths must be rate limited. Related: `seed.json → deploy.publicPaths` is specified as "exact paths or prefixes", which cannot express either the read/write distinction or the two hostnames this seed serves. Our manifest adds `mode` and `host` fields that the eventual schema will need.

## 2 — BASE-PUBLIC-001 forbids the transmission that one-click unsubscribe requires

**Baseline:** public surfaces "send no visitor data before the visitor's first interaction."

**The product:** RFC 8058 one-click unsubscribe — required by the bulk-sender rules of the large mailbox providers, and the only unsubscribe that reliably works — is a POST the *mail client* makes to a token URL with no interaction on our page at all. The subscription management page has the same shape: the subscriber arrives from an emailed link and the token in that link is transmitted on load.

**What we did:** `SUB-005` supersedes BASE-PUBLIC-001 for token-addressed paths only, and states what replaces it: no cookie on any public surface, an opaque token scoped to one subscription that grants nothing else and is revoked on deactivation, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex` on those responses. The rest of the public surface stays fully inside BASE-PUBLIC-001, including the subscribe form, where submitting an address *is* the first interaction.

**For the shared docs:** every seed that emails a recipient a link back to a public surface hits this. The baseline could carve it out directly — "a token the deployment itself emailed to the holder may be transmitted on load" — rather than making each seed supersede a security clause to comply with an email standard.

## 3 — BASE-DATA-002 retains data that should not be retained

**Baseline:** "No user data is deleted automatically. Only sessions and rate-limit state expire."

**The product:** anyone can type any address into a public subscribe form. A pending, unconfirmed subscription is an address held on the say-so of a visitor who may not own it. Keeping it until an operator notices is worse than deleting it.

**What we did:** `SUB-003` supersedes BASE-DATA-002 for pending subscriptions only, deleting them 72 hours after they are created. Confirmed subscriptions are retained under the baseline like everything else.

**For the shared docs:** BASE-DATA-002's exemption list is written as a closed set ("only sessions and rate-limit state"). Unverified contact details from a public surface are a third category with the same argument behind them, and any seed with a public opt-in will need it.

## 4 — BASE-DATA-004 assumes outbound destinations can be enumerated

**Baseline:** "User data leaves the deployment only through externals declared in `seed.json → externals`."

**The product:** webhook subscribers choose their own endpoint. The destination is not known when the seed is published, only when a subscriber adds one.

**What we did:** declared the class in `seed.json → externals` with `class: true` rather than naming hosts, and constrained the payload in `SUB-009` so it carries the published update and the delivery and update identifiers and no subscriber address. The first draft had `SUB-009` supersede BASE-DATA-004; the adversarial pass removed that. A class declaration *is* a declaration in `seed.json → externals`, and no personal data leaves, so the clause is satisfied rather than superseded. Marking a baseline clause superseded when it is not would have made `pnpm verify` report a security guarantee as waived for no reason.

**For the shared docs:** `externals` still needs a first-class notion of a buyer-configured destination class, and BASE-DATA-004 needs a sentence naming it. Until it has one, every seed with outgoing webhooks has to make this judgement call in prose, and the safe-looking call — supersede — is the wrong one.

## 5 — One Worker, and the availability isolation this category actually needs

**Current stack:** one Cloudflare Worker serves Hono APIs and public artifacts alongside TanStack Start sign-in and operator documents; a second needs a concrete isolation, security, or scaling reason.

**The product:** the category's signature failure is a status page that goes down with the product it reports on, or with its own operator app. `PAGE-005` and `PAGE-006` get most of the way there inside one Worker by making the public read path a snapshot read with no database query. We have kept one Worker and two hostnames.

**For the shared docs:** "availability isolation — the public surface must survive the operator surface" is a concrete reason and is not in the listed three. Worth naming, so a later build pass does not read the one-Worker rule as forbidding it if the snapshot approach turns out to be insufficient under load.

## 6 — Magic-link sign-in depends on the channel that fails during an incident

**Baseline:** BASE-ACCESS-001, "Operators sign in by magic link to an allow-listed email address; passkeys **may** be offered in addition."

**The product:** this product is used when other things are broken. If the mail provider is degraded — and a mail provider outage is itself an incident the buyer would want to post about — no operator can sign in to post it. The optional second factor is the thing that keeps the product usable in its own worst case.

**What we did:** nothing in the contract; we did not want to restate a baseline clause. Recorded here instead.

**For the shared docs:** for any seed whose job is to work when something else is failing, "may be offered in addition" should be "is offered in addition", or the baseline should require at least one sign-in path that does not depend on a declared external.

## 7 — The baseline says nothing about cacheability, and this category is defined by it

BASE-OPS-001 covers `/health`. Nothing in the baseline covers what a public surface serves when its backing store is unreachable. For most seeds that is a product question; for this one it is the whole product, so it is contracted here (`PAGE-005`, `PAGE-006`) rather than assumed. If other seeds' public surfaces end up making the same promise in the same words, it belongs in the baseline instead.

## 8 — The seed arrived without a git repository

`BOOTSTRAP.md` finishes with "everything is committed", and `AGENTS.md` describes tags, releases, and upstream diffs. This directory had no `.git` at all when this session started, and no `CONTRACT.md` or `seed.json` — the bootstrap pass that ran across the sibling seeds did not run here. `git init` was part of this session. Whatever plants these repos should either create the repository or fail loudly, since a missed seed is silent otherwise.

## 9 — What `pnpm verify` can honestly do today

`pnpm verify` runs TypeScript checking, first-party JavaScript syntax checks, contract/manifest integrity checks, real local Vite/Cloudflare Start/D1/R2 journeys, a generated Start Worker artifact check, and built-client namespace checks. The journey has tagged coverage for the implemented slices of `PAGE-001`, `PAGE-006`, `PAGE-007`, `PAGE-010`, `PAGE-012`, `SUB-001`, `COMP-006`, and `UPDATE-004`, plus session gating, deterministic sample boot, atomic incident drafts, settings snapshot rebuild, widget XSS safety, and unknown-host rejection. Its recorded result remains the source of release evidence.

It is not the full verifier `AGENTS.md` describes. There is no lint/boundary or schema-validation harness, prior-release migration test, load test, browser visual test in this command, remote preview/deploy smoke test, or complete clause-to-test coverage. The Worker test proves a current R2 snapshot can survive a D1 failure; it does not prove pointer serialization/retry, R2 failure handling, or Workers Cache stale fallback. Mail, AI, Queues, Cron, intake, publishing, and production setup remain outside its coverage. `tests/contract.mjs` is no longer unused: its `contract()` helper tags the exercised clauses in the Worker journey.

## 10 — Clause prefixes can collide with the product's own reference formats

`AGENTS.md` reserves `BASE-` and asks for "stable IDs and per-area prefixes (`BOOK-001`, `FORM-003`)". It says nothing about the identifiers the product itself shows people. This product's public incident references are `INC-4821` and `SCH-1542` — the strings customers quote in support tickets, taken from the prototype. A clause prefix of `INC-` would have put `INC-001` and `INC-4821` in the same paragraph meaning entirely different things, and a test named `INC-004` would read as a test about an incident. We used `INCIDENT-` and `MAINT-` for clauses and left the user-facing formats alone.

**For the shared docs:** one line in the contract section — a clause prefix must not collide with an identifier format the product shows users — costs nothing and is invisible until it is expensive.

## UI consistency pass

The operator pages share the selected 12ui design's navigation, typography and surfaces. The public snapshot retains its own Open Sans and configured branding with a compact masthead and status-first hierarchy. Incident composition precedes private controls on small screens, publication timing is separate from the next-update commitment, and component panels use native modal focus behavior. Subscription outcomes and setup retain their native routes and effects. No migration, provider, authentication, privacy or delivery contract changed.

## Focused workflow simplification — 2 October 2026

The overview presents each active incident once and combines component state and
history into one entry point. Empty first use points to adding a component.
The composer keeps the customer-facing fields and publish action primary, omits
obvious field explanations and the implementation banner, and offers email
preview and schedule/backdate controls through named disclosures. A configured
historical timestamp remains exposed and the action says “Publish historical
update”; clearing optional timing restores current-time publication. Channel
selection, autosave failure/retry, review, privacy and historical-notification
rules are unchanged. Successful publication refreshes the operator lifecycle and
timeline without replacing the editable draft. Maintenance date editing opens on demand, with explicit
cancel-changes and cancel-maintenance actions; recorded window precision is
preserved, including untouched seconds and ambiguous DST instants.

This changes operator presentation, not product requirements, public design,
authorization, data or provider behavior. Native browser/manual evidence and
project browser-test evidence are recorded separately in the external UX receipt.

The public page now has one “Resolved history” destination, omits two obvious
section explanations, and names active content “Incidents and maintenance.”
History explicitly covers resolved incidents and completed or cancelled
maintenance. The time label identifies the configured timezone without scripting
and the viewer's local timezone after scripting; availability days explicitly
retain the configured calendar. Timestamp instants and formatting are unchanged.
Targeted renderer and local-time script tests cover these distinctions; the
synthetic static renderer review has no live subscription or operator backend.

## Draft deadline during operator refreshes — 7 October 2026

Saving a private note or refreshing review metadata must preserve an in-progress
draft's original two-second save deadline under UPDATE-005. Refreshing the same
incident must also preserve displayed edits; only an acknowledged native draft
write can enable publication or scheduling. The autosave regression exercises a
real note refresh delivered during the debounce and checks stored and reloaded
bytes. This restores the existing requirement without changing its deadline.

Edits made while an earlier draft write is awaiting acknowledgement also keep
their original debounce deadline. The queue remains serialized and coalesces
pending edits into the latest displayed draft; time spent behind the earlier
write counts toward the unchanged 1,200 ms debounce. A native-write regression
holds the earlier acknowledgement, verifies that the later draft cannot overtake
it, and checks the two-second deadline plus exact stored and reloaded values.

## Subscriber dispatch cost — 7 October 2026

NOTIFY-002 retains its five-minute deadline at 1,000 subscribers, including the
existing local model's 100 ms acknowledgement and ten-requests-per-second limit.
Freeze and read each immutable mail envelope in one ordered D1 batch, and resolve
the provider-to-delivery mapping only when the durable callback ledger has pending
events. A durable claim and its authoritative delivery read also share one ordered
batch; only the claim winner receives the row. Accepted email attempts retain
COUNT + 1 numbering inside their insert and commit together with the pending
callback read, before any callback mapping or application. Provider send-ledger
recovery still prevents a second wire send if that local receipt batch fails.
Durable send claims, active-subscriber checks, sequential dispatch, retry
ordering, first-winner envelopes and callback claim/apply/complete ordering remain
the requirements. Local capture, provider acceptance and confirmed delivery stay
distinct. This restores the existing performance requirement without relaxing it.

## Native incident harness port ownership — 7 October 2026

The reference-storage incident fixture previously selected HTTP port 56300 and
related fixed Miniflare ports. Linux CI recorded Vite's strict occupied-port
failure before its three publication contracts executed; that log does not
identify the prior listener. The default mail-capture runtime now asks the real
Miniflare/workerd runtime for independent ephemeral HTTP and inspector ports.
Only after that runtime and the Wrangler migrations are ready does the incident
fixture reserve its own HTTP port. An explicitly configured
`LAMP_T073_INCIDENT_PORT` remains strict and fails if occupied.

Readiness requires the spawned Vite process to announce that exact listening URL
before the shared health probe can run. Startup failure and normal teardown stop
only the fixture's own process group. Native regressions retain an independently allocated foreign listener
while executing all three unchanged publication contracts,
prove explicit collision failure without probing or stopping that listener, and
verify independent real D1 stores and released runtime/inspector ports. External
controlled checks retain occupation of the legacy HTTP default separately, without
adding that fixed-port prerequisite to the default suite. Existing
contract bodies and historical fixtures are unchanged. This adjusts test bootstrap
only; production behavior and acceptance requirements are unchanged.

## Public snapshot fixture connection lifetime — 7 October 2026

The public snapshot fixture runs synchronous Wrangler D1/R2 commands between Node
fetches. Linux CI recorded a native `UND_ERR_SOCKET` while entering its second
contract, after the renderer-identity contract passed; the stale-snapshot contract
also passed. Reuse of a connection closed by the peer is a supported transport
hypothesis, not established packet-level causality for that CI failure.

Every Node fetch in this fixture, including startup, now asks the native fetch
implementation for `Connection: close`. The local adapter calls native fetch once,
retains its response stream and request semantics, and does not change global
transport state. Responses ignored by scheduled-event and stale-state checks are
released by their callers; the final failed scheduled response remains readable
for the existing diagnostic. The original retry count, timing, contract assertions,
Worker restarts, D1/R2 data, and Chromium journeys remain unchanged.

A native regression uses a separate HTTP server behind a TCP boundary that arms
already-idle connections during a real synchronous child CLI call. The boundary
closes the next bytes on an armed connection before HTTP parsing, independent of
route or client identity. The ordinary pooled request and the fixture policy are
checked against the same boundary, with raw connection and HTTP request counts.
This controlled idle-reuse closure tests the lifetime policy; it does not reproduce
a preclosed-FIN timing window or prove the cause of the historical CI failure.

The adapter uses native Request construction before changing the copied connection
header. This preserves native dictionary lookup for inherited, non-enumerable and
accessor options, including getter receivers, read counts, conversion order and
errors. Node retains its per-request dispatcher on the Request; the subsequent
native fetch explicitly retains the converted referrer and referrer policy, which
Node otherwise resets when copying a Request. Native HTTP regressions compare the
application request and option lookup trace with direct fetch, cover aborts with
no HTTP attempt, streaming duplex, dispatcher forwarding and caller header
immutability, and retain the original five transport tests.

## Subscriber notification token persistence — 7 October 2026

The manage and unsubscribe links now resolve together in one atomic D1 batch.
Both scopes retain their current committed, unrevoked token; concurrent dispatches
reuse the same winners, and a failed insert or read rolls back both allocations.
The transaction checks the subscriber's current active state, so deactivation or
deletion during sender configuration suppresses the pending notification without
recreating credentials. Each subsequent delivery resolves its own current state;
frozen retries retain the original complete envelope and links. Token signatures,
subscriber and scope boundaries, provider pacing, and the five-minute deadline
remain unchanged.

## Historical operator journey saved-state gate — 7 October 2026

The historical-controls browser journey waits for the exact draft it will use:
its native PUT must acknowledge the expected editable fields, an authenticated
GET must return the same durable draft, and the displayed fields must match while
publication is enabled. Its two label-only two-second waits previously conflated
workflow sequencing with the separate UPDATE-005 latency check. The reported
correction-wait timeout did not recur in the unchanged full verifier or two native
observer runs; those observations do not establish the cause of that earlier
failure. No application persistence defect was reproduced.

The dedicated UPDATE-005 browser and autosave-integrity deadlines remain strict
and unchanged, including native refresh and queued-write regressions. Historical
publication, private notes, correction, review and reasoned deletion assertions
remain intact. This journey now creates its own Journey API component regardless
of test selection; the empty-product journey still begins without any fixture
component. This changes test sequencing and isolation only.


## Public comparison source

The owner requires sanitized, deterministic public projections of every retained
comparison archive. Private originals remain digest-pinned outside the public
tree. Each derivative has a distinct identity and archive/member receipt; no
private immutable snapshot is relabelled as public. Personal locations and fixture
addresses are replaced, synthetic credential fixtures are marked, image metadata
is stripped, and historical presentation screenshots are explicitly excluded
from parent comparison presentation. Source, tests, schema, migrations, licences,
executable modes and meaningful comparison differences remain. This changes the
comparison presentation contract, not Lamp's runtime behavior. The public-parent
identity assertion continues to check a literal independently pinned identity.
