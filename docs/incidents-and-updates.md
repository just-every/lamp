# Incidents and updates

Open **Incidents** and choose **New incident** (an empty list opens it for you).
One screen asks what is happening (a title and the impact), who is affected (the
components and the people), and when the next update is; **Publish** creates the
incident and publishes its first update together. Lamp keeps each published
update on the incident timeline; a correction is a new update that names the
one it corrects.

## Compose and publish

Each update asks what is happening and who is affected. For an active incident,
set the next-update time as your communication commitment: 15 min, 30 min,
1 hour or 2 hours fill the time field, or type a time. A resolved update has no
next-update promise.

**More options** holds the rest: the status a new incident starts with, what
still works, details, the opening time of an earlier incident, which subscriber
channels to notify, scheduling or backdating the update, Primary or Dependent
relationships, templates, and **Save as private draft** for an incident you are
not ready to publish. The note beside Publish says who it notifies.

Review the preview before publishing; **Page** and **Email** show both
renderings. An unpublished draft stays private. A future scheduled update also
stays private until its scheduled publication time. Each published update sets
the incident lifecycle: Investigating, Identified, Monitoring or Resolved; on an
open incident, choose it above the fields. Delivery figures appear once
something was sent. Internal notes, review, corrections, the public impact and
deletion are under **Private actions** at the end of the incident page.

To reopen an incident resolved in error, publish an update that sets it to
Investigating. The resolution and reopening updates both remain in history. You
can also create a retroactive incident with updates dated in the past; its
component history uses those times and subscribers are not notified about those
retroactive updates.

## Change affected components

Each attached component is a chip under **Who's affected?** showing the state
the next update will set; change it in the chip. Choose **+ Add component** to
include another public component; set Primary or Dependent under More options.
Internal components stay out of that picker.

Saving keeps these choices private in the versioned draft. Preview shows the
changes; review and scheduling retain them. Publishing commits the wording and
states together, so Major outage can step directly to Degraded performance.
Other incidents, standing claims and maintenance still determine the resulting
public state. A conflicting attachment change requires a fresh review.

Choose Operational in a chip to stop claiming an outage while retaining the
attachment and its subscribers. Resolved releases every
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
incident; it is one line until you open it, and open from the start when alerts
brought facts. The brief is built without a model. Expand its disclosure to see
the exact information a suggestion request would send.

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
