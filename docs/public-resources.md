# Feeds, APIs, badges and embeds

Settings → Public resources and embeds links to your public API, feeds and badge and builds a tag for a banner, floating incident notice or compact status dot. Add the embedding site's full origin to Widget host origins and save settings first. Unlisted origins render nothing. Position, background, text color and hiding a healthy state are choices carried in your copied tag. The floating notice is visible only during an unresolved incident or in-progress maintenance. Embeds refresh from the same public host every 30 seconds.

## Feed readers and badges

`/feed.atom` and `/feed.rss` contain the same incident updates and maintenance notices, newest first, for the last twelve months. `/history.atom` and `/history.rss` work on every installation, including before an import. Event identifiers survive a hostname change.

Each component's **Feeds and badges** disclosure gives its own Atom, RSS, status badge and uptime badge URLs. These addresses use its immutable ID as a slug and survive renaming. Component feeds include only incidents and maintenance attached to that component.

Use `/badge.svg` in a README or dashboard, or supply `/badge.json` to the [Shields endpoint badge](https://shields.io/badges/endpoint-badge). Component badges use `/components/<slug>/badge.svg` and `/components/<slug>/uptime.svg`. Every badge states its value in text as well as color.

## Statuspage public API

Existing readers can use these paths on the public status hostname:

- `/api/v2/summary.json`, `/api/v2/status.json`, `/api/v2/components.json`
- `/api/v2/incidents.json`, `/api/v2/incidents/unresolved.json`, `/api/v2/incidents/resolved.json`
- `/api/v2/scheduled-maintenances.json`, `/api/v2/scheduled-maintenances/upcoming.json`, `/api/v2/scheduled-maintenances/active.json`

Responses use [Statuspage's documented public format](https://status.atlassian.com/api). Imported Statuspage record IDs are preserved where the import journal retained them. New public IDs are stable twelve-character identifiers. Internal components, operator names, notes and subscriber data are excluded.

| Lamp component state | Statuspage component status | Page indicator / incident impact |
| --- | --- | --- |
| Operational | operational | none |
| Degraded performance | degraded_performance | minor |
| Partially unavailable | partial_outage | major |
| Major outage | major_outage | critical |
| Under maintenance | under_maintenance | maintenance |

Incident lifecycle names become lowercase. Maintenance Scheduled, In progress, Completed and Canceled map to scheduled, in_progress, completed and completed; cancellation remains stated in its notice body. The current automatic maintenance lifecycle has auto-start and auto-complete enabled. Per-window switches, Verifying and editable maintenance messages await MAINT-009; this API does not supply those controls.

## Native public API

`/api/public/v1/` describes the page and links to components, incidents and maintenance. Each collection returns `generatedAt`, `data` and `nextCursor`. Follow a non-null cursor with `?cursor=<nextCursor>` on the same collection. Each page contains up to 50 records. Incidents carry their complete published timelines and published post-incident reports. Cursors belong to the current snapshot; a cursor removed by a later publication returns 404, so start again at the first page.

All these reads are public, allow CORS, use generation ETags, and read only published snapshot artifacts. They keep serving when the application database is unavailable. A publish switches feeds, badges, APIs and embeds to the same generation.
