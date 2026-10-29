# Work with an incident communicator

Lamp exposes its incident desk through the shared MCP door at `/mcp`. Discovery,
resource metadata and the incident-communication prompt describe supported jobs.
The door supports the 2026-07-28 and 2025-11-25 protocol versions.

## Connect and choose company policy

Business supplies signed installation settings with durable owner and teammate
IDs. An agent token carries the sponsoring person, consent and scopes. Token email
never selects an operator. Current native Owner/Admin, Communicator, Responder and Viewer permissions apply
to every tool and resource. Signed Business owner/editor policy roles are separate.

The company adopts signed policy at `/api/rer/agent-policy`. It chooses autonomous,
review, approval or blocked dispositions for each class. Unset, unanswered or
expired policy refuses agent work. `/agents` shows policy, Pause, pending actions,
reviews and retained activity. A named person approves the exact saved summary
and revision. Agent confirmations and imported text cannot approve an action.
Pause and revoked sponsor, agent or consent stop the next agent effect.

Native management credentials retain their original read or metric-point scopes
and sponsoring operator. Credential issuance, recent email proof, chat identity
linking, connection secrets and import apply retain their native person doors.
Some delegated native owner operations remain unavailable until the shared native
owner API supports Lamp's native owner invitation and proof boundary; the door returns an explicit refusal.
See [Native proof for protected changes](agent-native-proof.md) for the person proof workflow and current limits.

## Communicate an incident

1. Read accepted live alert evidence, current component claims, the incident brief
   and recovery evidence. Private notes stay out of AI briefs and public snapshots.
2. Open a private incident, attach real components, save impact and the next update
   time, and preview the exact saved draft version.
3. Publish that version under company policy. The summary names public wording,
   components, selected channels, recipients and promises. Configured native review
   rules still apply.
4. Read native resources, public state and actual delivery outcomes. Retained import reports are available at `lamp://imports/{id}/report` with `lamp.access.read`; this does not grant import apply, undo or invitation authority. Provider
   acceptance and a person reading a notice remain separate facts.
5. Resolve with current native recovery evidence or an explicitly permitted recorded
   reasoned override. Prepare and publish the post-incident report from the record.

Stale draft versions refuse before publication. Exact-key replay keeps one native
effect; changed arguments conflict. Queued effects retain their agent, sponsor and
consent and recheck admission at final native dispatch. Maintenance preserves
competing incident claims. Importing subscribers is silent; an explicit invitation
is a separate policy-decided action and does not confirm subscriber consent.

## Supported registry

Each mutation uses native validation and current records to compute classes and an
approval summary. Private draft work is standard, actual public exposure external,
active public behavior live, and a new relied-on promise commitment. Protected
returned evidence adds sensitive. Caller class and confirmation flags cannot lower
these decisions. Tools below may still refuse because native authority, evidence,
configuration or a provider is unavailable.

