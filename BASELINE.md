# BASELINE.md

Shared baseline requirements defined in Base. Editions ship their own copy and
baseline evidence; their reports distinguish implemented checks from planned
coverage. An intentional override identifies the baseline clause and the owner's
authorized replacement requirement, including changed security consequences,
with appropriate verification. Existing owner authorization is sufficient;
ordinary fixes to meet a requirement need no additional acknowledgement.
A product supersession names the baseline ID
in its contract and explains the replacement behavior. Keep these records in the
edition's useful requirements, intent or override documents. Use the override
schema and reporting that the edition actually implements; neither a particular
file path nor automatic `pnpm verify` supersession reporting is universal. Where
reporting is absent, state that gap and verify the replacement directly. Do not
silently weaken a guarantee or report an untested override as passing. Times are
p95 at the limits in `seed.json`.

## Access

- **BASE-ACCESS-001 — Sign-in.** Operators sign in by magic link to an allow-listed email address; passkeys may be offered in addition. No passwords are stored.
- **BASE-ACCESS-002 — Sessions.** A session expires after at most 30 days of inactivity; sign-out revokes that session. A valid session is required before an operator request reads private product data or performs its requested action. A protected operator document and each private generated server-function handler validate the session independently; a document gate does not authorize a function call. For an otherwise-admissible request that reaches session validation, a protected operator HTTP API returns 401 when the session is missing, expired, or revoked; a protected document returns its native sign-in response; and a generated transport may encode an identifiable session denial or sign-in redirect in its framework protocol, including a 200 serialized redirect. No such denial response exposes private product data or performs the requested mutation. Declared public exceptions remain governed by BASE-ACCESS-003, and host, method, Origin/CSRF, input, and runtime guards retain their normal order.
- **BASE-ACCESS-003 — Public endpoints.** Only paths declared in `seed.json → deploy.publicPaths` are reachable without a session. Entries are exact paths or prefixes and must cover the sign-in flow and the operator app's static assets. Each is rate-limited at the limits in `seed.json` and returns 429 when exceeded.
- **BASE-ACCESS-004 — Server-side authorisation.** Every mutation checks the caller's session and ownership on the server. Client-supplied identity, role, or ownership claims are never trusted.

## Input

- **BASE-INPUT-001 — Validation.** Every request body, query, and path parameter is validated against a schema at the boundary. Invalid input returns 400 in the standard error format and reaches no service.
- **BASE-INPUT-002 — HTML.** User-supplied HTML is sanitised before display: scripts, forms, and tracking pixels are removed; remote images load only on operator request. Channels that carry text are rendered as text.
- **BASE-INPUT-003 — Uploads.** Uploads are accepted only within the size and type limits in `seed.json`, stored in R2, served with their declared content type and a download disposition, and readable only by an authorised session or through a delivery channel the product contract names.

## Secrets and configuration

- **BASE-SECRET-001 — No leakage.** No secret appears in the client bundle, in logs, or in an error response.
- **BASE-SECRET-002 — Startup.** Missing required configuration fails at startup naming the variable. The product never runs in a degraded mode.

## Data ownership

- **BASE-DATA-001 — Export and import.** The product's documented export operation produces every record and attachment; its import operation restores them into an empty deployment; export, import, export yields an archive with equivalent contents.
- **BASE-DATA-002 — Retention.** No user data is deleted automatically. Only sessions and rate-limit state expire.
- **BASE-DATA-003 — Erasure.** Every entity that holds personal data can be deleted by an operator. Deletion cascades to dependent records and attachments within 5 minutes and is confirmed when complete. Audit entries are kept with the reference anonymised.
- **BASE-DATA-004 — Outbound flows.** User data leaves the deployment only through externals declared in `seed.json → externals`. No other outbound request carries user data.
- **BASE-DATA-005 — Independence.** The deployment makes no request to the marketplace or the seed author. There is no telemetry, phone-home, licence check, or kill switch.

