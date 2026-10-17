# Move in from another status page

Lamp can bring components, incident history, scheduled maintenance and eligible
email subscribers into your page.

## Common workflow

1. Sign in and open **Settings → Move in** (`/app/move-in`). Choose the matching
   source in the **Source** menu; its source-specific instructions are below.
2. Enter the source page ID and API key or token where supported, or upload saved provider JSON.
   Credential reads use fixed provider origins and `GET` requests only. Keys are
   used for that read, are not stored, and are not forwarded through redirects.
   Sorry's authenticated export runs locally as described below; its key never
   enters Lamp's Worker.
3. Choose **Run dry run**. Nothing has been written. Review the read, imported,
   changed, skipped and refused counts and the reason for every non-imported row.
   You can download the exact responses read and use those saved files later.
4. Check the review box and choose **Import**. Large imports may pause in batches;
   choose **Continue** until the job is complete. This does not send mail.
5. Open **Settings → Cutover** (`/app/cutover`). Before import it shows proposed
   destinations; after import it shows surviving records. Review the first 25 old
   public addresses, the total address count, unavailable links, reader gaps and
   eligible invitation count.
6. Choose **Send invitations** in Cutover. This is the only move-in action that
   sends mail. It sends one invitation to each eligible pending email subscriber;
   repeat for any remaining batch before the confirmation deadline.
   For Sorry, complete the hostname switch and observation window first; its
   imported subscriber candidates are held until that readiness check, for at
   most 30 days.
7. Point a hostname you control to Lamp using [the custom-domain guide](domains.md),
   or keep the deployment's default public address. Select that public origin in
   Cutover. Selecting it records your choice; it does not check DNS.
8. After switching, use **Check opens** for the listed links. These checks run in
   your browser without cookies or credentials, follow redirects and confirm a
   successful HTML page at the exact Lamp destination. A network, CORS or browser
   access error does not prove that a link works or that it is broken.
9. Keep the old page available through the pending subscribers' confirmation
   deadlines. Update old links, feeds, widgets and API readers before retiring it.

Cutover lists the first 25 public addresses. A live check covers only the rows
shown there; it does not validate the rest of the total automatically. A hostname
switch affects the address you control. It does not transfer or control a
provider-owned shortlink host, so keep its redirect active or update links that
still use that host.

## What saved API responses means

These are `.json` files containing the records your old provider returned when
its API was asked for components, incidents or subscribers. They are not
screenshots, CSV exports or a browser's saved public web page. Upload the files
unchanged and together; Lamp reads them without using an API key. Instatus also
needs the page ID so it can select the right page from those files.

If you have no such files, use the source account/API option in Move in, or ask
the person managing your old status page to capture them using the provider
instructions below. **Download these saved responses** after a dry run also gives you
files you can use for a later saved-response import. Keep them private: subscriber
files can contain personal information. Do not put them in Git.

The filename lists below are for the person collecting those responses.
A provider may return a long list in several **pages**. Save every page in order:
the first has the base filename, the second adds `-2`, the third `-3`, and so on.
For example, a list requested in groups of 100 is complete only when a response
has fewer than 100 records, including an empty response. Include that final
response too; do not rename or edit records inside the files. A missing file or
page can leave history or subscribers out, so resolve dry-run refusals before
importing.

## What carries over

Subject to the selected source's documented fields and the dry-run report:

| Source data | Lamp result |
| --- | --- |
| Component groups and components | Native groups and components; supported names, descriptions, ordering and relationships are retained. |
| Incidents and supplied updates | Native incident history at the source times the reader supports; notifications are not replayed. |
| Scheduled maintenance | Native maintenance windows and source-specific history where supported; a window already over is imported as completed. |
| Eligible email subscribers | Pending Lamp subscriptions; Sorry candidates are first held for cutover. Each person must confirm an invitation before the deadline. |

The sources do not expose identical fields. Each source section and the dry run
name omitted, changed, skipped or refused records; relevant source-specific
defaults are described below.