| Tool | Possible classes | Scope |
|---|---|---|
| `lamp.access.read` | standard | `lamp.access.read` |
| `lamp.access.update` | access, security | `lamp.access.update` |
| `lamp.ai.check` | external | `lamp.ai.write` |
| `lamp.ai.read` | standard | `lamp.ai.read` |
| `lamp.ai.suggest` | external | `lamp.ai.write` |
| `lamp.channels.read` | standard | `lamp.channels.read` |
| `lamp.channels.test` | external | `lamp.channels.write` |
| `lamp.channels.update` | standard, access | `lamp.channels.write` |
| `lamp.claims.update` | standard, external, live | `lamp.claims.update` |
| `lamp.components.correct` | standard, external, live | `lamp.components.correct` |
| `lamp.components.create` | standard, external, live | `lamp.components.create` |
| `lamp.components.list` | standard | `lamp.components.list` |
| `lamp.components.move` | standard, external, live | `lamp.components.move` |
| `lamp.components.read` | standard, sensitive | `lamp.components.read` |
| `lamp.components.remove` | destructive, external, live | `lamp.components.remove` |
| `lamp.components.update` | standard, external, live | `lamp.components.update` |
| `lamp.credentials.create` | access, security | `lamp.credentials.create` |
| `lamp.credentials.update` | access, security | `lamp.credentials.update` |
| `lamp.deliveries.dispatch` | external, live | `deliveries:dispatch` |
| `lamp.deliveries.read` | standard | `lamp.deliveries.read` |
| `lamp.drafts.save` | standard | `lamp.drafts.save` |
| `lamp.events.list` | standard | `events:read` |
| `lamp.followups.dismiss` | standard | `lamp.followups.write` |
| `lamp.followups.read` | standard | `lamp.followups.read` |
| `lamp.followups.retry` | external | `lamp.followups.write` |
| `lamp.groups.create` | standard | `lamp.groups.create` |
| `lamp.groups.move` | standard, external, live | `lamp.groups.move` |
| `lamp.groups.read` | standard | `lamp.groups.read` |
| `lamp.groups.remove` | external, live, destructive | `lamp.groups.remove` |
| `lamp.groups.update` | standard, external, live | `lamp.groups.update` |
| `lamp.impact.update` | standard, external, live | `lamp.impact.update` |
| `lamp.importgrants.read` | standard | `lamp.importgrants.read` |
| `lamp.importgrants.update` | access, security | `lamp.importgrants.update` |
| `lamp.incidents.assign` | standard | `lamp.incidents.assign` |
| `lamp.incidents.brief` | standard | `lamp.incidents.brief` |
| `lamp.incidents.create` | standard | `lamp.incidents.create` |
| `lamp.incidents.delete` | destructive, external, live | `lamp.incidents.delete` |
| `lamp.incidents.note` | standard | `lamp.incidents.note` |
| `lamp.incidents.preview` | standard | `lamp.incidents.preview` |
| `lamp.incidents.publish` | external, live, commitment | `lamp.incidents.publish` |
| `lamp.incidents.read` | standard, sensitive | `lamp.incidents.read` |
| `lamp.incidents.resolve` | external, live | `lamp.incidents.resolve` |
| `lamp.incidents.update` | standard | `lamp.incidents.update` |
| `lamp.intake.read` | standard | `lamp.intake.read` |
| `lamp.intake.update` | standard, live, security | `lamp.intake.write` |
| `lamp.maintenance.cancel` | standard, external, live | `lamp.maintenance.cancel` |
| `lamp.maintenance.complete` | standard, external, live | `lamp.maintenance.complete` |
| `lamp.maintenance.create` | standard, external, commitment, live | `lamp.maintenance.create` |
| `lamp.maintenance.read` | standard | `lamp.maintenance.read` |
| `lamp.maintenance.remind` | standard, external | `lamp.maintenance.remind` |
| `lamp.maintenance.start` | standard, external, live, commitment | `lamp.maintenance.start` |
| `lamp.maintenance.update` | standard, external, live, commitment | `lamp.maintenance.update` |
| `lamp.metrics.create` | external, live | `lamp.metrics.create` |
| `lamp.metrics.points` | external, live | `lamp.metrics.points` |
| `lamp.metrics.pull` | external, live | `lamp.metrics.pull` |
| `lamp.metrics.read` | standard | `lamp.metrics.read` |
| `lamp.metrics.remove` | external, live, destructive | `lamp.metrics.remove` |
| `lamp.metrics.update` | external, live | `lamp.metrics.update` |
| `lamp.operators.erase` | access, destructive | `lamp.operators.erase` |
| `lamp.operators.invite` | access, external | `lamp.operators.invite` |
| `lamp.operators.restore` | access | `lamp.operators.restore` |
| `lamp.operators.revoke` | access | `lamp.operators.revoke` |
| `lamp.page.read` | standard | `lamp.page.read` |
| `lamp.page.update` | external, live, security | `lamp.page.update` |
| `lamp.privacy.erase` | destructive | `lamp.privacy.erase` |
| `lamp.recovery.read` | standard | `lamp.recovery.read` |
| `lamp.reports.draft` | standard | `lamp.reports.draft` |
| `lamp.reports.publish` | external | `lamp.reports.publish` |
| `lamp.reports.read` | standard | `lamp.reports.read` |
| `lamp.reports.save` | standard | `lamp.reports.save` |
| `lamp.reports.waive` | standard | `lamp.reports.waive` |
| `lamp.social.read` | standard | `lamp.social.read` |
| `lamp.status.read` | standard | `lamp.status.read` |
| `lamp.subscribers.add` | standard, external | `lamp.subscribers.write` |
| `lamp.subscribers.invite` | standard, external | `lamp.subscribers.write` |
| `lamp.subscribers.read` | standard | `lamp.subscribers.read` |
| `lamp.subscribers.remove` | destructive | `lamp.subscribers.write` |
| `lamp.templates.apply` | standard | `lamp.templates.apply` |
| `lamp.templates.create` | standard | `lamp.templates.create` |
| `lamp.templates.list` | standard | `lamp.templates.list` |
| `lamp.templates.update` | standard | `lamp.templates.update` |
| `lamp.updates.correct` | standard | `lamp.updates.correct` |
| `lamp.updates.dispatch` | external, live, commitment | `lamp.updates.dispatch` |
| `lamp.updates.schedule` | external, live, commitment | `lamp.updates.schedule` |
| `lamp.workspace.snapshot` | standard | `lamp.workspace.snapshot` |