## Public surfaces

- **BASE-PUBLIC-001 — Privacy.** Public surfaces (widgets, booking pages, forms, status pages) set no cookies, load nothing from third-party domains, and send no visitor data before the visitor's first interaction.
- **BASE-PUBLIC-002 — Origins.** Embeddable surfaces can be embedded only on host origins listed in settings.
- **BASE-PUBLIC-003 — Accessibility.** The operator app and every public surface are keyboard operable and labelled for assistive technology, passing the automated accessibility check at the level in `seed.json`. BASE-ACCESSIBILITY-001 sets the bar.

## Operations

- **BASE-OPS-001 — Health.** `/health` returns 200 within 1 second when the database, storage, and queues are reachable, and 503 otherwise.
- **BASE-OPS-002 — Migrations.** Migrating from the previous released tag to the current one succeeds on sample data. Destructive changes are expand → migrate → contract with a documented recovery step.
- **BASE-OPS-003 — Idempotency.** Queue consumers and webhook handlers produce the same result when a message is delivered twice.
- **BASE-OPS-004 — Failure is visible.** A job that fails after its retries is marked failed where an operator can see it. Nothing is dropped silently.
- **BASE-OPS-005 — Audit.** Every destructive action and every automated action that reaches a user records the actor, or the feature that acted, and the time. Audit records survive deletion of what they describe.

## Shared conformance duties

Seeds cite each applicable Base id and write only their delta in their own contract. A Base conformance journey runs on the seed's own data; planned coverage is not evidence that a duty passes.

- **BASE-ROLE-001 — Roles through every door.** Every door enforces the caller's current role on the server before reading content or changing state. A role refusal returns 403 with no state change. An admin role grants no content access by itself; content access needs its own grant. This extends BASE-ACCESS-004 to reads and every product door.
  1. For each role on the seed's own records, run permitted and forbidden reads and mutations through every door the seed exposes; the outcomes agree with the role's declared rights.
  2. A forbidden action returns 403 and leaves records, attachments, jobs and outbound effects unchanged.
  3. Changing or removing a role changes the next request's authority through every door, including an existing session or agent grant.
  4. An admin without a content grant cannot read another person's content; granting and revoking content access changes that result without changing the admin role.
  Base conformance journey: planned (roles through every door).

- **BASE-AUDIT-001 — Searchable, durable audit.** The audit trail is searchable, paginated and exportable to an authorised operator. Failed and uncertain outcomes are recorded durably with their actor, target, time and outcome, as well as successful actions; an unresolved outcome is never presented as success. This extends BASE-OPS-005.
  1. Perform successful, refused, failed and uncertain actions on the seed's records; search by actor, target, time and outcome and find the corresponding rows.
  2. Traverse more than one page in a stable order without missing or duplicating rows, respecting the operator's audit access.
  3. Export the matching trail across all pages and reconcile its fields and row count with the search results.
  4. Restart the deployment after failed and uncertain actions; their rows remain searchable and exportable with those outcomes.
  5. Delete an audited target and verify that its audit survives, with personal references anonymised as BASE-DATA-003 requires.
  Base conformance journey: planned (audit search, pagination, export and durable outcomes).

- **BASE-BACKUP-001 — Independent backup, restore and rollback.** Backups run on a documented schedule, are encrypted and are held independently of the live deployment so losing it does not lose the backup. A restore drill recovers records, attachments and access into a fresh deployment. An upgrade has a documented, proven rollback that preserves the installation's data. This extends BASE-DATA-001.
  1. Create records, attachments and access grants, let the scheduled backup run, and read back its completion and captured recovery point.
  2. Verify that backup storage is independent of the live deployment, its stored contents are encrypted, and restoration needs the separately held recovery key or authority.
  3. Restore that backup into a fresh deployment with the live deployment unavailable; reconcile records, attachment contents and access, then perform the seed's primary journey there.
  4. Upgrade a populated deployment, exercise it, then follow the documented rollback; reconcile its data and repeat the primary journey on the recovered deployment.
  Base conformance journey: planned (scheduled backup, fresh restore and upgrade rollback).

