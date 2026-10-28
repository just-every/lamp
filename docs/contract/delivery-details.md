# Subscriber and delivery technical profiles

This file records mechanism moved from the contract. The numbered acceptance points in CONTRACT.md remain the gating outcomes.

## Email subscription doors

SUB-001 submits a standard POST without CSRF token or ambient session. A `Sec-Fetch-Site: cross-site` request returns 403. The subscriber confirmation policy extension is `subscriber.confirmation.v1`. A pending subscription expires 72 hours after creation. Tokens have at least 128 bits of entropy, identify only one subscription and travel in emailed token URLs. Token-addressed responses set `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. BASE-PUBLIC-001 supplies the cookie rule.

SUB-006 notification mail carries `List-Unsubscribe` with both `mailto:` and `https:` values, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and a visible body link. The web value accepts multipart/form-data or application/x-www-form-urlencoded with `List-Unsubscribe=One-Click`, returning 200 without redirect, cookie or further interaction. Both headers appear in DKIM's `h=` tag. The BASE-ACCESS-003 limiter is keyed per subscription token, never a mailbox provider's source IP.

## Webhook authentication and payload

SUB-009 POSTs `webhook-id`, `webhook-timestamp` and `webhook-signature`. The signature is a space-separated list of versioned HMAC-SHA256 values over `{webhook-id}.{webhook-timestamp}.{raw body}`; current and retiring secrets may overlap. Only a 2xx received within 30 seconds succeeds, and redirects fail. Lamp-format bodies carry the incident, all published updates and each attached component's previous and new states, without subscriber addresses.

A destination at `hooks.slack.com` receives Slack's message form with the same signing rule. Bare `https://` URLs are `<url>`, never `<url|text>`, with trailing punctuation outside. Rich-text link elements show the URL itself and reassemble every field unchanged. Other webhook destinations receive Lamp fields byte for byte.

## Statuspage compatibility

SUB-018 incident and maintenance bodies use `{meta, page, incident}`. `meta` contains `unsubscribe` and `documentation`; `page` contains `id`, `status_indicator` and `status_description` under PAGE-016. Incident fields are `id`, `name`, `status`, `impact`, `shortlink`, `created_at`, `updated_at`, `resolved_at`, `components`, and complete `incident_updates`; each update has `id`, `body`, `status`, `created_at`. Maintenance adds maintenance statuses, `scheduled_for`, `scheduled_until` and existing notices. MAINT-009 owns its in-window wording.

Statuses are `operational`, `degraded_performance`, `partial_outage`, `major_outage`, `under_maintenance`, mapped one to one to COMP-001. Imported Statuspage identifiers remain those source identifiers; native identifiers are stable and use the same compatible format. UPDATE-001 fields pass through UPDATE-002 with unchanged text, no generated anchor or other markup. The literal sample `See https://help.example.com/kb/123.` stays that text in `incident_updates.body`. These bodies also carry SUB-009 signatures and no subscriber address. RL-102 adds the public self-service format chooser; private creation, CSV and management keep their format choices and existing recipients' selections.

NOTIFY-017 component changes use `{meta, page, component_update, component}`. `component_update` contains `id`, `component_id`, `created_at`, `old_status`, `new_status`; `component` contains `id`, `name`, `status`, `created_at`. Lamp form uses the `component.changed` event; Statuspage form uses `component_update`.

## Slack and Teams public subscriptions

SUB-014 uses Slack OAuth v2 with only `incoming-webhook`; the visitor chooses a channel and components. `app_uninstalled`, `tokens_revoked` and `channel_is_archived` deactivate with the provider reason. SUB-015 accepts Microsoft's documented Teams Workflows hosts for “When a Teams webhook request is received,” sends a verification Adaptive Card and activates only after channel confirmation. Cards use UPDATE-002 and show bare secure-web URLs as links with that same URL visible; other schemes and markup remain literal. Official-schema fake exchanges and callbacks remain repository acceptance; actual tenant receipt is separate field proof.

## SMS consent and links

SUB-013 accepts E.164 numbers for United States/Canada unless the owner enables another country. The opt-in names the page, frequency, “Msg & data rates may apply” and HELP/STOP. YES records number, consent instant, page and exact wording. STOP, UNSUBSCRIBE, CANCEL, END and QUIT immediately deactivate with a single required carrier response; HELP names page/support. The confirmation allowance is one per number per 24 hours, messages are at most two segments and always keep a permanent update link.

