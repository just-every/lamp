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

## Durable invocation consent

Persist the originating `ctx.consent` alongside the native sponsor id, agent
attribution, scopes, client id, tool, arguments and idempotency key when preparing scheduled or
durable work. The trusted worker later calls the public door with that saved
identity:

```ts
const result = await door.invoke(job.tool, job.args, {
  person: { id: job.sponsorId }, agent: job.agent, consent: job.consent,
  scopes: job.scopes, clientId: job.clientId,
})
```

`invoke` re-reads the native person; saved role or email is unnecessary. Consent
is optional for work that originated independently of Business consent. Work
prepared under a consent must retain that exact id rather than omit or replace
it at execution. The door puts it on the Principal and `ToolContext`, re-reads
current signed revocations at worker admission and fences execution reservation
against revocation. A revoked consent returns
`{outcome: 'refused', code: 'consent_revoked'}` without calling the native effect.
Both successful and refused invocation audit rows include `consent`, agent,
sponsor, tool, time, policy revision and outcome. The edition owns its scheduler
and native transaction boundaries; retain that result with the job.

The shared `runAgentDoorConformance` journey accepts an optional
`invoke(name,args,who)` callback wired to that same trusted worker door. `who`
carries `{person: {id}, agent, consent}`. The module's journey uses it to run
serialized job input, prove a native effect and consent-attributed audit, then
revoke the consent before admitting saved work and prove `consent_revoked`,
a complete refusal audit and an unchanged native witness. Supply this callback
in the edition's integrated module journey; no production test route is needed.
The HTTP-only CLI journey checks signed consent revocation and audit attribution
separately, without claiming to run the edition's scheduler.

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
