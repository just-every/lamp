import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPublicAddress, readSite } from '../../src/core/platform/site-reader/index.ts';

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

  t.diagnostic('services, training, releases and other supporting pages stay out at any depth, even under Products');
  const supporting = [
    ['/services/training/', 'Product Training'], ['/services/onboarding/', 'Personalized onboarding'],
    ['/services/customer-success-management/', 'Customer success'], ['/services/', 'Professional Services'],
    ['/products/release-overview/', 'Product Releases'], ['/product-releases/', 'Recent changes'],
    ['/products/release_notes/', 'Recent changes'], ['/platform/productUpdates/', 'Recent changes'],
    ['/products/what%27s-new/', 'Recent changes'], ['/learn/orbit/', 'Orbit'], ['/resources/orbit/', 'Orbit'],
    ['/platform/productChangeLog.html', 'Recent changes'], ['/products/ai/', 'AI at Acme'],
    ['/products/academy/courses/', 'Orbit'], ['/apps/product-training/', 'Orbit'],
    ['/platform/premium-support/', 'Orbit'], ['/products/consulting/', 'Orbit'],
    ['/products/careers/', 'Orbit'], ['/platform/partner/', 'Orbit'], ['/apps/pricing/', 'Orbit'],
    ['/products/legal/', 'Orbit'], ['/legal/privacy/', 'Orbit'],
    ['/advisory/', 'Professional-services'], ['/welcome/', 'Product certification'],
    ['/changes/', 'Product updates'], ['/courses/', 'Product academy'], ['/assistance/', 'Premium support'],
    ['/supporting/', 'Premium support plans'],
  ];
  for (const [url, name] of supporting) {
    assert.deepEqual((await read(`<nav><div><button>Products</button>
      <a href="/products/data-services">Data Services</a><a href="/products/service">Service Hub</a>
      <a href="${url}">${name}</a>
    </div></nav>`)).map(component => component.name), ['Data Services', 'Service Hub'], `${url}: supporting pages leave independently of duplicate-label cleanup`);
  }
  assert.deepEqual((await read(`<nav><div><button>Products</button>
    ${supporting.map(([url, name]) => `<a href="${url}">${name}</a>`).join('')}
    <a href="/products/data-services">Data Services</a><a href="/products/learning-services">Learning Services</a>
    <a href="/products/service">Service Hub</a><a href="/products/secure-partner-access">Secure Partner Access</a>
    <a href="/products/customer-service-ops">Customer Service Ops</a>
    <div><h3>Training</h3><a href="/products/orbit">Orbit</a></div>
    <div><h3>Consulting</h3><a href="/products/relay">Relay</a></div>
  </div></nav>`)).map(component => component.name), ['Data Services', 'Learning Services', 'Service Hub', 'Secure Partner Access', 'Customer Service Ops']);

  t.diagnostic('hosting sites file products under /services/ and in a Services menu; consulting, implementation and a Services column beside Products stay out');
  const named = async html => (await read(html)).map(component => component.name);
  assert.deepEqual(await named(`<header><nav><div><button>Products</button>
    <a href="/services/cloud-servers/">Cloud Servers</a><a href="/services/kubernetes/">Managed Kubernetes</a><a href="/services/object-storage/">Object Storage</a>
  </div></nav></header>`), ['Cloud Servers', 'Managed Kubernetes', 'Object Storage']);
  assert.deepEqual(await named(`<header><nav><a href="/services/cloud-servers">Cloud servers</a><a href="/services/dedicated-server">Dedicated servers</a></nav></header>`), ['Cloud servers', 'Dedicated servers']);
  assert.deepEqual(await named(`<header><nav><div><button>Services</button>
    <a href="/dns/"><h4>DNS Management</h4><p>Manage DNS entries and zones</p></a><a href="/cloud/load-balancer/"><h4>Load Balancer</h4><p>Automatically distributing traffic</p></a>
    <a href="/services/consulting/">Cloud Consulting</a><a href="/services/implementation/">Implementation</a><a href="/custom-solutions/">Custom Solutions</a>
  </div></nav></header>`), ['DNS Management', 'Load Balancer'], 'a Services menu is the product menu of a site without another');
  assert.deepEqual(await named(`<header><nav><div><button>Platform</button>
    <div><div><span>Products</span></div><ul><li><a href="/products/deliver">Deliver</a></li><li><a href="/products/secure">Secure</a></li></ul></div>
    <div><div><span>Services</span></div><ul><li><a href="/services/managed-cdn">Managed CDN</a></li><li><a href="/services/managed-security">Managed Security</a></li></ul></div>
  </div></nav></header>`), ['Deliver', 'Secure'], 'a Services column beside a Products column is help around the products');
  assert.deepEqual(await named(`<header><nav><div><button>Services</button>
    <a href="/services/web-development">Web Development</a><a href="/services/product-design">Product Design</a>
    <a href="/services/machine-learning">Machine Learning</a><a href="/services/cloud-migration">Cloud Migration</a>
  </div></nav></header>`), [], "a consultancy's Services menu names work done for clients, not products");

  t.diagnostic('services, training, support and release navigation never become products, at any depth or slug spelling');
  const chrome = [
    ['/services/onboarding', 'Personalized onboarding'], ['/services/customer-success-management', 'Customer success'],
    ['/services/', 'Professional Services'], ['/products/release-overview', 'Product Releases'],
    ['/platform/product_releases', 'Recent changes'], ['/products/whatsNew', 'Latest news'],
    ['/products/changelog/archive', 'Timeline'], ['/apps/weekly-updates', 'Fresh additions'],
    ['/platform/customer-support', 'Assistance'], ['/tools/product-training', 'Courses'],
    ['/platform/academy/courses', 'Courses'], ['/products/career-opportunities', 'Open positions'],
    ['/products/partner-program', 'Ecosystem'], ['/apps/legal-notices', 'Notices'],
    ['/apps/pricing-options', 'Options'], ['/products/consulting', 'Expert advice'],
    ['/learn/product/one', 'Courseware'], ['/resources/products/two', 'Resources library'],
    ['/products/three', 'Product Training'], ['/products/four', 'Release Notes'],
    ['/platform/five', 'Consulting Services'], ['/products/six', 'Premium Support'],
    ['/products/seven', 'Success plans'], ['/products/eight', 'Product Academy'],
    ['/products/nine', 'What’s New'], ['/products/ten', 'Product Updates'],
    ['/enterprise/', 'Enterprise Class'], ['/compliance/', 'Regulatory Compliance'],
    ['/platform/strategy', 'AI at Acme'],
  ].map(([url, label]) => `<a href="${url}">${label}</a>`).join('');
  const operational = '<a href="/products/data">Data Services</a><a href="/products/learning">Learning Services</a><a href="/products/service">Service Hub</a>';
  assert.deepEqual((await read(`<nav><div><button>Products and pricing</button>${operational}${chrome}</div></nav>`)).map(component => component.name), ['Data Services', 'Learning Services', 'Service Hub']);
  assert.deepEqual(await read(`<nav><div><button>Products</button>${chrome}</div></nav>`), [], 'an empty product list stays empty rather than being filled with consulting offerings');
  assert.deepEqual((await read(`<nav>${operational}<div><h3>Training and support</h3><a href="/products/extra">Assistance</a></div></nav>`)).map(component => component.name), ['Data Services', 'Learning Services', 'Service Hub']);

  t.diagnostic('titles and separate blocks supply names without merging their descriptions, irrespective of the words used');
  assert.deepEqual((await read(`<header><nav>
    <a href="/products/analytics"><div><h4>Analytics</h4><p>Podcast analytics software</p></div></a>
    <a href="/products/orbit"><span class="link-title">Orbit</span><span class="link-description">Everything your team needs</span></a>
    <a href="/products/relay"><div>Relay</div><div>Send messages across the world</div></a>
    <a href="/products/time"><span>Time</span> <span>tracking</span><small>Track every hour</small></a>
    <a href="/products/comet" title="Comet"><p>Keep every project moving</p></a>
  </nav></header>`)).map(component => component.name), ['Analytics', 'Orbit', 'Relay', 'Time tracking', 'Comet']);

  assert.deepEqual((await read(`<nav aria-label="Products: Dropdown Content">
    <a href="/software/orbit"><div class="product-description-container"><div class="product-header"><strong>Orbit</strong></div><span class="product-description">Everything your team needs</span></div></a>
    <a href="/software/relay"><div class="description-wrapper"><h3>Relay <span class="badge">NEW</span></h3><p>Send messages across the world</p></div></a>
    <a href="/software/comet"><div class="description"><strong>Comet</strong><span class="description">Keep every project moving</span></div></a>
    <a href="/software/office">Microsoft <strong>365</strong></a>
  </nav>`)).map(component => component.name), ['Orbit', 'Relay', 'Comet', 'Microsoft 365'], 'description wrappers retain their structural titles without glued prose or number loss');

  t.diagnostic('description-styled wrappers expose their product title while the separate description stays out');
  assert.deepEqual((await read(`<nav>
    <a href="/products/converse"><div class="product-description-container"><div class="product-header"><strong>Converse</strong></div><span class="product-description">Discuss every project together</span></div></a>
    <a href="/products/orbit"><div class="description-wrapper"><h4>Orbit</h4><span class="description">Keep every project moving</span></div></a>
    <a href="/products/relay"><div class="description-container"><strong>Relay</strong><span class="description">Send messages across the world</span></div></a>
    <a href="/products/office"><strong>Office</strong> 2024</a>
    <a href="/products/observatory"><div class="description-layout"><h4>Observatory</h4><span>See every system together</span></div></a>
  </nav>`)).map(component => component.name), ['Converse', 'Orbit', 'Relay', 'Office 2024', 'Observatory']);
  assert.deepEqual((await read(`<nav><div aria-label="Products: Dropdown Content">
    <a href="/software/converse"><div class="product-description-container"><div class="product-header"><strong>Converse</strong></div><span class="product-description">Discuss every project together</span></div></a>
    <a href="/software/orbit"><div class="description-layout"><h4>Orbit</h4><span>Keep every project moving</span></div></a>
    <a href="/collections/team"><div>Supercharge every team</div><div>Converse Orbit</div></a>
  </div></nav>`)).map(component => component.name), ['Converse', 'Orbit'], 'a menu role suffix still exposes titled product links, without promoting a descriptive collection card');

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

  const namedMenu = await read(`<header><nav><div><button>Products</button>
    <a href="/platform/generative-ai/"><h3>Acme Advance</h3><p>Generative AI across operations</p></a>
    <a href="/platform/generative-ai/">Generative AI</a>
  </div></nav></header><footer><nav><div><h3>Platform</h3>
    <a href="/platform/generative-ai/">Generative AI</a><a href="/platform/relay/">Relay</a>
  </div></nav></footer>`);
  assert.deepEqual(namedMenu.map(component => component.name), ['Acme Advance', 'Relay'], 'the product menu title beats a URL-spelling label, including a nav inside the footer');

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
  const renamed = await read(`<header><nav><div><button>Products</button>
    <a href="/platform/generative-ai"><h3>Acme Advance</h3><p>Automate every task</p></a>
  </div></nav></header><footer><nav><div><h3>Platform</h3>
    <a href="/platform/generative-ai">Generative AI</a><a href="/platform/operations">Operations</a>
  </div></nav></footer>`);
  assert.deepEqual(renamed.map(component => component.name), ['Acme Advance', 'Operations'], 'the product-menu name beats a footer category that spells the URL');
  assert.equal(renamed[0].url, 'https://example.com/platform/generative-ai');
  const shelf = ['Agents', 'Bases', 'GPUs', 'Metal', 'Engine', 'Data', 'Learning', 'Droplets', 'Clusters'];
  const indexed = await read(`<main><p>Evals for Learning. Evals everywhere: Evals, Evals. Droplets.</p></main><nav><a href="/pricing">Pricing</a></nav>
    <footer><div><h3>Products</h3><a href="/products">Catalogue</a>${shelf.map(name => `<a href="/products/${name.toLowerCase()}">${name}</a>${name === 'Learning' ? '<a href="/products/learning/evals">Evals</a>' : ''}`).join('')}</div></footer>`);
  assert.deepEqual(indexed.map(component => component.name), shelf.slice(0, 8), 'neither the index nor a page beneath an area takes a main area\'s place');

  t.diagnostic('a footer <nav> product group is product evidence; over the cap the header\'s areas and names come first');
  assert.deepEqual((await read(`<header><nav><div><button>Toggle platform menu</button>
    <a href="/platform/runners/">Agent Runners</a><a href="/platform/database/">Database</a><a href="/platform/functions/">Functions</a>
    </div><a href="https://app.example.com/">Dashboard</a></nav></header><footer><nav><details><summary><h2>Products</h2></summary>
    <a href="/platform/runners/">Agent Runners</a><a href="/platform/functions/">Functions</a><a href="/platform/observability/">Observability</a>
    </details></nav></footer>`)).map(component => component.name), ['Dashboard', 'Agent Runners', 'Functions', 'Observability']);
  const operations = ['Cloud', 'Incidents', 'Automation', 'Agents', 'Advance', 'Service Ops', 'Insights'];
  assert.deepEqual((await read(`<main>${'<a href="/digital-operations/">Digital operations</a>'.repeat(6)}</main><header><nav><div><button>Products</button>
    ${operations.map(name => `<a href="/platform/${name.toLowerCase().replace(' ', '-')}/"><h3>${name}</h3><p>Run every part</p></a>`).join('')}
    <a href="/platform/service-ops/status-pages/"><h3>Status Pages</h3><p>One source of truth</p></a>
    </div></nav></header><footer><nav><div><h3>Platform</h3>
    <a href="/platform/cloud/">Cloud</a><a href="/digital-operations/">Digital Operations</a><a href="/platform/advance/">Generative AI</a>
    </div></nav></footer>`)).map(component => component.name), [...operations, 'Status Pages'], 'a footer-only page never displaces a header product, whatever its link count');

  t.diagnostic('a class names its element by its last word, without utility values or hashes; touching siblings and flex columns are separate lines');
  assert.deepEqual((await read(`<nav aria-label="Products"><div><button>Products</button>
    <a class="header-platform-card__link" href="/products/orbit/"><div class="header-platform-card__content"><h4 class="header-platform-card__title">Orbit</h4><p class="header-platform-card__description">Secure all of your identities.</p></div></a>
    <a href="/products/relay/" class="p-4 hover:bg-[var(--header-button-hover-bg)]"><div><span class="font-bold text-[var(--header-text)]">Relay</span></div><div class="text-sm text-[var(--header-text-muted)]">Themes and experts</div></a>
    <a class="title-card-link" href="/products/comet/"><div class="titleCard-title">Comet</div><div class="titleCard-content">The blueprint for teams</div></a>
    <a href="/products/beacon/"><h6 class="Nav_nav-subtitle__fMMCy">Beacon</h6><p class="Nav_nav-description__BJJEx">Build agents faster.</p></a>
    </div></nav>`)).map(component => component.name), ['Orbit', 'Relay', 'Comet', 'Beacon']);
  assert.deepEqual((await read(`<nav><div><button>Platform</button>
    <a href="/platform/journeys/"><span class="relative flex flex-col gap-1"><span class="text-14"><span>Journeys</span></span><span class="text-12 text-black/65">Understand paths to conversion</span></span></a>
    <a href="/product/analytics">Analytics<span>All things video performance.</span></a>
    <a href="/platform/storage/"><span class="flex items-center gap-1"><span>Acme</span><span>Cloud Storage</span></span></a>
    <a href="/platform/vault/"><span class="font-bwi">&#xf1a3;</span> Secrets Vault</a><a href="/products/orbit">- Orbit</a><a href="/products/relay">• Relay</a>
    </div></nav>`)).map(component => component.name), ['Journeys', 'Analytics', 'Acme Cloud Storage', 'Secrets Vault', 'Orbit', 'Relay'], 'an icon glyph and a list marker are not part of the name');
  assert.deepEqual((await read(`<nav><div><button>Platform</button>
    <a href="/products/comet/"><span class="menu-card__title--bold">Comet</span> <span class="menu-card__text">The blueprint for teams</span></a>
    <a href="/products/beacon/"><span class="nav-link--label">Beacon</span> <span>agents</span></a>
    <a href="/platform/surveys/"><span class="relative flex min-w-0 flex-col gap-1"><span class="text-14 flex items-center"><span>Surveys </span></span><span class="text-12">Collect feedback from users</span></span></a>
    <a href="/platform/replay/"><div class="flex flex-col">Session Replay <span>See every visit</span></div></a>
    </div></nav>`)).map(component => component.name), ['Comet', 'Beacon', 'Surveys', 'Session Replay'], 'a BEM modifier keeps a title a title; the children of a flex column are separate lines');

  t.diagnostic('comparison, alternative, audience, "why" and use-case pages, calls to action and compliance pages stay out; a decorative arrow is not a call to action');
  assert.deepEqual(await read(`<nav><a href="/">Home</a><div><button>Why Acme</button>
    <a href="/features/vs-google-analytics">Google Analytics</a><a href="/features/vs-cloudflare-web-analytics">Cloudflare Web Analytics</a>
    <a href="/why-acme/cookieless-analytics">Cookieless analytics</a></div>
    <a href="/vs-matomo">- vs Matomo</a><a href="/compare/acme-vs-segment">Segment Analytics</a><a href="/google-analytics-alternative">Google Analytics</a>
    <a href="/for-ecommerce">- Ecommerce analytics</a><a href="/white-label-web-analytics">- White-label analytics</a>
    <div><button>Who it's for</button><a href="/products/agencies">Agency analytics</a></div></nav>`), [], 'a single-product site with comparison pages stays honestly empty');
  assert.deepEqual(await read(`<nav><a href="/google-analytics">Acme vs Google Analytics</a><a href="/products/ga">Google Analytics alternative</a>
    <div><button>Compare</button><a href="/products/mixpanel">Mixpanel</a><a href="/products/heap">Heap</a></div></nav>`), [], 'a comparison named in the link or its group stays out');
  assert.deepEqual((await read(`<header><nav><div><button>Products</button><a href="/design/"><h3>Acme Design</h3></a>
    <div><h2>What you can do in Acme</h2><a href="/design-explore/"><p>Design and explore</p></a><a href="/build-ship/">Build and ship products</a></div>
    </div></nav></header><footer><div><h3>Product</h3><a href="/design/">Acme Design</a><a href="/slides/">Acme Slides</a>
    <a href="/design-explore/">Design and explore</a><a href="/build-ship/">Build and ship products</a></div></footer>`)).map(component => component.name), ['Acme Design', 'Acme Slides'], 'a use-case page the header files under a question stays out of the footer product list');
  assert.deepEqual((await read(`<header><nav><div><button>Solutions</button><a href="/incidents/">Incident Response</a><a href="/on-call/">On-call</a></div></nav></header>
    <footer><div><h3>Products</h3><a href="/incidents/">Incident Response</a><a href="/on-call/">On-call</a></div></footer>`)).map(component => component.name), ['Incident Response', 'On-call'], 'a product menu the header calls Solutions still lets the footer list its products');
  assert.deepEqual((await read(`<header><nav><div><button>Products</button>
    <a href="/websites"><span>Websites</span><span aria-hidden="true">→</span></a><a href="/invoicing"><span>Invoicing</span><span aria-hidden="true">→</span></a>
    <a href="/security-compliance"><h3>Security &amp; Compliance</h3><p>End-to-end data protection</p></a>
    <a href="/gdpr/">GDPR Compliance</a><a href="https://events.example.com/landing">Register now</a><a href="/early-access">Early access</a>
    <a href="/trust-center/">Security and trust</a><a href="https://trust.example.com/">Trust and safety</a><a href="/calendar">Calendar →</a>
    </div></nav></header>`)).map(component => component.name), ['Websites', 'Invoicing', 'Security & Compliance']);
  assert.deepEqual((await read(`<nav><a href="/pricing">Pricing</a></nav><footer>
    <div><h3>Products <span>Products</span> ↓</h3><a href="/orbit">Orbit</a><a href="/relay">Relay</a></div>
    <div><h3>Resources <span>Resources</span> ↓</h3><a href="/products/name-generator">Business Name Generator</a><a href="/tools/logo-maker">Logo Maker</a></div>
    <div><h3>Programs Programs ↓</h3><a href="/products/circle">Circle</a></div></footer>`)).map(component => component.name), ['Orbit', 'Relay'], 'a group label\'s arrow and responsive repeat are ignored; free tools and programmes stay out');

  t.diagnostic('a name is what a link shows: an icon named only by aria-label, title or alt is no component, while a visible card title names its overlay link');
  assert.deepEqual(await read(`<header><nav><a href="/data/" aria-label="Data &amp; Analytics"><div><div><span>Data &amp; Analytics</span></div><span>Future proof your data foundation</span></div></a></nav></header>
    <footer><a href="/preferences/email/manage" aria-label="Email"><span><svg></svg></span></a><a href="/analytics/" title="Analytics"><img src="/a.png" alt="Analytics"></a></footer>`), []);
  assert.deepEqual(await named(`<nav><div><button>Product</button>
    <div><a aria-label="Capture" href="/product/capture"> </a><div><img alt=""></div><div><h3>Capture</h3><p>Bring everything into one place</p></div></div>
    <div><h3>Agents</h3><a aria-label="Agents" href="/product/agents"></a></div>
  </div></nav>`), ['Capture', 'Agents']);
  assert.deepEqual(await named(`<nav><div><button>Products</button>
    <a href="/orbit"><img alt="orbit icon"><div><p>Orbit</p><p>Content creation and publishing</p></div></a>
    <a href="/relay"><img alt="relay icon"><div><p>New! Relay</p><p>Social inbox and care</p></div></a>
    <a href="/collections/teamwork"><div class="product-description-container"><div class="product-header"></div><span class="product-description">Supercharge teamwork</span><div><span>Orbit</span><span>Relay</span></div></div></a>
  </div></nav>`), ['Orbit', 'Relay'], 'two paragraphs are a name and its description; a leading badge and a marked description are not names');

  t.diagnostic('plain text heading a list labels it like a menu button, so use-case and audience lists stay out');
  assert.deepEqual(await named(`<nav><ul>
    <li><span>Product</span><ul><li><a href="/products/engage/">Engage</a></li><li><a href="/products/ai-workflows/">AI Workflows</a></li></ul></li>
    <li><span>Use Cases</span><ul><li><span>Specialized</span><ul><li><a href="/products/roadmaps/">Roadmapping</a></li><li><a href="/products/research-synthesis/">Research Synthesis</a></li></ul></li></ul></li>
    <li><p>By Team</p><div><ul><li><a href="/products/design/">Design and UX</a></li></ul></div></li>
  </ul></nav>`), ['Engage', 'AI Workflows']);

  t.diagnostic('calls to action, questions, events, demos, free tools, catalogues, programmes, solutions and analyst reports are no product areas, even under Products');
  assert.deepEqual(await named(`<header><nav><div><button>Products</button>
    <a href="/cdn/">CDN</a><a href="/storage/">Storage</a><a href="/products/reports">Reports</a><a href="/contact-sales/">Get in touch with sales</a>
    <a href="/launch-week">Launch Week</a><a href="/roi-calculator">ROI Calculator</a><a href="/tools">Free Tools</a>
    <a href="/products/cloud/free-tier/">What's in the free tier?</a><a href="/products/try.html">Trials and demos</a><a href="/demos">Demos</a>
    <a href="/methodology">How it works</a><a href="/products/education-grant"><h4>Education Grant</h4><p>Bring our power to your institution</p></a>
    <a href="/products/erp/grow.html">Midsize business solutions</a><a href="/circle"><h4>Circle</h4><p>The partner program for freelancers and agencies</p></a>
    <a href="/marketplace">Marketplace</a><div><a href="https://cloud.example.com/reports"><span>Reports</span></a></div><span>Analyst reports and studies by research institutes</span>
  </div></nav></header>`), ['CDN', 'Storage', 'Reports']);

  t.diagnostic('over the cap, a product named after the area it sits beneath is an area of its own, unlike a feature page beneath it');
  const family = ['Jira', 'Confluence', 'Jira Service Management', 'Rovo', 'Bitbucket', 'Guard', 'Loom', 'Focus', 'Talent', 'Pipelines'];
  assert.deepEqual((await read(`<header><nav><div><button>Products</button>
    ${family.map(name => `<a href="/software/${{ 'Jira Service Management': 'jira/service-management', Pipelines: 'bitbucket/pipelines' }[name] ?? name.toLowerCase()}"><h3>${name}</h3><p>Plan and track</p></a>`).join('')}
    </div></nav></header>`)).map(component => component.name), family.slice(0, 8));
});