Dry runs, import, **Continue**, job reads, re-running an import, undo and Cutover
checks send no mail or trigger customer notices for imported history. Imported
history appears on the public page. Only **Send invitations** sends mail.
Eligible email rows stay pending until they confirm; Sorry candidates are held
until released to pending after cutover. Unconfirmed or unsubscribed source rows
are skipped where the source provides those states; the reader differences are
described below. Lamp permits at most one invitation per
imported subscriber and claims it before the mail transport call. A claimed or
uncertain send is not automatically retried. A transport acceptance does not
prove inbox delivery. Local development silently suppresses mail and retains no
invitations to open; use a hosted installation and a real mailbox to exercise
subscriber confirmation. Do not use local **Send invitations** to prepare
subscriptions you intend to invite after moving that data to hosting: its durable
claims still prevent those invitations from being sent again.

For Statuspage, Better Stack and Instatus, the confirmation deadline is
**72 hours from the import review time**, even if you have not sent the
invitation yet. Sending later leaves only the time remaining. Sorry candidates
are held without a confirmation deadline until released after cutover; their
72-hour clock starts at release. Candidates not released **30 days after the
import review time** are deleted with their addresses, as an undo would remove
them; Cutover shows the date as **Release by**. Expired pending subscriptions cannot be
invited; the expiry job deletes their unconfirmed addresses. Cutover shows
eligible, already-claimed and expired counts.

Lamp serves its native public JSON at `/api/public/status`. It does not provide a
provider-shaped JSON compatibility API by default. Cutover lists the selected
source's unsupported API and feed paths. Replace old feed subscriptions with
Lamp's `/feed.atom`; replace source widgets with `/widget.js` and configure the
allowed widget origins in Settings. A source widget keeps calling its old host or
stops working when that host is removed.

## Repeat, undo and full-install restore

Repeating an identical import while its prior job is present is an idempotent
no-op. After a successful undo, the source can be imported again. **Undo** under
**Your imports** is conditional: it removes rows created by that import only
when their expected values are still present. Rows changed since import and
confirmed subscribers stay, with their reason shown. Aliases stay for surviving
imported incidents or maintenance and are removed when the imported target is
removed. Undo sends no mail.

