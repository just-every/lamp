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

Use **Affected components** on the incident page to attach a public component or
detach an existing component. Internal components are excluded from the attach
list, as they are when creating an incident.

On a published incident, Lamp asks for confirmation before either change. The
confirmation names the component's resulting public status, including when
another incident, maintenance or standing claim keeps that status unchanged.
Attaching immediately publishes the component claim and queues the latest
published update for eligible subscribers who follow that component and have
not already been notified about the incident. The confirmation shows the current
number of email and webhook recipients separately; it respects the latest
update's selected channels. Pending or deactivated subscribers, internal-only
updates and retroactive incidents receive no catch-up notification. Eligibility
is checked again when attaching; subscriber changes before confirmation can
change the final recipients.

Detaching immediately releases this incident's public claim. Remaining claims
determine the component's status. It sends no email or subscriber notification;
publish a separate update when customers need an explanation. Changes to an
unpublished incident remain private and send no notifications.

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
