# Incidents and updates

Open **Incidents** and choose **Create incident** if the draft form is not
already open. Enter the title and attach at least one component, then choose
**Create incident draft**. In the composer, write a public update for the people
affected. Lamp keeps each published
update on the incident timeline; a correction is a new update that names the
one it corrects.

## Compose and publish

The update asks who is affected and what the impact is. You can add what still
works and details. For an active incident, set the next-update time as your
communication commitment. A resolved update has no next-update promise.

Review the preview before publishing. It shows the public page and email
renderings. An unpublished draft stays private. A future scheduled update also
stays private until its scheduled publication time. Each published update sets
the incident lifecycle: Investigating, Identified, Monitoring or Resolved.

To reopen an incident resolved in error, publish an update that sets it to
Investigating. The resolution and reopening updates both remain in history. You
can also create a retroactive incident with updates dated in the past; its
component history uses those times and subscribers are not notified about those
retroactive updates.

## Change affected components

Use **Component states with this update** in the composer. Each attached
component shows this incident's current claim and the state the next update will
set. Choose **Attach with this update** to include another public component,
with its state and Primary or Dependent relationship. Internal components stay
out of that picker.

Saving keeps these choices private in the versioned draft. Preview shows the
changes; review and scheduling retain them. Publishing commits the wording and
states together, so Major outage can step directly to Degraded performance.
Other incidents, standing claims and maintenance still determine the resulting
public state. A conflicting attachment change requires a fresh review.

Choose **Release … with this update** or Operational to stop claiming an outage
while retaining the attachment and its subscribers. Resolved releases every
claim. Customers receive one notification per selected channel, containing the
wording and the component changes.

## Wording and links

Settings lets the owner list terms to flag and choose a preferred field length.
The composer also flags resolution-time promises, internal hosts, IP addresses
and email addresses. Each finding appears beside its field and can be dismissed.
These checks never block publishing.

A bare HTTPS URL becomes a link with the URL itself as its label. Trailing
punctuation stays outside the link. HTML, Markdown and other URL schemes remain
literal text. Email HTML links directly to the URL; its text part and generic
webhook bodies retain the original wording. Slack and Teams posts also include
the help links and every populated field.

## Use the brief and suggestions

The incident page shows a brief of accepted alerts, published updates, attached
public components and their claimed states, plus open questions from the saved
incident. The brief is built without a model. Expand its disclosure to see the
exact information a suggestion request would send.

When an AI provider is configured, choose **Suggest update** in the composer.
That action fills only text fields, cites the brief items it uses, leaves your
text in a field when the suggestion has no text for it, and never publishes.
Review every filled field before publishing. Open questions are not valid
sources. Internal notes and internal components are excluded. Lifecycle and
next-update time remain your decision. Without a configured provider, the
suggestion control is absent and Lamp makes no AI request. A failed or
unanswered request shows an error; other publishing paths remain available.

## Track due updates and reports

Overview and the incident list mark an update due beginning 10 minutes before
its committed time. The scheduled trigger sends one due email to active
operators and, if no newer update has replaced that commitment by its time, one
overdue operator email. These are operator alerts, not subscriber notifications.
A newer update or resolution ends the prior commitment. The
public page shows the committed time without a due or overdue label.

After resolving an incident, attach its post-incident report from the incident
page. The report holds a summary, timeline, cause and remediation. The operator
app marks a report as due 7 days after resolution when the incident reached
Partially unavailable or Major outage and has no report.

## Choose public incident impact

The **Incident impact** card shows the impact derived from component claims and
the public impact. Choose None, Minor, Major or Critical and **Save impact** to
set a separate public description. Choose **Use component claims** to clear it.
Each choice appears in Impact history with the operator and time. Component
states, overall status and uptime continue to follow claims. The incident
header's peak component state records the most severe claim during its history.

## Edit and apply update templates

Expand **Update templates** in the composer and choose a saved template. An
imported template shows its original title, folder and notification default.
Edit its wording and save that same template before applying. Oversized imported
wording is kept in full; the editor names every field to shorten and blocks
application until the saved text fits. Applying fills only the private draft and
stages its component choices; it keeps the incident's title and publishes nothing.
If the template has no next-update interval, choose the commitment yourself.
A **No notifications** default clears subscriber channels; check the selection
before publication.
