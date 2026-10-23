# Alerts from monitoring tools

Open **Alerts** and add a source for Datadog, UptimeRobot, Better Stack or
Pingdom. Choose the matching preset, map it to one component, and create the
source. Lamp displays its endpoint instructions and token once; copy them into
the monitoring tool while the confirmation is visible.

An accepted firing alert creates or updates a draft incident on the mapped
component. It does not change the public page. Review the draft and publish a
customer update when you are ready. A recovery closes the matching draft only
when the incident has never been published; a published incident keeps its
lifecycle.

Presets read each tool's documented alert payload and use a deduplication key
to keep repeated alerts on the same unresolved incident. Configure the tool to
send the displayed endpoint credential as instructed on the source card.

## Prometheus Alertmanager and Grafana Alerting

Use **Connect Alertmanager or Grafana** for tools that send alerts in groups.
Choose the tool, name the connection, and add one row per component with the
labels that identify it, such as `service="api", region="us-east"`. Every label
in a row must match exactly; any matching row attaches its component. Create the
source and copy the bearer token while it is shown: it is displayed once.

In Alertmanager, add a webhook receiver (version 4 payloads) with that URL and
`Authorization: Bearer <token>`. In Grafana, create a Webhook contact point
(version 1 payloads) with the URL and an Authorization header with scheme
`Bearer` and the token as credentials.

Each alert group becomes one private draft incident, even when it affects
several components; repeats of the same alert update it instead of opening
another. Alerts that no row matches are listed under Receipts. The draft closes
by itself only when every alert in the group has recovered and nothing was
published. Nothing reaches your public page until you publish an update.

## Uptime

In **Alerts → Connect Uptime**, enter the signing secret from Uptime's JSON
webhook destination. Map each Uptime monitor ID to a Lamp component and save.
Paste the displayed endpoint into that destination, keep its default JSON body
and signing enabled. Lamp verifies `X-Lamp-Timestamp` and `X-Lamp-Signature`
(HMAC-SHA256 over `timestamp.body`, unpadded base64url) within five minutes.
The default schema-2 confirmed firing and recovery events are supported;
custom body templates are not the Uptime preset format.

Unmapped monitors and inconsistent transitions appear as rejected receipts.
Accepted evidence stays in the private incident brief, including supplied
vantages, error category and confirmed failure time. Older envelopes without
that optional context say it was not supplied. Edit the saved connection's
mappings in Connect Uptime; a blank secret keeps the existing secret.
The preset never changes the public page without operator publication.


## PagerDuty

Open **Alerts → Connect PagerDuty** at `/app/alerts`. First save the source
and its component mappings with the signing secret blank. The saved source
card provides its endpoint. Until you save the subscription's signing secret,
Lamp refuses every inbound event; the source is not yet connected for webhooks.

