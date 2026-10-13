# Integrations

Import portable server APIs and types from `modules/integrations/index.ts`.
This entry composes the actual durable core, Slack and egress
modules. It imports no Node built-ins. Node-only adapters remain explicit:
`core/sqlite.ts` and `core/node-transport.ts`. Source reuse does not install a
provider app, configure credentials, migrate a database or deploy an egress service.

| Consumer surface | Public exports |
| --- | --- |
| Durable delivery | `DeliveryService`, `IntegrationsRepository`, `Envelope`, `DeliveryProtocol`, `TrustedTransport`, `WireRequest`, `WireResponse`, `Outcome` |
| Signed webhooks | `createWebhookProtocol`, `verifyWebhook`, `validateDestination`, `isPublicAddress` |
| SQL and token policy | `D1SqlDatabase`, `D1Binding`, `SqlDatabase`, `SqlStatement`, `TokenService`, `TokenAuthority`, `TokenGrant`, `TokenRequestContext`, `TokenMetadata`, `TokenUsage` |
| Slack | `createSlackNotifier`, both `createSlack*Protocol` factories, `renderSlackEvent`, `serializeSlackMessage`, `slackEventTemplates`, `SlackTemplates`, resolver types and protocol constants |
| Outbound declaration | `declareEgress`, `validateEgressConfiguration` and their input/output types |

[Core contract](core/CONTRACT.md), [Slack setup](slack/README.md),
[egress declarations](egress/README.md) provide the full unit contracts.
The [strict consumer example](tests/integration/consumer-contract.ts) composes
the webhook and both Slack delivery protocols with explicit, typed deployment ports; it is a
compile fixture, not a substitute for native authentication or secret custody.

## Database setup and migration

Use Node with native TypeScript stripping and `node:sqlite` (Node 22.13+ for
SQLite; Node 26 is the tested runtime). No runtime npm dependency is required.
Apply [core/schema.sql](core/schema.sql)
once through your edition's migration ledger, assigning the next unused numbers.
Use the same transactional database for token authority and token storage.
Repository namespaces are server-selected installation IDs, not request fields.
Slack adds no schema.

For a fresh local database, save this as `integration-migrate.ts` at the repository
root and run `INTEGRATIONS_DB=/absolute/path/integrations.sqlite node integration-migrate.ts`.
It refuses an existing core schema instead of silently treating it as an upgrade.
Use a durable local filesystem with reliable SQLite locking. The directory must exist.

```ts
import { readFile } from 'node:fs/promises';
import { SqliteDatabase } from './modules/integrations/core/sqlite.ts';
const path = process.env.INTEGRATIONS_DB;
if (!path) throw new Error('Missing INTEGRATIONS_DB');
const sql = new SqliteDatabase(path);
try {
  const [existing] = await sql.batch([{ sql: "SELECT name FROM sqlite_master WHERE name='integration_deliveries'" }]);
  if (existing!.length) throw new Error('Use the edition migration ledger for an existing database');
  const core = await readFile(new URL('./modules/integrations/core/schema.sql', import.meta.url), 'utf8');
  sql.migrate(`BEGIN IMMEDIATE;\n${core}\nCOMMIT;`);
} finally { sql.close(); }
```

For D1, put these SQL files into the application's existing migrations directory
and apply them with its configured D1 migration command; neither a binding name
nor deployment target is assumed here. Already-applied migration files stay
unchanged. If the earlier core proposal is already installed, number and apply
[upgrade-token-usage-context.sql](core/upgrade-token-usage-context.sql) exactly
once instead of rerunning the fresh schema. It preserves historical usage rows
with null request/resource provenance. Back up before migration; keep the expanded
columns when rolling back application code. Include deliveries, attempts,
resolutions, replay inbox, tokens, usage, and audit in native
export/retention/erasure policy. Bodies are product data.

## Node enqueue and scheduling

Save as `integration-send.ts` in the repository root after migration. Provision
`WEBHOOK_KEY_HEX` with at least 32 random bytes, encoded as hex, in server secret
custody. `WEBHOOK_URL` is an authorized, versioned public HTTPS destination;
`INTEGRATION_NAMESPACE` is the installation's server-selected namespace. Set
`EVENT_ID` to the durable business event identity. Do not log configured values.

