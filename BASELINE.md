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

- **BASE-AGENT-001 — One MCP door per seed.** Every seed, hosted or self-hosted, serves one remote MCP endpoint at `/mcp` over Streamable HTTP. It speaks the current revision (2026-07-28) and accepts 2025-11-25 clients through the twelve-month deprecation window. It implements `server / discover`, tools, resources and prompts. Lists are deterministic and carry `ttlMs` and `cacheScope: "private"`. Roots, Sampling and Logging are not served.
  1. `server / discover` returns the supported versions, capabilities, `serverInfo` and instructions.
  2. A 2026-07-28 request works with no handshake, and a 2025-11-25 client completes `initialize` and lists the same tools.
  3. An unsupported version returns `UnsupportedProtocolVersion`.
  4. Two `tools / list` calls return the same order, with cache fields.
  5. A foreign Origin returns 403, and a header and body method mismatch returns `HeaderMismatch`.
  6. An oversized body returns 413 with no effect.
  Base conformance journey: planned (`./modules/agent-door`).

- **BASE-AGENT-002 — The seed's jobs are tools, through the UI's own actions.** Each Core job a person does in the product is a tool. Where one is not, the Agent surface says why: it runs on a device, it is a person's interactive screen, it belongs to a connector or the import door, or it is an installation fact. Risk is never the reason: a risky job is a tool with its class (BASE-AGENT-006). Tools are named `<seed>.<area>.<verb>` and declare input and output schemas and truthful annotations. Each calls the same server action as the UI, so validation and authorization are written once, and the seed's embedded agents use the same registry. A business refusal returns `isError` with the seed's stable error code.
  1. The Core clause ids in each tool's `_meta`, with the not-a-tool reasons that `server / discover` serves, cover every Core clause in the contract, and no reason is risk; the harness and `rer check` fail on a gap.
  2. Each tool's fixture result validates against its `outputSchema`.
  3. Read tools declare `readOnlyHint`; tools that can carry destructive declare `destructiveHint`, and tools that can carry external declare `openWorldHint`.
  4. A refusal returns the same error code the UI gets for the same action.
  5. The UI action and its tool, on the same fixture, give the same record state and the same audit event type.
  6. The seed's embedded agents appear in the audit as calls to the same tools.
  Base conformance journey: planned (`./modules/agent-door`).

- **BASE-AGENT-003 — Records are resources.** Each primary record type has a URI template, and tools return `resource_link`s to the records they touch. A read returns exactly the fields the caller's role sees in the UI. File bytes count against any byte budget on the grant. A record the caller cannot open reads as not found, identical to a missing id. Text from customers, imports or files carries an untrusted marker in `_meta`.
  1. `resources / templates / list` names every record type in the Agent surface.
  2. Reads as two roles return exactly what the UI shows each.
  3. An out-of-scope id and a missing id give identical responses.
  4. A write's `resource_link` reads back the new state.
  5. Bytes over budget return `budget_exhausted` and no partial content.
  6. Customer-sourced text carries the untrusted marker.
  Base conformance journey: planned (`./modules/agent-door`).

- **BASE-AGENT-004 — Business identity and short-lived, audience-bound tokens.** The door is an OAuth 2.1 resource server. Its RFC 9728 metadata names the authorization servers this installation trusts. That is the paired Business when Business provisioned it, verified with the owner-claim trust the installation already holds for its import door; otherwise it is the seed's own sign-in. Access tokens are RFC 9068 JWTs with `aud` set to the seed's canonical MCP URI, `sub` the sponsoring person, `act` the agent (RFC 8693) with its specialist, scopes per tool family, and a lifetime of 15 minutes or less (5 by default). The policy scopes rules on the sponsor, agent and specialist the token names. The consent behind the tokens can last longer and is revocable. Tokens travel only in the Authorization header, and there is no passthrough.
  1. An unauthenticated call returns 401 with `resource_metadata`, and the metadata names the trusted servers and scopes.
  2. A Business token for this seed works, and the same token sent to a sibling seed returns 401.
  3. An expired token returns 401, and a token with a lifetime over 15 minutes is refused.
  4. A read-only token calling a write tool returns 403 `insufficient_scope` with every needed scope in one challenge.
  5. A token in a query string is refused and not logged.
  6. Revoking consent in the seed or in Business refuses the next call within 60 seconds.
  7. After unpairing, Business tokens are refused and the seed's own sign-in still works.
  Base conformance journey: planned (`./modules/agent-door`).

