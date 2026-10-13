# Durable integration core

Import portable delivery, signed webhook, token and D1 APIs from `./index.ts`.
Import Node adapters explicitly from `./sqlite.ts` and `./node-transport.ts`.
Node 26 is the tested runtime; no runtime npm dependency is needed.

The [consumer guide](../README.md) contains fresh SQLite migration, enqueue and
Worker scheduling examples. The [public contract](CONTRACT.md) defines exact
HMAC framing, retry outcomes, durable replay and same-database token authority.
The [receiver guide](../receiver.md) supplies executable Node and Fetch receiver
boundaries that verify original bytes before claiming replay identities.

Apply `schema.sql` once through the application's numbered migration ledger.
Existing installations of the earlier proposal instead apply
`upgrade-token-usage-context.sql` once. Namespaces and authority callbacks come
from native authenticated server state. Use a durable database, trusted secret
storage and a transport enforcing public destinations at connect time. Worker
consumers must supply an enforcing egress binding; ordinary fetch is insufficient.

Schedule `dispatchDue()` after restart and at future due times. Expose durable
attempts and uncertain outcomes in the native operator experience. Receiving a
signed delivery and claiming its replay ID do not complete a domain effect:
commit an inbox processed marker with the effect in the application's transaction.

Run `node --test modules/integrations/tests/integration.test.ts` from Base's root
for the retained integration suites, including local HTTP/TLS, SQLite and actual
D1 tests. These checks establish local behavior, not production delivery.