- **BASE-DATA-006 — Erasure respects retention and legal hold.** A legal hold or retention rule takes precedence over erasure. The operator sees the affected records, the reason and the hold or retention state; retained data is not reported as erased. The request and its actual outcome are audited. This extends BASE-DATA-003 with the retained-data exception, leaving its erasure guarantee in force for eligible data.
  1. Request erasure of records covered by a legal hold and by a retention rule; the operator sees what must remain and why, including the retention end or hold-release condition.
  2. Verify that held records and attachments remain intact and the result identifies retained data rather than claiming complete erasure.
  3. In the same journey, erase eligible records and dependants within BASE-DATA-003's five minutes, with completion read back and audit references anonymised.
  4. Release the hold or satisfy the retention rule, retry erasure, and read back completion; the audit preserves both requests and their actual outcomes without retaining the erased personal references.
  Base conformance journey: planned (retention-aware erasure).

- **BASE-SIGNIN-001 — Standards-based SSO and lifecycle.** SAML and OIDC sign-in and the SCIM account lifecycle are proven against run-auth as a standards provider. The seed enforces its own current roles and sessions after provider admission. Real vendor tenants are Field proof register rows, with their run state visible; standards conformance does not claim vendor certification.
  1. Configure run-auth as the provider and complete SAML sign-in into the seed; invalid signatures, an incorrect audience and expired assertions admit no session.
  2. Complete OIDC sign-in against run-auth; an incorrect issuer, audience, state or expired token admits no session or account link.
  3. Through SCIM against run-auth, provision, update and deactivate a person, then read back the seed's account and access; deactivation revokes active access and reactivation does not revive old sessions.
  4. Verify that provider lifecycle changes cannot create an unintended role or cross-installation identity link, and that unauthorised SCIM requests change nothing.
  5. Read the vendor-tenant register rows and their dated results or not-run state; the UI and docs claim only the proof actually recorded.
  Base conformance journey: planned (run-auth SAML, OIDC and SCIM lifecycle).

- **BASE-SIGNIN-002 — Native multi-factor authentication.** Without an identity provider, the seed offers TOTP, WebAuthn and passkeys, with recovery codes. Enrolment, challenge, recovery and revocation are bound to the person and cannot bypass their current role or restore a revoked session.
  1. Enrol TOTP and complete its challenge; invalid, expired and replayed codes do not establish access.
  2. Enrol a WebAuthn authenticator and complete its challenge; an incorrect origin, relying party or challenge is refused.
  3. Register a passkey, sign out and sign in with it; removing it prevents its next use.
  4. Generate recovery codes and use one to recover access; it cannot be used twice, and failed recovery attempts are rate-limited.
  5. Replace or revoke factors from the person's authenticated settings and read back the change; another person cannot enrol, recover or revoke those factors, and revoked sessions remain revoked.
  Base conformance journey: planned (native factors and recovery).

- **BASE-INSTALL-001 — Free self-host and removal.** A person can self-host the seed for free on a computer, a server or their own Cloudflare account through the documented `rer` verbs. The source and data stay under their control; provider charges are disclosed separately. Removal reads back what was actually removed and what remains.
  1. On a fresh computer, follow the documented `rer` install, setup and local-run path and complete the primary journey without a product licence or hosted subscription.
  2. Repeat the documented `rer` path on a server, then deploy into the owner's Cloudflare account and read back a working installation with the declared resources.
  3. Export the installation's records and attachments through its documented `rer` verb and verify they remain available independently of the author.
  4. Use the documented `rer` removal operation and reconcile its read-back with the resources, local files and retained exports that actually remain; a failed or partial removal stays visible.
  Base conformance journey: planned (computer, server, owner Cloudflare and removal).

