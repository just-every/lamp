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
  assert.deepEqual(site.components.map(component => component.name), ['Time tracking', 'Invoicing and Payments', 'Reporting']);
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
});
