# Your public status page

The page host serves your public status page at `/`, history at `/history`,
the Atom feed at `/feed.atom`, and the embed script at `/widget.js`. In Settings,
choose how customers recognize the page and where its widget may run.

## Set branding and widget access

In **Settings**, edit the page name, tagline, hostname, accent colour, time zone
and footer credit. Upload a logo or remove it; Lamp serves the logo from its own
origin and generates the status favicon and social image. List the full origins
where you embed the widget. The widget refuses requests from other host origins.

Add the single script tag for `/widget.js` to your product page. It displays the
overall status and unresolved incident information from the public snapshot.

## Read history and uptime

History lists resolved incidents and completed maintenance for the previous
12 months and links to earlier populated months. Each `/history/YYYY-MM` page
links to adjacent months with records and to permanent incident pages, including
imported history. These pages work without JavaScript and remain available from
the published snapshot when the database is unavailable.

The public page shows a 90-day uptime window for each visible
component. It counts Major outage and Partially unavailable as full downtime,
Degraded performance as half downtime, and Under maintenance as no downtime.
Lamp computes this from component state history, and the page states the method.

The public page, feed and widget show published information. Internal components
and incident notes are not included in those public surfaces.
