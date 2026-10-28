# Your public status page

The page host serves your public status page at `/`, history at `/history`,
the Atom feed at `/feed.atom`, and the embed script at `/widget.js`. In Settings,
choose how customers recognize the page and where its widget may run.

## Set branding and widget access

In **Settings**, edit the page name, tagline, hostname, accent color, time zone
and footer credit. Upload a logo or remove it; Lamp serves the logo from its own
origin and generates the status favicon and social image. List the full origins
where you embed the widget. The widget refuses requests from other host origins.

Add the single script tag for `/widget.js` to your product page. It displays the
overall status and unresolved incident information from the public snapshot.

## Customize the theme

Open **Settings → Page → Theme** and enable **Use a custom theme**. Choose the
background, surface, text, link and five state colors. Lamp checks text, links
and each state color against both backgrounds at 4.5:1 contrast before saving.
Valid changes save and publish automatically; a refused edit stays in Settings
with its reason while the previous public snapshot keeps serving.

Choose bundled Inter or upload a WOFF2 font, then upload a header image. The
uploaded image address shown in Settings can also be used in header or footer
HTML. Fonts and images travel with page-data exports and are served by your
page's own origin.

Add header and footer links using HTTPS addresses or paths on your page. Each
HTML field accepts up to 8 KB of the supported text, list, navigation and image
elements. Saving removes scripts, event handlers, styles, forms, frames and
unowned images, and lists what was removed. The cleaned content is present in
the published page even with JavaScript disabled.

Choose whether component groups start expanded, which components show uptime
bars, and how many history days appear. Hiding a bar keeps its uptime figure;
the figure still uses the stated 90-day reporting window. Requested days before
the retained record are identified as having no recorded history.

**Page CSS** is scoped to your public page and included in its snapshot
stylesheet. Lamp refuses `@import`, external `url()`, `expression()` and
`behavior`, naming the offending construct. Disabling **Use a custom theme**
restores Lamp's default appearance.

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

## Accessibility evaluation

Read the [Accessibility Conformance Report (VPAT)](accessibility/vpat.md) for the current release, measured surfaces and evaluation limits. It is also served on the operator app host at `/docs/accessibility/vpat`, without sign-in. This report does not claim conformance for private pages, email clients or surfaces that have not been evaluated.