- **BASE-MAIL-001 — Truthful mail outcomes.** Mail keeps queued, submitted, provider-acknowledged, failed, uncertain and person-confirmed outcomes distinct, with the evidence and time for each transition. Submission or provider acknowledgement is not a person's receipt. A scanner's fetch never counts as a person's receipt or confirmation.
  1. Send mail through the seed's public action and read back queued, submitted and provider-acknowledged states only as the corresponding queue, transport and provider evidence arrives.
  2. Exercise a provider failure and an interrupted or ambiguous submission; read back failed and uncertain respectively, with their durable evidence, without presenting either as delivered or person-confirmed.
  3. Fetch every mail link as a scanner, including repeated fetches; no fetch produces a person-confirmed receipt or performs a person's confirmation.
  4. Complete the seed's explicit person-confirmation flow and verify that it alone records the named person and time; query the history after restart and reconcile it with the actual transitions.
  Base conformance journey: planned (mail outcomes and scanner-safe confirmation).

- **BASE-ACCESSIBILITY-001 — One accessibility bar.** At widths 1440 and 390, the operator app and every public surface have no serious or critical axe findings, pass keyboard journeys, and expose correct accessible names, roles, states and live regions. A human screen-reader pass and a VPAT are Field proof register rows, with their run state visible rather than claimed without evidence.
  1. Run axe on the seed's operator and public journeys with realistic records at both widths and find no serious or critical findings.
  2. Complete the same journeys by keyboard at both widths, including dialogs, errors and completion, with usable focus order, visible focus and no keyboard trap.
  3. Assert accessible name, role and state for controls and live-region announcements for asynchronous progress, errors and completion at both widths.
  4. Read the screen-reader and VPAT register rows, including dates or not-run states; public claims match that evidence.
  Base conformance journey: planned (axe, keyboard and accessibility tree at 1440 and 390).

- **BASE-DOCS-001 — On-site docs from one contract.** Every Core capability has on-site Markdown documentation that a stranger can reach and use. CONTRACT.md is the only source of acceptance text and status; ACCEPTANCE.md and the claims document at `./docs/CLAIMS.md` are generated from it, as are their counts.
  1. Follow the seed's on-site docs navigation and reach Markdown guidance for every Core capability, including the inputs, observable result and recovery from a refusal or failure.
  2. Generate ACCEPTANCE.md and the claims document from CONTRACT.md; reconcile every clause's acceptance text, status, claims and counts with that source.
  3. Change a contract clause and regenerate; both outputs reflect it, a second generation changes nothing, and the check command rejects stale generated output.
  Base conformance journey: planned (Core docs navigation and contract generation).


## Agent access

Every call can carry several risk classes. The server computes them from arguments and current records, and from the provider's answer for gated steps. A seed proposes a new class for the shared list rather than inventing one.

| Class | A call is in it when it… | Measured by |
| --- | --- | --- |
| **standard** | stays inside the business and can be undone in the product | items |
| **external** | reaches or exposes anything to someone outside the business | recipients; counterparty *known*, *new* or *public* |
| **money** | moves money or changes what the business pays or charges | amount; counterparty |
| **commitment** (legal) | binds the business: a signature, accepted terms, an offer, a sign-off others rely on | value; counterparty |
| **accounts** | creates an account, identity or paid resource at an outside service | provider |
| **gated** | needs a step that outside services or agent providers commonly keep for a person: a consent screen in someone's account, card entry at a hosted checkout, identity or business verification, terms accepted in a person's name | provider; step |
| **access** | changes standing authority: staff, roles, admins, membership, devices, app and agent grants | people; widens or narrows |
| **security** | changes protective settings, or handles credentials | setting |
| **destructive** | cannot be undone in the product | items |
| **sensitive** | touches regulated personal data: health, ID, bank, card or payroll numbers | records; kind |
| **live** | changes how a running service behaves for its users | service |

Four rules no company policy changes:

