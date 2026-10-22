# Site reader

Reads what a public website says about itself, so a product can prefill a
business's name, description, mark, colours and first components from one URL.
Self-contained: no Lamp imports, standard `fetch` only, runs in Workers and Node.

```ts
import { readSite } from "./index.ts";

const result = await readSite("getharvest.com");
if (result.ok) result.site;   // SiteRead
else result.reason;           // "invalid-url" | "refused-address" | "unreachable" | "timeout" | "http-error" | "not-html"
// result.message is one short sentence a person can read.
```

## SiteRead

| Field | From |
|---|---|
| `url`, `host` | The page that answered, after redirects |
| `name` | og:site_name, application-name, manifest or `<title>` part; the one the domain spells wins ("Harvest" for getharvest.com) |
| `title`, `description` | `<title>`; meta description, og:description or manifest description (≤ 280 chars) |
| `icon` | Declared SVG icon first, then the largest declared raster (link icons, apple-touch-icon, manifest), then `/favicon.ico` if nothing is declared. Bytes as a `data:` URL, type sniffed from the bytes |
| `colours`, `accent` | theme-color, the SVG mark's own fills, CSS custom properties named brand/primary/accent, pinned-tab colour, manifest theme_color; `accent` is the first saturated one |
| `fonts` | Google Fonts links and inline `@font-face` families |
| `components` | Up to 8 plausible product/app areas from the site's header and `<nav>` (footer links if the header has too few). Product/app menu groups, product subpaths and distinct service subdomains take priority over weaker service-name evidence. Audience, comparison, migration, account, documentation and marketing navigation are dropped, and so is a catalogue index (the one link at its level whose address holds two or more other areas, such as "Browse all products" at `/products`). Over 8, the areas the page links to most (counting pages beneath them) and names most in its own text are kept, before pages beneath another area. Fewer than 2 plausible areas returns an empty list. |
| `statusPage` | A link named Status, or to a known status host |

Nothing is guessed: a field the site does not give is `null` or empty.

A site's own domain (`siteDomain` in `domain.ts`) is its registrable domain by the
[Public Suffix List](https://publicsuffix.org/list/): example.co.uk, and
astro-paper.netlify.app rather than netlify.app, since every netlify.app site is a
site of its own. The list's rules are bundled in `public-suffix-list.ts`; refresh
them from the maintained list with `node scripts/public-suffix-list.mjs`.

Component names use the link's structure: a heading or title/label element wins
over a description, subtitle, paragraph or small print. Separate block siblings
are read as a name followed by supporting text; ordinary inline spans remain
one name. Badges (NEW, BETA, Soon and counts), emoji and decorative elements are
removed, as is text kept for screen readers only. A badge leaves only when it stands
on its own: a trailing badge word or bracketed count in its own element or text,
set off by a separator ("Search (42)"), or in capitals after a mixed-case name
("Metrics BETA"). A bare number leaves only when it is styled as a badge, pill or
counter; otherwise it is part of the name ("Microsoft <b>365</b>"). Words and numbers
inside one text are the name ("What's New", "Microsoft 365", "Build Preview"). The site's spelling,
case and ampersands are retained. No description word list is used to shorten names.

Menu buttons and headings supply the surrounding group, including footer product
groups. A Features menu alone needs additional service evidence; it does not make
every benefit into a component. Pricing, customer stories, feature/benefit indices,
blog, company, careers, contact, legal, sign-in/up and documentation routes stay
excluded even inside a product group, as are calls to action (a trailing arrow,
"Explore …", "… more"), plan and pricing wording ("… plans", "… pricing"),
"… all products" links, downloads and release notes. Generic links are matched on
the link's whole text as well as the cleaned name.

Text that links to three or more addresses, or to two when another link names one
of them, is boilerplate ("Free and premium plans" on every product card) and leaves
all of them. When several links share an address, the name kept is the one that
matches a menu group label a link to it sits under, then the one that spells the
address's last path segment, then a heading, then the first. Merging happens before
the cap, and the selected links retain their order on the site.

These are editable starting points, not a discovered availability architecture.
Single-product sites can legitimately return no components; menus rendered only
by JavaScript are unavailable to this reader.

## Safety

- http and https only, default ports only, no credentials in the URL; `localhost`, single-label and private-suffix names are refused.
- Before every request, including every redirect hop (at most 5), the host name is resolved and every address must be public: private, loopback, link-local, CGNAT, documentation, multicast and reserved IPv4/IPv6 ranges (and IPv4 embedded in IPv6) are refused. The default resolver is DNS over HTTPS at cloudflare-dns.com; pass `resolve` to use another.
- One deadline for the whole read (10 s by default); HTML is read up to 1.5 MB, a manifest up to 100 KB, an icon up to 300 KB.
- The HTML is scanned as text, retaining a stack of menu groups and each link's text elements: no page DOM, no script runs. Show a returned SVG only through `<img>` (where scripts never run), or rasterise it.
- Limit: the fetch resolves the name again after the check. On Cloudflare Workers outbound requests cannot reach private networks anyway; elsewhere, run behind an egress that refuses them.

## Options

`fetch`, `resolve`, `timeoutMs`, `maxHtmlBytes`, `maxIconBytes`, `maxRedirects` (see `types.ts`).

Tests: `tests/site-reader/site-reader.test.mjs` (`node --test`).
