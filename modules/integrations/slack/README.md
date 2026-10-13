# Slack notifier

Portable source imports: `modules/integrations/slack/index.ts`. This unit uses
core's frozen `DeliveryProtocol`, durable repository and delivery service.
No Slack SDK or runtime dependency is needed. Node deployments use
`NodePinnedTransport` from `modules/integrations/core/node-transport.ts`.

## Public API

- `createSlackNotifier({repository, transport, templates, incomingWebhook?, bot?, now?})`
  returns `{enqueue, delivery}`. `enqueue({id, tenant, destinationId, event, mode,
  data}, retry?)` durably queues one immutable serialized message; mode is
  `incoming-webhook` or `bot`. It performs no network request.
- `delivery` is the real core `DeliveryService`: `dispatch`, `dispatchDue`, `get`,
  `log`, `recoverExpired` and trusted `resolveUncertain` calls remain available.
- `createSlackIncomingWebhookProtocol({resolveDestination})` and
  `createSlackBotProtocol({resolveDestination})` can instead join an existing
  core delivery service. IDs are `SLACK_WEBHOOK_PROTOCOL` and `SLACK_BOT_PROTOCOL`.
- `renderSlackEvent(event, data, templates)` and `serializeSlackMessage(message,
  channel?)` supply exact JSON for direct core enqueue. A bot channel must match
  the destination resolver; a webhook body cannot override its channel.
- `slackEventTemplates` provides `incident.opened`, `incident.updated` and
  `incident.resolved` with `{title, detail}` data. Supply your own typed
  `SlackTemplates<Data>` for native product events. Unknown events reject.
  Each template returns `{summary, sections}`; summary supplies accessible
  top-level message text and sections use Block Kit plain text.
- All user content is escaped. `renderSlackEvent` applies Slack's documented
  message-formatting rule (`&` to `&amp;`, then `<` to `&lt;` and `>` to `&gt;`)
  to the top-level text and every block text a template returns, so
  `<!channel>`, `<@U123>`, `<#C123>`, `<!subteam^S123>` and `<url|label>` arrive
  as inert literals. Callers and templates must not pre-escape: pass raw text,
  or it is escaped twice (`&lt;` shows as `&amp;lt;`). `escapeSlackText` is
  exported for hand-built messages; `validateSlackMessage` and
  `serializeSlackMessage` reject any text still holding a raw `<` or `>`. Escaping
  can lengthen text, so Slack's 3000/4000-character limits apply to the escaped form.
- `validateSlackMessage`, `assertSlackChannel`, `classifySlackIncomingWebhook`,
  `classifySlackBot`, `resolveSlackWebhook` and `resolveSlackBot` are also exported,
  alongside the related TypeScript interfaces.

The incoming-webhook example below passes the migrated `IntegrationsRepository`, trusted egress
transport, installation-specific resolvers and selected templates:

```ts
import { createSlackNotifier, slackEventTemplates } from './modules/integrations/slack/index.ts';
import { NodePinnedTransport } from './modules/integrations/core/node-transport.ts';

const notifier = createSlackNotifier({
  repository,
  transport: new NodePinnedTransport(),
  templates: slackEventTemplates,
  incomingWebhook: resolveInstallationWebhook,
});
await notifier.enqueue({
  id: logicalEventId,
  tenant: repository.namespace,
  destinationId: 'operations-channel-v1',
  event: 'incident.opened',
  mode: 'incoming-webhook',
  data: { title: incident.title, detail: incident.publicSummary },
});
await notifier.delivery.dispatch(logicalEventId);
const attempts = await notifier.delivery.log(logicalEventId);
```

Identifiers, repository and resolvers above are the consumer's actual server
objects. Authorize event/destination selection before enqueue; never expose
configuration, arbitrary templates, reconciliation or repository management to
unauthenticated callers. Each repository namespace and resolver closure belongs
to one installation. Schedule `dispatchDue` after restart and at due times.
Core owns atomic claims, immutable-ID conflicts, audit attempts and migrations;
this unit adds no schema or parallel queue.

## Installation and credentials

For incoming webhooks, install a Slack app, enable incoming webhooks and authorize
its chosen channel. Store the resulting secret URL server-side. The resolver
signature is `(destinationId) => Promise<string>`; only HTTPS
`hooks.slack.com/services/<team>/<service>/<secret>` URLs are accepted. Queries,
fragments, other hosts and nonstandard ports reject. Channel identity comes from
Slack's installation. See [incoming webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/).

