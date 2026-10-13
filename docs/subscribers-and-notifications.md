# Subscribers and notifications

Visitors subscribe by email from the public page. They receive a confirmation
link and become active only after confirming. A pending address expires after
72 hours. Subscribers can manage their component selection or unsubscribe from
their emailed link.

## Choose what each subscriber follows

Subscribers can follow selected components. A subscription that has never been
narrowed follows every visible component, including components added later.
During update composition, choose which available channels receive that update;
the public page, Atom feed and widget always receive it.

Subscription requests are limited to 5 per minute from a requester network
address. Separately, one email address receives at most one confirmation message
in 24 hours.

## Add webhooks or team channels

Add a webhook endpoint with a contact email. Each notification is signed and
contains the incident, its published updates and the affected component state
changes. The delivery log records outcomes; it does not track opens.

In **Settings**, add a Slack incoming webhook or Microsoft Teams channel webhook
and select the components it follows. Leave every component unchecked to follow
all visible components. The URL is encrypted and is not shown again after you
save it. Select **Slack and Teams** when publishing an update to post to the
matching channels.

Use the delivery log to review queued, delivered, bounced, complained,
suppressed or failed notifications and filter by channel, outcome or update.
