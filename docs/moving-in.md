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
