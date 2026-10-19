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

The operator pages share the selected 12ui design's navigation, typography and surfaces. The public snapshot retained its own Open Sans and configured branding with a compact masthead and status-first hierarchy (replaced on 12 October 2026 by the owner; see "Public status page restyle"). Incident composition precedes private controls on small screens, publication timing is separate from the next-update commitment, and component panels use native modal focus behavior. Subscription outcomes and setup retain their native routes and effects. No migration, provider, authentication, privacy or delivery contract changed.

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
timeline and opens a fresh empty draft for the next update (UPDATE-005 amendment). Maintenance date editing opens on demand, with explicit
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
`LAMP_INCIDENT_PORT` remains strict and fails if occupied.

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

Lamp's source is developed in its public repository, and every published tree
passes the publication scan with no reviewed exceptions. The retained comparison
projections (the whole-parent projection of the pre-edition Lamp and three
historical shared-component projections, with their plan, receipt and producer)
carried original-archive identities that a credential scanner cannot tell from
keys without the private originals, so they left the source tree on 13 October
2026 and remain in the private development history. The edition now declares no
comparison parent; its shared components keep their pinned Base baselines. This
changes the authoring comparison inputs only, not Lamp's runtime behavior.

## Product landing page, at /lamp until it became the app host's home page on 10 October 2026 — 8 October 2026, redesigned, given its intro and completed below the desk lamp 9 October 2026, restyled to modern design C the same day

The owner asked for a product landing page. It is served at `/lamp` on the operator application
host as a TanStack Start document, beside `/signin`, so the public snapshot pipeline is untouched:
`/`, `/history`, the feed, the widget and every page-host path are unchanged. `host-dispatch.ts`
and `server.ts` add `/lamp` as one exact app path rendered by Start, and `seed.json →
deploy.publicPaths` lists it because BASE-ACCESS-003 requires every unauthenticated path to be
declared. Every deployment's app host now serves this page; moving it to a separately hosted
product site is an owner decision. On 10 October 2026 it moved to the app host's `/` (the last
subsection below); `/lamp` now redirects there.

The owner rejected the first version (a long HappyToHelp-style page) and on 9 October 2026
approved one design in the 12ui Design workspace: the hanging-lamp mark and wordmark, Docs and
GitHub links, a serif headline, one line of copy, Get the code and Read the docs, and an etched
desk lamp lighting a tabletop on cream paper. The owner asked for just that concept: no further
sections, diagrams or text, and not to lead with open source. Its images are derived from 12ui's
conversion by `scripts/lamp-site/art.mjs` and recorded with their source hashes in
`src/site/lamp/asset-provenance.json`. The first version's sections, drawings, font and notices
are removed.

The same day the owner, liking that style and the logo's lamp, asked for more visual appeal through
an intro built around the logo's lamp. Owner requirements, in their words where given:

- The header at rest is the wordmark "Lamp" alone at the left, with Docs, GitHub and Get the code.
- A larger version of the logo's pendant lamp hangs from the top of the page in the centre. The
  page starts dim with the lamp off; shortly after load it clicks on (a brief flicker), its light
  falls on the paper, and the light reveals the title "When something breaks, turn the light on."
  This is the page's one h1, the document title is "Lamp — When something breaks, turn the light
  on.", and it replaces the approved design's "turn on the light."
- As the visitor scrolls, the big lamp rises out through the top and the logo's lamp drops into its
  place beside the wordmark: the lamp going home into the logo, continuous and reversible.
- Below, the approved composition continues, its line of copy now the section's heading. (The rest
  of the page below it was added later that day at the owner's request; see below.)
- Later the same day the owner asked for the unlit page to be "a lot darker, so we can only barely
  see the rest of it", and for the light, as the lamp flickers on, to "come out from it quite
  quickly". Before the click the page is close to night: paper, header, wordmark, nav and pill barely
  show and the unlit lamp hangs in it as a dark silhouette. After the flicker the light bursts out of
  the bulb and its front spreads across the page in about half a second, easing as it reaches the
  edges, lifting the dark from the lamp outward and revealing the title on its way. It is not a
  uniform fade of the page.

`src/site/lamp/` builds this as small components with scoped stylesheets: `SiteHeader` (fixed; its
paper backing fades in as the page scrolls), `BrandMark`, `Intro`, `IntroReady`, `Dusk` (first `Darkness`),
`LampRig`, `Cord`, `LampSprites`, `Light`, `DeskSection` and `LampArt`. The click-on is one 3.0s CSS
timeline (`timeline.css`: opacity, transforms and the dusk's mask) that never replays. The dark
is one layer over the whole first screen (until 12 October, see below: now the background behind it); its mask opens from the
bulb with the click, then follows the light's front (`--lamp-reach`, a registered length)
outward. The opening stays centred on the bulb when the visitor scrolls during the click-on (it
follows the handoff's lift), and the dark reaches below the intro over the handoff's scroll range,
so a scroll in the dark never uncovers lit paper. It holds at its start, the room dark and the lamp hidden, until the lamp's drawings have loaded and decoded, so the lamp is
always there, unlit, before it clicks on and lights the title. Readiness never waits for the page's
script bundle: `IntroReady` is a small inline script in the served document, straight after the
rig, that marks the intro `data-ready` once the drawings decode. The hold is bounded: if the
drawings are still loading 1s after the first frame, it marks the intro `data-late`, the room
lights and the headline shows, and the lamp appears, already lit, when its drawings arrive; it
never clicks on before it is drawn. The lamp's light fades out over the intro's lowest 30svh, so
its warm pool meets the paper below with no edge. The handoff is driven by `useScrollProgress`, one passive scroll
listener throttled to one write per frame of `--lamp-p` and the header backing's opacity through the
CSSOM; the backing is whole before the rising lamp's socket can reach the header's links, measured
from the layout, so the lamp never shows through a half-faded header. Every element's resting
style is the lit, landed state: under prefers-reduced-motion, and without JavaScript
(`@media (scripting: none)`), the lamp is simply lit, the title shown and the mark in its slot.
Without JavaScript nothing tracks the scroll, so the header is not fixed: it scrolls away with the
page, needs no backing, and the big lamp's cord runs up to the top edge.
Before the click the header is deliberately barely legible, for at most the hold and the click-on
(about 3s); any keyboard focus on the page lifts the dark at once, so focus is always visible,
and the title is never hidden from assistive technology.

The intro's sprites (the big lamp unlit and lit on one registered 1024x1536 canvas, its glow, and
the header mark drawn from the lit lamp at 104/1024 scale with the previous logo's three rays) were
generated on 9 October 2026 with Codex CLI 0.160.1's built-in image_gen tool on the owner's ChatGPT
sign-in. The owner suggested GPT Image 2.5; the tool did not report its image model, so that is not
confirmed. `scripts/lamp-site/intro.mjs` copies them in and records generator, prompts, date,
registration and hashes in `asset-provenance.json`. The previous header mark image is removed;
the favicon and touch icon still derive from the approved design's mark.

### The rest of the page, below the desk lamp — 9 October 2026

The owner then asked for the rest of the page in the same style, with content inspired by the
sibling seeds. This replaces the earlier "just that concept, no further sections" requirement for
everything below the desk lamp; the intro and the desk section stay exactly as approved. The owner
rejected an all-etchings version as "a bit heavy on the graphics. Some are fine - but you need actual
boxes showing what it does like the other seeds in this folder". The page now follows the plan that
answers this (`rest/plan-boxes.md` in the landing page's evidence, fact-checked against the source):

- Nine sections follow the desk lamp, each a `<section>` with one h2 of seven words or fewer and at
  most one sentence (146 words of new prose in all): "Who's affected, and what still works.", "Say it
  once, everywhere.", "Customers hear only what they follow.", "Down, not dark.", "Written in ink.",
  "Planned work, announced ahead.", "Plug in your monitoring.", "Already wired in." (six small plates
  captioned by h3s) and "Your light, under your roof."; then the close, "Hang the lamp before you
  need it." with one Get the code pill, and a footer with the mark, Lamp, Docs, GitHub and the page's
  only mention of the MIT licence. No two neighbouring sections share a composition.
- Every section but the close shows the product through plates: Lamp's real UI (the public page,
  the notification email, the site banner, the Atom entry, Manage subscription, the page served as
  its last known state, the 90-day availability, an incident record, planned maintenance and its
  reminder, the operator Alerts screen, and the export) drawn as live HTML and inline SVG with the
  product's own strings. A plate is a straight 1px ink hairline with 3px corners on ivory over a
  hatched offset shadow; amber marks only light, the current state and, in section 2, the same words
  highlighted in the email, the banner and the feed. Each plate is one `role="img"` with a label
  restating it; its drawn copy is `aria-hidden`, holds no headings and nothing focusable.
- One sample (`plates/sample.ts`) feeds every plate: one business on `status.example.com` in
  Europe/London, no page or business name. Strings the product makes with a pure formatter
  (`renderIncidentUpdate`, `formatTime`, `dateLabel`, `updateSummary`, `updateText`, `renderedUpdate`,
  `computeUptime`) come from that formatter; `tests/lamp-site/plates.test.mjs` renders the product's
  real page, incident page, feed and widget from the same records and finds every drawn string in
  them, and finds the strings private to a module (the stale banner, email times, the subscriber
  page, the operator screens, the threading and webhook headers) in that module's source. The
  webhook's two signatures are recomputed there. The export's entity count, 41, is what a real local
  export of a freshly migrated database printed. Two deliberate drawing choices: the widget's own
  dot (#d66a1f) is drawn amber, and the product's blue and brown uptime marks are drawn in ink.
- Three etchings below the desk, no more: the dark terrace with one lit street lamp (section 4,
  plate D in its light), the lantern on its shelf with the key on its hook (section 9), and the
  intro's lit pendant (the close, the intro's own files). The terrace and lantern masters were
  generated with Codex CLI 0.160.1's image_gen; `scripts/lamp-site/etchings.mjs` derives their AVIF
  and WebP widths (the terrace also as a 4:5 crop around the post, its cut sides feathered) with the
  desk scene's pixel work, now shared in `scripts/lamp-site/pixels.mjs`, and records origin and hashes
  in `asset-provenance.json → etchings`. All load lazily with empty alts. The lit terrace, the
  hallway and the logbook were dropped and are not in `src/`.
- Nothing below the desk moves: no reveal, hover or scroll effect; without JavaScript and under
  reduced motion it renders the same. Under 1024px every section reads text first, then its plates
  (at most 640px wide); under 600px the 390 rules apply (16px gutters, section 2's plates stacked
  and unturned, the tiles one column, the footer in two rows); plate A is one column until it is
  900px wide.
- Two placements differ from the plan's coordinates because the plan's own constraints required it.
  In section 2 the plates are as tall as their real content, so each sheet overlaps the one behind
  it only below that sheet's highlighted line (the plan's first requirement: the shared words stay
  whole in all three), which makes the cluster taller than the plan's 600 units. In section 4 the
  street lamp's head spans about 691 to 841 units, so the headline ends 100 units left of the post
  and plate D starts 92 units right of it, instead of 64 and 72, which would touch the lantern.
- Two plate sizes differ from the plan because the strings it requires would otherwise fall under
  the crop. Plate E2 runs through all four updates, "About this incident" and the Opened line, and
  its crop fade falls on the first words of the post-incident report (its eyebrow and heading, as
  the real page prints them next): about 813px (867 units) tall at 1440 instead of about 640 units,
  so the right column ends about 330 units below E1, and from 1024 to about 1300px, where E2 is
  under 480px wide and its fields stack, about 520px below. At 390 it is about 1000px tall instead
  of about 760px. Plate A keeps its one-column arrangement until the plate is 900px wide (about
  1235px of page), not 600px: narrower, the two-column record leaves the current update too little
  width to keep its four fields above the fade. One column, plate A is as tall as its content (about
  715px from 600 to 900px of plate, 817px at 390).
- Measured on the production build at 1440: about 374 KB on first load (HTML, scripts, styles, the
  two fonts and the intro's drawings) and about 532 KB once scrolled to the end; at 390, 357 KB and
  420 KB. The two etchings are requested only as they come near.

`src/site/lamp/sections/` holds one component and one scoped stylesheet per section, the close and
the footer; `src/site/lamp/plates/` holds the shared `Plate`, one component per plate, the small
parts they share, and `sample.ts`. A plate's layout follows its own width (container queries), so
the same plate serves every page width.

Although it is not a status surface, the page follows BASE-PUBLIC-001: it sets no cookie and loads
nothing from another origin. Its fonts (Playfair Display and Inter, SIL OFL 1.1, licences beside
them; code in plates uses the system monospace stack), the sprites, the lamp scene, the etchings,
icons and paper are bundled into `/app-assets/`. It adds no contract clause; `tests/lamp-site/`
holds its guarantees.

### Restyled to modern design C — 9 October 2026

The owner then judged the page "progress, but the whole style feels old. Just because it's called
'lamp' and line drawn does not mean we want the site style to feel old. It should feel reassuring,
modern, clean, dependable." In a 12ui round they approved design C (`12ui-modern/approved-C.png`,
1536x1024) as the visual authority: a warm, clean off-white page with no texture, a modern matte
dark-green dome pendant on a thin black cord whose warm bulb lights the headline, a grotesk headline
in deep green-black, a muted grey-green subline, dark pill buttons and an underlined link, and a
small flat dome mark beside a sans "Lamp" wordmark under a quiet nav. This replaces the visual
requirements above (the approved etched design of the morning, Playfair Display, the paper, the
hatched plates and the etchings); the copy, the plates' content and strings, the sample and the
intro's behaviour are unchanged. The restyle follows `modern/restyle-spec.md` in the landing page's
evidence, every token measured from C:

- The hero is design C. The intro keeps its dark start (now a deep green-black night), the click,
  the light spreading from the bulb and revealing the hero, the 1s hold and `data-late` path, the
  no-JS and reduced-motion lit states and the scroll handoff into the header mark, with the wordmark
  alone at rest. C's subline and its two actions ("Get the code" and "Read the docs") now close the
  hero, so the separate desk-lamp section is folded into it and removed; the subline is the hero's
  paragraph, no longer an h2. The pull-chain scroll cue is removed (C has none), so the click-on runs
  8 animations instead of 9. At 1440x900 the lit hero passes `modern/hero-check.py` against C.
- One typeface, Inter (the file the page already shipped), its headline at 600; Playfair Display and
  its preload are deleted. The page requests one font file.
- The lamp drawings are the art track's matte renders (`modern/art/`, Codex CLI 0.162.0's image
  tool) on one square 1560 canvas, lit and unlit with identical alpha, plus a procedural glow; the
  lit inner shade was graded toward C's gold (`modern/build/grade/`). The header and footer mark is a
  hand-written SVG of C's flat dome, and the favicon and touch icon are rendered from it.
  `scripts/lamp-site/intro.mjs` copies them in and records generator, prompt files and hashes,
  registration and hashes in `asset-provenance.json`; `art.mjs` and `etchings.mjs` are deleted.