For app bots, install the app with `chat:write` and grant its access to the chosen
conversation. The resolver returns `{token, channel}`; use a conversation ID,
not a display name. The protocol always posts JSON to
`https://slack.com/api/chat.postMessage` with bearer authentication; no configurable
bot endpoint exists. It does not impersonate users. See
[chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/).
Both regular `xoxb-` and rotated `xoxe.xoxb-` access tokens are accepted. The
consumer owns secure OAuth installation and refresh scheduling; the resolver
must supply the current access token, never a refresh token.
See [token rotation](https://docs.slack.dev/authentication/using-token-rotation/).
GovSlack and legacy custom integration URLs are outside this implementation.

Load required configuration at application startup and fail with the consumer's
configuration variable name when absent. Keep credentials in deployment secrets
or a protected credential store. Resolvers must only read local trusted state
and finish inside core's claim horizon; refresh credentials separately. Validate
known destination versions with the exported resolve functions at startup.
Never put credentials in destination IDs, event data, exceptions, client bundles
or logs. Rotating a webhook URL requires a new destination ID; core detects URL
drift. A changed bot channel also fails preflight, so create a new destination
version. Bot token rotation for the same installation/channel is supported.

The immutable JSON body contains product data and is durably stored; select only
fields intended for that Slack channel. The consumer declares `hooks.slack.com`
and/or `slack.com` and these data fields in its actual `seed.json.externals`.
Configuration errors are fixed safe messages; attempts retain machine codes and
HTTP status, never raw provider bodies, bearer headers or webhook URLs. Slack
acceptance does not establish that a person read the message.

## Egress and outcome policy

Always use core's trusted transport contract. `NodePinnedTransport` validates all
resolved addresses and pins the public result to verified TLS, refuses private,
local and metadata destinations, bounds time/response size, and follows no
redirect. Worker consumers need a trusted enforcing egress service; ordinary
`fetch` does not satisfy that contract. No production loopback or endpoint
bypass is provided. The transport is a security boundary, not an untrusted option.

Incoming webhook acknowledgement requires HTTP 200 with exact `ok`; documented
4xx error names reject. Bot acknowledgement requires HTTP 200 with boolean
`ok:true` and no contradictory error. Known `ok:false` validation/auth/channel
errors reject even under HTTP 200. Unknown bodies, redirects, other HTTP statuses,
server errors, and partial-effect `internal_error`/`fatal_error` remain uncertain.
The deliberately conservative policy does not infer non-delivery from transient
service or migration errors. Raw unknown error names never enter logs.

HTTP 429 and bot `rate_limited`/`ratelimited` responses retry only with a valid
whole-second `Retry-After`. Missing/invalid/ambiguous cooldowns terminate with
`slack_rate_limit_invalid_delay`, visibly requiring intervention. Core uses the
later of its configured backoff and provider cooldown, limits attempts (default
4, maximum 10), and rejects delays beyond one day without retrying early.
Consumers should also pace new messages for their channel/workspace; this library
does not implement a cross-job workspace rate limiter. See
[Slack rate limits](https://docs.slack.dev/apis/web-api/rate-limits/).

A lost response or expired claim stays uncertain and is never automatically
replayed. No Slack idempotency guarantee is assumed. Retain the log; reconcile
only with trusted external evidence using `delivery.resolveUncertain`. A database
failure propagates; there is no in-memory success or retry fallback.

## Verification and integration proposal

New suites: `modules/integrations/tests/slack/*.test.ts`. The tests use real local
HTTP and TLS receivers, ephemeral test certificates, synthetic credentials, and
file-backed SQLite with restart. They never call Slack. The test transport maps
only the exact two fixture provider URLs onto loopback; this exists solely under
[Slack test helpers](../tests/slack/) and never bypasses production egress policy.

The root `verify:modules` command discovers the integrations aggregator, which
runs every retained nested suite once. Run only this module with
`node --test modules/integrations/tests/integration.test.ts`. The schema test
uses the pinned AJV 8.17.1 dev dependency. A separately installed AJV can be
selected through `SLACK_TEST_AJV_MODULE` with its absolute `dist/ajv.js` path.
The local Worker/D1 suite uses the pinned Miniflare dev dependency. No missing
dependency silently skips a suite.

The committed schema fixture transcribes the current documented Block Kit
section/text subset and validates Slack's unchanged official sample and every
emitted template for both paths, with independent invalid-payload tests. It is
not claimed to be a Slack-published JSON Schema or full Block Kit validator.
[Fixture provenance](../tests/slack/fixtures/provenance.md) lists the sources.
Local checks prove protocol and persistence behavior; installation, provider
acceptance in a real workspace and human receipt remain unverified.
