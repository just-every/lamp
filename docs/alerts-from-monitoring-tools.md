# Alerts from monitoring tools

Open **Alerts** and choose a tool under **Connect a tool**: Uptime, PagerDuty,
Datadog, UptimeRobot, Better Stack, Pingdom, Alertmanager, Grafana, or
**Another tool** for any tool that posts JSON. Only that tool's form opens. It
asks only for what the tool needs, and Lamp makes the key the tool posts with.
The key is part of the address Lamp shows once: copy it into the tool before you
close the form. A connected tool then shows as one row with its state, **Edit**
and **Remove**. Edits save as you make them. A key or secret changes only through
its own button. **Remove** asks once; the tool's address stops working and its
alert log is erased, while its drafts stay.

**Recent alerts** appears once something has arrived. It lists what each tool
sent, accepted or refused with the reason. Payloads and keys are never shown.

An accepted firing alert creates or updates a draft incident. It does not change
the public page. Review the draft and publish a customer update when you are
ready. A recovery closes the matching draft only when the incident has never
been published; a published incident keeps its lifecycle.

## Datadog, UptimeRobot, Better Stack and Pingdom

Choose the component the tool's alerts belong to and connect. Lamp shows the
address, with its key, and for Datadog and UptimeRobot the body to paste. Each
preset reads its tool's documented alert payload and uses a deduplication key to
keep repeated alerts on the same unresolved incident.

## Prometheus Alertmanager and Grafana Alerting

Add one row per component with the labels that identify it, such as
`service="api", region="us-east"`. Every label in a row must match exactly; any
matching row attaches its component. Connect, then use the address Lamp shows:
in Alertmanager as a `webhook_configs` url with `send_resolved: true` (version 4
payloads), in Grafana as a Webhook contact point with its default payload
(version 1). The key in the address replaces an Authorization header; a
`Bearer` token header is also accepted.

Each alert group becomes one private draft incident, even when it affects
several components; repeats of the same alert update it instead of opening
another. Alerts that no row matches are refused and listed under Recent alerts.
The draft closes by itself only when every alert in the group has recovered and
nothing was published.

## Uptime

Choose **Uptime** and **Make the Uptime address**; there is nothing to type. In
Uptime's Notifications, add a Webhook with that address and keep its default
signed JSON. Uptime's own signing secret is not needed in Lamp: the address
carries a key Lamp made, which Uptime stores with its other destination
credentials. Lamp refuses a request without that key, or whose
`X-Lamp-Timestamp` is missing or more than five minutes off, with 401.

Uptime names each monitor in its events. The first alert from a monitor is
refused as not picked yet, and the monitor appears in the Uptime form by name.
Pick the component it feeds; from then on its confirmed failures open private
drafts on that component and its recoveries close drafts that were never
published. Leave a monitor on **Not on your page** to keep its alerts out.
Uptime's **Send test** reaches Lamp and is listed, but only alerts open drafts.
Accepted evidence stays in the private incident brief, including supplied
vantages, error category and confirmed failure time. Older envelopes without
that optional context say it was not supplied.

A connection made before Uptime paired by picking keeps its HMAC signing secret,
verified over `timestamp.body` (unpadded base64url) with the same five-minute
window, and its monitors keep their mappings.

## PagerDuty