- The plates are restyled as clean product cards (white, a 1px ink-10% border, 12px corners, a soft
  layered shadow, Inter titles; no hatching, rotation or ivory). Amber now means only the lamp's
  light and "now": the current update or notice, the same words in section 2, B2's widget dot and
  the light on the dark band; ticked checkboxes are ink.
- Both etchings are dropped and no new picture is generated. Section 4 ("Down, not dark.") is the
  page's one dark band: the same lit pendant hangs from its top edge over plate D, whose stale banner
  is the first thing its light falls on, with the text on the right. Section 9 ("Your light, under
  your roof.") is plate-only: the text beside plate H, now a dark terminal card. The close hangs the
  same lit pendant; both reuse the intro's files, so they cost no new request.
- Each pendant draws one cord: its drawings are masked above the cord grip and the CSS cord runs
  down to the grip, so the cord never steps in width or shading where it meets the drawing; the
  grip is the only joint. On the dark band the pool of the lamp's light under plate D exists only
  from 1024px, where the pendant hangs over the plate; narrower, the text lies between lamp and
  plate, and no light shows without a lamp above it.
- Measured on the development server at 1440: the page's images and fonts after a full scroll are
  under 250 KB (Inter, the three 720px AVIF sprites and the SVG mark), against about 532 KB before.

The page still sets no cookie and loads nothing from another origin, and `/` and the public
snapshot pipeline are untouched. `tests/lamp-site/` was changed to prove the new style: the
assertions on the desk section, the etchings, Playfair, the hatch, the turned cards and the cue
were replaced by assertions on design C's hero, the cards, the dark band, the single face and the
art's registration; every intro, handoff, accessibility, overflow, origin and plate-string
guarantee is kept.

### Brand mark 18 — 9 October 2026

The owner then rejected the restyle's header mark (C's flat dome on a cord) and, from 23 numbered
variations (`modern/logo/all-marks-1.png`, `all-marks-2.png` in the landing page's evidence), chose
mark 18, "Circle: dome above, light below": on a 64x64 viewBox, an ink half-disc dome on top, a
warm amber lower half-disc, and a pale bulb arc at the dome's rim (`modern/logo/badge/badge-1.svg`,
with `badge-1-reverse.svg` for dark grounds). Owner requirements:

- Mark 18 is the brand mark wherever the mark appears: the header lockup and the footer draw
  `art/lamp-badge.svg`, a byte copy of `badge-1.svg`. The old mark's file, its favicon and touch
  icon, and the header's registration to the old dome's base are removed.
