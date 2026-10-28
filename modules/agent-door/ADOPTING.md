# Adopt the agent door

The edition owns its tools, native adapters, migrations and release evidence. The
module provides the shared transport, credentials, policy and review machinery.
Keep the edition's existing interface and authorization decisions authoritative.

## Copy committed runtime source

Choose an immutable full Base commit containing the module. A released or
unreleased commit is equally usable; a package release is not required to copy
runtime source. Use a Base checkout containing that commit and the previous pins
when refreshing existing copies.

For a first copy, from the edition's Git root, replace `FULL_BASE_COMMIT` and
`/absolute/base-checkout` with the chosen commit and checkout:

```sh
mkdir -p src/base/modules/agent-door
git -C /absolute/base-checkout archive FULL_BASE_COMMIT modules/agent-door | tar -x -C src/base
node node_modules/@runeditrun/rer/edition-authoring/cli.mjs record-base src/base/modules/agent-door modules/agent-door FULL_BASE_COMMIT --base /absolute/base-checkout
```

This copies committed bytes from `modules/agent-door/` into
`src/base/modules/agent-door`. The record command writes its origin commit,
file digests and modes into `base-copies.json`. Review any reported differences,
omissions or edition-only files. Keep the record with the edition source.

Refresh recorded copies from the edition's Git root:

```sh
rer refresh-base --ref FULL_BASE_COMMIT --base /absolute/base-checkout
```

`--ref` accepts any full Base commit available from that checkout, released or
unreleased. The installed CLI version and the selected runtime-source commit are
separate pins. Refresh moves all recorded copies selected by the record, so
inspect the complete change. It preserves acknowledged adaptations and refuses
undeclared local edits. Applied migration history remains the edition's
responsibility: never refresh a copied schema over an applied migration. If the
edition uses a source lock, refresh it
with its existing authoring command after staging intentional changes. See the
[edition authoring guide](../../export/EDITION-AUTHORING.md) for offline refresh,
adaptations and copy verification.

## Wire the edition

Use explicit `.ts` extensions in runtime imports so the copied source can also
run under Node's TypeScript stripping. Copy the module's SQL into a new,
additive migration in the edition's migration sequence. Apply it through the
edition's existing migration runner; preserve all previously applied migrations.

Mount one door at the documented paths in the existing Worker and return its
response when its handler recognizes the request. Leave ordinary application
routes with the edition's existing router. Supply the edition origin, seed,
name, specialist, database, tool registry and people adapter.

Import `createAgentDoor` from the copied `index.ts` production entry, not an
internal implementation file or the test-only conformance signer. Route its
`handle` before ordinary app authentication redirects so MCP credentials and
signed policy adoption reach their own checks. Retain the edition's native
person session and Origin and CSRF controls. The [route and capacity reference](README.md)
lists the owned paths and defaults; these are request capacities, not company
policy limits.

Use `operatorAuthPeople({db, session, allowList})` to connect live operator accounts. Pass
the edition's native session reader as `session` and the same parsed
`AUTH_ALLOW_LIST` native session admission uses. Copy the additive
`modules/business-settings/schema/0002_business_people.sql` into a new migration
as well as adopting the Business settings module. Business sends `owner_id` and
team `id` before minting access tokens, using the same Business person id as
`sub`. `people.sponsor({sub})` resolves only through that durable mapping; token
email never selects a local account. Implement `people.person(id)` to re-read
native ids for approval execution, Undo, embedded agents and subscriptions.
Expose `businessMember(person)` from the same mapping for paired policy refs:
Business owner is owner, Business team admin is editor, member has no policy
role. The native role may differ. Local credentials return `sponsor: { id }`,
read by `people.person`, rather than an address. Sponsorship is resolved from
current native people on each request; an unknown or inactive sponsor cannot
act. A saved token never replaces this account check. Keep native permissions,
resource ownership and business invariants inside each tool's native service.
Carry the sponsor's native person ID for authorization and database relations;
record both the agent and sponsor in audit attribution.

Pass the installation's existing owner-claim trust into the door: issuer,
installation ID, application origin (`appOrigin`) and public key ring. Keep that
origin aligned with the edition's canonical origin. Do not create another key
ring for agent access. Business credentials use the existing ring; local
credentials come only from the edition's explicit `localCredentials` adapter.
With `trust: null`, an independently operated installation can use that local
adapter under its owner's configuration. A recognizable Business credential
that fails validation is refused; it cannot become a local credential.

## Implement native tools and resources

Declare each tool's input and output JSON Schemas, scope, policy classes and
contract clauses. Classify the exact proposed effects before execution, using
native facts and units. Add only the native actions the edition supports and
retain native validation, access checks, transaction boundaries and audit.
Mutating tools require a server-computed `summary(args,ctx)` describing target,
recipients, amount, payee, role or item names. Read summaries retain declared
arguments or the resource URI. Approval views expose `summary` and
`summary_sha256`; approval and rejection send both that hash and `revision`.
Approved native actions receive `ctx.approvers`, while the agent remains the
preparer. Native reversal receives `UndoContext`: the reviewer is `person`,
`agent` is null, and `actor.kind` is person.

