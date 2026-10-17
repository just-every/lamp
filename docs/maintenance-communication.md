# Maintenance communication

Maintenance → Schedule maintenance saves a private, versioned draft as you type.
Preview notice shows the same plain text used by the public timeline and email.
Scheduling requires an affected audience and customer impact (250 characters each).
What still works (250) and details (500) are optional. Existing title-only windows
keep their historical messages and are not backfilled.

Write update on a window publishes Scheduled, In progress, Verifying or Completed.
In progress starts early; Verifying keeps Under maintenance claims; Completed
releases them. Published messages stay immutable. Select an earlier message in
Correct an earlier update to append its correction reference. Email, webhook and
Slack/Teams selections are fixed with the publication; all off publishes silently.

Auto-start and auto-complete default on; pagewide default settings remain unbuilt. Turn off auto-start to keep a due window
Scheduled until an operator starts it. Turn off auto-complete to keep it active
until an operator completes it, including while Verifying. A start-due operator
email is queued once for that start time, and an overrun email once for that end
time after fifteen minutes. Push alerts, management token/Statuspage write APIs,
SMS, the selectable Statuspage webhook payload format and pipeline integrations remain unbuilt.

Add `/maintenance.ics` to a calendar subscription. Events keep their UID when
rescheduled, increment SEQUENCE, use exact UTC window instants and retain cancelled
events with STATUS:CANCELLED. The feed is in the same retained snapshot generation
as the page, feeds and APIs. It never reads the application database on a public
request. Resend and SendGrid notification emails include an immutable window's
calendar attachment; cancellation mail uses METHOD:CANCEL. Managed mail's shared
relay rejects attachments and does not advertise support, so Managed mail sends
the notice without an attachment. Completing Managed calendar attachments requires
an external relay change; this implementation does not claim that provider gap is
complete. Direct provider transport support does not prove live inbox acceptance.

Page-data export includes private maintenance drafts, wording, per-window switches,
calendar sequence and immutable notices. Older signed files may omit the new draft
array; verification uses their original field set before restore defaults apply.
