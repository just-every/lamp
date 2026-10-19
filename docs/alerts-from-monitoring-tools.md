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
