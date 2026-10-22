import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isPublicAddress, readSite } from '../../src/core/platform/site-reader/index.ts';
import { createWebsiteService } from '../../src/core/features/website/service.ts';
import { readStatusPage } from '../../src/core/features/website/status-page-reader.ts';

// The internet stops here: a fake DNS and a fake transport answer for named hosts.
function network(routes, addresses = {}) {
  const requested = [];
  return {
    requested,
    resolve: async host => addresses[host] ?? ['93.184.215.14'],
    fetch: async (url, init) => {
      requested.push(url);
      assert.equal(init.redirect, 'manual', 'redirects are followed by the reader, one checked hop at a time');
      const route = routes[url];
      if (!route) return new Response('missing', { status: 404 });
      return typeof route === 'function' ? route(init) : new Response(route.body, { status: route.status ?? 200, headers: route.headers ?? { 'Content-Type': 'text/html; charset=utf-8' } });
    },
  };
}

const page = `<!doctype html><html><head><title>Time Tracking Software | Harvest</title>
<meta name="description" content="Track time &amp; send invoices.">
<link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="apple-touch-icon" href="/touch.png">
<link href="https://fonts.googleapis.com/css2?family=Besley:wght@400&display=swap" rel="stylesheet">
<script>document.title = "Injected"; fetch("http://127.0.0.1/");</script>
</head><body><header><nav><a href="/">Home</a><a href="/features/time-tracking">Time tracking</a><a href="/features/invoicing">Invoicing &amp; Payments</a>
<a href="/features/reports">Reporting</a><a href="/pricing">Pricing</a><a href="/integrations/slack">Slack</a><a href="https://id.example-harvest.com/login">Log in</a>
<a href="/products/ecommerce">Ecommerce</a><a href="/solutions/saas">SaaS</a><a href="/for/agencies">Agencies</a>
<a href="/for/creators">Creators and publishers</a><a href="/for/public-sector">Public sector</a><a href="/products/white-label">White-label analytics</a>
<a href="/compare/google-analytics">Vs Google Analytics</a><a href="/migrate/ga4">Migrate from GA4</a>
<a href="/now">Now</a><a href="/docs">Docs</a><a href="/docs/api">API</a><a href="https://developers.example-harvest.com/">Developers</a>
<a href="/features/zero-downtime-deploys">Zero Downtime Deploys</a><a href="/features/granular-routing">Granular Routing</a><a href="/features/autoscaling">Autoscaling</a></nav></header>
<main><a href="/careers">Careers</a></main><footer><a href="https://www.harveststatus.com/">Status</a></footer></body></html>`;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#FA5D00"/><path fill="#fff" d="M8 8h4v16H8z"/></svg>';