Tools declaring access or security require `authority(args,ctx)`, returning the
authority subject and whether the proposed change widens it. Name the native
person id, email or agent id; the door normalises these and refuses self-widening
before classification and again at approval execution. Return null only when
no standing authority is changed. Other people's changes still follow policy.
Declare `escalations: [{ id, tool, args }]` in `agent-surface.json`, covering each
access or security tool that can widen authority. Use `{ "$sponsor": "id" }` or
`{ "$sponsor": "email" }` as argument values; the conformance journey resolves
these and requires `self_escalation` with an unchanged native witness. Retain a
journey call proving an ordinary narrowing change too.

For a tool whose only effect is revocation or reduction, declare `widens: false`
and `narrowing: {effect: 'revoke', target: 'id'}` (or effect `narrow`) in both
its runtime definition and surface tool. Include its exact native `inputSchema`
in the surface. This checked contract accepts a closed object with one required
string target identifier (`id` or a name ending `_id`); it refuses extra fields,
open objects, references and schema unions. An operation accepting roles, scopes
or grants to add must retain its escalation fixture. Separate the revoke-only
operation from an operation that also grants authority when needed.

A narrowing-only tool still declares `authority`, returning `widens: false`.
A contradictory widening answer refuses as `narrowing_contract_violation`.
Unlike ordinary tools' ignored extras, undeclared narrowing-tool arguments
refuse as `invalid_arguments`, including attempts to replay a prior key.
Every such tool needs a normal journey step and a `narrowings` entry:

```json
{
  "tool": "seed.access.revoke",
  "step": "revoke",
  "witness": {
    "tool": "seed.access.grants",
    "args": {"id": {"$from": "grant", "pointer": "/id"}},
    "pointer": "/grants"
  }
}
```

The read-only witness returns the targeted subject's native effective grants as
unique strings. Use the same target argument in the witness and revoke call.
The journey prepares a nonempty grant set through native tools, then proves a
strict subset after the action and refuses a smuggled grant-adding argument
without an effect. Output point names identify every narrowing tool. No tool
is exempted from execution, policy, audit, schema or journey coverage.

## Hand off native human proof

A native authentication requirement stays independent of company approval.
Declare `proof: 'native', proofKind: 'step_up'` on the runtime and surface tool.
Supply `nativeProof: {handoff, verify}` to `createAgentDoor`. Both hooks receive
`{kind, tool, principal}`; `verify` also receives the exact native `args` and an
opaque `reference`. The seed verifies its own recent human proof and returns
true only for the matching person, originating agent/client and action. Base
never handles passwords, second factors, recovery codes or session credentials.

Without a valid reference, the tool returns `native_proof_required` with `kind`
and a same-origin `handoff` URL from the seed hook. Keep secrets out of that URL.
The challenge has its own complete refused audit row and makes no native effect,
including under autonomous company policy. The human opens the native handoff
and completes the seed's authentication. The agent retries with the opaque
reference in `params._meta["com.runeditrun/native-proof"]`; an embedded caller
passes it as `door.invoke(name,args,principal,proofReference)`.

The reference is retained with a pending approval and the seed verifier checks
it again immediately before native execution. Expired or revoked proof refuses
with the same challenge even if all business approvers have approved. A valid
proof still passes scopes, classification, company policy and named approval.
The native action receives the verified `{kind, reference}` as `ctx.nativeProof`.
The seed must fence the proof and grant checks within its native transaction
when concurrent revocation requires it. Native proof references must be opaque,
non-secret handles of at most 512 characters, never bearer credentials.