- The header lockup has the proportions of the logo sheet's 40px lockup: the mark square, the gap
  9/40 of it, "Lamp" at 38/40 of it in Inter 600 at -0.035em, the name's line centred on the mark.
  From 1024px the mark is 42 units (so the wordmark keeps C's 40 units), 32px from 600px and 30px
  below; its size and top are whole pixels, centred on the header's first row, so it is crisp at
  every width. The footer's lockup uses the same proportions at 24px.
- The scroll handoff is unchanged in kind: the big lamp rises out through the top as the wordmark
  steps aside and mark 18 drops from above the top edge into its slot, landing exactly in it with
  no jump at the end of the handoff.
- The reverse is used where the mark's own ground is dark. On the page that ground does not occur:
  the unlit room is a layer of night over the whole first screen, header included, so the mark's
  ground under it is still the paper, and the colour mark is the one that reads there (a dark
  silhouette in the night, like the big lamp; the reverse's paper dome would vanish into the
  paper). The SVG favicon (`art/lamp-badge-icon.svg`) carries both: the colour mark, and the
  reverse under `prefers-color-scheme: dark`, for dark browser chrome.
- The favicon is that SVG with 32 and 16px PNG fallbacks, and the touch icon is mark 18 at 140px
  on the page's paper, 180px; `scripts/lamp-site/mark.mjs` copies the mark in, renders the PNGs
  in Chromium, and records sources and hashes in `asset-provenance.json` (`mark.chosen` records
  the owner's choice). `scripts/lamp-site/intro.mjs` now copies only the sprites.

`tests/lamp-site/` was changed to prove it: the assertions on the old mark's file, its 48-unit
geometry and dome-base registration, and the 64px PNG favicon were replaced by assertions on mark
18's file and shapes, the lockup's proportions, whole-pixel size and top, one blended pixel at the
seam and the circle's sides at 1x and 2x at every width, mark 18's pixels in the slot where the
handoff lands, the night over the mark in the unlit room, the favicon's reverse on dark chrome, and
the served icon links and files. Every intro, handoff, accessibility, overflow and origin guarantee
is kept.

### Test prune — 10 October 2026

The owner set new rules for every test suite, and they replace the test claims recorded in the
entries above. Owner requirement, verbatim:

- Keep test suites small and meaningful: a project's suite stays in the low hundreds of tests, not
  thousands.
- Tests guard the flows a user or the business would notice breaking, through public doors (route,
  command, transport, built page), with fakes only at the paid or network edge. Add or change one
  only when a change adds or alters such a flow.
- Prove a one-off fix in its evidence (the failing case before, the same case after), not with a
  new permanent test.
- No pin tests: never assert a hash, version string, file or env list, UI copy or a threshold's
  value.
- Delete freely. Deleting a test is never cheating and never needs approval.
- Never weaken a test to get a change through. A test that pins behaviour you deliberately changed
  is updated or deleted in the same change and named in your report.
- CI is the full wall. Run the tests of what you touched; no full suites per lane or gate, and no
  baseline runs.

Under these rules `tests/lamp-site/source.test.mjs` (25 tests: source text, file lists, colour
tokens, copy, links, fonts, hashes and provenance) and `tests/lamp-site/plates.test.mjs` (11 tests:
the plates' strings against the product's renders and module sources) are deleted, and
`tests/lamp-site/browser.test.mjs` is cut from 33 tests to 12, dropping its pixel, colour, copy,
geometry, timing-threshold and provenance assertions. `pnpm run test:lamp-site` runs only
`browser.test.mjs`. The page itself is unchanged.

The guarantees recorded above that are now intentionally not asserted by any test:

- the plates' strings: that each drawn string is found in the product's real public page, incident
  page, feed and widget rendered from the sample, or in the source of the module that owns it (the
  stale banner, email times, the subscriber page, the operator screens, the threading headers);
  strings made by a pure formatter in `plates/sample.ts` remain the product's by construction;
- the webhook tile's two signatures, recomputed from the sample secrets;
- mark 18's file (a byte copy of `badge-1.svg`), its shapes and colours, the lockup's proportions,
  and its crispness at whole pixels, 1x and 2x;
- the favicon and touch icon files and links, and the favicon's reverse on dark chrome;
- the design C pixel match of the lit hero at 1536x1024, and the cord, seam and light-burst pixels;
- the provenance records and hashes in `asset-provenance.json`, and the page's exact copy, colour
  tokens, transfer sizes and per-section composition geometry.

These remain owner requirements of the page, but nothing checks them automatically: a change that
touches one proves it in that change's evidence. The flows the page's visitors and owner would
notice breaking are each guarded by one browser test on the served landing page (at `/lamp` when
this was written, the app host's `/` since 10 October 2026):

- served as the app host's home page, with the page host's `/` the status page and `/lamp`
  redirecting home: "the app host's home page is the landing page, the page host's is the status
  page, and /lamp redirects home" (until 10 October 2026: "/lamp is served as its own document on
  the app host, and / still serves the status page");
- the dim start, the one click-on and the lit, readable hero, never replayed: "the intro starts
  dim with the hero readable and the lamp clicks on once, leaving the page lit";
- the 1s hold, both halves (the click-on held at its start while the drawings load; then lit
  without them, the lamp shown only once drawn, already lit): "when the lamp's drawings are slow the
  click-on holds at its start, then the page goes lit without them, and the lamp appears only once
  drawn, already lit";
- lit before the scripts arrive on a slow network: "on a slow network the page goes lit before its
  scripts arrive, without waiting for hydration";
- reduced motion and no JavaScript simply lit, the mark in its slot: "under reduced motion the page
  is simply lit: nothing animates and the mark already sits in its slot" and "without JavaScript the
  page is simply lit, the mark in its slot and nothing running";
- the scroll handoff into the header mark and back: "the scroll handoff lifts the big lamp away and
  lands the header mark in its slot, continuously and reversibly";
- the product-card sections, the close and the footer: "every section renders below the hero, in
  order, under one h1: the product cards, then a close that offers a way in, then the footer" (every
  section but the last shows rendered cards; the last has none and offers a visible link);
- no sideways overflow: "nothing overflows sideways at a narrow phone and a wide desktop width";
- nothing loaded from another origin (BASE-PUBLIC-001, which the page follows): "every request the
  page makes stays on its own origin";
- keyboard reach and visible focus: "the keyboard reaches the skip link first and then every link,
  each with a visible focus ring, and focus lifts the dusk";
- accessibility: "automated WCAG AA checks find nothing on the lit page, at the top and at every
  section".

### The lamp vanishing after hydration — 10 October 2026

The owner reported that on the landing page "the lamp isn't staying there. It's disappearing."
The lamp vanished, and the room went back to night for good, whenever React rendered the intro
in the browser instead of hydrating the server's: it does so when hydration meets server HTML it
did not expect, and the new intro had neither the `data-ready` mark IntroReady's inline script had
written nor a script to write it again (React never runs a script it renders), so its lamp stayed
hidden and its timeline held at the dark start. Two things set it off:

- In WebKit (Safari's engine), on every load at every width: the product cards' times are made
  by the product's `formatTime` on the server and again in the browser, and WebKit joins a date
  and a time with " at " where V8 writes ", " ("Oct 9, 2026 at 13:12" against
  "Oct 9, 2026, 13:12").
- In the owner's own Chrome, on this Mac (the dev server's log, three times): the threaded
  email tile's In-Reply-To text was split after "…com" by the time React hydrated it, an edit
  made in the browser (most likely by an extension), never by the server. Playwright's clean
  Chromium never did this; an edit outside the page's control can always happen.

Owner requirement: the intro's lamp stays visible and lit at rest in every browser until the
visitor scrolls it into the handoff, whether React hydrates the intro or renders it anew, and a
time reads the same wherever it is formatted.

`formatTime` (`src/core/features/public-snapshot/format.ts`) now builds its date and time from
the formatter's parts, so its output no longer depends on an engine's joining words; on the
server (V8) it is unchanged, byte for byte, so the public page, feed, widget and emails read as
before. IntroReady keeps the intro's progress on the window as well as on the intro, and when
React renders a new intro it gives it the same marks and a negative `--lamp-intro-delay`, so the
timeline resumes exactly where it was: a lit page stays lit and a click-on in progress carries
on. The hydration error itself is still reported in the console.

No permanent test was added: the 12 browser tests run a clean Chromium, where neither trigger
occurs, and reproducing either needs an edit to the page that no public door makes. The fix is
proven in its evidence (`polish/bug/` in the landing page's evidence): before, the lamp vanished
and the page stayed dark in WebKit on every load, and in Chromium and WebKit once the In-Reply-To
text was split before hydration; after, it stays lit at rest in Chromium and WebKit at 1440x900,
1512x982, 1728x1117, 1920x1080 and 390x844, on fresh, warm and reloaded loads, with slow drawings
and scripts, a busy main thread, a scroll down and back, a tab switched away and back, a resize,
and a split text node before or after the page has lit.

### Polish pass — 10 October 2026

The owner, verbatim: "On the home page, the lamp isn't staying there. It's disappearing. Just do a
full polish pass across it all. It's not totally selling it for me. It doesn't have some of the
refinements some of the other siblings have. The concept is fantastic. I think we just need to keep
polishing it up and really working on it."

Kept owner requirements: the header at rest is the wordmark "Lamp" alone (mark 18 drops in only
during the handoff, and sits in its slot from the start under reduced motion and without
JavaScript); design C's first screen, which `hero-check.py` still passes on a lit 1440x900 capture;
the intro's dark start, one click-on, 1s hold and late path; and the lamp visible and lit at rest in
every browser, as recorded in the entry above. Moving the landing page to `/` and publishing each
company's page on its own host is separate routing work; this pass writes no new `/lamp` link and
links within the page by `#id` only.

Intentional changes:

- **The handoff, retimed.** The big lamp hangs at page speed (the 45svh lift is gone). The handoff
  is measured on the lamp: it runs from the scroll where the lamp's grip meets the header's bottom
  edge to the one where its bulb passes it, and the mark drops into its slot over exactly that span,
  so at every scroll position the bulb is still below the header, or the mark shows, or both. The
  wordmark steps aside over the first part of that span (0.05–0.4), once the mark's foot shows and
  before the falling mark reaches the name's line, so the two never overlap. The header's backing is
  frosted glass (84% paper over an 18px blur, opaque paper where backdrop filters are missing), whole
  before the grip reaches it, so the lamp passes up into it softened rather than sliced. The light
  fades with its lamp, so no glow is left at the top without a source.
- **Reading order in the dark.** In the dark only the lamp shows; the light reveals the headline,
  then the subline, the two ways in and a new proof line. The first keyboard focus shows the whole
  lit hero at once and for good (`data-shown`), so it never replays when that focus ends. The proof line under the ways in reads "Live within 10 seconds · Answers when its
  database is down · No cookies, no tracking".
- **The light without rings.** The cone is clear beside the shade down to the rim's line, falls
  downward as in C, and is dithered by a grain tile (`art/grain.svg`, recorded in
  `asset-provenance.json`): sparse light and dark specks balanced to leave the light's level
  unchanged, laid over the hero's light and the section and close pools and confined to them. The
  plan's alpha-modulating grain mask was tried first and left rings in the faint outer falloff,
  where a few percent of a faint light is less than one level. The grain reaches as far as each
  light does and is three tiles deep in its faint outer ring, where a step is widest; the pools'
  feathering is part of their gradient, so their grain can outlast the light's fade and stop only
  where the light is under half a level.
- **Order, words and structure.** Eight sections plus the close, in the story's order: Status page,
  Updates, Resilience (Down, not dark, moved up to third), Subscribers, History, Maintenance, Also
  included, Ownership. Each has an eyebrow. Copy: "Who’s affected, and what still works." /
  "Every update leads with impact, in plain words."; "Say it once, everywhere." / "Page, email,
  site banner and feed carry the same words."; "Down, not dark." / "Even with Lamp’s own database
  down, your page still answers and says how old it is."; "Customers hear only what they follow." /
  "They pick components, and leave in one click."; "Written in ink." / "Updates are never
  rewritten, and uptime is never rounded up."; "Maintenance runs itself." / "It starts, finishes and
  tells subscribers, with no one at the desk."; "Already wired in."; "Your light, under your roof."
  / "It runs on your Cloudflare account, never phones home, and exports in full." with three steps
  (run the setup, deploy, use your own domain); the close "Hang the lamp before you need it." / "Set
  it up on a calm day. It’s ready for the bad one." with Get the code and Read the docs.
- **Monitoring folded into a tile, the Thread tile dropped.** Plug in your monitoring's honest next
  step is a draft (INTAKE-002), which the owner does not want sold; its source card is now the
  "Alerts in, one incident per problem" tile (INTAKE-003). The email-threading tile is gone.
- **Grid and grounds.** From 1024px every section sits on one 12-column grid inside the shared
  gutter (columns of 95 units, gaps of 24), every text column, plate, panel and tile on a column
  line, the text side alternating; cards inside a stage panel are staged in it. Featured cards stand
  on quiet stage panels (`--lamp-stage`); Down, not dark is an inset rounded night panel whose lamp's
  light falls on plate D; the lamp's pool lies under plate A and the close's headline. Spacing varies
  with the story, and text beside tall cards stays in view. Ownership's terminal (setup, deploy,
  export) runs off its panel's right and bottom edges.
- **Cards cropped cleanly.** No card fades through text any more: plate A ends with the current
  update, its columns within 24px; the channel cards end on the line after the shared words, each
  strip ending in its channel's chip; E2 ends after Identified with a fading rail; E1's figure
  stands at 28px beside its strip with the method's first two sentences; plate C omits its helper
  line; the six tiles are one height, each crop ending on a line or control boundary, two to a row
  only from 680px so the webhook's body line clears its padding, with every row's captions and crops
  on one line however a caption wraps; mono lines break only between words, and the stale banner's
  timestamp stays whole.
- **Motion below the hero.** This supersedes "Nothing below the desk moves" in the entry above.
  Each section plays one calm moment once, as it first crosses 85% of the viewport, after hydration
  and only when motion is welcome: the product's real behaviour in reading order (the current update
  arriving, one highlighter through three channels, the light landing on the stale page, ticks,
  uptime filling and updates stacking, the reminder washing in, tiles rising, the terminal typing).
  No loop, counter or bounce; each ends within 1.2s, the terminal within 1.8s; nothing seen is ever
  hidden again, a focus inside shows the final state, and reduced motion, print and no JavaScript
  show the final state outright. A moment that has played, or been focused, is over for good: no
  later focus change, resize or container query restarts it.
- **Hover and press.** Pills darken with a soft shadow and press 1px; nav and footer links show an
  underline on hover; Read the docs deepens its own. None of it moves under reduced motion.
- **Footer index.** The footer signs off with the lockup and the page's one line, an index of the
  sections (`#id` links that glide only when motion is welcome, moving focus to the section's
  headline as a native jump would), Docs, GitHub and an outline MIT licence pill.
- **The phone header.** Under 600px the header is one 64px row, the name and Get the code; Docs is
  in the hero and Docs and GitHub in the footer. The intro is as tall as its content, so section 1's
  headline starts in the first screen.
- **No trust line.** The plan's "Every promise here is a numbered, tested clause" was dropped,
  because one caption, "Signed webhooks, Slack too", has no clause behind its Slack half (the
  delivery code formats Slack hooks, but no CONTRACT or BASELINE clause states it).

Claims map: the proof line (PAGE-007; PAGE-005, PAGE-006; PAGE-013, NOTIFY-004, BASE-PUBLIC-001),
Status page (UPDATE-001), Updates (UPDATE-002), Resilience (PAGE-005, PAGE-006), Subscribers
(SUB-004, SUB-006), History (INCIDENT-004, UPTIME-001), Maintenance (MAINT-002, MAINT-005), the
tiles (HIST-002; INTAKE-003; SUB-009, with Slack outside the contract; NOTIFY-004; PAGE-012;
SUB-005 and BASE-PUBLIC-001), Ownership (BASE-DATA-001, BASE-DATA-005; the steps are
`scripts/setup.mjs`, which provisions D1, R2 and the queue, and `scripts/deploy.mjs`, which checks
`/health` and then the page host's retained snapshot; PAGE-012), and the close (PAGE-006, as
qualified by Resilience).

Test changes in `tests/lamp-site/browser.test.mjs` (still 12 tests):

- "the intro starts dim with the hero readable and the lamp clicks on once…": after scrolling through, the "does not
  replay" check reads only the intro's own animations, since moments below may still be playing.
- "under reduced motion the page is simply lit…": also scrolls through the whole page and checks
  that nothing animates anywhere.
- "the scroll handoff…": at every step the lamp's bulb is below the header's bottom or the mark
  shows below the top edge: the owner's "it's disappearing", guarded.
- "every section renders below the hero…": runs with motion on, waits for every moment to finish,
  and checks each heading and card is visible, opacity included, so no moment can leave content
  hidden.

### The landing page at the app host's `/`, each company's status page at its page host's `/` — 10 October 2026

The owner, verbatim: "the landing page shouldn't be at /lamp. It should be the default landing
page, and we should have some other way for the users' landing page to be hosted. It should have
its own URL, or we should be mapping C names or something to it. The home page itself, without the
lamp, should be what appears on the home page. We need some other way to actually publish the
status page for each company".

Decision (option A of the routing study, taken by default; the owner was told and did not object):
one installation publishes one company's status page, and its two hostnames each have their own
home page.

- The app host's `GET /` is the landing page, a TanStack Start document (`src/routes/index.tsx`,
  formerly `src/routes/lamp.tsx`). Its brand links to `/`.