Moving from another Lamp page? Download **Settings → Export page data** there and
restore the file on the new page; see [Backups and recovery](backups-and-recovery.md#export-your-page-data-from-the-app).

Undo applies to one move-in job; it is not a full installation restore. To
restore a complete Lamp installation from an archive, follow [Backups and
recovery](backups-and-recovery.md). Full restore has its own archive and
empty-destination requirements.

## Statuspage

Choose **Statuspage**. In that account, open the avatar menu and choose **API
info**; enter the displayed **page ID** and **API key**. Lamp makes bounded `GET`
requests to `https://api.statuspage.io` and uses the key only in those requests.
The API calls read components, component groups, incidents, scheduled incidents,
subscribers and incident templates. The key is not saved. See the [official API reference](https://developer.statuspage.io/).

For saved responses, upload the unchanged JSON arrays named:
`component-groups.json`, `components.json`, `incidents.json`,
`incidents-scheduled.json`, `subscribers.json` and `incident-templates.json`.
An optional `incident-template-groups.json` array of group IDs and names supplies
template folder names; embedded template groups also supply names. The documented
management API exposes no group-list read. Without a group name, its source ID
is retained as the folder and the dry run names that change. Include later pages as
`<resource>-2.json`, `<resource>-3.json` and so on. The incidents and scheduled
incidents collections may both contain a maintenance; duplicates are carried
once. Statuspage maintenance windows carry over, but their update messages do
not enter Lamp's maintenance history; the unchanged responses remain in raw
source provenance. API reads use pages of 100 and stop after 50 pages per
resource. In saved-file mode, `components.json` is required, but the reader
cannot establish that the files cover every source page or form a complete page
sequence. Include the unchanged pages from one export set. The reader checks
response shapes and its input limits of 8 MiB total, 5,000 records, 512 KiB per
record and 200 files. It cannot prove that no further source pages exist past
its configured page limit. The other resource files may be omitted.

The subscriber API defaults to `state=active`; Lamp does not request
`state=all`, the `unconfirmed` state or the separate
`/subscribers/unsubscribed` endpoint. For a saved-file import, provide the
default active collection. The saved-row reader cannot reliably reclassify a
hand-picked all-state export, so do not upload one. Non-email and quarantined
rows are skipped. Eligible email rows become pending and need the Lamp
invitation and confirmation described above.

The import does not read the source page's visibility settings. Check that the
page is intended to become publicly readable before moving it; Lamp's public
page does not preserve member-login or IP restrictions. Unsupported subscriber
channels do not move. Components marked `only_show_if_degraded` retain their
conditional visibility in Lamp. The source's `showcase` flag does not set a Lamp
visibility rule.

Postmortems with a valid `postmortem_published_at` become published incident
reports at that original time. Bodies with no publication time stay private,
visible only to operators. The report keeps the full body in Summary; the other
report fields are empty. Markdown and HTML become plain text, keeping paragraphs,
headings, list items, link labels and URLs. Images become text naming the image
and source URL; Lamp never fetches or embeds them. Invalid report bodies or
publication times refuse that report without rejecting an otherwise valid incident.
The dry run counts published, kept-private and refused postmortems separately.
Import sends no postmortem notifications, even when the source requested them.

Incident templates retain their name, title, lifecycle, affected components and
states, folder and notification default. Their first body paragraph becomes
Customer impact and the rest becomes Details; Who is affected names their
components. Oversized wording is retained in full and the dry run names each
field to shorten. Open the imported template in the composer, shorten and save
those fields before applying it. An absent next-update offset stays unset for
the operator to choose. Applying a template fills a private draft and publishes
nothing. The source incident's recorded impact is preserved independently of
component claims and uptime history.

Reports belong to their imported incident for repeat and undo. Undo removes an
unchanged report with its incident and removes unchanged templates and their
component selections. An edited or added report retains its incident; an edited
template retains its components. Repeating the import duplicates neither.

This reader maps the source `/incidents/<id>` path for each imported incident or
maintenance, along with any supplied `shortlink` path. If a source shortlink is
absent, that separate shortlink is unavailable; Lamp does not guess it. A full
shortlink such as `https://stspg.io/abc` remains on
that source-owned host; Lamp can serve `/abc` on your moved hostname only when
that path was supplied and accepted. Keep the original redirect or update the
consumer's link.

The source's `/history.atom` and `/history.rss` paths reach Lamp's feeds.
Statuspage JSON readers use `/api/v2/` on the moved hostname. The old
`/embed/script.js` path serves Lamp's floating notice; allow the embedding
origin in Settings. [Public resources](public-resources.md) documents the
read APIs, native pagination and remaining maintenance compatibility gaps.

## Sorry

Choose **Sorry**. Use a public page's HTTPS origin for a keyless read, or upload
the unchanged JSON files from the local capture below. For an authenticated read, use the masked API key field or capture locally below
with a hidden prompt or private key file. Lamp uses the key for GET requests only
and never stores it. Only move material intended to be public and unrestricted.
Source visibility, audience rules and private-page access do not transfer.

### Capture an authenticated export locally

In Sorry, open **My Account → API Tokens**. Tokens are user-specific. Find the
page ID in its management UI, then run this command from the Lamp checkout with
the pinned Node version:

```sh
node --experimental-strip-types scripts/sorry-capture.mjs --page-id PAGE_ID --out /absolute/private/path/sorry-export
```

The destination must not exist, its parent must exist, and it must be outside
the checkout. Enter the token at the hidden terminal prompt. For an existing
private token file, add `--key-file /absolute/private/path/token`; the file must
be owned by you with no group or other permissions (`chmod 600`). Never put a
token in a command argument or environment variable. The capture does not read
environment credentials. See Sorry's [authentication reference](https://docs.sorryapp.com/v1/authentication).

The command makes fixed-origin `GET` requests to
`https://api.sorryapp.com/v1/pages/PAGE_ID` and its components, notices, notice
details and subscribers. Notice reads request `include=components,updates`;
subscriber reads include component preferences. Subscriber pages use
`page=N&per_page=500` and continue until a short page. Supplied pagination must
be complete; unsupported or inconsistent pagination is refused. The capture
paces reads below the documented ten requests per second and refuses redirects.
See the [REST API](https://docs.sorryapp.com/v1),
[notices](https://docs.sorryapp.com/v1/notices) and
[subscribers](https://docs.sorryapp.com/v1/subscribers) references.

After the complete bounded read succeeds, the command creates a local directory
with mode `0700` and original response files with mode `0600`. It never writes
the API token and refuses a response that reflects it. Responses containing
credentials outside the documented subscriber channel fields are also refused.
SMS / phone, Slack, Microsoft Teams, Google Chat and legacy Slack channels do
not move. Eligible email subscriptions on the same rows are retained; rows
without an enabled email channel are skipped with a reason. Other channel
values are omitted from every retained record. For a response containing
these values, Lamp retains only its
unchanged-byte hash and size, without original-response custody; sanitized
bytes are never labelled as an original. The local capture files remain
unchanged and can contain channel credentials, so keep them private. Captured files
may contain email addresses: keep them private, outside Git, and remove them
when no longer needed. Capture sends no mail and imports nothing. A failed
capture is not an export to import.

Upload the files together in Move in:

- `sorry-page.json`, `sorry-components.json`, `sorry-notices.json`
- `sorry-notice-ID.json` for every notice, including full components and updates
- `sorry-subscribers.json`, with later subscriber pages named
  `sorry-subscribers-2.json`, `sorry-subscribers-3.json` and so on

The reader also accepts documented separate update-list exports as
`sorry-notice-ID-updates.json`. Keep original envelopes intact. It refuses an
incomplete timeline, missing required files or input over 8 MiB, 5,000 records
or 200 files; the dry run names unsupported records rather than inventing them.

### Public JSON and feeds

For a keyless local capture, run:

```sh
node --experimental-strip-types scripts/sorry-capture.mjs --public-url https://status.example.com --out /absolute/private/path/sorry-public
```

The public reader gets `/api/v1/status`, every component and notice collection
page, and `/api/v1/notices/ID` for each notice. Collections expose up to 25 rows
per page; follow `meta.next_page` until complete, checking `meta.total_count`.
The notice list contains summaries; each detail supplies affected components
and full update history. A status overview or the first notice page alone is
incomplete. Pagination stays on the selected HTTPS origin and collection.
Public capture uses `sorry-status.json` instead of `sorry-page.json`, numbered
collection files such as `sorry-notices-2.json`, and the same detail filenames.
Public JSON provides no subscribers. For a bounded read-only sample, the preview
door accepts `previewNoticeLimit` (1–10): it still reads every collection page,
names uncaptured notice details as refused, and never permits that incomplete
capture to apply. Omit the limit for a complete move. See the [public Status API](https://status.sorryapp.com/api).

Sorry documents no native RSS/Atom feed. If the source HTML advertises an
alternate feed, discover its actual `rel="alternate"` link; a feed is a
supplementary discovery source, not proof of a complete history or subscriber
export. Do not guess a feed endpoint or treat a recent feed window as the
archive. Replace existing feed readers with Lamp's `/feed.atom` and JSON readers
with `/api/public/status`. See Sorry's [feed and notification comparison](https://www.sorryapp.com/compare/sorry-vs-statuspage/notifications/).

### Review history, then release subscribers after cutover

The dry run reports native mappings, unsupported records and any changes to
source meaning. Cancelled maintenance remains cancelled and never acquires
a maintenance claim. General notices become resolved informational incidents,
including notices without affected components. In particular, authenticated update text may not include a
lifecycle state for each update; any lifecycle projection is disclosed as a
change, not presented as source evidence. Supplied public notice URLs provide
old-link paths. A path works on a hostname moved to Lamp; Sorry-owned hosts
remain outside Lamp's control. Review the actual destinations in Cutover.

While a Sorry import is retained, `/history`, `/notices` and Sorry's
`/history/YYYY/month` URLs (English month names, such as
`/history/2026/october`) redirect permanently to Lamp's history at `/history/`.
These answers and the history document come from the same public snapshot as
notice redirects. Complete undo removes the Sorry aliases and restores Lamp's
ordinary `/history` document.

Eligible email candidates have `notify_by_email: true` and an email address,
even when other channels are enabled or populated. SMS / phone, Slack, Microsoft
Teams, Google Chat and legacy Slack channels are listed as not carried in the
dry run, and their values are not retained. Rows without an enabled email
channel are skipped with a reason. Component preferences must resolve and are
never broadened. Import holds Sorry candidates inactive, without sending mail
or starting the confirmation deadline. They receive no ordinary notifications
while held. If you neither release them nor undo the import, they are deleted
with their addresses 30 days after the import review time, so an abandoned move
keeps no one's address. Other provider confirmation deadlines are unchanged.

Switch the intended hostname using [the custom-domain guide](domains.md), check
that Lamp serves it, and finish the observation window you chose for the move.
Keep Sorry available during this period. In Cutover, use that exact configured
public origin and explicitly confirm both that the hostname is live and that
the observation window has ended before **Send invitations**. Selecting an
origin alone does not verify DNS or finish the observation window.

This readiness action releases held candidates to pending confirmation and
starts their 72-hour deadline at release. Send the remaining invitation batches
within that window, keep the old page available through confirmation, and check
delivery separately. Only recipients who confirm become active. Import,
re-import, history inspection, link checks and the held state send no mail.

Sorry references above checked **16 October 2026**. The public API and REST API
describe different response envelopes; keep their captures separate and review
each dry run before importing.

## Better Stack

Choose **Better Stack**. In Better Stack, open **API tokens → Team-based tokens**,
select the team that owns the page, then create or copy an **Uptime API token**
from that team's Uptime section. The [API token settings](https://betterstack.com/settings/api-tokens/0)
and [official token guide](https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/)
show the account controls.

Paste the token into Move in and choose **Find my pages**. Lamp lists the
status pages that token can read, with each page's name, address and ID; choose
**Use this page** beside yours to fill the page ID. (Lamp reads that list from
Better Stack's [List status pages](https://betterstack.com/docs/uptime/api/list-all-existing-status-pages/)
API.) The page ID is not a monitor ID or the public hostname.
Enter that page ID and **API token**, or upload the saved original JSON files. Lamp reads from
`https://incidents.betterstack.com/api/v2` using Bearer authentication and `GET`
only; the token is not saved, redirects are refused, and requests stay within
the selected page and report. See the [official status-page API reference](https://betterstack.com/docs/uptime/api/list-all-existing-status-pages/).
Every section, resource, report and subscriber page must be present. Each
report needs its complete update timeline, supplied through update pages or a
matching report detail response. The reader refuses collections over 8 MiB,
5,000 records, 200 files or 50 pages per list rather than importing a truncated
source.

Use these unchanged saved envelopes: `status-page.json`, `sections.json`,
`resources.json`, `status-reports.json`, `subscribers.json` and
`status-updates-REPORTID.json`. Number later list pages for each list as
`sections-2.json`, `resources-2.json`, `status-reports-2.json`,
`subscribers-2.json` and `status-updates-REPORTID-2.json`. An unchanged
`status-report-REPORTID.json` detail response may supply the complete `included`
update relationship instead; duplicate included and list updates are carried
once. An optional original `webhook-ID.json` payload may supply its exact
documented incident or maintenance shortlink. REST reports alone have no
documented public address, so those old report links are unavailable and Lamp
does not invent `/incident/<REST-id>`.

The page response must explicitly include `published`, `password_enabled` and
`ip_allowlist`. Lamp refuses unpublished, password-protected, IP-restricted or
declared audience pages. Confirm that the page is public and unrestricted,
including that it has no visitor SSO. The REST contract does not document an SSO
read flag, so Lamp cannot detect visitor SSO. Missing visibility fields are
refused.

Sections become groups. Displayed resource IDs identify components; underlying
monitor IDs do not. Known operational, degraded, downtime and maintenance
states map to Lamp; paused `not_monitored` or unknown states are refused.
Current non-operational resource states become standing claims at review time.
Historical daily availability aggregates, monitor integrations and widgets
remain source provenance, not invented incidents. Reports retain their
messages, publication times and affected resource states. Because the source
REST report has no investigation lifecycle, Lamp projects Investigating for
affected updates and Resolved for all-resolved updates or the final update of an
ended report. That projection is not a claim about the source lifecycle.
Maintenance windows need a valid end; supplied history appears on the owner
record and public maintenance page without native lifecycle notices, feed
notices or notification jobs.

Only email rows with a valid source confirmation time become pending
subscriptions. Unconfirmed, missing or invalid confirmation, declared
unsubscribed and unsupported channel rows are skipped with reasons. Missing
preferences or unresolved selected resource IDs are never broadened to all
components; an empty explicit selection means all. Existing subscriptions and
suppressions are preserved. The endpoint does not export a complete unsubscribe
ledger, so the dry run cannot account for rows absent from that API response.

The source hostname stays with its owner. Cutover shows only exact supplied
links, the `/feed.atom` feed and the unsupported `/feed.rss` and `/index.json`
readers. Update feed and API readers to Lamp's Atom feed and native
`/api/public/status` endpoint. Source widgets need the same replacement described
above.

Better Stack uses its own source namespace with the same dry run, journal,
revision checks, batching and conditional undo. The additive maintenance-history
migration is included in a full installation backup and restore; a complete
undo removes its unchanged historical messages with the imported maintenance
record.

## Instatus

Choose **Instatus**. In your [Instatus dashboard](https://dashboard.instatus.com),
right-click the project name at the top left and choose **Copy Project ID**;
that value is the **page ID** Lamp asks for. Or paste your API key into Move in
and choose **Find my pages**, then **Use this page** beside yours. Open **User settings → Developer
settings** (or [Developer settings](https://dashboard.instatus.com/developer))
to copy your **API key**. See the [official API help](https://instatus.com/help/api).

Enter the page ID for saved files or an API read. For an API read, also enter
the **API key**. Lamp uses fixed-origin `GET` requests to
`https://api.instatus.com`; it does not save the key or forward it through a
redirect. It selects the requested page from `/v2/pages`, then reads components,
incidents with embedded updates, maintenance lists and each maintenance's
detail, subscribers and audience groups. Saved files require the selected page
ID but no API key. The reader refuses incomplete
collections and input over 8 MiB, 5,000 records, 512 KiB per record, 200 files
or 50 pages per list; it never silently truncates a collection. See
[Instatus API help](https://instatus.com/help/api).

For saved responses, request `per_page=100` and save each consecutive page until
the final short or empty page. Use these unchanged JSON filenames:

- `instatus-pages.json`, `instatus-components.json`, `instatus-incidents.json`
- `instatus-maintenances.json`, plus `instatus-maintenance-ID.json` for each detail
- `instatus-subscribers.json`, `instatus-audience-groups.json`
- Later list pages add `-2`, `-3` and so on before `.json`.

Empty component, incident, maintenance, subscriber and audience-group resources
still need their empty `[]` response; the pages response must contain the
selected page. Maintenance detail is required because the list does not
establish affected components. The optional
`instatus-summary.json` can preserve exact public links supplied for a record;
it is not a complete history export. The API help uses v2 component and
maintenance lists while the official OpenAPI attaches their schemas to v1
reads; check your dry run for missing or refused records before importing.

The saved pages response cannot establish public access or the absence of
audience rules. Lamp asks you to confirm that the page and supplied history are
published and unrestricted; this is your acknowledgement, not provider
evidence. Known private, allow-listed, audience-scoped or secure-link pages are
refused, and known unpublished records are not made public. Audience groups are
access controls, not display groups. Visual parent components and their
children retain their documented grouping; conflicts, cycles and missing group
references are refused.

During Instatus normalization, a missing component or visual-group `createdAt`
uses the selected page's `createdAt`, or `1970-01-01T00:00:00.000Z` if that is
also absent. A missing component or group `order` defaults to `0`. This
timestamp is a source-normalization default; Lamp timestamps native groups at
import time.

Incident update chronology uses `started`, preserving supplied creation
metadata separately. Maintenance uses its explicit end, or an end derived from
documented duration minutes when completed or configured to end automatically.
Missing or contradictory required ends are refused. Every maintenance update
is retained as history without lifecycle notices or replayed notifications.

Only confirmed, approved, email-only subscribers become pending. Unconfirmed,
unapproved, unsubscribed or deleted rows and unsupported phone, webhook or chat
subscriptions are skipped with reasons. Component preferences must resolve
and are never widened. Capability fields such as tokens, component automation
addresses and webhook credentials are omitted from retained source records.

The optional summary file preserves exact supplied public URLs from
`activeIncidents`, `activeMaintenances` and `recentlyResolvedIncidents`, matched
to management records by source ID. A summary is not complete history. Old URLs
missing from it are unavailable; Lamp never guesses a path or host. Supplied
incident and maintenance paths redirect to surviving Lamp records. The source's
`/history.atom` and `/history.rss` paths reach Lamp's feeds. `/summary.json`,
`/v3/summary.json` and `/v3/components.json` are unsupported. Update JSON readers
to Lamp's native `/api/public/v1/` format. The source hostname
remains outside Lamp's control.