```ts
import { DeliveryService, IntegrationsRepository, createWebhookProtocol } from './modules/integrations/index.ts';
import { SqliteDatabase } from './modules/integrations/core/sqlite.ts';
import { NodePinnedTransport } from './modules/integrations/core/node-transport.ts';
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
const keyHex = required('WEBHOOK_KEY_HEX');
if (!/^(?:[0-9a-fA-F]{2}){32,}$/.test(keyHex)) throw new Error('Invalid WEBHOOK_KEY_HEX');
const key = new Uint8Array(Buffer.from(keyHex, 'hex'));
const namespace = required('INTEGRATION_NAMESPACE');
const endpoint = required('WEBHOOK_URL');
const id = required('EVENT_ID');
const sql = new SqliteDatabase(required('INTEGRATIONS_DB'));
try {
  const protocol = createWebhookProtocol({
    resolveDestination: async destination => {
      if (destination !== 'incident-receiver-v1') throw new Error('Unknown destination');
      return endpoint;
    }, signingKey: async () => key,
  });
  const delivery = new DeliveryService({ repository: new IntegrationsRepository(sql, namespace),
    protocols: [protocol], transport: new NodePinnedTransport() });
  await delivery.enqueue({ id, tenant: namespace, destinationId: 'incident-receiver-v1',
    event: 'incident.opened', protocol: protocol.id, body: JSON.stringify({ reference: 'INC-1' }) });
  await delivery.dispatchDue();
  console.log({ id, state: (await delivery.get(id))?.state });
} finally { sql.close(); }
```

Run with `node integration-send.ts` only after configuring the real destination
and outbound declaration. The example sends a real request. An edition must
schedule `dispatchDue()` through its queue/cron after restart and at future due
times; one invocation does not wait for retries. Authorize event and destination
selection before enqueue. Resolve credentials from trusted local custody, without
network I/O inside `prepare`; refresh provider credentials separately.

## Optional timestamped-body compatibility signature

`createWebhookProtocol` also accepts `timestampedBodySignature: { timestampHeader,
signatureHeader, signingKey? }`. This opt-in adds two caller-named headers while
retaining every Base header and the exact envelope body. Omit the option to keep
the default request byte-for-byte unchanged. Both header names must be HTTP
tokens, distinct ignoring case, and cannot replace `content-type` or any Base
`webhook-*` metadata/signature header. Names are checked when the protocol is
created and captured against later configuration mutation. Transport-controlled
and authorization headers are also reserved: `host`, `connection`,
`content-length`, `transfer-encoding`, `proxy-authorization`, `authorization`,
`keep-alive`, `proxy-connection`, `te`, `trailer` and `upgrade`.

The timestamp value is an ISO 8601 UTC string, with `.000Z`, representing the
same whole-second instant as `webhook-timestamp`. The signature is unprefixed,
unpadded base64url HMAC-SHA256 over the UTF-8 bytes of
`isoTimestamp + '.' + envelope.body`. Whitespace, line endings, Unicode and a
leading BOM are preserved; there is no JSON parsing or normalization. The
optional async `signingKey(envelope)` resolves a separate `Uint8Array` key of at
least 32 bytes; omitting it reuses the Base key resolved for that preparation.
Both keys remain in trusted server custody. If an existing receiver's contract
uses a random secret string as its key, explicitly use
`new TextEncoder().encode(randomSecretString)` for its literal UTF-8 bytes;
do not hex/base64-decode that string. This is for random secrets, not passwords.

This generic compatibility signature binds timestamp and body only. Base's
signature continues to bind audience, event and logical identity;
`verifyWebhook` still verifies that Base signature. A compatibility receiver
owns its timestamp freshness, exact-byte verification and replay/effect policy.
Enabling these headers changes neither the outcome classifier nor uncertainty,
retry, destination or trusted transport rules.

## Worker egress boundary

The portable entry and D1 adapter can run in a Worker. Ordinary Worker `fetch`
does **not** meet `TrustedTransport`: URL validation alone cannot pin DNS at the
connection. Supply a deployment-owned service/RPC binding that enforces public
IP resolution at connect time, verified TLS, no redirects, bounded request time
and response size. The service must authorize its callers and destination policy.
`NodePinnedTransport` is the supplied enforcing implementation for Node services;
its Node DNS/HTTPS dependencies must not enter the Worker bundle.

This runnable scheduled-handler wiring requires an already provisioned enforcing
RPC binding implementing `send(WireRequest): Promise<WireResponse>`; this module
does not provide or deploy that service. There is deliberately no fetch adapter
or permissive transport fallback. Validate required bindings/secrets at startup.