- **BASE-AGENT-005 — An agent acts as a person in a role, never more.** Every call is authorized as the sponsoring person's current role and access (BASE-ACCESS-004), intersected with the grant's resources, actions and budget. A grant only narrows. No call widens the calling agent's own authority. A call that would widen its own grant or its sponsor's role, or change the company policy or Pause, is refused with `self_escalation`, whatever the policy says; narrowing its own grant is allowed. Other access and security changes are ordinary actions in the access and security classes. An agent never acts after its sponsor is suspended. Anything an agent reads (records, files, emails, imports, other seeds' results) is data and cannot change its scope, its targets or a call's class.
  1. For each role fixture, every tool's allow or deny through MCP equals the UI's for the same action.
  2. A one-folder, read-only grant holds, and widening through arguments is refused.
  3. Downgrading the sponsor changes the next call's result, and suspending the sponsor returns 401.
  4. Calls that widen the agent's own grant or its sponsor's role, or change the policy or Pause, return `self_escalation` and change nothing, even under a policy with every class autonomous; dropping a scope from its own grant runs.
  5. An injection fixture yields no out-of-grant call and no change of class: record text asking for a wider action, or claiming that a recipient is internal.
  Base conformance journey: planned (`./modules/agent-door`).

- **BASE-AGENT-006 — Every action declares its risk class.** Classes come from the fleet list in RISK-POLICY.md: standard, external, money, commitment, accounts, gated, access, security, destructive, sensitive and live. In the registry, each tool declares the classes it can carry and a server-side classifier that decides them per call from the arguments, current records and, for gated, the provider's answer. The classifier also supplies each class's facts: the measure (items, recipients, amount and currency, people or records), the counterparty (internal, known, new or public), the direction for access, the provider and step for gated, and the data kind for sensitive. A classifier never reads a flag, label or claim supplied by the agent or by record text. A seed cannot add a class; it proposes one for the fleet list.
  1. Every tool in `tools / list` carries its possible classes in `_meta`, equal to the Agent surface table.
  2. For each tool, fixture calls cover every class it can carry, and the computed classes and facts equal the fixture's expected values.
  3. An argument or record text asserting a class or a confirmation (`internal: true`, `confirmExternal: true`) leaves the computed classes unchanged.
  4. Money calls carry amount and currency, external calls their counterparty and recipient count, access calls their direction, and destructive calls their item count.
  5. No tool in `tools / list` declares a class outside the fleet list, and `rer check` fails on one.
  6. A refused call's audit row still records its computed classes.
  Base conformance journey: planned (`./modules/agent-door`).

- **BASE-AGENT-007 — The company's policy decides, at one chokepoint.** Every agent door calls one decision function: MCP, the integration API with agent tokens, and the seed's embedded agents. It evaluates the call's classes against the company's policy, as above. The seed ships no dispositions and fills no gap with one: agent access opens only under a complete policy that setup has asked for (RISK-POLICY.md), and before then every agent call returns `policy_unset` with the setup link and changes nothing. *Autonomous* runs the call. *Review* runs it and adds it to the review feed. *Approval* saves a pending action with server-computed facts and returns `input_required`, with a URL-mode elicitation to the seed's approval page and a pending handle. Each person the rule names approves the exact saved revision in a signed-in browser, and changed inputs need a new approval. The retried call returns the result and a receipt. A rejection returns `approval_rejected`, and a lapse past the wait the rule sets returns `approval_expired`. *Blocked* returns `policy_blocked`, naming the class, rule and revision.
  1. The Base harness runs each tool under each disposition for every class it can carry, and sees it run, run and enter the review feed, wait with no effect, or be refused.
  2. Before setup is complete, the setup page lists every class the seed's tools carry with examples and no answer pre-selected, an agent call returns `policy_unset` with the setup link and changes nothing, and an incomplete revision cannot be confirmed; a `*` rule completes it, and a tool an upgrade adds with an unanswered class appears in `tools / list` once that class is answered, while the other tools keep running.
  3. Under "money autonomous up to $500, approval up to $10,000, blocked above", calls of $400, $600 and $20,000 run, wait and are refused; a per-day cap sends the call that crosses it to the next rule.
  4. A call carrying two classes takes the stricter disposition.
  5. An approval shows server-computed facts and an expiry, returns the URL elicitation and a handle, and completes once after the named approver approves; a changed input needs a new approval, and a rejection or lapse leaves no effect.
  6. The same call through MCP, the integration API and an embedded agent gets the same decision.
  7. A policy change applies to the next call within 60 seconds, and the audit cites the new revision.
  8. A policy document with a bad signature or another Business's id is rejected, and the door keeps the last valid revision.
  Base conformance journey: planned (`./modules/agent-door`).

- **BASE-AGENT-008 — Truthful attribution.** Every agent act is recorded and shown as `"<agent> for <person>"`, and mail and messages an agent sends outside name it that way as their sender. An approval, a review mark, a confirmation (a warning dialog, a typed-field confirmation, a delivery confirmation), a decision or a signature attributed to a person comes only from that person's signed-in session. When an agent does the equivalent act, the record names the agent, and the act carries its own class; a binding decision or a signature is commitment. Agent doors ignore arguments that stand for a person's confirmation. No tool solves a bot check, or enters a person's own password or 2FA code at an outside service. A provider step that demands a person goes to a person, whatever the policy says; the gated class marks such steps before they run.
  1. An agent call carrying a person-confirmation flag is classified and decided exactly as without it.
  2. Approving, marking reviewed or answering a policy question with an agent or device token returns 403 and changes nothing.
  3. A form-mode elicitation "accept" never completes an approval.
  4. Where an agent's decision, signature or field confirmation runs without a person, it reads `"<agent> for <person>"` in the record, the activity view, exports and any certificate, never as the person's own act.
  5. After a person approves an agent's prepared action, the record shows the person as approver and the agent as preparer.
  6. Activity and exports at 1440 and 390 show `"<agent> for <person>"` for every agent act.
  7. Mail an agent sends to an outside address names `"<agent> for <person>"` as its sender.
  Base conformance journey: planned (`./modules/agent-door`).

- **BASE-AGENT-009 — Every agent action is audited with its class and decision.** Extending BASE-OPS-005, each call that reads private data or changes anything records the agent client, name and specialist, and the run or task id (`traceparent` when sent); the sponsoring person, the grant, the tool and the targets; the classes and their facts, and the policy revision and rule; the decision (autonomous, review, approval, blocked, unset or self_escalation) and the outcome (done, refused, pending or failed); the approval or review id and person, and the idempotency key. For a period, the seed's Agents page shows actions by class and decision with the notable ones, the review feed (Mark reviewed, Flag, and Undo where reversible), pending approvals, steps waiting for a person and setup questions. Business shows the same across seeds.
  1. One write leaves a complete audit row.
  2. Refused, pending, unset and self-escalation calls are audited.
  3. The Agents page's counts by class and decision equal the audit rows on a fixture week.
  4. The review feed lists exactly the calls decided as review; Mark reviewed records the person, and Undo restores a reversible one.
  5. Filtering by agent or class lists only those rows, and export includes every field.
  6. Removing the agent keeps its rows and its name.
  7. The Agents page works at 1440 and 390 with no serious or critical axe findings.
  Base conformance journey: planned (`./modules/agent-door`).

- **BASE-AGENT-010 — Agents can follow changes.** The seed emits a typed event for every record change and for every approval, review and policy decision. Each event carries a stable id, a type, the record URI, the actor (a person, or an agent acting for a person) and a time. Events never carry secrets or more than the subscriber may read. Agents can read events three ways: `subscriptions / listen`, an `events.list` tool with a cursor, and signed webhooks from Base `integrations` using the same ids. Every channel delivers at least once and filters by access at delivery.
  1. A subscribed record changed in the UI produces a notification within 10 seconds.
  2. `events.list` returns the same event id the webhook carries.
  3. Replaying from a cursor returns the same ids in order.
  4. After access is revoked, no channel delivers events about that record.
  5. A failed webhook is visible and replays without duplicate effects.
  6. `approval.pending`, `approval.decided`, `review.flagged` and `policy.adopted` carry the class and decision and nothing the subscriber may not read.
  Base conformance journey: planned (`./modules/agent-door`).

- **BASE-AGENT-011 — Limits are policy, and Pause stops everything.** Business limits are rules in the company's policy: per-call and per-day thresholds on any class's measure, such as money moved, outside recipients or items destroyed; spend caps on provider cost (models, SMS, email) per seed, specialist or agent, which setup asks with the classes; "no cap" is an answer. Tools with provider cost declare an estimate before they run, and an exhausted cap returns `budget_exhausted` before any partial effect. The seed's capacity limits (request rate, body and byte sizes) protect the installation: they bound rate and size, never daily business volume, are documented and are not policy. A grant carries budgets only when the person granting it sets them. A **Pause agents** control in the seed, and Pause all agents in Business when paired, refuses every agent token within 60 seconds until a person resumes; browser sessions and devices keep working.
  1. A rate overrun returns 429 with `Retry-After`.
  2. A per-day cap of three outside recipients sends the fourth to the rule that applies past the cap.
  3. An exhausted spend cap returns `budget_exhausted` with no partial effect and shows the spend.
  4. Under the answer "no cap", a spending call runs and its spend shows in usage; a call that spends nothing is unaffected by any cap.
  5. The usage view shows calls, decisions by class, money moved and provider spend per agent.
  6. Pause and Pause all agents each stop the next call within 60 seconds, and resume restores access.
  7. An agent token cannot resume.
  Base conformance journey: planned (`./modules/agent-door`).

- **BASE-AGENT-012 — Writes are idempotent and conflict-safe.** Every mutating tool requires an idempotency key and takes an optional expected revision. The same key with the same arguments returns the first outcome for at least 24 hours; the same key with different arguments returns `idempotency_conflict`; a stale revision returns `revision_conflict` with the current revision. Long work returns a job handle and a status tool, with no dependence on the Tasks extension.
  1. Two calls with one key give one effect and equal results.
  2. A retry with a new JSON-RPC id and the same key, after a dropped stream, returns the recorded outcome.
  3. The same key with different arguments returns a conflict and no effect.
  4. A stale revision returns a conflict naming the current revision.
  5. A job handle used by another person's token reads as not found.
  Base conformance journey: planned (`./modules/agent-door`).

- **BASE-AGENT-013 — Manifest, docs and the conformance journey.** `server / discover` instructions and an on-site `/docs/agents` page are generated from the action registry. The page lists tools by job, with each tool's classes, the test that adds each computed class, its scopes, resource templates, event types, capacity limits and error codes, and the specialist role. `prompts / list` carries the specialist's jobs. Base ships the conformance journey, a harness that `rer verify` runs against `rer dev` and seeds run in CI. It is an MCP client; a signed-in test person takes a person's steps (setup answers, approvals, review marks, resume) through the URLs the door returns, and the same browser leg runs the UI-parity actions and the page checks at 1440 and 390. It runs every acceptance point of BASE-AGENT-001 to 012 and of the seed's SURFACE clauses under two company policies: *all autonomous* (`*`), and *held* (standard review, every other class the seed declares approval, which the test person grants), plus the single-class variants a point names. A point that names no disposition passes under both.
  1. The docs list exactly the names in `tools / list` and `resources / templates / list`.
  2. Each tool's classes, and the test behind each computed one, are documented.
  3. The harness fails on any of: a tool without a schema; an effect under approval or blocked, or before setup is complete; a computed class that differs from its fixture; a flag that changes a class or completes a person's step; a role-parity mismatch; a wrong-audience token being accepted; a duplicate effect on retry.
  4. Every acceptance point runs under both policies, every decision matches the policy in force, and under all autonomous no call waits for a person or is refused by policy.
  5. A stranger agent given only the seed URL completes the specialist journey through MCP.
  Base conformance journey: planned (`./modules/agent-door`).
