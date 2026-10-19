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
