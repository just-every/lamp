# SendGrid email transport

Explicit optional cross-family transport for native sign-in and outbound mail.
Support Lily and Beacon select it for operator sign-in and outbound replies;
Sales Ferry and Orbit select it for native authentication mail. The family
composition descriptors select this Base module and copy its editable source;
no family depends on another family at runtime. Each edition owns its auth and
durable mail workflow, including the treatment of ambiguous submission results.
The installer copies `src/` to `src/modules/sendgrid-email/`. Edition adapters
select SendGrid through configuration and map results into their durable send
workflow; missing credentials fail visibly. No provider fallback is performed.

`sendSendGrid` submits one authenticated request to the global SendGrid v3 Mail
Send endpoint. Redirects are refused so mail and credentials stay at the declared
endpoint; a redirect response is ambiguous and requires reconciliation before
resubmission. HTTP 202 reports `accepted`, never `delivered`. It retains a usable
`X-Message-Id` as `providerMessageId`; a missing or malformed receipt is explicitly
`null`, without erasing HTTP acceptance or manufacturing remote evidence. `custom_args.rer_delivery_id` carries the
local durable command identity for correlation; it is not an idempotency key.
The declared API does not offer a duplicate-suppression key, so a lost response,
HTTP 408, server error, or unexpected non-202 status is ambiguous and must be reconciled before
another submission. The module performs no retries. Rate limiting and definite
client rejection are separate errors. Provider response bodies and API keys are
never included in errors.

Callers provide a verified sender, recipient snapshots, body, optional reply
address/thread headers and base64 attachments. Open, click and Google Analytics tracking are off so
authentication and message links are not rewritten by the transport.

This module does not implement SendGrid inbound parsing or delivery webhooks.
Support uses Lily's public intake and Beacon's widget for incoming messages.
Resend inbound email remains separately configurable where selected. Verified
SendGrid delivery evidence would require an explicitly configured signed Event
Webhook, its public key, raw-payload signature verification, durable event
deduplication and recipient-scoped reconciliation. An accepted receipt alone is
not evidence of delivery.

Official provider references checked 14 September 2026:

- [Mail Send API](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send)
- [X-Message-ID receipt](https://www.twilio.com/docs/sendgrid/glossary/x-message-id)
- [Event Webhook signature verification](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features)

Run `pnpm verify:modules` from the Base repository. The source and protocol tests
originated in Support and now incorporate Lamp outcome and transport cases; family assembly copies the
module tests into each selected edition for its composition verification.
Tests inject a provider HTTP response only within the test suite; production uses
the actual fetch transport. Live sending requires the owner's intended recipient.

Optional `message.asmGroupId` selects a positive SendGrid suppression group ID.
`message.subscriptionTracking` explicitly enables/disables the provider's
unsubscribe footer/header feature without enabling open or click tracking; omit
both for existing behavior. This can change the delivered body and requires the
edition's acceptance of the provider footer. Confirm delivered List-Unsubscribe,
List-Unsubscribe-Post and DKIM header coverage with real mail; configuration alone
is not one-click acceptance. [Provider header behavior](https://www.twilio.com/docs/sendgrid/ui/sending-email/list-unsubscribe).

`message.customArgs` can carry `rer_product` for the optional shared event relay.
Values must be strings within the provider's 10KB total limit; reserved event and
`rer_delivery_id` fields cannot be replaced. The edition owns its fixed product
marker, suppression group and signed event reconciliation.

Lamp also selects this source and owns its durable claim ledger and signed event
reconciliation. `serializeSendGridMessage` exposes the validated wire bytes for
claim hashing; it makes no request. Lamp retains existing legacy fingerprints
only for prior-data compatibility and stores actual HTTP receipts separately from
its historical local `providerMessageId` callback identity. Source adoption does
not change provider acceptance into recipient delivery.

HTTP 408 is not specified by the Mail Send endpoint documentation. Treating it,
5xx and redirects as ambiguous is our conservative at-most-once policy because we
lack proof that another submission cannot duplicate mail. Only explicit 429
rejection is classified as rate limited; other 4xx responses are definite
rejections. This transport neither retries nor chooses a product's retry policy.

Consumers upgrading from the former string-only receipt must allow null receipt
storage after acceptance. Keep durable command correlation in `rer_delivery_id`
and product-specific custom arguments for signed-event reconciliation. Do not
replace a missing remote receipt with that local identity. Existing source pins
and legacy family outputs remain unchanged until their adapters and tests adopt
the new result contract.
