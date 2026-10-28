# Native development ingress

`rer dev` keeps the local request boundary and silently suppresses mail.

Cloudflare's Vite plugin adds `X-Forwarded-Host` when it converts each Node
request into a Worker request. That field alone cannot prove whether a client
supplied it. Lamp therefore checks provenance before normalizing it:

1. A Vite plugin observes the native HTTP server's requests. Its first Connect
   middleware checks the original raw headers, socket addresses, authority,
   origin and target. It rejects forwarding/internal headers, duplicates of
   security-relevant headers, nonlocal sockets and noncanonical local authority.
   Native Vite's own middleware and Cloudflare Worker runtime remain in place.
2. Accepted ingress receives an ephemeral HMAC covering its method, complete
   URL, original Host, Origin, fetch-site context, issue time and random nonce.
   Cloudflare then performs its normal request conversion.
3. The actual Worker entry verifies and consumes that proof. Only then can it
   remove Cloudflare's matching `X-Forwarded-Host` and the private proof header.
   The local request checks run on the resulting Request before
   host dispatch or Start rendering.

SUB-005 requires `Referrer-Policy: no-referrer` on subscriber token documents;
their native HTML forms can therefore submit `Origin: null`. Both gates admit
that literal origin only for `POST` with exactly `Sec-Fetch-Site: same-origin`
to `/manage/<token>` or `/unsubscribe/<token>`. The path must have one nonempty
unreserved token segment, excluding dot segments, escaping and extra segments;
ingress checks the original target before URL normalization. Other origins retain
their existing checks. Missing or different fetch metadata cannot use this
exception, including `none`, `same-site` and `cross-site`. No outbox, sign-in,
setup, API, asset or emulator endpoint receives it.

The original Origin and fetch metadata remain in the signed proof and verified
Request. Browser-controlled Fetch Metadata identifies the browser initiator; it
is not authentication against local programs. Subscriber scope, signature,
expiry and revocation remain the native service's authority. RFC 8058 clients
without Origin retain their existing route behavior. Token responses remain
no-referrer, no-store and cookieless.

The key exists only in a Node closure and an SSR-only virtual module. It is not
a Vite define, environment variable, Worker binding, file, R2 object or config
value. The virtual module rejects client-environment loads and has no source
map content. Responses and assets never receive proof headers. A server restart
rotates the key; proofs are single-use and expire after five minutes. The Worker
holds at most 10,000 consumed nonces and fails closed if that bound is reached.
Local development disables the emulator inspector, storage explorer and
observability trace recorder. Browser requests to private emulator control paths
and module-runner headers are rejected at ingress. WebSocket upgrades pass only
to the native local Vite HMR endpoint, retaining Vite's own token check.
The actual persistence directory is denied to Vite file serving and ignored by
its watcher, including when the developer selects a custom directory.

The native Cloudflare ASSETS service can re-enter Connect internally. These
requests did not arrive on the Vite listening socket and are not stamped again;
the native plugin still owns their routing. An external request cannot claim
that status using a header. A copied proof or a matching forwarding header does
not pass either ingress or the Worker verifier.

The plugin and virtual import exist only in `vite serve`, excluding preview.
Production compilation removes the entire Worker hook and cannot enable capture
using runtime bindings or flags. Sessions and subscriber confirmation continue through the native app.

Focused checks:

```
pnpm run test:ownership
pnpm run test:runtime
```