For disposable conformance, declare
`verification: {proof: {module: 'tests/native-proof.mjs'}}` in the surface.
That contained test module default-exports an async function receiving
`{request, origin, agentId, tool, args, kind, handoff}` and returns a valid native
proof reference using the seed's human lifecycle. The supplied `request(path,
init)` uses the test person's native session and only the fresh installation's
origin. It must never contact providers or read real credentials. As with owner
initializers, this is trusted test tooling and never production authority.
Direct harness callers can provide the same function as `prove`.

Conformance challenges each proof tool, refuses a bogus reference with an
unchanged native witness, checks those audits, and succeeds with the test hook's
valid proof through autonomous and held policy. The ordinary autonomous-success
requirement applies directly to tools without `proof`; proof tools require the
native reference first.

Return resource references for outcomes the user can inspect. Supply undo only
when the native action has a real reversal; review and approval do not invent one.

The maintained reference pattern is
`default-seed/src/agent-door/index.server.ts`, with native people and access tools
in that directory. Its tools call the seed's existing people repository and
operator-account services. Follow that division: the edition owns native
actions, resources and permission checks, while the copied module owns the
agent transport and policy pipeline. Do not copy Base's people model into an
edition with a different domain. Use `door.invoke` for embedded agents and
`door.emit` after native person changes so both enter the same event vocabulary.

Expose resources through explicit readers and treat imported or external
content as untrusted. Every resource declares non-empty catalogue `classes`
and `classify(record,ctx)`, based on the record itself. Resource readers and classifiers receive `{person, agent, clientId, scopes, db}`.
Use this authenticated authority for service and client fences, including events
and subscriptions; a sponsor's administrator role never bypasses a registered
resource's reader. `ToolContext` carries the same scopes and client id.
`door.invoke(name,args,{person,agent,scopes,clientId})` requires explicit scopes
and never supplies registry scopes. Omit `clientId` only for a native agent with
no separate client identity.

If the seed has mutable client grants, declare `currentScopes(principal)` to
read them from its native store. The door intersects this with the original
credential scopes before calls and again at approval execution and subscription
delivery. It cannot widen the token or saved approval. Removing the tool's scope
before approval execution returns `insufficient_scope`, runs no native action,
and retains the execution audit linked to its original decision. Seeds without
client grants can omit the hook. Approval retries and idempotency digests retain
the originating client id; approved-read retries recheck native resource access
before returning retained content. Keep grant checks in the native transaction too
when the seed needs a fence against concurrent grant edits.

Resource reads pass through
the same policy, approval, review and audit path as tools. A resource read must enforce the current person's native
access. Mark device, screen, connector, import-door and installation operations
as outside the tool registry when they require another supported door.

## Durable invocation consent and operation identity

Every tool callback receives this admission metadata on `ToolContext`:

```ts
readonly consent?: string             // originating Business consent record id
readonly scopes: readonly string[]    // effective grant recorded at admission
readonly operationId: string          // door-issued original decision/audit id
readonly idempotencyKey: string | null // original key; null for reads
readonly clientId?: string
readonly person: Readonly<Person>      // native sponsor, including id
readonly agent: Readonly<Agent>        // originating agent, including id
readonly approvers: readonly Readonly<{ id: string; name: string }>[]
```

The context and its copied identity, scope, actor, proof and approver objects are
frozen at runtime and read-only in TypeScript. `db` remains the native service
capability, and `emit` still records effects. Mutation of a context cannot edit
the door's principal or a later callback. A tool returning a native queued-effect
handle should include `ctx.operationId` in that handle. Its audit row carries the
same `operation_id`, plus `consent`, `scopes`, `client_id` and `idempotency_key`.
Approved execution retains the original operation id and key, while its own
execution audit still has a distinct `id` and original `decision_id`.

Persist the originating context alongside the native queue item. For example,
a preparation tool records the following identity before returning its handle:

```ts
const identity = {
  person: { id: ctx.person.id }, agent: ctx.agent, consent: ctx.consent,
  scopes: ctx.scopes, clientId: ctx.clientId, operationId: ctx.operationId,
}
// Persist identity, ctx.idempotencyKey and native job arguments atomically.
```

The trusted worker re-enters a registered native execution tool through the
public door, using exactly those saved values and the same public key:

```ts
const result = await door.invoke('example.queue.execute', {
  id: job.id, idempotency_key: job.idempotencyKey,
}, job.identity)
```

`invoke` accepts `operationId` only at the trusted worker boundary; MCP arguments
cannot supply it. The door checks it against the retained completed admission,
including the exact sponsor, agent (id, name and specialist), consent, client,
granted scope set and key. The execution context restores recorded scope order
and agent metadata from that admission.
Missing, incomplete or mismatched admissions return `operation_mismatch` without
running the tool. It does not reconstruct scopes from the registry. The door
re-reads the current native person, current grants and signed policy. A removed
admission scope returns `insufficient_scope` and requires fresh preparation;
revoked consent still returns `consent_revoked` with no effect. Keep the same
checks in the native effect transaction when concurrent edits need a fence.

Each continuation tool has its own once-only claim under the original operation
and public key, so replay returns its one recorded result rather than the
preparation handle. Reusing that continuation with changed arguments returns
`idempotency_conflict`. Public keys may not contain NUL, which separates these
internal claims from ordinary keys. The existing calls table stores the claims;
no new schema migration is needed. Keep the originating audit, approvals and
idempotency records for as long as the queue may execute or replay them.
Approver ids come from the retained approved execution and are re-resolved to
active native people; a seed cannot supply them.

For independently prepared scheduled work with no earlier tool admission, omit
`operationId` and supply its original native sponsor, agent, explicit scopes,
client id and consent to `invoke`. This makes a fresh door admission. Consent is
optional only for work originating independently of Business consent. Never drop
or replace an originating consent at execution. Older pending approvals retain
their original decision id as operation identity; older queue handles without a
recorded admission snapshot require fresh preparation.

The shared `runAgentDoorConformance` journey can take an optional
`invoke(name,args,who)` callback wired to the same trusted worker door. Its
existing consent checks remain unchanged. Base's public-door fixture additionally
proves native queue persistence, one-effect replay, execution-time revocation,
immutable identity, scope narrowing and named approver continuity. These module
proofs do not establish a seed's integrated queue behavior. Client-data custody
and erasure remain outside this adoption proof until retained fields and fences
are agreed. This change does not promote those claims or supply seed-side
`BASE-AGENT-010` contract citations.

## Keep runtime and CLI evidence separate

The copied module is application runtime source pinned by `base-copies.json`.
The edition's pinned `rer` CLI remains its command and authoring dependency.
Updating one does not prove or update the other. CLI conformance runs as plain
ESM against the pinned CLI; it must not depend on TypeScript loading or the
application's bundler.

`conformance/index.mjs` exports `runAgentDoorConformance`. Connect its fetch,
canonical origin, Agent surface, test-only signer and `{email,cookie,sub}` to
a disposable real installation with the edition's actual D1 schema and native
actions. Never include test signer material or fixture authority in production.
The harness's stable point prefixes describe its implemented checks; they do
not mean every baseline clause has been exercised. Module tests under `tests/`
are separate from this installation journey and the edition's browser and UI parity
work. `rer verify` pairs its per-run ring through `RER_BUSINESS_TRUST`, posts a
real signed settings document with the owner's Business `owner_id`, then mints
journey tokens carrying that subject and `consent`. No setup-mode bypass exists. Retain explicit gaps for Business consent propagation, spend and byte budgets,
long jobs, Business delivery of grant narrowing, outside mail, standalone policy forms and token
issuance, self-host delivery and stranger-specialist completion. Platform adoption
of the shared policy source is also separate from copying it into an edition.

Validate the integrated edition through its public doors: current sponsor and
scope checks, all exposed tool effects, policy and review decisions, migrations,
resources, audit, subscriptions and retained outcomes. Keep successful and
failed outcome evidence for at least 24 hours. This module currently retains it
indefinitely; adoption must not introduce earlier cleanup. Report the exact
edition behavior verified, separately from Base module or CLI results.

## Verification owner lifecycle

`rer verify` reads the same `rer-setup.json` owner-claim step as installation.
For `mode: "signed"` it signs a fresh five-minute `rer-owner-claim+jwt` with
the disposable installation's per-run key, matching its configured issuer,
installation ID, origin and owner email. It posts that claim to the declared
path through the production handler. Setup-token mode retains the native token
POST. No production key is read, and signed admission still rejects raw tokens.

Seeds with a native initializer or a different owner binding declare this in
`agent-surface.json`:

```json
{
  "verification": {
    "owner": {
      "email": "synthetic-owner@example.com",
      "emailField": "SETUP_OPERATOR_EMAIL",
      "tokenField": "H2H_SETUP_TOKEN",
      "bindings": {
        "RER_MANAGEMENT_ORIGIN": "issuer",
        "RER_INSTALLATION_ID": "installationId"
      },
      "initializer": "tests/initialize-agent-owner.mjs"
    }
  }
}
```

All keys are optional. Email defaults to `synthetic-base-1@example.com`;

All four keys are optional. Email defaults to `synthetic-base-1@example.com`;
the manifest's email and token fields are always bound too. The initializer is
a contained seed module default-exporting an async function receiving
`{request, origin, email, sub, displayName, token, claim, returnTo}`. `claim` is
`{mode, path, token}` with the signed credential when signed mode is declared;
`token` is the private per-run setup token. Use `request(absoluteURL, init)` to
drive the seed's real project/password, owner and member-linking lifecycle.
It permits only the fresh hosted origin. Return the native final 303 `Response`
with its session cookies; then the runner posts the signed Business settings
document and runs the journey. Never create an owner with direct SQL, substitute
an auth adapter, or add a verification-only production route. Initializer code
runs as trusted test tooling in Node; it must use the supplied request function
and must not contact providers or read real credentials.

`bindings` maps native environment binding names to the verifier's per-run
values: `issuer` (the issuer origin), `installationId`, `appOrigin`, `publicKeys`
(the JSON public key ring), `email`, `sub` (the owner's Business person id),
`token` (the setup token), or `sessionSecret` (a fresh session signing secret).
Only named native bindings are added, for that disposable runtime only; existing
Base verifier bindings and manifest email/token fields remain available. Nothing
is written to the seed's environment files. Tokens and sessions are never printed.
These aliases configure the seed's existing admission and do not bypass signed
claim verification. For a signed seed needing just its native issuer and
installation names, declare the two `bindings` above without an initializer.

## Verification provider edges

`agent-surface.json.verification.network` declares an optional test-only edge:

```json
{
  "module": "tests/provider-edge.mjs",
  "origins": ["https://api.openai.com", "https://receiver.example.invalid"]
}
```

The contained ES module default-exports `{async fetch(request) { ... }}`.
It receives the full Web `Request`: method, exact URL, headers and raw body,
and returns a Web `Response`, including JSON or a streaming body. Relative
helper imports are supported. Run the seed's own signature/payload validation
and return realistic provider receipts here; keep native preparation, permission
checks, state commits and receipt validation in the application.
The module runs in an isolated workerd with no application bindings, Node
capabilities or network access. Its own `fetch` requests are denied, including
requests to declared origins. Only declared exact origins reach the module;
other outbound effects receive HTTP 502. Built-in Resend, SendGrid and Cloudflare
mail adapters remain available by default. Never place production credentials
in this declaration or ship the test adapter as application authority.

## Base source from an archive

A plain directory export can supply the source without a Base Git checkout:

```sh
node node_modules/@runeditrun/rer/edition-authoring/cli.mjs record-base src/base/modules/agent-door modules/agent-door --base-archive /absolute/base-export --ref FULL_BASE_COMMIT
rer refresh-base --base-archive /absolute/base-export --ref FULL_BASE_COMMIT
```

Use the full 40-character commit SHA from the authenticated archive acquisition.
The directory must preserve Base's paths and executable modes. It is the source
at that declared SHA; the CLI cannot authenticate an archive's commit without
Git history. Copy mapping and byte digests follow the same rules as a checkout.
History-dependent refresh operations require the historical source evidence
described in the [authoring guide](../../edition-authoring/README.md); they fail
closed when that evidence is absent.

## Interim policy boundaries

Do not register provider `cost`: construction refuses it until spend reservations
are enforced. Standalone `spend.caps` cannot be saved. A paired Business document
can contain caps but state and the page plainly report that they are not enforced.
Only seed-scoped `max_per_day` rules can be adopted from Business; company-wide
reservation requires a future Business door. Business `person:` references must
map to active local people at adoption. Business role references use the mapping,
so promoting a seed admin does not confer Business approval authority.

Business can revoke agents or consents in the signed envelope's optional
`revoked` lists. Tokens require `consent`; affected pending approvals expire and
execution rechecks revocation. Retain both these lists and historical attribution.

## Event visibility and native revisions

Retained event replay, listing and subscription delivery re-read each event's
current native resource with `ResourceDefinition.read`. A sponsor, actor or
Business role cannot override that reader's refusal or null result. Readers
must authorize on every call, including after grants narrow. Unknown resources
and refused reads produce no event, notification or new cursor. Base approval
resources use their current approval reader rules.

Tool names use `<seed>.<segment>(.<segment>)*`: each segment is lowercase
`[a-z][a-z0-9_]*`. The existing seed-id grammar allows hyphens in the seed
prefix. Names have at most 128 ASCII characters, within MCP's allowed character
set. Duplicate, foreign-seed and malformed names fail the existing
`BASE-AGENT-013.surface.<name>.name` declaration check and runtime registration.

Native `revision(args,ctx)` returns an opaque string or number, or null when no
record exists. Declare `revisionType: 'string'` for UUIDs or other string tokens,
`'number'` for numeric tokens, or retain the default `'integer'`. The generated
`expected_revision` input schema uses that type. Tokens are compared strictly
and saved unchanged with pending approvals. A stale initial token returns
`revision_conflict`; a token changed before approved execution also returns
`revision_conflict` without running the tool. Native services
still own atomic revision checks at their effect boundary.

## MCP version compatibility

The negotiated versions remain `2026-07-28` and `2025-11-25`. Both initialize
and list the same registry; unsupported negotiation returns
`UnsupportedProtocolVersion` (-32022). March `2025-03-26` is deliberately not
advertised: its Streamable HTTP transport permits batched requests, which this
door's single-message parser rejects, and its pre-June schema lacks structured
results, output schemas, resource links and elicitation. March also predates the
protocol-version HTTP header and modern method/name metadata. Supporting it
would require a batch dispatcher and a separate legacy result/approval shape,
not merely adding a version string. Seed contracts should use a supported
version until that transport work is implemented.

## Captured native email in verification

The owner initializer and optional `verification.journey` test module receive
`mail.read({limit, maxAgeMs, after})`. This reads only accepted Resend, SendGrid
or Cloudflare sending submissions for this run's configured synthetic owner
mailbox. Results contain `{id, at, subject, text, html}`; provider headers,
credentials and other recipients are never returned. Defaults are ten messages
and five minutes. Hard limits are twenty retained/read messages, 64 KiB per
submission and five minutes of age. `after` is an optional millisecond timestamp.
Capture exists only in verifier memory and is cleared when the run closes.
There is no HTTP outbox, application binding or production reader.

Drive the native email request through `request`, read the captured code or
link, and submit it to the seed's real confirmation handler. Preserve native
one-use, expiry, session and step-up checks. Never print the message or proof.
Return the final native 303 response with its confirmed session cookie from the
initializer. The reference verifier fixture uses the real operator-auth email
lifecycle and production mail sender, with only the paid sending edge replaced.

`verification.journey: "tests/native-agent-journey.mjs"` optionally names a
contained module default-exporting an async function. It receives
`{request, origin, email, cookie, mail, fixtures, tool}` after the standard
policy/authentication phases and before the final audit. `tool(name,args)` uses
the run's real agent credential and records calls for that audit; no signer or
credential is passed to the module. The standard phases still run, and a failed
native journey fails verification. Errors are redacted to a fixed diagnostic.
Keep these modules in test tooling outside the production dependency graph.

## Per-run provider fixture control

The same initializer and native journey receive
`fixtures.set(exactDeclaredOrigin, jsonValue)`. It permits at most 100 updates,
16 KiB of JSON per value and only origins in `verification.network.origins`.
Read challenges or other values through native HTTP or declared tools first,
then set the isolated edge's response fixture. No production state accessor,
route, credential or authorization bypass is supplied by the verifier.

The network module's default `fetch(request, {fixture})` receives the most
recent value for that request's declared origin, or null. The request retains
its original method, URL, headers and body. A private loopback transport carries
the fixture and strips its carrier headers before invoking the adapter; app
headers cannot override it. Fixture controls are host functions, never served
routes. Values are isolated to the run and cleared on close. Undeclared origins
still receive 502, and the adapter's own outbound fetch remains denied. Keep
native DNS/challenge, signature and receipt validation inside the application.

## Copy source without Base's upstream tests

Copy runtime source and declarations with the authoring export's `testSource`
filter (`composition/git-source.mjs`), then `record-base` the files actually
copied and `rer refresh-base` the exact selected revision. Do not bulk-copy the
upstream `tests/`, fixtures or test typings into a seed's application source.
Refresh preserves deliberately omitted upstream tests; the record's
`notCopied` result makes those omissions inspectable. Existing intentional test
copies remain their owner's choice and are not silently removed.

The door's operator-people adapter also needs [operator-auth](../operator-auth/); Business
settings needs the [foundation runtime](../../foundation/runtime/). Copy/record those dependencies at their
corresponding relative paths or retain the seed's supported native adapters.
The fresh-copy journey records and refreshes door, settings and prerequisites
through the exported authoring CLI, then typechecks the entire copy under strict
TypeScript without excluding any copied files.

## Current admission on replay

Idempotency keys retain outcomes, not authority. Every retry rechecks the current
credential, sponsor, agent and consent revocation, scope, pause, native
classification and policy before returning saved content. A refusal has its own
audit row and never includes the saved result. A new approval or review
requirement returns `approval_required` or `review_required`; an old approval
cannot authorize a newer policy revision. Accepted replay does not execute or
count the native effect again. Record revision preconditions guard first
execution; they do not reject a successful replay merely because that execution
advanced the record revision.

For an explicit current-authority proof, declare
`verification.replayAdmission: {prepare:['create']}`. Preparation names existing
journey steps and must end with an idempotent write. Its public-door phase
proves identical once-only replay, pause and changed-policy refusal, a newly
required approval, current scope and the refused replay's complete audit.

## Verify multiple sponsors

Keep `verification.owner` for the first owner's existing bindings and lifecycle.
Optionally declare `verification.sponsors` as a nonempty list of principals with
unique stable `label` values and distinct canonical emails:

```json
{
  "sponsors": [
    { "label": "owner" },
    { "label": "member", "email": "synthetic-member@example.com", "role": "member", "initializer": "tests/initialize-member.mjs" }
  ],
  "crossSponsor": {
    "prepare": ["create"],
    "read": { "tool": "example.records.read", "args": { "id": { "$from": "create", "pointer": "/id" } } },
    "change": { "tool": "example.records.update", "args": { "id": { "$from": "create", "pointer": "/id" }, "value": "Edited" } }
  }
}
```

These keys live under `verification`. The first principal inherits `owner` and
runs all existing phases. Each later principal requires its own contained
initializer and receives `{label,email,sub,displayName,claim,owner,request,
origin,database,returnTo}`. Its fresh signed claim uses the same disposable
installation ring; `owner` carries the first principal's native session for
normal invitations. A signed Business settings roster binds each subject with
its declared `admin` or `member` role (default `member`). Complete the seed's
native member lifecycle and return its final 303 session response. Never create
accounts or sessions through direct SQL.

`database(binding)` exposes read-only SELECT statements against declared
**disposable verification** D1 databases, for test-owned mailbox or native
installation state. It has no production bindings or served endpoint. All
account creation and record effects still go through production doors. A seed
with another identity lifecycle uses its initializer and supplied signed claim.

`crossSponsor.prepare` names journey steps that create private native records.
The `read` and `change` fixtures use those outputs. Each additional sponsor must
successfully act on its own records, fail to read or change the first sponsor's
records, and fail to read or approve the first sponsor's private approval using
both its session and agent credential. Audits must attribute both principals
correctly. An omitted list or one sponsor runs no extra phase or points.

## Provision verification webhook secrets

A seed that creates its own random installation HMAC keys can declare
`verification.network.secretSource` as the path `tests/read-webhook-secrets.mjs`
alongside its existing network module and origins. The contained test-only module
exports `async function ({database})`, reads the fresh installation's own state
and returns a nonempty map of uppercase binding names to string values. The
isolated receiver receives that map as `env.secrets` in its `fetch(request,env)`.
It still has no application bindings, Node capabilities or outbound network.
Provisioning occurs after native initialization and Business binding, before
journey effects. Values and accessor failures are never printed. No accessor
is bundled into the app or mounted as a production route.

For callbacks into the seed, also declare:

```json
{ "webhooks": { "module": "tests/inbound-webhook.mjs", "prepare": ["create"] } }
```

This is another key under `verification`. Its contained module default-exports
an async builder receiving `{origin,outputs,secrets}` and returns
`{valid: Request, invalid: Request}`. Sign the seed's exact native payload with
its per-run key and with a wrong key, respectively. Both requests must POST to
the disposable installation origin. The verifier requires a 401 or 403 with no
native change for the invalid signature, then a successful response and a
retained native effect for the valid signature. Native signature validation,
replay checks and state commits remain in the seed.

## Security changes with no authority subject

A security tool changing only a record may explicitly declare `authority:
'none'` instead of an authority callback. Declare the same `inputSchema` and
`effect: {kind:'record', justification:'...specific native record change...'}`
in its runtime definition and `agent-surface.json` tool. Validation requires a
mutating security tool, no access class, a nonempty justification, and a closed
recursive schema containing only typed record inputs. Open or opaque objects,
references and schema composition are refused. Person, user, owner, sponsor,
agent, role, scope, grant, credential, permission, consent and token fields,
including nested and camel-case variants, are refused.

The registry publishes this class and record effect; conformance matches them
to the runtime schema. Normal policy, approval, execution and audit still apply.
Undeclared arguments return `undeclared_arguments` instead of being ignored.
Every success, pending execution and refusal records `authority: 'none'` in its
audit row. The extra conformance phase probes widening arguments, unchanged
native state, audit attribution and a rejected authority-bearing declaration.
A tool that can change someone's authority retains its callback and
`self_escalation` fixture. Narrowing callbacks continue returning
`{subject, widens:false}`; this record class does not replace narrowing checks.
## Native independent reviewers in verification

An owner initializer that needs a second person during fixture preparation can
declare that person's native lifecycle separately:

```json
{
  "verification": {
    "owner": { "initializer": "tests/initialize-owner.mjs" },
    "reviewers": [
      { "label": "quality", "email": "synthetic-quality@example.invalid", "initializer": "tests/initialize-reviewer.mjs" }
    ]
  }
}
```

The owner initializer receives `reviewers.initialize(label, {cookie})`. Pass its
real native owner session. The declared reviewer initializer receives
`{request, origin, label, email, owner: {email,cookie}, returnTo, mail}`. Use the
same-origin `request` to invite the reviewer, consume their invitation through
the native confirmation handler, and return its final 303 `Response` with the
reviewer's session cookie. `initialize` returns `{email,cookie}` to the owner
initializer, which then performs the native independent review. No agent token,
signer, database writer or production test route is supplied. Native roles,
independence, expiry, one-use proofs and step-up checks remain authoritative.
This test session grants no authority to a queued agent job.

`mail.read({limit, maxAgeMs, after})` returns only this declared reviewer's
accepted Resend, SendGrid or Cloudflare mail submissions as
`{id,at,subject,text,html}`. The provider edge remains isolated. Rejected or
oversized submissions and undeclared recipients are unavailable. Capture is
limited to twenty messages, 64 KiB per submission and five minutes of age;
defaults are ten messages and five minutes. No headers or provider credentials
are exposed. Each initializer runs at most once, there are at most eight unique
reviewers distinct from the owner, and capture is destroyed when verification
closes. The harness requires every declared reviewer lifecycle to complete;
its fixed failure diagnostic never prints mail, proofs or initializer errors.
Keep lifecycle modules in test tooling outside the production graph.

## Client custody boundary

The door retains idempotent outcomes, pending approval arguments, review
summaries, trace text, audit and events. Native client erasure must account for
these stores; a native record deletion alone cannot remove retained content or
prevent replay. No generic client-scoped erasure adapter is supplied yet.
Keep a native custody exception closed when these stores contain client data.
An adoption must establish the native mapping from retained artifacts to
clients, the permitted redaction of retained decision evidence, and the atomic
fence against pending execution and concurrent capture before enabling it.
The existing evidence-retention requirement still applies.

## Resolve native targets for audit and approval

A record tool declares `target(args, ctx)` alongside `classify`, `summary` and
`revision`. Return `{ kind: 'invoice', id: nativeRecord.id }`, or `null` if the
call has no native record target. Resolve through the native service; arguments
and returned resource links do not establish identity. The resolver receives the
current sponsor, agent/client and narrowed scopes. It must enforce native
visibility and return only audit-safe, policy-redacted identifiers. Do not put
credentials, private record content or unauthorized existence signals in them.
The door validates an exact nonempty string `kind`/`id` pair and refuses malformed
answers as `target_invalid`; a resolver is attribution, never an authorization
grant. Keep native access checks inside classification and execution too.

Tool audit rows store that pair in `resource`; undeclared or absent targets stay
`null`. Resource reads retain their requested URI in `resource`. Pending approval
summaries also contain the server-resolved pair as `summary.nativeTarget`, bound
to `summary_sha256`. Approval execution resolves again under the current native
principal; a changed target refuses `approval_evidence_changed` before effects.
Read-only record tools may declare the same resolver.

A journey step may declare `target: {kind, id}` to check the native identity in
its audit, pending summary and execution audit. The `id` may use a prior-result
`$from` reference. Supply the expected redacted native identity independently of
the proposed arguments; a wrong pair must fail conformance.

## Keep refusal attribution and classification

For schema-valid, resolvable calls, policy-unset, unavailable and paused refusals
retain the native target and computed classes/facts. Their rules use a null rule
id and the stopping disposition (`unset`, `unavailable` or `paused`): no policy
rule authorized an effect. Classification and target hooks are read-only and
must work without an adopted policy. If native authorization or missing state
causes a `ToolRefusal`, the audit retains `classification_refusal` with that
code, without inventing facts or bypassing the policy refusal. Invalid arguments
and principals lacking the tool scope do not resolve native targets.

## Return resource refusal machine codes

Every resource refusal carries its named code in JSON-RPC `error.data.code`,
including `resource_unavailable`, `tool_not_found`, `insufficient_scope`, policy
refusals and `approval_required`. Missing and hidden native records both return
`resource_unavailable` with no content or distinct existence signal. The code is
the same one produced by the tool pipeline; no seed response hook is needed.

## Declare sponsor escalation per native surface

An access/security surface tool may declare `sponsorEscalation: false` only when
its native authority resolver cannot widen the admitted sponsor. Examples are
record visibility changes with no standing authority subject, and admin-only
teammate edits whose sponsor already has full native authority. This declaration
replaces only an inapplicable sponsor-escalation fixture. Every declared class
still needs ordinary journey coverage, including real native widening/narrowing
changes where supported, with policy, approval, audit and native guards intact.
A missing or true declaration still requires the escalation fixture. It never
disables the runtime's self-widening refusal. Checked `widens: false` tools still
need their narrowing schema and grant-subset witness; this flag cannot waive
those checks. Owner-to-admin is a native demotion, never a widening operation.

## Contract clauses

[`CLAUSES.md`](CLAUSES.md) is the single canonical source for
`BASE-AGENT-001` through `BASE-AGENT-013`: transport, tools, resources,
identity, authority, classes, policy, attribution, audit, events, limits and
Pause, idempotency, and the manifest and conformance journey. Its requirement
text and numbered acceptance points preserve the shared duties previously
printed in `export/BASELINE.md`. Copying a duty never proves its implementation.
The baseline keeps the implementation coverage and outstanding gaps separately.

The static surface validator checks every clause ID named by tools and
`notTools` against the seed contract. The built-in `events.list` tool cites
`BASE-AGENT-010`; conformance point prefixes cover all thirteen shared duties.
There is no fixed shared set of `AGENT-*` or `SURFACE-*` IDs: those remain the
seed's own specialist jobs and deltas. The sync never creates or changes them.

A directory copy of `modules/agent-door/` delivers `CLAUSES.md` automatically
through the existing `record-base` and `refresh-base` workflow above, including
its digest in `base-copies.json`. If the edition instead records individual
module files, copy and record this additional file from the same immutable
commit (replace the destination with the edition's actual module path):

```sh
git -C /absolute/base-checkout archive FULL_BASE_COMMIT modules/agent-door/CLAUSES.md | tar -x -C src/base
node node_modules/@runeditrun/rer/edition-authoring/cli.mjs record-base src/base/modules/agent-door/CLAUSES.md modules/agent-door/CLAUSES.md FULL_BASE_COMMIT --base /absolute/base-checkout
```

Do not add a singleton record under an existing directory record. The CLI also
ships this canonical file in its portable source inventory for editions that
have not copied the runtime yet. When a module copy is recorded, the command
uses that copy and verifies its recorded digest. An older runtime record
without the clause file uses the CLI-delivered source, so a contract sync does
not require moving the runtime ahead of its own adoption work. The CLI and runtime remain separate pins.

From the runnable seed root, using a CLI containing this command:

```sh
rer door clauses --check
rer door clauses --write
rer door clauses --check
```

If the seed's pinned CLI predates the command, use the selected Base checkout
directly, without changing that pin or the runtime copy:

```sh
node /absolute/base-checkout/bin/rer.mjs door clauses --write --cwd /absolute/seed
node /absolute/base-checkout/bin/rer.mjs door clauses --check --cwd /absolute/seed
```

`--cwd DIR` selects a different seed root. `--check` is read-only, exits 1 and
names every missing or stale shared clause, and checks the generated documents
when all clauses are current. `--write` inserts missing clauses in
`### Agent surface (Base-delivered)` under Target clauses, before the seed's
last `### Agent surface` area, and updates existing shared definitions in place.
It preserves all other contract bytes except the generator-owned summary rows.
Existing shared Status, Evidence and Gap cells stay verbatim; canonical title
updates change only the Title cell. New clauses have status `missing`, with a
gap requiring judgment through this seed's own doors. The judged revision and
date stay unchanged, and a second write produces no diff.

The command runs the seed's `Lander-Regenerate` contract-docs `write` command
from `AGENTS.md`, followed by the corresponding `check`, retaining any declared
arguments. Without that declaration it uses
`node src/base/contract-docs.mjs write`, then `check`. Restore or copy the real
contract generator before syncing; legacy contracts must first be converted to
the standard level-four clause and Status table shape. Review the contract,
`ACCEPTANCE.md` and `docs/CLAIMS.md` together, run touched seed checks, then run
the edition's documented source-lock command **last**, followed by its source
check. Locking and committing remain explicit edition-authoring steps.
