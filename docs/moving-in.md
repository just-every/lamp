# Move in from a hosted status page

Lamp reads your page's components, component groups, incident history with every
update, scheduled maintenance and email subscribers from Statuspage, Better Stack or Instatus's API.
**Synthetic-only validation:** fixture families are written from each provider's published API reference; no real account export has been supplied.

## Steps

1. Sign in and open **Settings → Move in** (`/app/move-in`).
2. Choose the source first. For Statuspage, either enter your Statuspage **page ID** and **API key** (Statuspage: avatar menu →
   API info), or choose saved API responses. The key is sent only in GET requests to
   `https://api.statuspage.io`, used for that one dry run and never stored.
3. Read the **dry run**. Nothing is written yet. It counts every record as imported,
   changed, skipped or refused and gives each reason; you can download the responses
   it read and import those later instead of using the key again.
4. Confirm and **Import**. Large pages import in batches: choose **Continue** until
   the import is done. This sends no mail.
5. Open **Settings → Cutover** (`/app/cutover`) and read the first 25 old addresses,
   reader gaps and eligible invitation count. The dry run also links to this preview;
   its destinations are proposed until imported. Saved imports show surviving records.
6. Choose **Send invitations** explicitly. Repeat for any remaining eligible batch.
7. Point your hostname using [the custom-domain guide](../OPERATIONS.md#your-own-domain),
   or keep the default deployment address; select that address in Cutover.
8. Recheck each old link from your browser after switching. Keep the old page available
   through the confirmation deadline, and update source-owned links and other readers.

Saved responses are the unchanged JSON arrays the API returns, one file per page:
`components.json`, `component-groups.json`, `incidents.json`,
`incidents-scheduled.json` and `subscribers.json`, with later pages as
`incidents-2.json` and so on (`GET /v1/pages/{page_id}/<resource>?page=N`).

## What carries over

| Source | Lamp |
| --- | --- |
| Component groups | Groups, in their order |
| Components | Components with name, description and order; group containers become groups |
| Incidents and their updates | Incidents at their original times, every update kept; component states and uptime history come from those times |
| Scheduled maintenance | Maintenance windows; a window already over is imported as completed |
| Email subscribers | Pending subscribers, eligible for one owner-triggered invitation |
| Post-mortems, templates, SMS, Slack, Teams and webhook subscribers, "only show if degraded" | Not carried; each is named in the dry run |

An imported page notifies nobody about its history: no incident or maintenance
notice is sent or published. Dry runs, apply, resume, job reads and browser checks
send no email. Only **Send invitations** does. An invitation names your page and
asks for confirmation by the original deadline: **72 hours from the import review
time**, stored as the subscriber's creation time. Sending later leaves only the
remaining time; it never changes the imported row or its undo journal. Expired
subscriptions cannot be invited and their unconfirmed addresses are deleted by
the expiry job (SUB-003). Cutover shows eligible, claimed and expired pending counts.

Each invitation is claimed before the transport call. Repeated or concurrent sends
cannot send it twice; an interrupted or uncertain claimed send is not automatically
retried. A transport acceptance or local outbox capture does not prove inbox delivery.

## Again, and undo

Importing the same source again changes nothing. **Undo** (under Your imports)
removes everything the import created that nobody changed since; a record you
edited, a subscriber who confirmed and anything they still need stay, and are
named. Undo sends nothing.

## Bookmarks and feeds after switching the hostname

Imported Statuspage `/incidents/<source-id>` paths, including maintenance, and
supplied shortlink paths answer **301** on Lamp's public hostname. Each reaches
its incident (`/incidents/INC-n`) or maintenance (`/maintenance/SCH-n`) page.
`/history.atom` serves the native Atom feed after an import, including a page with no incident history.
These responses share the versioned public snapshot and need no database read.
Unsafe paths, Lamp route collisions and addresses assigned to different records
are refused with the address named. No missing shortlink is guessed.

A link such as `https://stspg.io/abc` belongs to the source provider. Lamp can serve
`/abc` on your moved hostname, but cannot move or control `stspg.io`; keep that
provider redirect active or update the consumer's link. Lamp does not provide a
Statuspage JSON API under `/api/v2/`: readers receive 404 and must adapt to Lamp's
native `/api/public/status` response. No Atlassian-shaped JSON compatibility API is
added; adding one would need a new contract clause.

Statuspage RSS at `/history.rss` returns 404: point readers to `/feed.atom` instead.
Existing provider widgets are not served by Lamp; they keep calling the old provider
or fail when it is removed. Replace them with `/widget.js` and configure permitted
host origins in Settings.

Cutover checks run from the owner's browser against the selected public origin,
without cookies or credentials. They follow each redirect and verify a successful
HTML response at the exact expected Lamp permalink. Network, CORS and unreachable
host failures stay visible. Selecting an address acknowledges the choice; it does
not validate DNS. Public snapshot responses permit credentialless cross-origin
reads so the owner workspace can check the public host.

Existing imports need **no database migration or re-import**. Their retained
source IDs and original passthrough `shortlink` fields supply aliases on the next
snapshot rebuild (the scheduler also rebuilds old renderer generations). A
shortlink absent from that retained source is unavailable. Unsafe or conflicting
old addresses are reported as unavailable in the import report; safe aliases and
the public snapshot still publish. They are never silently remapped. Re-run
and undo retain their original journal and expected native rows. Undo keeps
aliases for edited records that remain and removes aliases for records it removes.

The source feed remains after conditional undo while imported records survive; a
complete undo removes it.


## Better Stack

Choose **Better Stack** in Move in. Use the status page ID and API token, or saved
original JSON responses. The token path uses GET with Bearer authentication only
at `https://incidents.betterstack.com/api/v2`; redirects and pagination outside the
selected page/report are refused. The token is not saved. All section, resource,
report, per-report update and subscriber pages must be complete. Files are bounded
to 8 MiB total, 5,000 records, 200 files and 50 pages per list; exceeding a limit
refuses the read rather than importing a truncated source.

Save the original envelopes as `status-page.json`, `sections.json`, `resources.json`,
`status-reports.json`, `subscribers.json`, and `status-updates-REPORTID.json`.
Number later pages `subscribers-2.json` and `status-updates-REPORTID-2.json`.
An unchanged `status-report-REPORTID.json` detail response can supply its complete
`included` update relationship instead; duplicate included/list updates are carried once.
The page must explicitly include `published`, `password_enabled` and `ip_allowlist`.
Lamp refuses unpublished, password-protected, IP-restricted or declared audience
pages and asks you to confirm the page is public and unrestricted. Better Stack's
REST contract has no documented visitor SSO flag, so this acknowledgement does not
claim that Lamp detected SSO. Missing documented visibility fields are refused.

Sections become groups. Displayed resource outer IDs identify components; underlying
monitor IDs do not. Known operational, degraded, downtime and maintenance states map
to Lamp; paused `not_monitored` or unknown states are refused. Current non-operational
resource states become standing claims at review time. Historical daily availability
aggregates, monitor integrations and widgets remain source provenance, not invented
incidents. Reports retain their original messages, publication times and affected
resource states. Better Stack has no investigation lifecycle: Lamp projects
Investigating for affected updates and Resolved for all-resolved updates or the final
update of an ended report. This is an explicit projection, not a claimed source
lifecycle. Maintenance windows need a valid end; all their historical messages appear
on the owner record and public maintenance page, without creating native lifecycle
notices, feed notices or notification jobs.

Only email rows with a valid source confirmation time become pending subscriptions.
Unconfirmed, null/missing confirmation, declared unsubscribed and unsupported channel
rows are skipped with reasons. Missing preferences or unresolved selected resource
IDs are never broadened to all components. An empty explicit selection means all.
Lamp preserves existing subscriptions and suppressions. The source endpoint does not
export a complete unsubscribe ledger. Invitations still require **Send invitations**.

REST reports have no documented public address. Lamp reports these addresses as
unavailable and never invents `/incident/<REST-id>`. An optional unchanged saved
status-page webhook, named `webhook-ID.json`, can supply the documented
`incident.shortlink` or `maintenance.shortlink`, correlated by its update
`status_report_id`. The source hostname remains outside Lamp's control. Cutover
lists these exact supplied paths, `/feed.atom`, and the unsupported `/feed.rss` and
`/index.json` readers. Update the latter to Lamp's Atom and native status endpoint.

Better Stack uses a separate source namespace with the same dry run, journal,
revision checks, batching and conditional undo as Statuspage. Existing Statuspage
journals are not rewritten; their original undo expectations stay unchanged. The
additive maintenance-history migration is included in normal installation backup
and restore, and a complete undo cascades its unchanged historical messages.

## Instatus

Choose **Instatus** first. Enter your page ID for either saved files or an API-key
read. The key is used only for GET requests to `https://api.instatus.com`, never
stored or forwarded through redirects. The reader selects that ID from
`/v2/pages`, then reads components, incidents with embedded updates, maintenance
lists and each maintenance's detail, subscribers, and audience groups. Limits
refuse an incomplete collection; they never silently truncate it.

For saved responses, request `per_page=100` and save every consecutive page until
a short or empty page. Use these unchanged JSON filenames:

- `instatus-pages.json`, `instatus-components.json`, `instatus-incidents.json`
- `instatus-maintenances.json`, plus `instatus-maintenance-ID.json` for every detail
- `instatus-subscribers.json`, `instatus-audience-groups.json`
- Later list pages add `-2`, `-3`, and so on before `.json`.

Empty resources still need their empty `[]` response. Maintenance detail is
required because the list does not establish affected components. The current
API help uses v2 component and maintenance lists while the official OpenAPI
attaches their field schemas to v1 reads; deployed account parity has not been
verified. Both fixture families remain **synthetic-only**, with no real owner
export supplied.

The saved pages response cannot establish public access or absence of audience
rules. A separate checkbox asks you to confirm the page and supplied history are
published and unrestricted. It is your acknowledgement, not provider evidence.
Known private, allow-listed, audience-scoped or secure-link pages are refused;
known unpublished records are not made public. Audience groups are access
controls, not display groups. Visual parent components and their children retain
their grouping; conflicts, cycles and missing group references are refused.

Incident update chronology uses `started`, preserving the supplied creation
metadata separately. A maintenance uses its explicit end or an end derived from
documented duration minutes when completed or configured to end automatically.
Missing or contradictory ends are refused. Every maintenance update is retained
as history without creating lifecycle notices or replaying notifications.

Only confirmed, approved, email-only subscribers become pending. Unconfirmed,
unapproved, unsubscribed and unsupported phone/webhook/chat subscriptions are
skipped with reasons. Component preferences must resolve and are never widened.
Importing, continuing, undoing and opening Cutover send nothing. Invitations are
sent only through the explicit **Send invitations** action in Cutover. Capability
fields such as tokens, component automation addresses and webhook credentials
are omitted from retained source records.

Optional `instatus-summary.json` can preserve exact supplied public URLs from
`activeIncidents`, `activeMaintenances` and `recentlyResolvedIncidents`, matched to
management records by source ID. A summary is not a complete history export; old
URLs missing from it remain unavailable, and Lamp does not guess a path. Supplied
incident and maintenance paths redirect to surviving Lamp records. `/history.atom`
serves Lamp's Atom feed. `/history.rss`, `/summary.json`, `/v3/summary.json` and
`/v3/components.json` are unsupported: update readers to `/feed.atom` or the native
`/api/public/status` format. Source-owned hosts remain outside Lamp's control.
