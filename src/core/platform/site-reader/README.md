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
| `components` | Up to 8 plausible service links from the site's header and `<nav>` (footer links if the header has too few). Product/service paths or clear service names supply evidence; audience, comparison, migration, account, documentation and marketing navigation are dropped. Names come from the links; no entries are synthesized. Fewer than 2 plausible services returns an empty list. |
| `statusPage` | A link named Status, or to a known status host |

Nothing is guessed: a field the site does not give is `null` or empty.

## Safety

- http and https only, default ports only, no credentials in the URL; `localhost`, single-label and private-suffix names are refused.
- Before every request, including every redirect hop (at most 5), the host name is resolved and every address must be public: private, loopback, link-local, CGNAT, documentation, multicast and reserved IPv4/IPv6 ranges (and IPv4 embedded in IPv6) are refused. The default resolver is DNS over HTTPS at cloudflare-dns.com; pass `resolve` to use another.
- One deadline for the whole read (10 s by default); HTML is read up to 1.5 MB, a manifest up to 100 KB, an icon up to 300 KB.
- The HTML is scanned as text: no DOM, no script runs. Show a returned SVG only through `<img>` (where scripts never run), or rasterise it.
- Limit: the fetch resolves the name again after the check. On Cloudflare Workers outbound requests cannot reach private networks anyway; elsewhere, run behind an egress that refuses them.

## Options

`fetch`, `resolve`, `timeoutMs`, `maxHtmlBytes`, `maxIconBytes`, `maxRedirects` (see `types.ts`).

Tests: `tests/site-reader/site-reader.test.mjs` (`node --test`).