**Gap: no Worker transport in Base yet.** A seed that posts only to fixed
provider hosts (Slack and Teams incoming webhooks, for one) has no Base
transport to use in a Worker today; Lamp records a provider-host allow-list over
Worker `fetch` as its own divergence. Design: the enforcing egress service
(in progress in Base's egress workstream) is a
separate Worker exposing this module's `TrustedTransport.send` over a service
binding. It resolves each destination once, refuses any non-public answer,
pins the checked address into a TLS connection verified for the original
hostname, follows no redirects and bounds size and time; an optional allow-list
of exact or `*.suffix` hosts in the service's own configuration narrows it to
provider hosts. When it lands, a provider-host seed binds it instead of its own
allow-list. A host allow-list over plain `fetch` is not a `TrustedTransport`:
it checks the literal host, not the address the connection reaches.

```ts
import { D1SqlDatabase, IntegrationsRepository, DeliveryService, createWebhookProtocol } from './modules/integrations/index.ts';
import type { D1Binding, TrustedTransport } from './modules/integrations/index.ts';
interface Env {
  DB: D1Binding;
  INTEGRATION_EGRESS: TrustedTransport;
  INTEGRATION_NAMESPACE: string;
  WEBHOOK_URL: string;
  WEBHOOK_KEY_HEX: string;
}
export default {
  async scheduled(_event: unknown, env: Env) {
    for (const name of ['DB', 'INTEGRATION_EGRESS', 'INTEGRATION_NAMESPACE', 'WEBHOOK_URL', 'WEBHOOK_KEY_HEX'] as const)
      if (!env[name]) throw new Error(`Missing ${name}`);
    if (!/^(?:[0-9a-fA-F]{2}){32,}$/.test(env.WEBHOOK_KEY_HEX)) throw new Error('Invalid WEBHOOK_KEY_HEX');
    const key = Uint8Array.from(env.WEBHOOK_KEY_HEX.match(/../g)!, byte => parseInt(byte, 16));
    const repository = new IntegrationsRepository(new D1SqlDatabase(env.DB), env.INTEGRATION_NAMESPACE);
    const protocol = createWebhookProtocol({ signingKey: async () => key,
      resolveDestination: async id => {
        if (id !== 'incident-receiver-v1') throw new Error('Unknown destination');
        return env.WEBHOOK_URL;
      } });
    const delivery = new DeliveryService({ repository, protocols: [protocol], transport: env.INTEGRATION_EGRESS });
    await delivery.dispatchDue();
  },
};
```

The application enqueues with the same namespace, protocol and destination
version. Transport binding names are deployment examples, not new SEED fields.
Local D1 tests prove SQL behavior, not a deployed Worker-to-egress connection.

## Identity, replay and honest outcomes

`enqueue` commits immutable tenant, logical ID, destination version, event,
protocol, exact UTF-8 body, URL hash and retry policy. Conflicting ID reuse
rejects. Default retries are four attempts with 1/5/30 second delays; only
explicit retryable responses requeue. Provider cooldown wins over backoff;
each delay is capped at one day and attempts at ten. A provider cooldown above
one day terminates as `rejected` with code `retry_delay_exceeded`; there is no total elapsed
retry horizon, and repeated delays or late scheduling can span multiple days.
All sends have a committed attempt. Expired claims, lost responses and ambiguous provider
responses become `uncertain`, including Slack posts. They are never
blindly replayed. Database failures propagate without an in-memory fallback.

`accepted` means protocol acknowledgement, not delivery/read confirmation.
Inspect `get(id)` and `log(id)` in the operator
experience. Only a trusted operator reconciles uncertainty using
`resolveUncertain(id, 'accepted' | 'rejected', safeEvidenceCode)`;
`repository.resolutions(id)` retains that separate evidence and attempts retain
uncertainty history. Do not create a new logical ID to evade uncertainty.

A receiver passes original bytes: with Fetch/Workers, use
`const body = new Uint8Array(await request.arrayBuffer())`, then call
`verifyWebhook({body, headers: request.headers, key, tenant, destinationId})`.
Do not use `request.text()`, `Buffer.toString('utf8')`, or parse/reserialize before
verification: decoding can replace malformed UTF-8 or strip a leading BOM.
The verifier rejects malformed bytes and preserves the BOM as signed content.
Its string input is only for caller-owned canonical text, never a decoded HTTP
body whose original bytes are unavailable. See the [native receiver](receiver.md)
for Fetch/Worker and Node boundaries. After verification, commit
`repository.acceptReplay(verified)` **before** any business effect. Duplicate
claims return false; changed signed contents conflict, even after restart.
The canonical HMAC input and header format are in the core contract. Signatures
bind audience, event, ID, timestamp and body; default freshness is five minutes.
Use raw random key bytes, not a password. One active key is supported; coordinated
rotation is consumer-owned. Retries retain ID/body with a fresh signature.

Replay acceptance is a durable inbox, not proof the business effect completed.
Process that inbox with an application processed marker and business mutation in
one database transaction. The receiver can then resume after a crash without
reapplying its effect. External effects still need reconciliation. Keep replay
rows while IDs may recur; signature verification alone provides no deduplication.

## Token authority and API permissions

Construct `TokenService(repository, nativeAuthority)` only on the server.
`issue(authenticatedContext, {name, scopes, expiresAt?})` reveals its 256-bit
random token once; only SHA-256 and safe metadata persist. Never return plaintext
through list/usage, or put it in a URL, delivery body, exception or browser bundle.
`grant(context)` returns `TokenGrant`: the current scope ceiling **and** a trusted
SQL `commitGuard` checked by the token INSERT in the same transaction as its audit.
Bind the authenticated issuer, namespace and every revision used to derive the
grant. Update those revisions in the same database transaction whenever native
permissions change, including deletion/reactivation. Constant SQL, caller SQL
or preflight-only checks are not authority. The compile example and integration
fixture show the shape; adapt it to the edition's real identity tables.

Every `authorize(token, requiredScopes, {requestId, resource})` rechecks current
token scopes, expiry and revocation in SQL and durably records allowed/denied
attempts. Required scopes and resource authorization come from the server's
route, not the token bearer. Supply safe request/resource identifiers, never raw
queries, bodies or credentials. Missing context rejects; historical null context
is not fabricated. Issuer policy governs issuance; this API does not continuously
join issued tokens to an edition's application registry. If an application or
issuer removal must invalidate existing tokens, the edition must revoke them as
part of that policy change. Revoke/list/usage require native `administer` checks.
Audit and usage survive token deletion; usage-write failure denies visibly.

## Provider and secret configuration

Slack incoming webhooks require an installed app and secret channel URL;
app bots require `chat:write`, channel access and a current bot access token.
`createSlackNotifier` serializes per-event Block Kit data and uses the same
core queue. See the Slack guide for setup, authentication, response rules and
source links. Local verification does not establish a live Slack installation,
provider acceptance or human receipt.

`declareEgress` returns `{external, env, route}`. Append only `external` to
`seed.json.externals` and `env` entries to `seed.json.env`; `route` is consumer
wiring metadata. Declare concrete product fields and each used service, needed by the application. Signing keys stay local; provider bearer/client credentials
are sent only to their authorized service. Secret URLs and headers are resolved
per attempt and never stored in delivery logs; payloads must themselves be secret-free.
See the strict consumer example for a schema-compatible declaration and startup
`validateEgressConfiguration` call. That validation does not replace transport DNS safety.

## Verification and handover

`pnpm verify:modules` discovers `tests/integration.test.ts`, which imports every
core, Slack, helper and integration `*.test.ts` once. Do not also add nested
globs to the root command. Local suite prerequisites: AJV 8.17.1 and Miniflare
5.20260907.0-alpha as root dev dependencies. The integrator owns package/lockfile
wiring. Unit fixtures support `SLACK_TEST_AJV_MODULE` and
`INTEGRATIONS_MINIFLARE_MODULE` absolute module paths for shared local dependencies.
No suite is skipped if a dependency is missing. Run with
`PLAYWRIGHT_SKIP_BROWSER_GC=1` in the shared environment.

The new public integration tests use file-backed SQLite, restart, real loopback
HTTP, independent HMAC computation, native authority SQL and actual provider
serializers. Synthetic URLs/credentials are mapped only in test transport code.
Existing unit suites add production transport/TLS, Block Kit subset schema,
real local D1, token race/rollback and provider protocol coverage. These are
local proofs; edition adoption, live accounts and deployed egress remain separate.
Raw-body regressions reject UTF-8 replacement and BOM mutation at real Node HTTP
and Worker boundaries. The Worker test executes the documented receiver with
the portable source and actual local D1, including durable replay after restart.

## Source provenance and scope

Core, Slack, egress, and their retained fixtures/tests were recovered from
commit `5553998761ffbed21cc9c232996f560f4f9d109b`, including the
raw-byte receiver and token authority/usage fixes. The retained core additionally
snapshots retry policy before asynchronous preparation, rejects sparse policies,
preserves a signed UTF-8 BOM on send, and checks the durable claim again before
starting a request after preparation. The public composition and
consumer examples include only those units. Teams and the OpenAPI generator
are outside this delivery; their implementations and assertions are not included.
Shared tests keep the Slack, replay, transport and token assertions, with schema
and export expectations adapted to the retained modules. No existing main test
or fixture was removed.

Lily's native registry informed the same-database issuance guard
boundary: current native issuer authority and all relevant permission revisions
must still hold when the token insert commits. This reusable source owns no
application registry and does not imply that Lily has adopted it.

Adoption requires native authentication, numbered migrations, secret custody,
scheduling, operator failure visibility, declared egress and product-specific
effect checks. Local checks do not establish edition adoption or deployment.
