# Move in from a hosted status page

Lamp reads your page's components, component groups, incident history with every
update, scheduled maintenance and email subscribers from Statuspage's API.
**Synthetic-only validation:** two fixture families written from Statuspage's
published API reference pass; no real account export has been supplied.

## Steps

1. Sign in and open **Settings → Move in from Statuspage** (`/app/move-in`).
2. Either enter your Statuspage **page ID** and **API key** (Statuspage: avatar menu →
   API info), or choose saved API responses. The key is sent only in GET requests to
   `https://api.statuspage.io`, used for that one dry run and never stored.
3. Read the **dry run**. Nothing is written yet. It counts every record as imported,
   changed, skipped or refused and gives each reason; you can download the responses
   it read and import those later instead of using the key again.
4. Confirm and **Import**. Large pages import in batches: choose **Continue** until
   the import and its invitations are done.

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
| Email subscribers | Pending subscribers, each sent one invitation to confirm |
| Post-mortems, templates, SMS, Slack, Teams and webhook subscribers, "only show if degraded" | Not carried; each is named in the dry run |

An imported page notifies nobody about its history: no incident or maintenance
notice is sent or published. An invitation names your page and asks the subscriber
to confirm within 72 hours; without that the subscription expires (SUB-003).

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
Statuspage JSON API or RSS feed: those old paths return 404.

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
