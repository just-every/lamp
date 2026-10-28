# Incident, update and maintenance details

## References and response conventions

Incident references use `INC-` followed by digits and maintenance uses `SCH-`. Invalid required fields and missing deletion reasons use 400; stale attachment choices and review holds use 409. Public incident addresses contain the permanent reference.

## Chat authentication

Slack uses `/lamp incident` and authenticates `X-Slack-Signature` over the raw body within five minutes. Teams supplies `incident` and a message extension; its Bot Framework bearer token verifies against OpenID metadata keys with Lamp's bot app ID as audience. Drafts and previews use Adaptive Cards and `Action.Execute`.

## Link and message forms

Only bare `https://` URLs are linkified; `http:`, `javascript:` and `data:` remain text. Public anchors show the URL and carry `rel="nofollow noopener ugc"`. Email HTML links directly; text email and SMS retain bare URLs. Slack uses `<url>`, never `<url|text>`; rich-text link text equals its URL. Teams Adaptive Cards show their direct URL. Punctuation stays outside the link, while all other markup remains literal.

## Calendar and compatibility mappings

The calendar lives at `/maintenance.ics` and uses RFC 5545 UID, DTSTAMP, SEQUENCE and STATUS:CANCELLED. Empty calendars retain a valid UTC VTIMEZONE with TZID, STANDARD/DAYLIGHT, DTSTART, TZOFFSETFROM and TZOFFSETTO. Statuspage-compatible incident updates map `PATCH /v1/pages/{page_id}/incidents/{incident_id}` components statuses `major_outage`, `partial_outage`, `degraded_performance` and `operational`. Maintenance maps `incident[body]`, `incident[status]`, `scheduled_auto_in_progress`, `scheduled_auto_completed`, `scheduled_remind_prior` and `deliver_notifications`. Its webhook shape retains `{meta, page, incident}`, `scheduled_for`, `scheduled_until` and `incident_updates`.

## Replaceable product policies

The incident lead policy is `incident.update-due.v1`, initially ten minutes; escalation is `incident.escalation.v1`, initially ten minutes overdue. `update.review.v1` initially requires no second operator, and `maintenance.reminders.v1` initially sends scheduled, 24-hour, started and completed notices. These person-workflow policies do not determine agent calls: agent actions carry their server-computed RISK-POLICY classes and company policy decides each disposition.

## Timing measurement boundary

The 240-second scheduled publication and automatic maintenance transition bounds are declared promises based on one local stress observation with twenty updates and twenty starts due in one cron minute on one workerd process on a shared runner. It is not an independent-run p95 or a hosted Cron guarantee.

## Release bookkeeping

Shipping operator impact changes INCIDENT-002. Shipping atomic component choices changes COMP-006. UPDATE-013's link rendering changes UPDATE-001 and UPDATE-002; 1.10.0 records them. MAINT-009 wording changes MAINT-001, MAINT-002, MAINT-004 and MAINT-005 with new-window scope. Later channel obligations remain in SUB-013/014/015/018, NOTIFY-014 and maintenance wording, with provider proof attached to their own clauses. Controlled Slack, Teams, webhook and mail edges are fixture proof, not live tenant or mailbox acceptance; the single external 20 October Slack readback does not establish provider acceptance.