Copy that endpoint into a new
[v3 webhook subscription in PagerDuty](https://docs.pagerduty.com/integrations/webhooks#add-a-v3-webhook-subscription-on-the-generic-webhooks-page),
subscribing to `incident.triggered`, `incident.acknowledged`,
`incident.escalated` and `incident.resolved`. Copy the generated signing
secret from PagerDuty, edit the Lamp source, paste the secret and save.
The source card then shows the webhook connection as connected. Keep signing
and the default v3 body enabled.

Add a mapping row for each component using the PagerDuty service ID
(`service_id`), service name (`service_name`), or both. Values must match
exactly, including case. When both fields are supplied, both must match;
every matching row attaches its component to the same private draft. Edit a
saved connection to change mappings. Once a secret is saved, leaving the signing secret blank while editing keeps
that saved secret.

Lamp follows [PagerDuty's signature verification](https://docs.pagerduty.com/developer/verifying-webhook-signatures):
it verifies HMAC-SHA256 hex over the exact raw request body, accepting any
matching comma-separated `v1` signature through constant-time comparison.
An invalid signature returns 401 and records nothing. Signed unsupported
or unmapped events appear in Receipts. Triggered events create private drafts;
acknowledgments and escalations add their event times to the incident brief
and its cited report timeline. Repeated events remain linked to the same
incident. Resolution records recovery and closes a draft only if nothing has
been published. Published incidents still need an operator's resolution update.

To post what customers were told back to responders, connect a PagerDuty REST
API key that can create incident notes. **PagerDuty user email** is optional
in Lamp: it defaults to the Lamp source owner's email. That address must be a
valid user in the PagerDuty account because the
[create-note API requires a `From` header](https://docs.pagerduty.com/developer/api/reference/rest/incidents/create-incident-note).
The key and email are encrypted with AES-GCM, stay hidden after saving, and
are preserved when the API key field is left blank while editing.

With a connected key, each publication makes at most one note request per
linked PagerDuty incident containing the published text and permalink. The
only destination is `https://api.pagerduty.com/incidents/:id/notes`, and Lamp
refuses redirects. Note failures appear in the source's Receipts and never
block publication. With no key, no request is sent and signed inbound events
still work. Archives exclude the sealed note credential; after restore the
source shows **Reconnect required** until you supply a replacement key.
**Erase source** permanently removes the source's saved credentials and
receipts. Local test receipts establish the protocol behavior; connecting
and checking a real PagerDuty account is installation acceptance.

## Jira Service Management Operations and Opsgenie

In Alerts, open **Connect JSM and Opsgenie**. The owner chooses the tool, names
the source and adds exact tag or entity matchers for its components. A tag such as
`component:api` matches one item in `alert.tags`; entity matches `alert.entity`.
Every matching component is attached. Both fields in one rule must match; separate
rules can attach several components. Unmapped alerts appear against their source.
JSM affected-service mapping is not available: the documented outgoing Webhook
shape does not define its field. Provider responder roles are also not supplied;
briefs explicitly show receipt time and the supplied responder or escalation target.

Create the endpoint and copy the generated token once, or enter your own token.
In the provider's outgoing Webhook integration, select Create, Acknowledge,
AddNote, Escalate and Close. Use the endpoint with the custom header
`Authorization: Bearer <token>`. Tokens in URLs are refused for these presets.
JSM's outgoing Webhook integration requires its Premium or Enterprise plan.

Create creates or updates a private draft; it never publishes or claims component
state. Acknowledge and Escalate enter the brief and its cited report timeline.
AddNote enters Internal notes only: it is excluded from alert payload storage,
briefs, model prompts and public pages. Close records recovery and only resolves a
draft that has never been published. Automatic rules remain AUTO-001's carrier.

Outbound notes are optional. Select **Connect JSM outbound notes** and provide the
HTTPS Atlassian site (`https://name.atlassian.net`), account email and API token,
or connect an Opsgenie API key and choose the US or EU API region. Saving these
credentials makes no provider request. Credentials are sealed, never displayed,
and excluded from both archive formats. After restore, the card says **Reconnect
required**; supply the credentials again. Erase source removes the connection,
credentials and intake/outbound receipts while keeping operator publications.

JSM resolves its site's cloud ID through `/_edge/tenant_info`, without sending the
credential there, then uses HTTP Basic authentication at the fixed
`api.atlassian.com/jsm/ops/api/{cloudId}/v1/alerts/{id}/notes` endpoint. Opsgenie uses
`Authorization: GenieKey` at `api.opsgenie.com` or `api.eu.opsgenie.com`, under
`/v2/alerts/{id}/notes`. A publication sends exactly one note containing its public
text and permalink. Enable **Close alert on resolve** to send one additional
`POST .../alerts/{id}/close` on the operator's Resolved publication. JSM's close
has no body; Opsgenie's close sends an empty JSON object. Redirects are refused.
Failures appear in source receipts and never block publication; requests are
claimed once, without retrying ambiguous provider outcomes.

These connections are proven against recorded-form documentation fixtures and
fake provider API edges. No live provider account acceptance is claimed.