## Native records

- `lamp://access/{id}`
- `lamp://components/{id}`
- `lamp://deliveries/{id}`
- `lamp://groups/{id}`
- `lamp://imports/{id}/report`
- `lamp://incidents/{id}`
- `lamp://incidents/{id}/brief`
- `lamp://incidents/{id}/draft/{version}`
- `lamp://incidents/{id}/recovery`
- `lamp://maintenance/{id}`
- `lamp://metrics/{id}`
- `lamp://page/{id}`
- `lamp://reports/{id}`
- `lamp://subscribers/{id}`

Resources are classified reads under the same policy and current native visibility.
Missing and restricted records share a refusal. Customer, provider and imported
text are untrusted evidence. Credentials, webhook capability paths and hidden
operator notes do not enter public projections.

## Audit targets and retries

Calls on existing incidents and component reads record the native record kind
and ID in the door audit. An approval also binds that identity into its saved
summary. A request to create a record has no existing native record ID at
admission; inspect its returned resource to read the resulting record.

A saved idempotent result does not replace current policy, Pause, consent,
scope or native admission. An independent native draft review remains a real
person's action; the preparing agent and its sponsor do not become that reviewer.

## Limits

Lamp supports its native incident, maintenance, component, subscriber, delivery,
intake, report, configured AI and supported X/Bluesky/Mastodon work. It does not add
a GitHub maintenance planner, payment executor, monitor observation or staff-role
hierarchy. Existing quotas, consent and uncertain provider custody still apply.
An uncertain provider attempt is never blindly resent.

Shared spend caps are not enforced yet. A signed paired cap document can be adopted
while Agents reports `not_enforced`; standalone cap saves refuse. Native provider
limits remain authoritative.

## Verification

This edition pins the published rer 0.2.88 CLI. Normal `rer verify` exercises its installed conformance runner against a disposable production installation; the Verify build job uses the same entry point before the browser shards. Dated Base dependencies remain failing assertions, rather than skipped capabilities. Fresh native phase fixtures supply current maintenance windows, minute aggregates, silent import batches and scoped native read clients. Approved replay, state-changing injection probes, delegated owner administration, due-dispatch fixtures, hosted public-origin access and trusted per-step queue proof retain dated dependencies. The native person screens remain authoritative for unsupported owner commands.