- The page host's `GET /` is the company's status page exactly as before: the R2 snapshot read
  path, CSP, caching and every PAGE clause are unchanged. The company points its own name, such as
  `status.company.com`, at the page host; OPERATIONS.md "Hostnames and DNS" records how, including
  that a name whose zone is outside the Worker's Cloudflare account must move to (or be delegated
  to) Cloudflare first. Several companies means several installations; one multi-tenant Worker
  would reverse the "More than one status page per deployment" non-goal and is not built.
- `/lamp` answers 301 to the app host's `/` for one release, then is removed. It stays in
  `seed.json → deploy.publicPaths` while it answers, because BASE-ACCESS-003 requires every path
  reachable without a session to be declared.
- `LAMP_PAGE_HOST` and `LAMP_APP_HOST` must differ everywhere. `host-dispatch.ts` throws, naming
  both variables, when they are equal, so a Worker so configured fails every request with a 500 and
  that error in its log; there is no fallback that drops either home page. Setup already rejected
  equal values.
- Locally the template sets `LAMP_APP_HOST = "127.0.0.1"` and `LAMP_PAGE_HOST = "localhost"`
  (also the local installer), both already on the development outbox and ingress loopback lists
  (the one ingress change, for links between the two hosts, is recorded below):
  `http://127.0.0.1:<port>/` is the landing page and
  `http://localhost:<port>/` the status page. Dev prints both and requests the status page
  once at start so development notification links have their page origin. A local state created
  earlier persisted `http://127.0.0.1:<port>` as that origin and refuses the new one by design;
  the error now names the one-time reset command (also in HANDOVER.md).
- The Alerts page showed each intake endpoint on the app host's origin, but `/api/intake/` is a
  page-host path, so a distinct-host deployment showed a URL that answers 404. It now shows the
  page host's origin from the operator session loader.
- The development outbox answers on both loopback hosts, so its links must name each surface's
  origin. Its header links were relative (`/`, `/signin`): on the app host "Lamp status" opened the
  landing page, and on the page host "Sign in" answered 404. Captured links were clickable only
  when their origin equalled the outbox's own, so each host showed half of them (sign-in links use
  the app origin; confirmation, manage and notification links the page origin) as plain text.
  `src/core/features/dev-outbox/routes.ts` now builds both origins from the request's scheme and
  port with `LAMP_PAGE_HOST` and `LAMP_APP_HOST`, points "Lamp status" at the page origin's `/` and
  "Sign in" at the app origin's `/signin`, and links a captured URL only when its origin is one of
  those two, still without credentials; any other origin, port, scheme or loopback name stays text.
- The two development hosts are distinct sites on one port, so a click from one to the other
  arrives as `Sec-Fetch-Site: cross-site`. Both development gates refused every cross-site request
  with 404 (the raw-socket ingress in `scripts/dev-ingress/plugin.mjs`, and the Worker's request
  check, which was the outbox predicate): the outbox's links, and the sign-in page's and operator
  shell's links to the status page, could not be followed in the browser. Both gates now admit a
  cross-site request only when it is a top-level GET or HEAD document navigation without Origin
  whose single Referer is the other surface on the same scheme and port (the ingress accepts any
  loopback name there; the Worker accepts only `LAMP_APP_HOST` or `LAMP_PAGE_HOST`), that is, a
  page this development server rendered. The Worker check is `admitsDevelopmentRequest` in
  `src/core/features/dev-outbox/access.ts`; such a request also gets the local subscriber token
  secret, so a confirmation link followed from the app host validates. Every other cross-site
  request still answers 404, `canUseDevelopmentMail` (mail capture and the outbox itself) still
  refuses every cross-site request, and production never runs either gate. The outbox keeps
  `Referrer-Policy: no-referrer`; only its links to the two surfaces send its origin
  (`referrerpolicy="origin"`, never a path or token). Settings' "Open the public status page"
  opens a new tab with `rel="noopener"` instead of `rel="noreferrer"`: it still cuts the opener,
  and the browser's default policy sends only the app origin, which belongs to this deployment,
  so the link crosses hosts in development as the shell's and sign-in page's links do. It also
  takes the page origin from the `/app` loader's `publicPageOrigin`, as the shell and alert
  sources do, instead of joining the window's scheme to the bare `LAMP_PAGE_HOST`, which dropped
  the development port and pointed at `http://localhost`.

No CONTRACT or BASELINE clause text changes: PAGE-001 and PAGE-012 were already host-qualified.

Tests follow the host model through `tests/e2e/helpers/hosts.mjs` (`appOrigin`, `pageOrigin`):
page-surface requests in the Vite-dev suites now go to the page host, app-surface requests stay on
the app host. Deliberately changed behaviour, updated in the same change:

- `tests/lamp-site/browser.test.mjs`: the routing test is rewritten (named above), and every visit
  opens the app host's `/`.
- `tests/e2e/deployment-artifact.test.mjs`: the app host's `/` was asserted to be 404 and is now the
  landing page (200, HTML); the managed readiness check had set both hosts to `status.lamp.test`
  and now runs the page host, then the app host's `/health`, then the page host again over one
  state.
- `tests/e2e/start-runtime.test.mjs`: the built Worker's app host `/` is the landing page and
  `/lamp` answers 301; the page host's `/signin` and `/lamp` are 404. Its "unsupported hosts" check
  is removed: Wrangler's `--local-upstream` rewrites every request to the app host, so it only
  passed while the app host's `/` was 404. `deployment-artifact.test.mjs` (a runtime whose upstream
  is the unknown host) and `app-api.test.mjs` still prove unknown hosts get 404.
- `tests/e2e/app-api.test.mjs`: the unknown-host check used `localhost`, now the page host; it sends
  `Host: [::1]`, a loopback name that is neither host, through `node:http` (fetch replaces Host).
- `tests/public-snapshots/public-snapshots.test.mjs`: the missing permalink's CSP is checked against the page
  origin rather than a literal `127.0.0.1`.