SUB-021 applies unchanged to incident, maintenance and post-incident reports on all doors, audiences and languages. Every bare `https://` URL keeps its bytes, with no label, shortener, redirect or click tracking. Punctuation stays outside; `http:`, `javascript:`, `data:` and markup stay plain text. At truncation a URL is complete or absent. Twilio test-account samples include `See https://help.example.com/kb/123.` and an overlength text whose cut point crosses a URL.

NOTIFY-014 uses Twilio or Plivo with a registered 10DLC campaign or verified toll-free number. Callbacks authenticate via `X-Twilio-Signature` or Plivo V3 and record delivered/undelivered/failed. Unsigned callback refusal is 401. Neither provider gets link-shortening or click-tracking options such as Twilio `ShortenUrls`. Throughput is subscriber count divided by registered messages/second plus 60 seconds. Provider credentials and real carrier receipt are separate from fixture proof.

## Mail identity and failover

NOTIFY-008 uses `mail.sender.v1` and the configured sending address. NOTIFY-010 carries page-identifying `List-Id`, `List-Archive`, `List-Help`, plus `Auto-Submitted: auto-generated`. Later incident updates set `In-Reply-To` and `References` to the first message. Setup/deploy require a reachable DKIM public key for the selected selector and DMARC policy; aligned DKIM is sufficient without SPF at the From domain because a provider may authenticate its return-path domain.

RL-101 governs SendGrid, Mailgun, Amazon SES, Postmark and Resend. Lamp retains one durable notification identity and provider-attempt mapping. Preserve a submitted Message-ID where the provider supports it; SES assigns its own identifier. Verify each provider's documented authentication, including Postmark HTTPS Basic rather than a payload-signature claim. Safe explicit non-acceptance for five minutes, or outage before submission, permits failover. Ambiguous acceptance stays pending for reconciliation without secondary submission; a 5xx is not universal proof of rejection. Restoring the primary cannot resend accepted work. Controlled fixtures do not prove exact-once mailbox delivery.

## Notification policy and logs

`notification.events.v1` selects first, later and resolved incident updates and MAINT-005 notices; NOTIFY-017 extends it for selected component changes. NOTIFY-003 makes five retries with exponential backoff over one hour. NOTIFY-004 stores subscriber, channel, update, queued_at, outcome and outcome_at, with queued/delivered/bounced/complained/suppressed/failed outcomes and matching filtered CSV. BASE-MAIL-001 supplies truthful receipt semantics.

## Subscriber capacity and release mechanics

SUB-020 admission is 25,000 total, 2,500 webhook, 1,000 Slack/Teams combined, counting pending/active/incident subscriptions but not deactivated/deleted. Full channel responses are 409 with Atom/RSS alternatives, identical for existing/new destinations, no writes/sends. Alerts fire at 80%/100% and a full channel stays in Follow-ups until it recovers. SUB-023 dry runs use “over the subscriber limit” for refused excess rows, name channel/excess, and refuse an over-limit apply before any write. Review narrowing may omit channels, components or subscribers.

The release shipping SUB-020 records MOVE-001 as changed. NOTIFY-017's release records NOTIFY-001 as changed. NOTIFY-020's release raises `seed.json` subscriber limits only with qualified hosted runs and `estimate: false`. The scale fixture uses real Cloudflare Queues/D1, outside fake providers with 100 ms acceptance, 5,000/25,000 email, 2,500 webhook and 1,000 combined chat subscribers. A second publish starts 60 seconds after the first and has its own five-minute bound. NOTIFY-023 uses SendGrid personalizations, Mailgun batch sending, SES `SendBulkEmail` and Postmark batch, retaining each recipient's message, token and headers. NOTIFY-024 can read SES `GetSendQuota`; 25,000 at 20/second is displayed as 21 minutes before publish.

## Email branding profile

NOTIFY-019's sample is display name “Acme status,” subject prefix `[Acme status]`, configured `Reply-To`, same-public-host logo with page-name alt text and a text part without image reference. Owner plain-text footer edits never remove appended unsubscribe/management/other required links or mandatory List headers. Settings, templates, page-data restore and API overrides preserve these guarantees; a logo URL at another host is refused. An optional postal-address line is suggested for CAN-SPAM-sensitive lists.
