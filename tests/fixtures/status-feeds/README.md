# Real public status page feeds

Captured without credentials on 22 October 2026 (09:19 UTC) by Lamp's own reader
(`captureStatusFeeds` in `src/core/platform/status-feeds/`, through the site reader's
public-address guard and DNS over HTTPS), and saved unchanged. Each file is the page's
response at its vendor's fixed public path; the file name is the one a capture uses.

| Folder | Page | Vendor | Files |
|---|---|---|---|
| `statuspage-convex` | https://status.convex.dev | Atlassian Statuspage | `public-summary.json` (`/api/v2/summary.json`), `public-incidents.json` (`/api/v2/incidents.json`) |
| `instatus-zed` | https://status.zed.dev | Instatus | `public-summary.json` (`/summary.json`), `public-components.json` (`/v2/components.json`), `public-history.atom` (`/history.atom`) |
| `betterstack-polar` | https://status.polar.sh | Better Stack | `public-index.json` (`/index.json`), `public-feed.rss` (`/feed`) |
| `betterstack-valtown` | https://status.val.town | Better Stack | `public-index.json` (`/index.json`), `public-feed.rss` (`/feed`) |

What each holds: Convex has two groups whose components share names, resolved and
postmortem incidents, a backdated one and some that name no component. Zed has two
groups, and an Atom history whose updates name no component state. Polar has two
sections and reports both on its page and only in its feed. Val Town has one section,
and automatic reports that name their resource only in their title.
