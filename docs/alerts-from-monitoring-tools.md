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
