# Status page feeds

Reads a public status page through its vendor's own public feeds, without a key:
its components and groups in the page's order, and its past incidents with every
update. For Atlassian Statuspage, Instatus and Better Stack. Self-contained beside
the site reader (its fetch guard, text and name cleaning), no Lamp imports, standard
`fetch` only, runs in Workers and Node.

```ts
import { readStatusFeeds } from "./index.ts";

const read = await readStatusFeeds("https://status.example.com/", "statuspage");
if (read) read.page;   // StatusFeedPage; read.files are the responses, unchanged
```

## What each vendor publishes

| Vendor | Components and groups | History |
|---|---|---|
| Statuspage | `/api/v2/summary.json`: a component marked `group` is a group, listing its own | `/api/v2/incidents.json`: the 50 newest incidents, each update with the component states it set |
| Instatus | `/summary.json` (name, what is open now) and `/v2/components.json`: a component others name as their group is that group | `/history.atom`: each incident's updates and the components it affected, by name; no states, and no year on an update's time (taken from the entry's own times) |
| Better Stack | `/index.json`: named sections are groups; one section alone is the page's list | the reports `/index.json` shows, with each update's resource states, and older ones from the `/feed` RSS, one item per update, naming resources only in their titles |

`StatusFeedPage.incidents` holds only resolved incidents: anything still open on the
page and all maintenance are left out. A Better Stack report no longer on the page is
over. `components` lists only what the page names; states appear only where the feed
states them. A page ID is the page's own (Statuspage's, or Better Stack's when the page
says this is its address).

Component names are the page's own. The site reader's cleaning takes off decoration
(spacing, emoji, entities) but never a word: "HTTP (Preview)" stays whole.

## Safety and limits

Every request is a keyless `GET` to the page's own origin at the vendor's fixed path,
through the site reader's guard (public addresses only, on every redirect hop, DNS over
HTTPS by default). One deadline covers a read (8 s by default). A summary or component
list is read up to 1 MB, a history feed or Better Stack index up to 3 MB, and a larger
one is refused. A page whose history does not answer still gives its components.

Tests: `tests/site-reader/site-reader.test.mjs` (discovery and reading, against the real
captures in `tests/fixtures/status-feeds/`), and Move in's readers of those captures in
`tests/betterstack/reader.test.mjs` and `tests/instatus/reader.test.mjs`.
