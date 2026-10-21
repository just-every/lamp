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
| `components` | Up to 8 plausible product/app areas from the site's header and every `<nav>`, including a `<nav>` inside the footer (other footer links if these give too few). Product/app menu groups, product subpaths (`/products/…`, `/apps/…`, `/services/…`) and distinct service subdomains take priority over weaker service-name evidence. Audience, comparison ("vs …", "… vs …", "… alternative", a Compare group), migration, account, documentation and marketing navigation are dropped, and so is a page the header files only under a use-case, audience or comparison group ("What you can do in Acme") even when the footer lists it under Product, and a catalogue index (the one link at its level whose address holds two or more other areas, such as "Browse all products" at `/products`). Over 8, the areas the header's navigation presents come before those only the footer lists; then the areas the page links to most (counting pages beneath them) and names most in its own text are kept, before pages beneath another area. A page named after the area it sits beneath ("Jira Service Management" beneath "Jira") is an area of its own. Fewer than 2 plausible areas returns an empty list. |
| `statusPage` | A link named Status, or to a known status host |

Nothing is guessed: a field the site does not give is `null` or empty.

A component name is text the link shows. An icon link named only by its aria-label, title or
image alt text is never a component ("Email" on a footer envelope icon); a link that shows no
text is named only when its card's visible title, the heading just before or after it, spells
the same name (`<a aria-label="Capture"></a>` beside `<h3>Capture</h3>`). A title attribute
names a link that shows only a description. A card of plain paragraphs is a name followed by
its description ("Orbit" over "Content creation and publishing", not the icon's "orbit icon"),
unless a class marks the text as a description.

Component names use the link's structure: a heading or title/label element wins
over a description, subtitle, paragraph or small print. A class names its element by
its last word ("product-header", "card__title"), read with and without a BEM modifier
("card__title--large", "link--label"); a word that only begins a class names
the block the element belongs to ("header-platform-card__description",
"title-card-link"), and utility values in brackets ("text-[var(--header-text)]") and
generated hashes are not words. Description-styled wrappers
still expose headings and names above a separately marked description. Separate block siblings,
the children of a flex column (`flex-col`), or siblings that touch with no space between them
("Journeys" then "Understand paths to conversion"), are read as a name followed by supporting
text, unless a flex row lays them side by side; other inline spans separated by a space remain one name. Badges (NEW, BETA, Soon and
counts), emoji, icon-font glyphs, decorative elements and a list marker before the name
("- vs Google Analytics") are removed, as is text kept for screen readers only. A badge leaves only when it stands
on its own: a trailing badge word or bracketed count in its own element or text,
set off by a separator ("Search (42)"), in capitals after a mixed-case name
("Metrics BETA"), or a leading badge word set off by punctuation ("New! App Hosting"). A bare number leaves only when it is styled as a badge, pill or
counter; otherwise it is part of the name ("Microsoft <b>365</b>"). Words and numbers
inside one text are the name ("What's New", "Microsoft 365", "Build Preview"). The site's spelling,
case and ampersands are retained. No description word list is used to shorten names.

Menu buttons and headings supply the surrounding group, including footer product
groups; a label's disclosure arrow and the copy a responsive layout repeats are not part
of it ("Resources Resources ↓" is "Resources"). Short text with no link that heads a list
labels that list the same way, whether it sits in a `<span>`, `<p>` or `<div>` or directly
in the `<li>` (`<li><span>Use Cases</span><ul>…`, `<div><span>Services</span></div><ul>…`); a
button beside it ("Back" in a mobile menu) is not part of the label. A Features menu alone needs additional service evidence; it does not make
every benefit into a component, and a product label inside it ("Features › Platform") names a
kind of feature, not a product menu.

Hosting and cloud providers call their products services: `/services/<name>` is product
evidence, and a Services menu is a product menu unless the site files its products under a
separate Products or Platform menu that does not hold it (a Services column beside a Products
column is help around the products). Professional services, consulting, advisory,
implementation, onboarding, training and support pages stay out by their own words and group,
whatever directory or menu holds them. When a link's only product evidence is the services
directory or menu, it also leaves if its name or a group label names work done for a client
(development, design, engineering, strategy, migration, research, testing…: "Web Development"
under "Software Engineering"); when most such links do, the directory is a consultancy's
professional services and all of them leave. Pricing, customer stories, feature/benefit indices,
blog, company, careers, contact, legal, sign-in/up and documentation routes stay
excluded even inside a product group, as are calls to action (a trailing arrow in the
link's shown text, "Explore …", "Register …", "… now", "… more"), plan and pricing wording ("… plans", "… pricing"),
"… all products" links, downloads and release notes. An arrow hidden from assistive
technology (`aria-hidden`) is decoration, not a call to action. Professional services, training, academy,
consulting, onboarding, customer success, early-access and support navigation stays out, as do
release, changelog, what's-new and update pages, trust centres, and compliance pages
("GDPR Compliance", `/compliance`); an area that pairs compliance with another
("Security & Compliance") stays. Comparison, alternative, audience and "why us" pages
stay out at any depth (`/features/vs-google-analytics`, `/acme-alternative`,
`/for-agencies`, `/why-acme`), as do Compare, Solutions, Industries, Use cases, "What …",
"Why …", "Who …", "How …", "By …" (By Use Case, By Team), Learning, Education, Events and
programme groups. Account, preference, profile and newsletter pages (`/preferences/email`),
licences and disclaimers stay out. Path segments and group/name wording are checked at every depth, including compound
slugs and punctuation variants. A `/tools/` directory (free generators and calculators) does
not establish product evidence. Generic links are matched on the link's whole text as well as
the cleaned name.

A page's kind is read from its own name, or from its own description (its text after the name,
or the first text after the link in its card), and these kinds are no product area even when a
Products menu or a product path files them (`page-types.ts`):

| Kind | Recognised by | Examples |
|---|---|---|
| Call to action | a leading verb and its object | "Get in touch with sales", "Schedule a call", "Find a partner" |
| Question or explainer | a question mark, or a leading what/why/how/who/when/where/which | "What's in the free tier?", "How it works" |
| Event | launch week, webinar, conference, summit, meetup, hackathon, keynote, roadshow, workshop or livestream, or upcoming/live/virtual/in-person/online/community/customer/partner/industry/our events | "Launch Week", "Webinare", "Upcoming events" |
| Demo or trial | demo, trial, test drive, product/guided/interactive tour | "Trials and demos", "Demos" |
| Free tool | a name ending in calculator, generator, checker, converter, estimator, grader, validator or picker (also kalkulator, calculadora, calculateur, calcolatore, калькулятор); "free tools/templates/tier/plan…" | "ROI Calculator", "Free Tools" |
| Catalogue | a name ending in marketplace, ecosystem, app store or app directory | "Marketplace", "Partner Ecosystem" |
| Claim or news | a leading "latest", a name ending in news or announcements, a comparative claim ("… faster", "… easier") or "24/7" | "latest innovations", "Research customers faster" |
| Feature index | a name ending in features or capabilities | "CDN Features", "Platform and Capabilities" |
| Programme | a programme people join: "Programs" alone, or a name ending in a partner, affiliate, reseller, referral, ambassador, startup, beta, education, student, nonprofit, developer, creator, expert, champion, community, channel, ISV, alliance or insider program/programme/Programm; a grant, scholarship or fellowship; an accelerator or incubator; or a description that introduces "the/our/a … program" | "Beta program", "Education Grant", "Startup-Programm", "Orbit: The partner program for freelancers" |
| Solutions page | a name ending in solutions | "Midsize business solutions", "Custom Solutions" |
| Report | a name ending in the singular "report"; a Reports, Research, Studies, Insights or Library page whose own description names analysts | "Reports: Analystenberichte und Studien" |

A single verb ("Build", "Chat"), a plural "Reports" without such a description, a product for
running programmes ("Loyalty programs") and "Free" before a product ("Free CRM") remain names.

Text that links to three or more addresses, or to two when another link names one
of them, is boilerplate ("Free and premium plans" on every product card) and leaves
all of them. When several links share an address, the name kept is the one that
comes from the product menu in the header/navigation before a footer category (a footer `<nav>` included),
then matches a menu group label a link to it sits under, then a title inside the
link, then spells the address's last path segment, then a surrounding heading,
then the first. Descriptive block cards need a title when their menu is identified
only by an accessibility role suffix. Merging happens before
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