1. People set the policy and the Pause switch. An agent may draft a change, and a person confirms it.
2. An agent never widens its own authority: its grant, its sponsor's role, the policy or Pause.
3. An agent acts for a named person, its sponsor, and never beyond that person's role.
4. Attribution is truthful. An agent's act reads `"<agent> for <person>"`, in the record and in the mail and messages it sends outside. It never records a person's approval, confirmation or signature. It never poses as a person to an outside service: no CAPTCHA, and never a person's own password or 2FA code. When a provider insists on a person, that step goes to a person.

Base and the seeds ship no dispositions; each company's policy decides every class.

Policy is data: numbered, signed revisions in the paired Business, adopted within 60 seconds using the installation's existing owner-claim trust; a standalone seed keeps the same document in Agents settings. Setup asks every class in use, each approval rule's approver and wait, and spend caps ("no cap" is an answer), with no answer pre-selected. Within a class, the matching rule with the most scope fields wins; a named class beats `*`, and a tie takes the stricter rule. Across classes the strictest result wins, in order blocked, approval, review, autonomous. Rules can narrow by seed, specialist or agent, threshold per call or per day, counterparty and access direction. These are company choices, never shipped answers.

MCP method names below use spaced slashes; the wire names join those segments without spaces.

Implementation notes below name stable point prefixes registered by
`modules/agent-door/conformance/index.mjs`. They identify implemented checks,
not a claim that the whole clause or an adopting edition's journey has passed.
Module tests under `modules/agent-door/tests/` are separate evidence;
the reference app runs this journey in its hosted verification shard. Broader baseline duties remain planned where called out below. The
policy source is ported from platform commit
`72aa71c03d943b53ed43dc73cac17d412c00d8fb`,
`src/business/agent-policy/{catalogue,document,decide}.ts`; platform adoption of
the shared source remains planned. Clause requirements below are unchanged.

The canonical requirements and acceptance points for these duties live in
[`modules/agent-door/CLAUSES.md`](../modules/agent-door/CLAUSES.md). Seeds inherit
that text with `rer door clauses --write`; the implementation coverage below
remains separate from a seed's own Status judgments.

- **BASE-AGENT-001 — One MCP door per seed.** [Canonical clause](../modules/agent-door/CLAUSES.md).
  Base conformance journey: `BASE-AGENT-001.1` through `.6` prove discovery, both protocol eras, unsupported versions, deterministic lists, Origin and header refusals, and body capacity.

- **BASE-AGENT-002 — The seed's jobs are tools, through the UI's own actions.** [Canonical clause](../modules/agent-door/CLAUSES.md).
  Base conformance journey: `BASE-AGENT-002.1.registry`, `.2` and `.3` prove registry equality, schemas, fixture outputs and annotations. Module public-door tests cover native refusals and embedded calls. Planned: complete Core-clause tier coverage and per-role UI-action parity in seed rounds.

- **BASE-AGENT-003 — Records are resources.** [Canonical clause](../modules/agent-door/CLAUSES.md).
  Base conformance journey: `BASE-AGENT-003.1` and `.4` prove templates and resource-link reads. Module public-door tests cover classified resource policy, approval, review, one audit per read, missing and invisible equality and untrusted content. Planned: per-role UI projection and byte budgets with `budget_exhausted`.

- **BASE-AGENT-004 — Business identity and short-lived, audience-bound tokens.** [Canonical clause](../modules/agent-door/CLAUSES.md).
  Base conformance journey: `BASE-AGENT-004.1` through `.5` prove metadata, challenges, audience, token times, scopes and query transport. Module tests cover durable Business subject mapping, allow-list admission, signed agent and consent revocation, seed revocation and standalone credentials. Planned: Business minting and consent revocation propagation, and seeds’ own credential issuance.

