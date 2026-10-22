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

## See the reach of an update

Open an incident's **Communication and reach** panel to see its whole-incident
figures. Expand **Reach of each update** for the recipient set and outcomes of
each publication. Email and webhook channels show committed sends, delivered,
bounced, complained, suppressed, failed and queued records. The panel refreshes
its own reads every 15 seconds while visible, including after publication;
refreshing counts leaves the update composer and its saved draft alone.

Committed sends count delivery rows. **Distinct subscribers delivered** counts
each opaque subscriber ID once per channel across the incident's updates. A
second update to the same ten subscribers adds ten sends, not ten additional
people. Erasing a destination preserves these anonymous counts. Operator Slack
and Teams destination posts appear separately and never increase subscriber
reach.

**Provider accepted sends** records successful provider-message attempts once
per delivery, even if there were retries. An email can be accepted and still be
queued until a signed delivery receipt arrives. Webhook delivery records its
endpoint's acknowledgment. Neither channel measures reading. Imported
historical updates have unknown source delivery figures; a mixed total labels
its known records as incomplete. **Download CSV** exports the same counts and
measurement definitions.

## Review communication performance

On **Overview**, use **Communication performance** to choose the calendar month
in the page's configured timezone. The cohort contains incidents opened from
the first instant of that local month, inclusive, to the next month's first
instant, exclusive. Their later publications and current delivery outcomes stay
with that opening month. Expand an incident for its individual figures, or open
its communication panel. The CSV includes raw counts, known timing totals,
averages, timezone and measurement time.

Alert-to-first-update latency starts at the first accepted alert receipt. A
manually opened incident without one has unknown alert latency. Native updates
use their actual publication record time, including later backdated updates;
imported updates retain the source's public timeline. Resolution duration runs
from incident opening to resolution; a later native backdated resolution cannot
shorten it to before the publication actually happened.

Each native public update with a next-update deadline makes one promise. The
next actual public publication keeps it when it happens at or before that
deadline. A late successor misses it. A promise with no successor stays pending
until its deadline passes, then counts as missed. Pending promises are excluded
from the kept share. Later backdating cannot turn a missed promise into a kept
one; imported source promises are unavailable.

The delivery failure rate divides bounced, complained and failed rows by all
known committed email/webhook rows, including queued and suppressed records.
The label gives that denominator; partial import coverage remains explicit.
Reports owed uses the existing report-due policy and the incident's retained
component-derived peak impact, independently of an operator-set impact override.
The default policy counts an unpublished report as owed seven days after a
Partially unavailable or Major outage incident resolves.

## Brand notification email

In Settings → Notification email, set your sender display name, reply-to address,
subject prefix, and plain-text header and footer. The From address remains your
configured, authenticated address. You can include a postal address in the footer.
Management and unsubscribe links and the required List headers are always added.
Upload a PNG, JPEG or WebP under Brand mark and select Use the uploaded page logo
in email; the HTML part loads it from your public status host, and the text part
carries no image reference. Other image URLs are not accepted.

Changes save automatically. Open an incident's Email preview to check the name,
reply-to, subject, logo and wording. An email already submitted for delivery keeps
its original branding during retries, even if you change Settings afterwards.

Managed mail controls From and Reply-To, so those two controls are disabled and
unsupported identity changes are refused. Subject prefixes, the logo and message
wording remain available. SendGrid and Resend support all these branding settings.

## Subscriber reporting

Open **Subscribers** for current counts by channel and state. Expand **Counts by component** or **Deactivation reasons** for detail. A subscription following every component appears in each component's count, so component counts overlap. Erased destinations are excluded.

Choose a growth month and channel, then **Download CSV** to export the same figures. The month filters the growth record; current counts always describe the present. Adding or removing a subscriber refreshes the figures while keeping the report's filters.

Daily growth measures pending plus active subscriptions: a new pending subscription joins inventory, confirmation does not add it again, and deactivation or erasure leaves inventory. Dates use UTC. Tracking starts with the first subscriber change or report read, from the baseline displayed on the report; earlier daily changes are unknown. The first tracked day and the current day are incomplete. Technical backups retain this anonymous history; restoring an older archive starts a new baseline. Audience and language reporting are not yet available.
