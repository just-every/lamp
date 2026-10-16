# Subscribers and notifications

Visitors subscribe by email from the public page. They receive a confirmation
link and become active only after confirming. A pending address expires after
72 hours. Subscribers can manage their component selection or unsubscribe from
their emailed link.

## Process email unsubscribe requests

Use a From address whose mailbox you monitor. Some mail clients send their
unsubscribe request to that address using the notification's `mailto:` option.
Lamp does not read incoming mail. When a request arrives, open **Subscribers**,
find its destination, choose **Remove**, and confirm the removal. Process these
requests promptly; the address stays subscribed until you remove it.

The HTTPS one-click List-Unsubscribe option works automatically and needs no
operator action. Every email also includes a visible unsubscribe link.

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

An incoming webhook is a private address created by Slack or Teams for posting
messages to one channel. Slack and Teams posts need an outbound connection,
which Managed hosting does not offer yet; on Managed, the card says so and
accepts no channel. They work on Free and Assisted installations. Create it in that service first, then paste it into
Lamp. You need permission to add an app or workflow in the destination workspace.

### Create a Slack webhook

1. Open [Slack's app dashboard](https://api.slack.com/apps) and create an app for
   your workspace (or select an existing app).
2. In the app's **Incoming Webhooks** settings, turn on **Activate Incoming Webhooks**.
3. Choose **Add New Webhook to Workspace**, select the destination channel and
   authorize it. For a private channel, you must already be a member.
4. Copy the resulting webhook URL. See [Slack's complete incoming-webhook guide](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)
   if your workspace requires an administrator's app approval.

### Create a Microsoft Teams webhook

1. In Teams, open **Workflows** and choose the **Send webhook alerts to a channel**
   template. Select the destination team and channel, then save it.
2. In the workflow's **When a Teams webhook request is received** trigger, set
   **Who can trigger the flow?** to **Anyone**. Lamp posts using the private URL;
   it does not provide Microsoft user authentication for tenant-only triggers.
3. Copy the webhook URL from the saved workflow's details. Keep the workflow
   active and assign a co-owner so it keeps working when its creator leaves.

See [Microsoft's template instructions](https://support.microsoft.com/en-gb/workflows/send-messages-in-teams-using-incoming-webhooks?nochrome=true)
and [trigger authentication options](https://learn.microsoft.com/connectors/teams/).
Use Workflows for new connections; Microsoft is retiring the older connector
setup. If Workflows is unavailable, ask the Teams administrator to enable it.

### Save the channel in Lamp and check a post

In **Settings → Team channels**, choose Slack or Microsoft Teams, enter a name
and paste that service's incoming webhook URL. Select the components it follows.
Leave every component unchecked to follow all visible components. The URL is encrypted and is not shown again after you
save it. Select **Slack and Teams** when publishing an update to post to the
matching channels.

Saving checks the address format and supported provider host; it sends
nothing. To check the connection, choose **Send test post** beside the saved
channel. Success: Lamp says the service accepted it, and a "Test post from
Lamp" message appears in that channel. The test is not an incident update and
is not recorded in **Recent posts**. Published updates appear there with the
service's response, which shows the post was accepted, not that someone read it.
If posting fails, check the copied URL, app/workflow permissions and workflow
status. For Teams, also check the **Anyone** trigger setting. Recreate the
webhook and remove/re-add the channel if its private URL was revoked or exposed.

Use the delivery log to review queued, delivered, bounced, complained,
suppressed or failed notifications and filter by channel, outcome or update.

For email, queued can mean the provider has already accepted the message. The
provider-accepted timestamp records that API response; it does not prove recipient
delivery. Without signed receipts configured, **Accepted by SendGrid** (or **Accepted by
Resend**) is the final email status shown for a successful send. The persisted
transport outcome remains queued; CSV includes the provider-accepted timestamp.
SendGrid receipts use `SENDGRID_WEBHOOK_PUBLIC_KEY` or the optional signed relay;
Resend uses `RESEND_WEBHOOK_SECRET`. Configure the selected provider's verification key
and signed webhook in [Owner inputs](../OPERATIONS.md#owner-inputs) to receive
delivered, bounced or complained updates. Delivered records the provider's
delivery report, never an open or proof that a person read the message.