- **BASE-AGENT-005 — An agent acts as a person in a role, never more.** [Canonical clause](../modules/agent-door/CLAUSES.md).
  Base conformance journey: `BASE-AGENT-005.1` and `.2` prove declared self-escalations have no native effect; `.5` proves injection variants cannot change decisions. Module tests cover self-escalation and current sponsor admission. Planned: full per-role UI parity and an agent narrowing its own grant.

- **BASE-AGENT-006 — Every action declares its risk class.** [Canonical clause](../modules/agent-door/CLAUSES.md).
  Base conformance journey: `BASE-AGENT-006.1`, `.2` and `.6` prove declared classes, computed fixture facts and audited facts. `rer check` enforces catalogue membership and a fixture for every declared class. Each adopting edition supplies its native classifier fixtures.

- **BASE-AGENT-007 — The company's policy decides, at one chokepoint.** [Canonical clause](../modules/agent-door/CLAUSES.md).
  Base conformance journey: `BASE-AGENT-007.1`, `.2`, `.5`, `.7` and `.8` prove policy phases, unanswered access, approval waits and receipts, adoption, decision agreement and invalid-envelope retention. Module tests cover person Undo, summary-bound approvals, their separate execution audits, rejection, expiry, changed facts and standalone completeness; the M8 worked vectors match the platform. Planned: seed-specific parity and provider spend caps.

- **BASE-AGENT-008 — Truthful attribution.** [Canonical clause](../modules/agent-door/CLAUSES.md).
  Base conformance journey: `BASE-AGENT-008.2.person-door` and `.5` prove person-door refusal and preparer and approver identity. The reference browser journey exercises named person approval and review marks at both widths. Planned: outside-mail attribution and per-role UI-action parity in seed rounds.

- **BASE-AGENT-009 — Every agent action is audited with its class and decision.** [Canonical clause](../modules/agent-door/CLAUSES.md).
  Base conformance journey: `BASE-AGENT-009.1`, `.2` and `.4.review` prove ordered audit, decision agreement and review entries; `BASE-AGENT-007.7.differs-from-policy` checks replayed decision evidence. Module tests cover review marks and Undo; the reference browser journey checks weekly counts, privacy, responsive layout and accessibility. Planned: adopting editions’ role and UI parity.

- **BASE-AGENT-010 — Agents can follow changes.** [Canonical clause](../modules/agent-door/CLAUSES.md).
  Base conformance journey: `BASE-AGENT-010.1.effects`, `.2.events`, `.3.cursor` and `.6` prove retained effects and module events. Module public-door tests compare callback and event-log ids and exercise timed person-change subscriptions. The seed supplies its signed-webhook hand-off; full Chest delivery belongs to its adoption round.

- **BASE-AGENT-011 — Limits are policy, and Pause stops everything.** [Canonical clause](../modules/agent-door/CLAUSES.md).
  Base conformance journey: `BASE-AGENT-011.6` proves Business Pause, person access and resume. Module tests exercise local Pause, per-agent capacity and daily counted-call limits; the reference browser journey exercises Pause and resume. Planned: provider spend caps, `budget_exhausted`, and adopting editions’ per-role UI parity.

- **BASE-AGENT-012 — Writes are idempotent and conflict-safe.** [Canonical clause](../modules/agent-door/CLAUSES.md).
  Base conformance journey: `BASE-AGENT-012.1` proves replay preserves one outcome and effect. Module public-door tests prove changed-argument conflict and stale expected revisions. Outcomes are retained indefinitely. Planned: job handles for long work and their foreign-handle journeys.

- **BASE-AGENT-013 — Manifest, docs and the conformance journey.** [Canonical clause](../modules/agent-door/CLAUSES.md).
  Base conformance journey: `BASE-AGENT-013.surface`, `.phase2`, `.phase3` and `.4` prove static declarations and fixture journeys under autonomous and held policies. The reference browser journey covers both person pages at 1440 and 390. Planned: full Core-clause tier coverage, per-role UI-action parity and the stranger-specialist journey; a prompt listing does not prove the latter.
