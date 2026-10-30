# Use an agent with Lamp

Lamp exposes a limited incident communicator at `/mcp` on the operator hostname.
It can save page settings, manage components, and prepare and publish incident
updates through the same native services the operator desk uses. The complete incident-week workflow
in the product contract is still incomplete.

## Connect and grant access

Use `https://<operator-hostname>/mcp` as the remote MCP address. Discovery reports
the supported protocol versions and available tools. The door supports
2026-07-28 and 2025-11-25 clients.

This edition accepts short-lived Business agent credentials using the
installation's configured owner-claim trust. Business must first bind its
owner and team identities to the installation's native people. A credential's
sponsoring person and current email must match that binding. Its audience is
this installation's MCP address; its scopes limit which tools it can call.
This adoption does not provide a local agent-token issuing flow.

Native Lamp roles remain authoritative. An agent sponsored by a Viewer cannot
publish an update. Communicators can publish, Responders can prepare incident
work, and Owners and Admins can manage page settings and the component catalogue.
A broader Business grant does not add native permissions. Suspending a person removes
that person's agent access too.

## Available jobs

| Tool | Scope | Job | Computed classes |
| --- | --- | --- | --- |
| `lamp.configuration.save` | `configuration:write` | Save the public page name, description, colour, timezone, hostname and footer choice | external and live |
| `lamp.components.list` | `components:read` | Read the component catalogue, groups and current claims | standard |
| `lamp.components.create` | `components:write` | Create an Operational internal or public component | standard for internal; external and live for public |
| `lamp.components.claim` | `components:write` | Set or clear a standing component claim | standard for internal; external and live for public |
| `lamp.components.remove` | `components:write` | Permanently remove a component and its native dependent history and links | destructive, plus standard for internal or external and live for public |
| `lamp.incidents.list` | `incidents:read` | Read native incidents | sensitive |
| `lamp.incidents.get` | `incidents:read` | Read one incident and its current draft revision | sensitive |
| `lamp.incidents.create` | `incidents:draft` | Prepare an incident with a component and private first-update draft | standard |
| `lamp.incidents.note` | `incidents:draft` | Add a private internal note | standard |
| `lamp.incidents.draft` | `incidents:draft` | Save a private update using its current draft revision | standard |
| `lamp.incidents.publish` | `incidents:publish` | Publish the current update to the public page | external and live |
| `lamp.incidents.brief` | `incidents:read` | Read the incident brief and native recovery check | sensitive |
| `lamp.witness` | `lamp:inspect` | Read counts and content hashes for native component and incident consistency | standard |

Publication currently selects no notification channels. Subscriber invitations,
mail and SMS dispatch, maintenance, report publication, provider setup, authority
changes and the other contract registry jobs are not available as MCP tools in
this adoption.

Lamp computes classes from the proposed action and current native records.
Private drafting has one touched-record measure. A public component change or
incident publication identifies the public counterparty and the running Lamp
status service. Component removal counts one logical component resource; it
also removes the component's dependent native history and links. Supplying a
risk label, role or instruction in an argument does not change these decisions.
The `agent-surface.json` journey names the fixtures for each declared class.

## Policy, approval and activity

Sign in as a native person and open `/agents`. This page shows the applicable
agent policy, work awaiting approval or review, and recent agent activity.
Business manages the paired policy. Calls wait when a required policy answer is
missing or unavailable. Each call follows the current policy's autonomous,
review, approval or blocked decision.

An approval shows the target and proposed action. The named person can approve
or decline that exact revision; a later record change can require a fresh
approval. An agent credential cannot approve its own work or operate a person's
Pause control. The owner can pause and resume agent admission from this page.
Pausing does not roll back a completed publication.

Door activity records the agent, its sponsoring person, computed classes,
policy decision and outcome. Native incident records still retain their native
operator authorship; a complete agent-for-person presentation across every
operator and public surface has not been established.

## Retrying a call

Every mutating call requires an idempotency key. Reuse that key when retrying the
same arguments after a lost response. Lamp retains the first outcome rather
than applying the same mutation again. Changing the arguments with that key
returns `idempotency_conflict`. Current native authority and policy still apply
on a completed retry.

Read the current draft revision before saving or publishing an update. A stale
revision returns `revision_conflict`; inspect the current draft before making a
new request. Component claim and removal also retain native revision checks.
A retry never grants authority to act after the sponsoring person's permissions
have changed.

## Capacity and refusals

The door admits up to 6,000 requests per minute per agent and accepts request
bodies up to 1 MiB. A capacity refusal returns `rate_limited` with a retry delay;
a large body returns HTTP 413. These transport limits do not establish company
volume budgets or provider spend caps.

A missing or invalid credential returns HTTP 401 with the protected-resource
metadata location. A missing tool scope returns `insufficient_scope`. Other
refusals include `forbidden`, `policy_unset`, `policy_unavailable`,
`policy_blocked`, `agents_paused`, `invalid_arguments`, `idempotency_conflict`
and `revision_conflict`. Treat a refusal as an outcome to inspect, rather than
changing roles or risk labels in the arguments.

## Current proof boundary

The declared capabilities are `tools`, `policy`, `pause`, `audit` and
`idempotency`. Resources, prompts, events and subscriptions are undeclared.
Their lists remain empty or their operations return `capability_not_declared`;
there is no agent event feed or record-resource link contract to rely on.

The disposable conformance journey exercises the declared component and incident
work under autonomous and held policies using native owner and provider flows.
Its results remain separate from complete product acceptance. It does not
establish coverage for every Core job, a stranger specialist's full incident
week, every native role and screen, delayed or queued execution, a second host,
or the complete native owner-administration lifecycle. See the Agent surface
clauses in the [product contract](../CONTRACT.md) for the remaining requirements.