test('the site reader reads what a site says about itself, refuses private destinations on every hop, and stays within its limits', async (t) => {
  t.diagnostic('reads name, description, mark, colours, fonts, components and status page, and runs none of the site\'s scripts');
  {
  const net = network({
    'https://example-harvest.com/': { status: 301, headers: { Location: 'https://www.example-harvest.com/' } },
    'https://www.example-harvest.com/': { body: page },
    'https://www.example-harvest.com/favicon.svg': { body: svg, headers: { 'Content-Type': 'image/svg+xml' } },
  });
  const result = await readSite('example-harvest.com', net);
  assert.equal(result.ok, true);
  const { site } = result;
  assert.equal(site.url, 'https://www.example-harvest.com/');
  assert.equal(site.name, 'Harvest');
  assert.equal(site.title, 'Time Tracking Software | Harvest');
  assert.equal(site.description, 'Track time & send invoices.');
  assert.equal(site.icon.contentType, 'image/svg+xml');
  assert.equal(site.icon.url, 'https://www.example-harvest.com/favicon.svg');
  assert.equal(Buffer.from(site.icon.dataUrl.split(',')[1], 'base64').toString(), svg);
  assert.equal(site.accent, '#fa5d00');
  assert.deepEqual(site.fonts, ['Besley']);
  assert.deepEqual(site.components.map(component => component.name), ['Time tracking', 'Invoicing & Payments', 'Reporting']);
  assert.equal(site.components[0].url, 'https://www.example-harvest.com/features/time-tracking');
  assert.deepEqual(site.statusPage, { url: 'https://www.harveststatus.com/' });
  assert.equal(net.requested.some(url => url.includes('127.0.0.1')), false, 'the page script never ran');
  }
  t.diagnostic('refuses private, loopback and link-local destinations, before the request and on every redirect hop');
  {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:c0a8:101::1', '224.0.0.1']) {
    assert.equal(isPublicAddress(address), false, `${address} is not public`);
  }
  for (const address of ['93.184.215.14', '1.1.1.1', '2606:4700:4700::1111', '::ffff:93.184.215.14']) assert.equal(isPublicAddress(address), true, `${address} is public`);

  const cases = [
    ['http://127.0.0.1/', {}, {}],
    ['http://[::1]/', {}, {}],
    ['intranet.example.com', {}, { 'intranet.example.com': ['10.0.0.8'] }],
    ['mixed.example.com', {}, { 'mixed.example.com': ['93.184.215.14', '192.168.0.10'] }],
    ['rebind.example.com', { 'https://rebind.example.com/': { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data/' } } }, {}],
    ['hop.example.com', { 'https://hop.example.com/': { status: 302, headers: { Location: 'https://inside.example.com/' } } }, { 'inside.example.com': ['::1'] }],
    ['localhost', {}, {}],
    ['https://example.com:8443/', {}, {}],
    ['https://user:secret@example.com/', {}, {}],
  ];
  for (const [input, routes, addresses] of cases) {
    const net = network(routes, addresses);
    const result = await readSite(input, net);
    assert.deepEqual([result.ok, result.reason], [false, 'refused-address'], input);
    assert.equal(net.requested.some(url => /127\.0\.0\.1|169\.254|\[::1\]|intranet|mixed|inside|localhost|8443|secret/.test(url)), false, `${input}: the refused hop was never requested`);
  }
  for (const input of ['file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)']) {
    assert.equal((await readSite(input, network({}))).reason, 'invalid-url', input);
  }
  }
  t.diagnostic('stays within its size and time limits and reports a failed site plainly');
  {
  const huge = 'x'.repeat(400_000);
  const net = network({
    'https://big.example.com/': { body: `<title>Big | Bigco</title><link rel="icon" href="/big.png"><link rel="apple-touch-icon" href="/ok.png">${'<p>filler</p>'.repeat(200_000)}` },
    'https://big.example.com/big.png': { body: huge, headers: { 'Content-Type': 'image/png' } },
    'https://big.example.com/ok.png': { body: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 180, 0, 0, 0, 180]), Buffer.alloc(40)]), headers: { 'Content-Type': 'image/png' } },
    'https://gone.example.com/': { body: 'gone', status: 410 },
    'https://data.example.com/': { body: '{}', headers: { 'Content-Type': 'application/json' } },
  });
  const big = await readSite('big.example.com', { ...net, maxHtmlBytes: 50_000 });
  assert.equal(big.ok, true, 'a long page is read up to the limit, not refused');
  assert.equal(big.site.name, 'Bigco');
  assert.equal(big.site.icon.url, 'https://big.example.com/ok.png', 'an oversized icon is skipped for the next one');
  assert.deepEqual([big.site.icon.width, big.site.icon.height], [180, 180]);
  assert.deepEqual(await readSite('gone.example.com', net), { ok: false, reason: 'http-error', message: "We couldn't read that website." });
  assert.equal((await readSite('data.example.com', net)).reason, 'not-html');
  // Node does not hold the process open for AbortSignal.timeout; this timer does, for the read's 50 ms.
  const hold = setTimeout(() => {}, 1000);
  const slow = await readSite('slow.example.com', { resolve: async () => ['93.184.215.14'], timeoutMs: 50, fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))) });
  clearTimeout(hold);
  assert.equal(slow.reason, 'timeout');
  const empty = await readSite('plain.example.com', network({ 'https://plain.example.com/': { body: '<p>Hello</p>' } }));
  assert.deepEqual({ ...empty.site, url: undefined }, { url: undefined, host: 'plain.example.com', name: null, title: null, description: null, icon: null, colours: [], accent: null, fonts: [], components: [], statusPage: null }, 'nothing the site did not give is filled in');
  }

  t.diagnostic('component names follow link structure and product navigation, in site order');
  const read = async html => {
    const result = await readSite('example.com', network({ 'https://example.com/': { body: html } }));
    assert.equal(result.ok, true);
    return result.site.components;
  };
  t.diagnostic('badges, counts and emoji leave the displayed product name; a name beginning with New stays intact');
  assert.deepEqual((await read(`<nav>
    <a href="/products/seer">Seer <span class="new-pill">NEW</span></a>
    <a href="/products/metrics">📊 Metrics BETA</a>
    <a href="/products/queue">Queue <span class="count">12</span> Soon</a>
    <a href="/products/search">Search (42)</a>
    <a href="/products/new-relic">New Relic</a>
    <a href="/products/inbox">Inbox <span class="counter">3</span></a>
  </nav>`)).map(component => component.name), ['Seer', 'Metrics', 'Queue', 'Search', 'New Relic', 'Inbox']);

  t.diagnostic('names are never cut: a trailing number or word in the name stays; a changelog link stays out under its whole text');
  assert.deepEqual((await read(`<nav><div><button>Products</button>
    <a href="/products/office">Microsoft 365</a>
    <a href="/products/sonnet">Sonnet 4.5</a>
    <a href="/products/build">Build Preview</a>
    <a href="/products/windows">Windows<!-- --> <!-- -->11</a>
    <a href="/products/region">Region 2 <span>NEW</span></a>
    <a href="/releases">What's New</a>
    <a href="/products/updates">What’s <span>New</span></a>
    <a href="/products/android">Android <b>15</b></a><a href="/products/office-2024"><span>Office</span> <span>2024</span></a>
    <a href="/products/haiku">Haiku <span>4.5</span></a>
  </div></nav>`)).map(component => component.name), ['Microsoft 365', 'Sonnet 4.5', 'Build Preview', 'Windows 11', 'Region 2', 'Android 15', 'Office 2024', 'Haiku 4.5']);

  t.diagnostic('calls to action, downloads, release notes and "… more" links stay out, even inside a product menu');
  assert.deepEqual((await read(`<nav><div><button>Product</button>
    <a href="/product/ai">Acme AI</a><a href="/product/mail">Mail</a>
    <a href="/explore">Explore more →</a><a href="/download">Acme App →</a><a href="/download">Acme App</a>
    <a href="/gallery">Templates and more</a><a href="/product/calendar">Calendar →</a>
  </div></nav>`)).map(component => component.name), ['Acme AI', 'Mail']);

  t.diagnostic('titles and separate blocks supply names without merging their descriptions, irrespective of the words used');
  assert.deepEqual((await read(`<header><nav>
    <a href="/products/analytics"><div><h4>Analytics</h4><p>Podcast analytics software</p></div></a>
    <a href="/products/orbit"><span class="link-title">Orbit</span><span class="link-description">Everything your team needs</span></a>
    <a href="/products/relay"><div>Relay</div><div>Send messages across the world</div></a>
    <a href="/products/time"><span>Time</span> <span>tracking</span><small>Track every hour</small></a>
    <a href="/products/comet" title="Comet"><p>Keep every project moving</p></a>
  </nav></header>`)).map(component => component.name), ['Analytics', 'Orbit', 'Relay', 'Time tracking', 'Comet']);

  t.diagnostic('product groups and distinct app hosts beat marketing, account and documentation links');
  const products = await read(`<header><nav>
    <a href="/features/time-tracking">Time tracking</a>
    <div><button>Products</button><ul>
      <li><a href="/intake">Intake</a></li><li><a href="/plan">Plan</a></li>
      <li><a href="/products/features">Features and benefits</a></li>
      <li><a href="/products/pricing">Pricing</a></li><li><a href="/customers/acme">Acme</a></li>
      <li><a href="/features">Explore features</a></li><li><a href="/about">About us</a></li>
      <li><a href="/blog">Journal</a></li><li><a href="/careers">Team</a></li>
      <li><a href="/contact">Get in touch</a></li><li><a href="/legal/terms">Terms</a></li>
      <li><a href="/sign-in">Sign in</a></li><li><a href="/signup">Join</a></li>
      <li><a href="/docs">Documentation</a></li><li><a href="https://docs.example.com/">Reference</a></li>
    </ul></div>
    <a href="https://console.example.com/">Console</a>
    <div><button>Company</button><a href="/products/story">Our story</a></div>
  </nav></header>`);
  assert.deepEqual(products.map(component => component.name), ['Intake', 'Plan', 'Console']);
  assert.equal(products.at(-1).url, 'https://console.example.com/');
  assert.deepEqual(await read('<nav><a href="/products/one">One</a><a href="/pricing">Pricing</a></nav>'), [], 'a lone plausible product does not manufacture a component list');

  t.diagnostic('footer product headings work when the header has too little evidence; repeats merge before the cap');
  const names = ['Intake', 'Plan', 'Build', 'Observe', 'Relay', 'Orbit', 'Comet', 'Atlas', 'Beacon', 'Stream', 'Vault', 'Studio'];
  const capped = await read(`<nav><a href="/pricing">Pricing</a></nav><footer><div><h3>Product</h3>
    ${names.map((name, index) => `<a href="/${name.toLowerCase()}">${name}</a>${index === 0 ? '<a href="/intake?from=footer">Intake NEW</a><a href="/intake#more">Intake overview</a>' : ''}`).join('')}
    </div><div><h3>Company</h3><a href="/products/office">Office tour</a></div></footer>`);
  assert.ok(capped.length >= 2 && capped.length < names.length, 'a long product menu is capped');
  assert.deepEqual(capped.map(component => component.name), names.slice(0, capped.length), 'deduplication and selection preserve source order');

  t.diagnostic('over the cap, the areas the site links to and names most are kept, before pages beneath another area, still in site order');
  const catalogue = ['Atlas', 'Beacon', 'Billing', 'Capital', 'Climate', 'Connect', 'Ledger', 'Orbit', 'Payments', 'Radar', 'Terminal'];
  const chosen = await read(`<main><h1>Accept payments online</h1><p>Payments, Billing and Terminal for every business. Radar stops fraud; Connect pays out.</p></main>
    <nav><a href="/pricing">Pricing</a></nav><footer><div><h3>Products</h3>${catalogue.map(name => `<a href="/${name.toLowerCase()}">${name}</a>`).join('')}
    <a href="/payments/checkout">Checkout</a><a href="/payments/links">Payment links</a></div></footer>`);
  assert.deepEqual(chosen.map(component => component.name), ['Atlas', 'Beacon', 'Billing', 'Capital', 'Connect', 'Payments', 'Radar', 'Terminal']);

  t.diagnostic('large product menus: repeated and plan wording leave, each address keeps its card title, a catalogue index is not an area');
  const hubs = ['Mail', 'Chat', 'Talk'];
  const menu = await read(`<header><nav><div><button>Products</button>
    <a href="/products/everything">Free CRM</a><a href="/products/get-started">Overview of all products</a>
    ${hubs.map(hub => `<div><h3>${hub} Hub</h3><p>${hub} software</p><a href="/products/${hub.toLowerCase()}">Free forever</a></div>`).join('')}
    <div><h3>Mail Hub</h3><a href="/products/mail">Inbox zero tools</a></div>
    <a href="/products/team">Team plans</a><a href="/products/billing">Billing pricing</a>
    <div><h3><a href="/products/mail/ai-sorter">Automate mail sorting</a></h3><p>Sort every inbox</p></div>
    ${hubs.map(hub => `<a href="/products/${hub.toLowerCase()}"><h3>${hub} Hub</h3><p>${hub} software</p></a>`).join('')}
    <a href="/products/mail/ai-sorter">AI Sorter<span class="visually-hidden">AI Sorter</span></a>
  </div></nav></header>`);
  assert.deepEqual(menu.map(component => component.name), ['Free CRM', 'Mail Hub', 'AI Sorter', 'Chat Hub', 'Talk Hub']);
  assert.equal(menu[1].url, 'https://example.com/products/mail', 'the hub keeps its place and address under its own title');
  const shelf = ['Agents', 'Bases', 'GPUs', 'Metal', 'Engine', 'Data', 'Learning', 'Droplets', 'Clusters'];
  const indexed = await read(`<main><p>Evals for Learning. Evals everywhere: Evals, Evals. Droplets.</p></main><nav><a href="/pricing">Pricing</a></nav>
    <footer><div><h3>Products</h3><a href="/products">Catalogue</a>${shelf.map(name => `<a href="/products/${name.toLowerCase()}">${name}</a>${name === 'Learning' ? '<a href="/products/learning/evals">Evals</a>' : ''}`).join('')}</div></footer>`);
  assert.deepEqual(indexed.map(component => component.name), shelf.slice(0, 8), 'neither the index nor a page beneath an area takes a main area\'s place');

  t.diagnostic('the status page a business already runs, linked or at status.<its domain>, gives its own components, groups and past incidents from its public feeds (real Statuspage, Instatus and Better Stack captures) through the same guard; anything else changes nothing');
  {
  const feeds = folder => Object.fromEntries(readdirSync(`tests/fixtures/status-feeds/${folder}`).filter(name => name.startsWith('public-')).map(name => [name, readFileSync(`tests/fixtures/status-feeds/${folder}/${name}`, 'utf8')]));
  const json = text => ({ body: text, headers: { 'Content-Type': 'application/json' } });
  const xml = text => ({ body: text, headers: { 'Content-Type': 'application/xml' } });
  const poweredBy = href => ({ body: `<!doctype html><title>Status</title><main><p>All systems operational</p></main><footer><a href="${href}">Powered by</a></footer>` });
  const home = (name, status) => `<!doctype html><title>Home | ${name}</title><nav><a href="/products/one">One</a><a href="/products/two">Two</a></nav>${status ? `<footer><a href="${status}">Status</a></footer>` : ''}`;
  const [convex, zed, polar, valtown] = ['statuspage-convex', 'instatus-zed', 'betterstack-polar', 'betterstack-valtown'].map(feeds);
  const net = network({
    'https://convex.example/': { body: home('Convex', 'https://status.convex.dev/') },
    'https://status.convex.dev/': poweredBy('https://www.atlassian.com/software/statuspage'),
    'https://status.convex.dev/api/v2/summary.json': json(convex['public-summary.json']),
    'https://status.convex.dev/api/v2/incidents.json': json(convex['public-incidents.json']),
    // No link: the page answers at status.<domain>.
    'https://zed.example/': { body: home('Zed') },
    'https://status.zed.example/': poweredBy('https://instatus.com'),
    'https://status.zed.example/summary.json': json(zed['public-summary.json']),
    'https://status.zed.example/v2/components.json': json(zed['public-components.json']),
    'https://status.zed.example/history.atom': xml(zed['public-history.atom']),
    'https://polar.example/': { body: home('Polar', 'https://status.polar.sh/') },
    'https://status.polar.sh/': poweredBy('https://betterstack.com/uptime'),
    'https://status.polar.sh/index.json': json(polar['public-index.json']),
    'https://status.polar.sh/feed': xml(polar['public-feed.rss']),
    'https://valtown.example/': { body: home('Val Town', 'https://status.val.town/') },
    'https://status.val.town/': poweredBy('https://betterstack.com/uptime'),
    'https://status.val.town/index.json': json(valtown['public-index.json']),
    'https://status.val.town/feed': xml(valtown['public-feed.rss']),
    // Nothing to take: status.<domain> on a private address, a linked page no vendor's feeds answer for, a page without components.
    'https://private.example/': { body: home('Private') },
    'https://other.example/': { body: home('Other', 'https://status.other.example/') },
    'https://status.other.example/': { body: '<!doctype html><title>Our status</title><p>All good</p>' },
    'https://empty.example/': { body: home('Empty', 'https://status.empty.example/') },
    'https://status.empty.example/': poweredBy('https://www.atlassian.com/software/statuspage'),
    'https://status.empty.example/api/v2/summary.json': json(JSON.stringify({ page: { id: 'emptypage01', name: 'Empty' }, status: { indicator: 'none' }, components: [], incidents: [], scheduled_maintenances: [] })),
  }, { 'status.private.example': ['10.0.0.5'] });
  let stored = null;
  const service = createWebsiteService({ get: async () => stored, record: async (url, statusPage) => { stored = { url, statusPage }; }, clear: async () => { stored = null; } },
    { read: input => readSite(input, net), readStatusPage: url => readStatusPage(url, net), unavailable: null });
  const found = async input => (await service.read(input)).found;
  const listed = ({ existingPage: page }) => page.components.map(component => component.groupId ? `${page.groups.find(group => group.id === component.groupId).name} / ${component.name}` : component.name);
  const linked = await found('convex.example');
  assert.deepEqual(linked.components.map(component => component.name), ['One', 'Two'], 'the navigation is read as before');
  assert.deepEqual(stored.statusPage, { url: 'https://status.convex.dev/', source: 'statuspage', pageId: 'jx5n2jz8hhnj' }, 'Move in keeps its prefill');
  assert.deepEqual([linked.existingPage.host, linked.existingPage.source, linked.existingPage.pastIncidents], ['status.convex.dev', 'statuspage', 50]);
  assert.deepEqual(linked.existingPage.groups.map(group => group.name), ['Live Traffic', 'Development Services'], 'the page\'s own groups, in its order');
  assert.deepEqual(listed(linked), ['Live Traffic / Free & Starter', 'Live Traffic / Professional', 'Live Traffic / Business', 'Development Services / Free & Starter', 'Development Services / Professional', 'Development Services / Business', 'convex.dev website', 'AI Gateway']);
  const guessed = await found('zed.example');
  assert.equal(guessed.statusPage, 'https://status.zed.example/', 'a page at status.<domain> is found without a link');
  assert.deepEqual([guessed.existingPage.source, guessed.existingPage.pastIncidents], ['instatus', 16]);
  assert.deepEqual(listed(guessed), ['Agent', 'Zed / Collaboration', 'Zed / Edit Prediction', 'Zed / Extension Registry', 'Delta / Delta Cloud Services']);
  const sections = await found('polar.example');
  assert.deepEqual([sections.existingPage.source, sections.existingPage.groups.map(group => group.name), sections.existingPage.components.length, sections.existingPage.pastIncidents], ['betterstack', ['Production', 'Sandbox'], 12, 11]);
  const lone = await found('valtown.example');
  assert.deepEqual(listed(lone), ['Scheduled Vals', 'Val Town Website', 'HTTP Val', 'HTTP (Preview)'], 'a lone section is the page\'s list, and a vendor\'s names keep their words');
  assert.equal(lone.existingPage.pastIncidents, 77);
  for (const input of ['private.example', 'other.example', 'empty.example']) {
    const quiet = await found(input);
    assert.deepEqual([quiet.existingPage, quiet.components.map(component => component.name)], [null, ['One', 'Two']], `${input}: the navigation's components stand, with no error`);
  }
  assert.equal((await found('private.example')).statusPage, null, 'a private status.<domain> is neither requested nor shown');
  assert.equal(net.requested.some(url => url.includes('status.private.example')), false);
  assert.equal((await found('other.example')).statusPage, 'https://status.other.example/', 'a linked page stays linked');
  }
});