- `tests/e2e/app-api.test.mjs` and `public-contract.test.mjs` now open one connection per request
  (`tests/public-snapshots/fixture-fetch.mjs`): with two origins the page host's pooled socket sat idle
  through Wrangler CLI work and was reset. `app-api` also stops its Worker's whole process group,
  as the other suites do, instead of signalling pnpm alone, which left the suite waiting.
- `tests/dev-ingress/production.test.mjs`: its hostile local bindings used one host for both
  surfaces and now use the template's two.
- `tests/baseline/e2e-baseline/core-baseline.test.mjs`: BASE-SECRET-002 also proves that equal hosts
  fail, naming both variables.

## Landing intro: the switch-on is calm — 12 October 2026

(The room's darkness and the text reveals below are superseded by the next section, "dusk behind a hero that is always there".) The lamp clicks on once, softly, and its warmth spreads; nothing strobes or flashes. This replaces
the landing page's earlier requirement that the lamp flicker on and its light burst out in about
half a second (the owner's words of 9 October, above), which flashed at visitors. The room stays a
rich dim green-black; the click is one gentle step to about 55% and then up to full, with no dip
back; the light spreads from the bulb as a wide, warm, soft front that opens like a vignette
receding to the corners, over about two seconds; the headline appears as the light passes it and is
readable by about 1.9s, then the subline, the two actions and the closing line (below) follow in reading
order; the whole intro has finished by 3.0s and no animation runs longer than 3s. The slow-drawings
path (`data-late`) lights the room over about 0.9s, easing in and out, with the headline and the
rest easing in to match. The hold, `data-shown`, reduced-motion and no-script behaviour are
unchanged. Measured with the capture harness at 1440x900 and 390x844: no reversals, the largest
rise in mean luminance over any 100ms at 0.10 (the former intro: 0.47), headline readable at
1.85s, total 3.0s.

## Landing intro: dusk behind a hero that is always there, the lamp hangs lower on large screens — 12 October 2026

The owner's change. It replaces the earlier requirements (9 and 12 October, above) that the room start
close to night or a rich dark green-black, that the hero's text be hidden in the dark and revealed
as the light reaches it ("reading order in the dark"), and that the dark be one layer over the first
screen with the header included. The owner's words, in substance:

- All hero text is on the page from the first frame: the headline, the subline, the two actions and
  the closing line are never at opacity 0 and never animate in. Only the room and the lamp change.
- The dim is the page's background, behind everything, not an overlay: the header, the lamp and its
  cord and the text are drawn above it in their own colours. (`.lamp-dusk` sits at z-index -1 inside
  the page, which is its own stacking context; sections that paint a ground of their own cover it
  where it runs under them.)
- Dusk to lit, not night to lit: the start is a warm grey-khaki, things a little harder to read but
  readable, and the lit end is exactly the lit page. Still clearly the light turning on, but much
  less intense. The soft click stays: one gentle step on, no flicker, nothing strobes or flashes.
  The warm spread from the bulb stays. The dim start leaves the headline at about 3:1 or better
  against its background (measured about 8:1; the subline about 4.4:1; the closing line about 3:1).
- On larger viewports the first screen was top-heavy, the lamp and hero high with empty space below.
  For larger viewports only, the lamp and the hero sit nearer the vertical centre of the first
  screen, by extending the lamp's cord from the top edge (the lamp is not detached). Phones, and
  small or short screens, keep the earlier layout; on a phone the first product section still
  peeks into the first screen (until 12 October, see "The hero fills the first screen on a phone").

Kept: the data-ready hold, `data-late` and `data-shown`, reduced-motion and no-script behaviour (the
resting style is the lit end state), the soft click, the 3.0s timeline, the scroll handoff.

How it is built: `Dusk` (`dusk.css`, was `Darkness`/`darkness.css`) is the background layer, with
`--lamp-dusk`, `--lamp-dusk-warm` and `--lamp-dusk-far` in `page.css`; the light's front is the same
mask that opens from the bulb (`--lamp-reach`). The text has no animation (`timeline.css` animates
the lamp, its light and the dusk only; the slow-drawings path lights the room over 0.9s and fades in
the lamp). In `intro.css` the lamp's top is `--lamp-hang` (where it hung before) plus `--lamp-sink`,
34% of the spare height: `100svh` less the stack of lamp, gap and text (`--lamp-flow`, estimated from
the layout's own sizes). From 600px wide, where the intro is one screen tall; zero on a phone and on
any screen no taller than its stack, so short screens change nothing. Tests changed for this:
"the intro starts dim with the hero readable and the lamp clicks on once, leaving the page lit"
(was "starts dark…", which required the headline at opacity 0), "when the lamp's drawings are slow…"
(its first frame is dim with the headline whole, not dark), and the keyboard test (focus lifts the
dusk); one test added: "on a tall large screen the lamp hangs lower on a longer cord, and on a phone
it hangs where it always did".

## The hero fills the first screen on a phone — 12 October 2026

The owner's change. It replaces "on a phone the first product section peeks into the first screen"
(the phone intro was as tall as its content plus 48px, the lamp hanging where it always did) with:
the hero fills the first screen on every device, the lamp hung lower to balance it. Under 600px the
intro is at least `100svh` tall, as from 600px, so a browser's chrome never crops it, and the first
product section starts below the first screen (its 48px phone top space is gone; it keeps the
section rhythm). The composition is balanced the same way as on large screens: `--lamp-sink`, 34% of
the spare height, hangs the lamp lower on its longer cord, now computed on phones from a phone
`--lamp-flow`, the measured height of the text stack (3.24 times the headline's font size for its
three lines, plus 213px, or 234px up to 372px wide where the closing line takes a third line). On a
phone too short for its stack (320x568, a landscape phone) the sink is 0, the intro grows with its
content, and nothing overlaps or scrolls sideways. The header, the dusk, the soft click and the
scroll handoff are unchanged. Test changed: "on a tall large screen the lamp hangs lower on a
longer cord, and on a phone it hangs where it always did" now asserts the new requirement (the intro
is a whole screen on every size and the lamp hangs lower on a taller screen, a short phone grows
without overlap).

## Landing hero: no proof row, the closing line names what Lamp replaces — 12 October 2026

The owner's change. This replaces the 9 October requirement above that the hero carry a proof line
under the two ways in ("Live within 10 seconds · Answers when its database is down · No cookies, no
tracking") and the claims-map entry for it. The hero now reads headline, subline, the two actions,
then one closing line, "100% free, open source alternative to **Atlassian Statuspage**, **Instatus**
and **Better Stack**": the names are `<strong>` at weight 600 in the second ink, the rest of the line
stays 15px in the third ink. The names are data (`lampReplaces` in `src/site/lamp/head.ts`), so the
hero's bold markup and the plain description sentence come from one source; meta description and
seed.json stay plain text. The closing line is on the page from the first frame (it first revealed third in reading order, 1.89s to
2.54s; see the dusk section above). The facts themselves (PAGE-007 latency, PAGE-005/006
resilience, BASE-PUBLIC-001 privacy) remain true and clause-backed; they are no longer claimed in
the hero.

## UPDATE-005 amendment — a new draft for each update

The owner requires a blank composer after publication rather than retaining published wording. Drafts belong to the incident and its next unpublished update. Reload restores that draft; publication consumes it. Conditional writes from a stale tab are refused and cannot resurrect published text or overwrite a newer acknowledged draft. Existing in-flight autosave deadlines and lost-response uncertainty remain required.

## PAGE-002 amendment — one configured time zone

The operator composer, timeline, preview and public page use the page’s configured time zone, including a visible zone label. JavaScript keeps that zone rather than converting timestamps to each visitor’s browser zone. This removes mixed-zone communication promises while preserving readable initial HTML.

## Native Settings dependency boundary — 10 October 2026

Settings must hydrate its real page, sender check and address controls in local
development. The readiness journey recorded a 200 Settings document and settings
API but a 404 for the server SendGrid mail module before any Settings control
mounted. Importing the operator panel through the session barrel pulled session
services, the mail barrel and that server module into Vite's client graph.
Settings now imports the operator panel directly from its UI module. Provider
modules remain on the server; development asset permissions, authentication,
sender evidence and public-address authority are unchanged. The existing browser
journey now also follows the checklist's native Settings and component actions
and exercises the completed disclosure with the keyboard. No fixture override or
application fallback was introduced.

The next native check reached a 400 whose safe category was Workerd's invalid
redirect argument. The canonical origin, host and port matched the fixture, and
an independent anonymous HTTP request returned the real HTML subscription form.
Workerd rejects `redirect: "error"`; the public setup checks now use `manual` and
still require status 200 and HTML. A redirect is refused without following it.
The real HTTP request, eight-second deadline, canonical-address evidence and
production public-fetch compatibility flags remain unchanged.

## Local first-owner access

First-owner controls stay disabled until their JavaScript submission handler is
ready, so an early click cannot reload the page instead of creating the owner.
Production compilation excludes the local setup interface and development outbox
capability even when a runtime caller requests local setup. Authorized production
setup and normal sign-in retain their existing contracts.

## Incident editing visits — 10 October 2026

UPDATE-005 draft isolation applies to each editing visit, including leaving an
incident and returning to it. Loading another incident shows no actionable data
from the previous incident. Already-started native writes may finish, but their
acknowledgements, errors and follow-up work cannot change a later visit's draft,
version, timing, channels or status. The same lifetime rule covers previews,
AI suggestions, templates and adjacent private actions, including deletion
navigation. Same-incident refreshes retain edits and their original autosave
deadline; native conditional-write and lost-acknowledgement rules are unchanged.

Successful publication also ends the consumed update's completion authority within
the same visit. Suggestions and template work started for it cannot populate the
fresh next draft, and pending previews or saves cannot acknowledge that draft.
Private note, review and correction completions share that consumed-update
boundary, including their errors, input clearing and refreshes. It ends at native
publication acknowledgement, before the follow-up read. A valid note completion
preserves text typed after submission. Deletion instead belongs to the incident
visit: publication cannot suppress a successful current-visit deletion, while an
obsolete visit cannot navigate or replace the current operator status.
Ordinary edits and autosaves do not end the current update's authority. Composer
inputs and tools wait during publication's native commit and refresh so they
cannot start new work against the consumed version.

Review and correction now follow UPDATE-005's acknowledged-draft mutation
protocol as well. Their exact draft identifier and publication count are enforced
with the native metadata mutation, so a request delayed until the next draft
cannot review or mark that replacement. Different-operator review and the
same-incident immutable correction target retain their existing meaning. A write
already committed to the original draft remains valid even when its delivered
completion no longer owns the current interface.

- The setup checklist checks the public page and its subscribe form by fetching the page host's `/`
  from the Worker. Locally the page host is another loopback name on the same port, so workerd sends
  that as a real subrequest stamped `CF-Worker`. The raw development ingress admits `CF-Worker` only
  once, alone among `cf-*` headers, and only on a GET or HEAD with no `Origin` or `Sec-Fetch-*`
  header: a request any local process could already send without it. The checklist derives the page
  origin from the operator's request (the page host on the same scheme and port), as Settings does.

## Seed command contract 1 (rer CLI)

Lamp runs the Base rer CLI (`scripts/base-cli/`, thin `scripts/rer.mjs`) with these differences:

- `deploy` runs Lamp's own Cloudflare pipeline (`deploy:cloudflare`), not Base deploy-kit. Lamp
  serves two hostnames, the operator app and the public page, and on workers.dev that is two
  Workers; deploy-kit deploys one Worker with one origin. The dry run still makes no provider
  request.
- Owner and sign-in hooks now use Base operator-auth (`POST /auth/bootstrap` with `SETUP_TOKEN`) and its native confirmation flow. Lamp retains product setup and attribution; the Base D1 outbox captures local mail.
- `preview` serves the fixed production build. Lamp's production build has no development
  outbox, so sign-in for local work uses `dev`.
- `export`/`import` move a local installation with Base portability. Lamp keeps its own archive
  engine as `export:cloudflare`/`import:cloudflare` for a deployed installation; Base remote
  transfer needs an HTTP portability endpoint Lamp does not serve.
- The development ingress accepts the CLI proxy's public port (from `RER_DEV_ORIGIN`) in the Host
  header; the proxy forwards the browser's Host to the internal listener unchanged.
- First-run setup at `/setup` confirms the page name, tagline, time zone and colour (SETUP-002);
  the eight-step setup checklist (SETUP-001) stays on Overview.

## Slack and Teams channels on a Worker — 11 October 2026

Base's integrations core asks for a `TrustedTransport` that pins public DNS to the
connection; ordinary `fetch` does not, and Base's `NodePinnedTransport` needs Node
sockets a Worker does not have. Lamp's channel transport (`src/core/features/channels/transport.ts`)
instead reaches only the providers' own webhook hosts (`hooks.slack.com`, and Teams'
`*.logic.azure.com`, `*.environment.api.powerplatform.com`, `*.webhook.office.com`),
over public HTTPS checked by Base's `validateDestination`, with no redirects, a
10-second limit and 64 KiB bodies, and the Worker runs with
`global_fetch_strictly_public`, so a resolved private address is refused by the
runtime. Slack goes through Base's Slack notifier protocol and renderer unchanged
(byte-exact copy); Teams is Lamp's own protocol on the same Base delivery service.
In local development only, `LAMP_DEV_CHANNEL_RECEIVER` (a loopback origin) receives
the posts in place of the providers, as Base's own Slack tests map fixture URLs onto
loopback; production builds compile that branch out.

Channel URLs are sealed with AES-GCM under a key derived (HKDF) from
`WEBHOOK_SIGNING_SECRET`, so no new owner secret is needed; its comma-separated list
already means "first seals, all open", which keeps channels working through a rotation.

## Portable hosting moves

`EFFECTS_PAUSED=1` holds background subscriber mail, webhook deliveries, operator alerts and Slack/Teams posts in their durable outboxes during an installation move. No dispatch claim or completion is recorded while paused. Remove the setting to resume the normal dispatcher; its existing claims and provider idempotency rules still apply. Interactive sign-in and subscription confirmation remain available.

## Portable container hosting — 11 October 2026

The maintained Base CLI export adds the optional container target; Workers remains
Lamp's default and its Worker source entry and migrations are unchanged. The
container declaration selects Node and the existing retained snapshot contract,
and declares both Lamp hostname settings for TLS ingress. Container export/import
uses the same native Base archive service as local Workers.

Lamp migrations seed three coordination tables (`public_snapshot_work`,
`snapshot_build_control`, `reference_counters`). The archive policy now explicitly
allows those seed rows to be replaced in the atomic restore; all other product
tables must still be empty. Existing sessions, one-use sign-in links and import-kit
custody remain excluded. This repairs restore into a freshly migrated destination
without dropping application records or bypassing archive integrity checks.

## Public status page restyle — 12 October 2026

**Replaced owner selection.** The public snapshot previously carried the
owner-selected cartographic design: a contour-map illustration in the masthead
(`cartographic-map.png`, served as `/assets/cartographic-map.svg`), the 12ui
improve-kit icon set, a navy-on-blue palette and bundled Open Sans (see "UI
consistency pass" above, `README.md` and `visual/README.md` before this date).
PAGE-003's browser check pinned that artwork and face.

**Owner's replacement requirement.** The owner asked to ditch the cartographic
style because it looks old-school for a business's public status page, and to
give the public page the warm, subtle backgrounds of the sibling Uptime product
and the rest of Lamp's styling: cleaner type and better spacing. The public page
now uses Lamp's own tokens (warm paper softly lit from the top, green-black ink,
white plates with hairlines, quiet state pills with a coloured dot as in the
operator app) and the same self-hosted Inter as the landing and operator app,
embedded in the existing stylesheet artifact. The hierarchy is overall state,
then components with their 90-day record, then current incidents and planned
maintenance, then recently resolved incidents, then subscribing. The business
keeps its own name, logo (composited favicon) and accent colour; the accent marks
the subscribe action only, with its text colour chosen for AA contrast, and
state colours stay semantic. The subscriber pages, the embeddable widget, the
favicon/Open Graph fallbacks and the retained-snapshot ("Last known state")
notice use the same palette. The notice is now styled from the stylesheet: its
former inline `style` attribute was refused by the page's own `style-src` CSP.

**Guarantees kept.** Static R2 snapshot, no JavaScript needed, no cookies, no
third-party request, initial requests within PAGE-003 (stylesheet with the
embedded face, script, favicon: the map request is gone), light colour scheme as
before, WCAG 2.2 AA. The PAGE-003 browser test now checks that the bundled face
loads from the stylesheet within the same-origin budget instead of pinning the
map and Open Sans. `PUBLIC_SNAPSHOT_RENDERER_VERSION` moved to
`lamp-public-snapshot-v4`, so an existing installation re-renders its stored
snapshot on the next scheduled retry or public change.

## Public pages show no empty sections — 12 October 2026

No clause in `CONTRACT.md` or `BASELINE.md` requires an empty-state message on a
public surface (PAGE-001 lists what the page contains when it exists; it does not
require a placeholder when a kind of content is absent), so nothing is replaced.
Intent: public pages show no empty sections: a section with nothing to show is
omitted, heading included; a page whose only content would be empty says so in one
neutral customer-facing line. The current page omits Components when no
component is visible and omits every incident and maintenance section that has no
entries, so a fresh page is the status plate and the subscribe area. History keeps
one line, "No past incidents or maintenance in the last 12 months.", because the
empty list is the whole page. A component with no recorded state shows "No data"
rather than operator wording, and the subscriber management page leaves out the
component selection when there is nothing to select. Navigation is unchanged.
`PUBLIC_SNAPSHOT_RENDERER_VERSION` moved to `lamp-public-snapshot-v5`, so stored
snapshots re-render.

## Local move-in and archive access — 12 October 2026

Move-in reports scroll their counts within the card on narrow screens; Undo
remains reachable while the dry-run or completed report is visible. Setup always
validates owner and page answers. Local data transfers preserve the existing
installation without treating transfer preparation as a new setup.

Archives remain private local data: the rer public port refuses archive and
local-control paths, and builds refuse an archive copied into their output.
Lamp uses Base native email sign-in and declares its local development identity.
## Operator authentication (ACCESS-001, TEAM-001, TEAM-002)

The existing ACCESS-001 guarantee now uses Base operator-auth at aa9b4d4fc6cba60411ef8d24a81323113677c370, including confirmation by POST. The former SSO non-goal is replaced by optional owner-linked OpenID Connect through Auth, Google, Microsoft or Okta; SCIM and role synchronization remain non-goals. Operators retain equal product access. All migrated non-erased operators use Base's owner role, retaining inactive status and IDs; setup-owner protection and the last-owner guard apply, with a fresh native email proof for access changes. Legacy operators remain only as product attribution rows and grant no authentication authority. Subscriber tokens are unchanged.

Sign-out becomes usable when the client can handle the action. It must revoke
the current server session and clear its browser cookie before returning to
sign-in. If the request fails, the workspace keeps the
failure visible and the sign-out control usable. A session already rejected by
the server returns to sign-in. Missing, opaque and foreign Origins and cross-site
mutation requests remain denied.

A plain-http visit to sign-in or an operator page on the configured https app
host is sent to https rather than failing. A managed deployment publishes its
configured public page once setup has stored it, before the first owner claims
the installation.

## Operator identity lifecycle and imports

Every Lamp operator remains an equal owner. Settings must expose pending
invitations as well as active and former operators. Erasing an unaccepted person
cancels their invitation and preserves Base's cancellation ledger; an accepted or
reactivated identity cannot be erased on the strength of a stale cancellation.
Erasure revokes outstanding authentication credentials, removes provider personal
identities, and retains only opaque attribution and consumed-claim history.
Erased identities and their anonymous mailbox cannot be reactivated; the person
must be invited anew at their original address. The setup
owner may remove only themselves, while another active owner remains.

An import must retain the authority of the exact session that requested it at
every durable boundary. Unlinking or changing its provider, disabling provider
sign-in, changing its generation, removing an operator, or revoking its session
must stop waiting import mutations. Local dev and review admission retain Base's
request gates. These restore the existing access and erasure guarantees.

The subsequent Base refresh adds a new dependency-approval migration. An older
pending approval must be renewed by its owner; every callback requires a live
app-local approval for that exact attempt. Only an originating setup attempt
can enable provider sign-in automatically. Existing owner controls and the
default-off upgrade policy remain authoritative. Native portability archives now
bind the manifest and ordered part digests; older version-1 native archives must
be exported again with the new source before restore.

Native installation exports explicitly retain durable Base identities, bootstrap,
invitation cancellation, identity bindings, audit and consumed owner-claim
continuity alongside Lamp attribution. Sessions, one-use links, credentials and
pending setup approvals stay on the source installation. Restored provider links
require fresh owner approval and provider sign-in starts disabled; native email
sign-in and subscriber capabilities remain usable.

## Docs at /docs, from the repository's own docs — 12 October 2026

The owner asked for what the other seeds have: docs pages on the product's own site, in the
homepage's style, reading the same content as the repository's docs. The landing page's "Docs"
and "Read the docs" links (`docsUrl` in `src/site/lamp/repository.ts`) now lead to `/docs`
on the app host instead of README.md on GitHub.

- One source. `docs/site.json` lists the pages and which repository Markdown each is cut from
  (`README.md`, `RUN-LOCALLY.md`, `OPERATIONS.md`, `CHANGELOG.md`, `docs/moving-in.md`). A file
  shared by several pages names the `##` sections each shows; every other section of such a
  file must be listed in `githubOnly` with its reason, so a new section never reaches the site
  unseen. Agent and maintainer records (AGENTS.md, CONTRACT.md, BASELINE.md, DIVERGENCE.md,
  HANDOVER.md, ACCEPTANCE.md and the rest) are not published. The pages are rendered at build
  time by the Vite plugin in `src/site/docs/build/` (marked, as Uptime's engine) into a virtual
  module; a link to a published file or section becomes its /docs page, a link to any other
  repository file goes to GitHub, and a broken link or anchor, an image, an unaccounted section
  or a build machine's path fails the build. Page bodies are read only on the server, through a
  public `createServerFn` (`src/site/docs/body.ts`) that imports the generated bodies module
  inside its handler, so the docs' text (which names secrets such as SUBSCRIBER_TOKEN_SECRET)
  never ships in the browser bundle and the start-runtime leak check keeps its markers.
- README.md and OPERATIONS.md gained headings so their sections can be placed: "Verify the
  source" in the README, and "Setup readiness", "Sign in from your terminal" and "Shared
  operator authentication" are `##` sections. Their text is unchanged.
- Same look: the pages use the landing page's header, footer, paper, ink, Inter and mark
  (`page.css` tokens, `SiteHeader`, `SiteFooter`) with no intro or lamp handoff. Docs is marked as
  the current page in the header. Pages work without JavaScript (the copy buttons appear only
  with it), make no third-party request, and keep the landing page's guarantees: the same
  WCAG AA and no-overflow checks run on every docs page.
- `/docs` and `/docs/` are app-host public paths (`host-dispatch.ts`, `server.ts`, seed.json
  `deploy.publicPaths`); the page host answers 404 for them, so the status snapshot's paths are
  untouched. The docs add no contract clause: `tests/lamp-site/browser.test.mjs` (two docs tests),
  `tests/docs/docs-site.test.mjs` (the build rules) and `tests/e2e/start-runtime.test.mjs` (the
  built Worker's dispatch) guard them.
- Merged with main on 13 October 2026, where a separate /docs build had landed (433f23e: DOCS-001,
  thirteen hand-written pages under `docs/`, a highlight.js renderer, README and OPERATIONS trimmed to
  link to those pages). The owner's docs above are kept: that build's code, its pages, DOCS-001 and its
  tests (`tests/e2e/docs-site.test.mjs`, `tests/e2e/docs-browser.test.mjs`, the bundle check in
  `tests/e2e/build-assets.test.mjs`) were removed, and README and OPERATIONS keep the sections the
  docs are cut from. The removed pages remain in Git at 433f23e.

## Hosted check and development sign-in — 12 October 2026

`/health` answers with Base `deploymentHealth` (`src/base/deployment-health.ts`), so a healthy body names the deployment that served it. `rer verify` serves the production build at one hosted origin; Lamp answers built files and `/health` on its app host, so `hosted-check.json` (named by the adapter's `deployDeclaration`) runs that check as the app host with the secrets a fresh deploy requires. Lamp's own Cloudflare deploy still reads `OPERATIONS.md`.

`rer dev --login` and `rer outbox --owner-email` ask the running app for an ordinary sign-in message, so the link is the newest message in the development outbox that `RER_SIGN_IN` names. When the setup owner has left, the message goes to the oldest active owner. Setup and the browser installer keep the direct link they hand to the installer page.

Subscriber deletion rewrites only that subscriber's own frozen envelopes and removes its exact address from operator-alert recipients. Alert text never carries an address, and another person's address can contain the erased one, so no alert text is rewritten.

## Shared import feed addresses — 13 October 2026

MOVE-005 applies when an owner imports from multiple providers: Instatus and Statuspage both use `/history.atom`. Their shared feed address must keep serving the current Lamp feed after owner publication and conditional undo. Render each feed address once across surviving imports so the complete retained snapshot remains valid; duplicate-artifact rejection and publication ordering stay unchanged.

## Local Cutover public reads — 13 October 2026

The owner must be able to check imported public links from the local Cutover
page using the same credentialless browser GET and redirect-following flow as
a hosted installation. Development admits those reads only from the configured
owner host to safe imported aliases or native incident/maintenance permalinks
on the configured public host, on the same scheme and port. The raw socket
guard still rejects forwarded, duplicate and nonlocal requests; the Worker
still verifies its private ingress proof and configured surfaces. This public
read admission never enables mail capture, outbox, authentication, setup, API
or emulator access. It changes no production authority or response policy.

Imported public addresses cannot claim the reserved `/cdn-cgi` namespace,
regardless of letter case. New imports refuse those addresses. Retained imports
report them as unavailable while preserving a safe canonical source incident
path; Cutover must not promise a link that the public ingress cannot serve.
The raw ingress reserves that same case-insensitive path segment, preserving
unrelated aliases such as `/cdn-cgi-legacy`. The three exact local scheduled
trigger paths keep their existing exemptions; other emulator paths remain denied.

## Returning from Cutover review — 13 October 2026

Move-in keeps raw responses and API credentials only in the current page's
memory. When browser Back mounts a fresh Move-in page after Cutover review,
the saved-response picker starts empty too, so the owner can select the same
files and run a fresh dry run before importing. A browser-restored file
selection must never silently become the source of a new import.

## Generated route-tree source identity — 13 October 2026

The tracked route tree retains TanStack Start's generated type-registration
footer as well as the route declarations. Native Vite development and production
builds produce both; omitting the footer from a published tree caused the
pre-verifier journeys to change its tracked bytes and fail `source:check`.
Publication records the complete generated output in the source lock, so running
those journeys preserves the published source identity. The integrity gate and
its coverage remain unchanged.

## Disposable demo adoption

The owner requests a signed-in, editable sample installation under `rer demo`,
with a visible Base Demo marker, fresh isolated storage on each start and no
external sends. Sample subscribers and history are demo data; they confer no
operator authority. Email uses durable local capture, API imports and channel
deliveries retain their ordinary refusal/failure paths, and AI is unconfigured
even when local installation settings contain provider credentials. This mode
does not replace ordinary deployment or alter the static run-site homepage.
The hosted secondary page hostname awaits Base's cookie-gated multi-host
container ingress support, as documented in DEMO.md.


## Stranger journey repairs — 15 October 2026

NOTIFY-010's former requirement for SPF at the visible From domain refused a
SendGrid-authenticated sender whose return-path subdomain owns SPF. Setup and
deploy now require the configured From-domain DKIM selector to resolve to a
nonempty public key and require a DMARC policy; aligned DKIM is sufficient
without From-domain SPF. This replaces that specific DNS preflight requirement,
while preserving the notification header requirements and provider authentication.

Customer confirmation, management and unsubscribe documents and customer mail
identify the configured business, with a return link to its status page. Local
outbox navigation identifies the same page. Phone uptime captions use the full
component width, keeping the reporting window and tracking coverage readable.

A committed incident publication starts subscriber dispatch in its existing
background completion, alongside chat dispatch. The immutable recipient set,
durable outbox, retries, claims, frozen envelopes and provider idempotency remain
authoritative; provider failures do not block the publish response. Cron still
recovers pending work. Composer chat defaults follow saved channel configuration,
setup actions use direct verbs, Settings describes loopback addresses as local,
and a resolved incident names its retained severity as peak impact. These repair
the existing workflows without changing the owner-final homepage or Run page.

## Demo and local dev mail — owner redirect, 15 October 2026 09:55Z

Supersedes the captured-mail development behavior and old demo marker described
above: dev and demo have no injected bar or mail viewer. Product labels read
Lamp Dev or Lamp Demo, and sign-in is one click. Local mail is suppressed
silently. Demo public reads/checks run for real; email, webhooks and chat sends
return provider-shaped success without reaching people or third parties. This
replaces SETUP-001's local capture wording for dev/demo only; production sender
authentication, receipts and sign-in remain real. Sample data and the static
homepage remain unchanged.

## Native hosted owner entry and removal — 15 October 2026

Native deployment retains Lamp's existing Worker, D1, bucket and queue names.
It records each provider creation identity and the exact uploaded Worker version
in Base's private ownership format. Existing resources without that creation
history are refused, never silently adopted. `rer signin` can therefore issue
Base's one-use owner grant on a default-prefix native deployment; migration 0023
adds its table without changing released migrations. Custom prefixes retain the
documented installation-secret sign-in command because rer 0.2.20 derives the
Worker name from the project and environment.

The documented native removal command releases the separate public Worker
first, then uses Base's ownership-checked removal for the app, schedules,
consumers, object bytes and recorded data resources. Removal reads back absence
before deleting its local records. Older installations without creation history
retain the explicit manual retirement procedure.

Ordinary development has no local outbox address: mail is silently suppressed,
nothing is stored or displayed, and no viewer or bar is injected.

## Release readiness

An owner claimed during deployment can sign in immediately, before confirming
the page's separate first-run settings. A spent bootstrap token is never an
operator-entry requirement. Accepted email is shown as accepted by the selected
provider when signed receipts are not configured; only signed provider events
establish delivery or bounce. Subscriber erasure requires confirmation, and an
erased destination offers no further removal action.

The checkout pins rer 0.2.22. Its Base refresh removed Lamp's former 0.2.21
production-auth dependency patch. Lamp's native deployment preflight continues
to name its documented owner inputs; runtime bindings remain mapped to those
inputs.

## Release 1.5.0 repairs — 16 October 2026

The former rer 0.2.21 dependency patch at
`patches/@runeditrun__rer@0.2.21.patch` changed Base's
`cli/production-auth.mjs` to name missing inputs using the deployment
declaration's environment names. The rer 0.2.22 adoption
removed the patch as part of its Base refresh; no local rer patch remains. No
authentication authority changed. The Managed mail
relay adoption remains a separate change.

Owners must use a monitored From mailbox and process mailto unsubscribe requests
in Subscribers. HTTPS one-click unsubscribe remains automatic. Live incident
component changes require confirmation before changing the public page or
queueing catch-up email. Local pages report mail suppression without claiming
sender verification or provider acceptance. Health requests recover initial
publication only while no current or retained snapshot exists; subsequent
snapshot recovery remains the scheduler's responsibility.

The standalone browser installer uses Base's shared install → setup → dev
journey. Its one-click owner entry must lead to the actual development runtime;
a production preview cannot serve the dev-key exchange it advertises. Setup
still uses the production artifact for migration and owner bootstrap.

## Sorry migration — 16 October 2026

MOVE-001 accepts Sorry authenticated saved/API reads and keyless published JSON history. MOVE-002’s review-time expiry remains for existing sources; Sorry subscriber candidates are held inert through cutover and the watch window. A separate owner action attests to the live configured hostname, records the release, and begins their 72-hour confirmation window. No imported history sends notifications; source IDs and exact public links remain in import-kit custody and the published alias snapshot. Partial public samples are preview-only and name each missing detail.

Documented Sorry subscriber channel capabilities stay transient: unsupported
Slack, Teams, Google Chat and legacy Slack rows are skipped with reasons.
Their response hashes remain, but capability-bearing originals and channel
values do not enter custody. Other credential-bearing responses are refused.
While Sorry is retained, its history collection and month URLs redirect to
Lamp's history at `/history/` in the same snapshot; complete undo restores
Lamp's ordinary `/history` document.

## Operator page responsiveness (owner, 16 October 2026)

The signed-in workspace must open its main pages and primary actions in under one second on a normal hosted deployment. Keep its existing appearance, copy and flows. Read current records for each visit and preserve explicit mutation refreshes; speed must not come from serving stale data or deferring required work behind a loading state.

## Maintenance mail without waiting for Cron — 17 October 2026

A new hosted installation must send committed maintenance notices even while
Cloudflare has not yet started its first Cron run. An operator write sends the mail it
committed right after it responds, as incident publication does. While Cron has
recorded no run for three minutes (its `scheduler` readiness evidence), other
requests (public page, operator app, health) run due maintenance transitions and
pending mail, at most every 20 seconds per isolate. Once Cron runs, it alone does
the time-based work. Every path
keeps the existing guarded transitions, one notice per kind, and outbox and
delivery claims, so MAINT-005 and NOTIFY-005 hold and no subscriber receives a
notice twice. Delivery rows and CSV name the maintenance reference, title and
notice kind.

Setup pages (AI assistance, identity provider settings, Move in, Slack and
Teams) give their steps, links, text to copy and a check on the page. On
Managed hosting, which relays mail but has no outbound relay for other
integrations yet, AI assistance and Slack and Teams say so in one line and
accept no settings that could not send.

## Page data restore keeps double opt-in — 17 October 2026

A page data restore must never turn addresses into active subscribers without
the double opt-in every other import enforces (MOVE-002, NOTIFY-008). An export
carries an integrity value keyed by the exporting installation's
`SUBSCRIBER_TOKEN_SECRET`; the key never leaves it. Email subscribers keep the
state the file gives them only when the restoring installation recomputes that
value with its own secret: an unchanged file from the same installation, or from
a recovery given its signing secrets. Every other file (edited, from another
installation, or from Lamp 1.7.0 or earlier) restores its subscribed and pending
email subscribers held. Held subscribers receive nothing until the owner sends
each one confirmation, which starts SUB-003's 72-hour window, and are deleted
30 days after the restore otherwise. The rule is the same hosted and on Managed
hosting. The restore's empty-page check runs inside its one transaction, and a
refused restore removes the logo it stored.

## Business adoption — 18 October 2026

The owner requested Base's optional Business import door, disabled by default,
with a single settings row and permanent grant-key revocation. Door plans reuse
Lamp's Statuspage and Sorry move-in readers, mapper and native target adapter;
both hold subscribers until a separate live-hostname/watch-window approval.
Local imports retain their existing behavior. Business approval metadata appears
in the existing owner-bound history and undo flow.

Since rer 0.2.61 the door is Base's integrated door, refreshed with
`refresh-base`/`record-base` and recorded in `base-copies.json`, except two
adapted files (`types.ts`, `authority.ts`) tracked as local source with a Base
0.2.61 comparison origin in `edition.json`. Their one change passes a
`reversalPolicy` into each door job, so Business imports undo as every Lamp
import does: preserving the records the owner changed (until Base #298 ships it).
Base's server-side source resolver admits the four sources Move in offers
(`statuspage`, `betterstack`, `instatus`, `sorry`); a plan request prepares the
named upload with Lamp's existing readers, native planner and target adapter
before the door reads it. Migrations 0037-0039 apply Base's
custody REPLACE triggers and the door's apply-failure and scope migrations; the
existing Sorry integration case also runs Base's public door conformance.

## One import path — 19 October 2026

The owner's 17 October decision: one way to import. Move in's screen keeps its
look, copy and steps but runs on the door's owner-session mount
(`createImportOperatorHandler` at `/api/operator/import/*`, Base ADOPTING steps 3
and 5) with the same allow-list and door key as the Business grant mount. The
old preview and apply routes are deleted; jobs they created keep their read,
resume and undo routes, and history lists every door import with them. Door
imports run as the installation's configured owner, so the owner's imports and
Business's share one lineage, history and undo; each request is still bound to
the signing-in owner's session. Lamp-specific behavior around the door: a key
or public page is read into saved responses first; a new dry run discards an
earlier unstarted one; an undone source is uploaded afresh with an `attempt`
field; owner imports keep each source's subscriber policy, while Business holds
subscribers until cutover. Subscriber deletion and expiry erase the subscriber
from import custody through the kit (Base ADOPTING step 6); the kit requires an
erased target to be gone, so Lamp's target adapter treats the anonymised record
an operator deletion keeps (`deleted:<id>`) as no import target.

Business catch-ups replace source-owned records under the reviewed native
revision and can undo back to that revision, while preserving incoming native
references. Door uploads, plans, grants, approvals and lineage are installation
custody: local exports exclude every `ik_door_*` table alongside import-kit jobs.

## Managed preview owner entry (18 October 2026)

Managed previews declare `/auth/owner-signin` as their owner entry so RER can bind the preview's single-use owner grant there. A missing, used or expired grant redirects to Lamp's sign-in page with a notice; an unavailable auth service does the same. Successful grant consumption retains Base's native session and single-use checks.

## Local hostname selection (18 October 2026)

Local setup, development and preview keep the operator surface on rer's selected
origin. The public status page keeps a separate hostname on the same port:
localhost beside the default 127.0.0.1 app, or status.localhost beside a localhost
app. Selecting localhost must complete
owner setup and health readiness without provider credentials.

## Configured sign-in choices and channel checks — 18 October 2026

ACCESS-001's enabled, configured providers remain available beside the local
one-click owner entry. Native provider forms retain their same-origin Origin
and allow the provider authorization redirect under CSP. With no enabled
provider, owner entry stays unchanged. A scoped rer 0.2.54 patch preserves these
choices in the shared development and one-click sign-in renderers.

A Slack channel test succeeds only on Slack's exact `ok` acknowledgement;
HTTP success with another body reports the provider's refusal text. Teams keeps
its HTTP acknowledgement semantics.

## Phone incident desk — 18 October 2026

Operators must be able to carry an alert through publication and resolution on a phone, including a recovered draft after reload. Receipt actions stay visible in a stacked phone layout, and operator controls use at least 44 px touch targets without changing the desktop layout. The same journey covers native sign-in, component claims and maintenance scheduling.

## Notification email branding — 18 October 2026

Owners can brand subscriber notification subjects and wording and reuse the
uploaded page logo without making unsubscribe, management or List headers
editable. Preview and delivery share the same branding renderer, and a frozen
retry retains the original identity and wording. Managed mail owns From and does
not accept Reply-To: Settings states that boundary and refuses unsupported
identity changes, including a page-data restore that would introduce them.

The package pin moves to rer 0.2.55 with the existing configured-provider
sign-in patch retained. Its native owner and provider flows remain available.

## Operator audit visibility — 18 October 2026

Settings exposes retained audit records with actor, action and UTC-date filters and matching CSV. Names are resolved from the current identity so erased operators show an opaque anonymised reference. Component state changes are audited in their history transaction; maintenance scheduling and reminder notices also record attribution. The released equal-operator policy remains in force until TEAM-004; TEAM-007 stays partial for that gate and its unbuilt event families.

## Subscriber reporting — 18 October 2026

Subscriber reports count current records separately from daily growth in pending-plus-active inventory. Anonymous database triggers observe inserts, transitions, channel moves, expiry, erasure and undo in the same transactions as those changes. Existing records establish an inventory baseline; observation begins with the first subscriber change or report read, keeping an empty installation’s migration seeds deterministic for native restore. Creation timestamps cannot reconstruct earlier growth. Technical archive restore retains these facts, or starts a fresh explicit baseline for older archives. Audience and language reporting remain unbuilt and HIST-007 remains partial.

## Grouped monitoring alerts — 18 October 2026

Alertmanager and Grafana contact points can map each alert's exact labels to several components while retaining one private incident per open source group. Per-alert fingerprints retain partial recovery evidence; only a completely recovered, never-published draft closes automatically. Existing source credentials and single-component presets retain their behavior. Native technical archives carry grouped mappings and member state.

The package pin moves to rer 0.2.57 with the configured-provider sign-in patch retained.

## Documented grouped webhook versions — 18 October 2026

Each grouped preset accepts its documented source format: Alertmanager version 4 and Grafana version 1. Missing, numeric, cross-source and unknown versions are refused with an operator-readable reason. Grafana's title names the private draft; its message and other source context stay in the retained private receipt. Neither becomes a public update without operator publication. The unmodified Grafana documentation example exercises the same grouped incident, notice, mapping, deduplication and recovery path as Alertmanager.