Choose **PagerDuty**, add a row for each component with the PagerDuty service
name, ID, or both, and connect. Values must match exactly, including case; when
both are given, both must match, and every matching row attaches its component.
Lamp then shows the address. In PagerDuty, add a
[v3 webhook subscription](https://docs.pagerduty.com/integrations/webhooks#add-a-v3-webhook-subscription-on-the-generic-webhooks-page)
with that address for `incident.triggered`, `incident.acknowledged`,
`incident.escalated` and `incident.resolved`. PagerDuty makes the signing
secret: paste it into **PagerDuty signing secret** and choose **Save secret**.
Until then Lamp refuses every inbound event.

Lamp follows [PagerDuty's signature verification](https://docs.pagerduty.com/developer/verifying-webhook-signatures):
it verifies HMAC-SHA256 hex over the exact raw request body, accepting any
matching comma-separated `v1` signature through constant-time comparison.
An invalid signature returns 401 and records nothing. Signed unsupported
or unmapped events appear in Recent alerts. Triggered events create private
drafts; acknowledgments and escalations add their event times to the incident
brief and its cited report timeline. Repeated events remain linked to the same
incident. Resolution records recovery and closes a draft only if nothing has
been published. Published incidents still need an operator's resolution update.

To post what customers were told back to responders, open **Send your updates
back to PagerDuty** and save a REST API key that can create incident notes.
**PagerDuty user email** is optional: it defaults to the Lamp source owner's
email. That address must be a valid user in the PagerDuty account because the
[create-note API requires a `From` header](https://docs.pagerduty.com/developer/api/reference/rest/incidents/create-incident-note).
The key and email are encrypted with AES-GCM and stay hidden after saving.

With a connected key, each publication makes at most one note request per
linked PagerDuty incident containing the published text and permalink. The
only destination is `https://api.pagerduty.com/incidents/:id/notes`, and Lamp
refuses redirects. Note failures appear in Recent alerts and never block
publication. With no key, no request is sent and signed inbound events still
work. Archives exclude the sealed note credential; after restore the row says
**Notes need a new key** until you save a replacement. Local test receipts
establish the protocol behavior; connecting and checking a real PagerDuty
account is installation acceptance.

## Another tool

Name the tool and choose how it proves itself: a token Lamp makes, sent as
`Authorization: Bearer <token>`, or an HMAC signature. For a signature, paste
the tool's own signing secret, or leave it empty and Lamp makes one. Lamp
checks the HMAC-SHA256 of `timestamp.body` in the signature header (unpadded
base64url) and an ISO time in the timestamp header, within five minutes. **Payload fields** names, as JSON paths, the
deduplication key, title and state, and the state value that means recovered;
Lamp's own alert shape fills them by default. A request whose payload lacks the
deduplication path returns 400 and is listed under Recent alerts.

## Public performance charts

In a component's settings, use **Public performance metrics** to add a management-API
series or a Prometheus query, or choose a connected Datadog, New Relic or Pingdom
preset or a paired Uptime monitor. Connect those presets in Alerts first, then
choose them in the component's metric feed list. A page can show ten metrics in
total.

Give each chart a public name and unit. For a pull feed, save a read-only key with
**Save read-only key**. Datadog also needs an application key scoped to metric
queries. New Relic takes an account ID and a query such as
`SELECT average(duration) AS value FROM Transaction`; Lamp supplies the time range
and minute interval. Pingdom takes its numeric check ID and reports milliseconds.
Prometheus takes a public HTTPS endpoint and one numeric range-query series.
Provider redirects and private destinations are refused. Keys are sealed, never
shown again, and excluded from backups; reconnect them after a restore.

New Relic's workflow template includes `entityNames` from the documented
[`entitiesData.names` workflow variable](https://docs.newrelic.com/docs/alerts/get-notified/custom-variables-alert-event-workflows/).
Its **Entity names** choice maps the listed names to the source's selected
component. Leave it empty to attach all workflow issues to that component.

A pushed series uses the displayed `/api/app/metrics/<id>/points` address with an
operator session and the same-origin protections as the operator management API.
Token authentication remains API-001's obligation. POST
`{"points":[{"at":1792800000000,"value":42}]}` with `at` at the start of a UTC
minute in epoch milliseconds. Each value is that minute's aggregate, and replacing
a minute is idempotent. Only the last day's minute aggregates are accepted.

Lamp keeps minute aggregates for one day, hourly aggregates for thirty days and
daily aggregates for ninety days. Charts are inline SVG and readable without
script. Missing minutes split the line; a stopped source states when it last
reported. Uptime contributes only response times its verified events actually
carry, never inferred samples between incidents.
