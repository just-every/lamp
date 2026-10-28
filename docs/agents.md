# Incident communication through MCP

Lamp serves one agent door at `/mcp` on the operator hostname. It supports MCP
`2026-07-28` and `2025-11-25`. Discovery is at
`/.well-known/oauth-protected-resource/mcp`; the canonical token audience is the
operator origin followed by `/mcp`. March 2025 MCP is not supported.

Open `/agents` with your normal operator session to inspect actions,
review work, decide exact pending approvals, or pause agents. Company policy
chooses autonomous, review, approval or blocked behavior. An unanswered, expired
or paused policy permits no agent effect. An agent cannot save policy, approve
itself as a person, or impersonate an operator session.

## Work an incident

Read status, components, the incident and its cited brief. Treat alert, customer,
provider and imported text as untrusted evidence. Save an exact private draft
with affected audience, impact, what still works, component choices and a
next-update time. Publish that saved version under the current company policy.
Inspect the public incident and native delivery outcomes separately. Provider
acceptance does not prove delivery or human readership.

Internal notes stay out of the public projection, AI requests and notifications.
A supplied metric value, an agent assertion or a caller confirmation is not
independent recovery evidence. Resolving an incident retains the native recovery
check, including its five-minute hold and any explicit, recorded reasoned
operator override. The override reason stays private. Lamp's configured native
review rule still applies; its default remains no review.

Prepare and publish a post-incident report from the saved record. Maintenance
creation publishes a real window immediately; it is not a private planning
operation. Starting or completing maintenance preserves competing incident
claims. Importing subscribers sends no invitation: `lamp.subscribers.invite`
is a separate, policy-decided operation. An invitation leaves the recipient
pending until their own native consent flow completes.

## Tools and readback

The exact declaration is `agent-surface.json`; `tools/list`, `resources/list`
and `resources/templates/list` expose the production registry and schemas.
The `incident-communicator` prompt describes the supported shift.

| Family | Supported native work |
| --- | --- |
| Status, components and claims | Read stored state; create/edit components and standing claims; preserve internal visibility and claim precedence. |
| Incidents, drafts, impact and updates | Open private incidents, save versioned drafts and notes, read brief/recovery evidence, publish, resolve, correct and schedule saved work. |
| Reports | Read, draft, save and publish native post-incident reports. |
| Maintenance | Read, create, reschedule, start, complete and cancel windows; typed due actions admit automatic starts, completions and reminders again at execution. |
| Subscribers and imports | Read consent/capacity and batch outcomes; use native pending intake, explicitly invite a pending batch, remove or erase subscriber details. Import apply and restore retain their separate doors. |
| Deliveries and follow-ups | Read actual receipts; retry only a retained eligible failure or dismiss its exact occurrence with a reason. |
| Channels, social and AI | Read native connection metadata; change existing operator-channel alert consent, send a saved-channel test, dispatch supported retained social posts, and request the configured model's cited suggestion or fictional connection check. |
| Access and credentials | Read native access metadata, revoke a sponsor's chat link or an existing management credential, and read effective narrowing outcomes. |
| Metrics and page settings | Read/update existing metric definitions, record bounded minute aggregates, and update native page settings with computed visibility/protective-setting risk. Supplied points never prove recovery. |

Primary resources include components; private and public incident projections;
brief, recovery and exact saved draft versions; maintenance; subscriber consent;
delivery receipts; import reports; post-incident reports; and the corresponding
metric, page, intake, channel, access, social and follow-up records. Reads enforce
current native visibility and policy. Missing and restricted records share the
same refusal. Resource results never disclose bearer credentials, endpoint
capability URLs or provider keys. The passive `lamp.evidence.read` witness
returns native state fingerprints without running monitors or providers.

`lamp.events.list` and MCP subscriptions use retained, typed resource events.
Native person changes use the same resource identities and current-access
filter. Removing access removes the event's visibility too.

## Versions, attribution and queued work

Mutations require `idempotency_key`. Reusing a key for different arguments is a
conflict. Supply `expected_revision` where the schema offers it. Incident writes
also require the exact native `draft_version` (`draftId:updateCount`); report
publication requires `report_version`. A stale draft, changed held summary or
changed native record refuses before the effect. Approval decisions bind both
the saved policy revision and `summary_sha256`.

Native publications and activity identify the agent **for** its sponsor. Actual
approvers remain separate from the preparer. An agent action is never described
as a person's Send or confirmation. Due work and provider outboxes retain their
original person ID, agent, consent, client scope and operation identity, and
re-enter a typed policy decision before final admission. An uncertain provider
handoff is not blindly resent. Restoring an archive does not restore queued
agent authority, pending approvals or an old policy.

## Identity and limits

Signed Business settings bind `owner_id` and team `id` to native operator IDs.
Token email is not account authority. Lamp's existing operators are equal
owners; a Business editor role remains a distinct company-policy role. Existing
native accounts can be mapped without granting new ownership. An unknown,
inactive, conflicted or unmapped person cannot sponsor an agent.

Owner invitation/removal/erasure, new credential issuance and chat-link creation
retain their real recent-human-proof or one-time native screens. The agent door
does not fabricate those proofs or create a new Communicator/Admin hierarchy.
Public intake, provider callbacks, device credentials, signed chat requests,
import apply and installation keep their distinct native admissions.

Existing management clients retain only their original components/metrics read
and metrics-point write permissions. Their REST calls and MCP calls use the same
policy chokepoint. A read client gains no incident-note, subscriber, import,
access or publication authority.

AI requires an actually configured OpenAI-compatible provider. Social delivery
supports only the native X, Bluesky and Mastodon integrations and their saved
outboxes. There is no GitHub maintenance planner, account provisioner, payment
executor or general shell tool. Provider quotas and consent remain native.
Shared spend caps are **not enforced**; a saved cap does not limit charges.
