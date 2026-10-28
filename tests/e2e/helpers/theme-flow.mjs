import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { sessionCookieName } from '../../helpers/session-cookie.mjs';
import { themeBrowserFlow } from './theme-browser-flow.mjs';
import { themeFixture, settingsInput } from './theme-fixture.mjs';
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Runs in the existing public isolation/weight registration, without registering another case. */
export async function themeFlow({ appFetch, fetch, appUrl, pageUrl, sessionId, currentSettings, updateSettings, diagnostic = () => {} }) {
  const initial = await currentSettings();
  const input = settingsInput(initial);
  const headers = { Cookie: `${sessionCookieName(appUrl)}=${sessionId}`, Origin: appUrl, Accept: 'application/json' };
  async function save(theme, expected = 200) {
    const response = await appFetch('/api/app/page-settings', { method: 'PUT', body: JSON.stringify({ ...input, theme }) });
    const body = await response.json();
    assert.equal(response.status, expected, JSON.stringify(body));
    return body;
  }
  async function snapshot() {
    // Consume both large responses as their headers arrive. A closed local
    // connection must not hold an unread font-bearing stylesheet behind HTML.
    const [document, stylesheet] = await Promise.all(['/', '/assets/status-page.css'].map(async path => {
      const response = await fetch(pageUrl + path);
      assert.equal(response.status, 200);
      return { text: await response.text(), generation: response.headers.get('x-lamp-snapshot-version') };
    }));
    return { html: document.text, css: stylesheet.text, generation: document.generation };
  }
  async function unchanged(action, description) {
    const beforeSettings = await currentSettings();
    const beforeSnapshot = await snapshot();
    await action();
    assert.deepEqual(await currentSettings(), beforeSettings, `${description}: stored settings are unchanged`);
    assert.deepEqual(await snapshot(), beforeSnapshot, `${description}: the published snapshot and generation are unchanged`);
  }
  async function upload(kind, bytes, contentType, name) {
    const form = new FormData();
    form.set('kind', kind);
    form.set('asset', new Blob([bytes], { type: contentType }), name);
    const response = await fetch(appUrl + '/api/app/page-settings/theme-assets', { method: 'POST', body: form, headers });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.asset.kind, kind);
    assert.match(body.asset.path, /^\/assets\/theme\/[A-Z0-9]+\.(?:woff2|png|jpg|webp)$/);
    return body.asset.path;
  }

  try {
    diagnostic('THEME-001 — owned assets, all theme fields and script-free published markup');
    const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Jm4kAAAAASUVORK5CYII=', 'base64');
    const fontBytes = await readFile(new URL('../../../src/core/features/public-snapshot/fonts/inter-latin.woff2', import.meta.url));
    const headerImage = await upload('image', imageBytes, 'image/png', 'theme-header.png');
    const fontAsset = await upload('font', fontBytes, 'font/woff2', 'theme-font.woff2');
    const fakeFont = Buffer.alloc(48); fakeFont.write('wOF2'); fakeFont.writeUInt32BE(48, 8);
    for (const [bytes, kind, type, name] of [[fakeFont, 'font', 'font/woff2', 'signature-only.woff2'], [fontBytes.subarray(0, -1), 'font', 'font/woff2', 'truncated.woff2'], [Buffer.from('not an image'), 'image', 'image/png', 'wrong-bytes.png']]) await unchanged(async () => {
      const form = new FormData(); form.set('kind', kind); form.set('asset', new Blob([bytes], { type }), name);
      const refused = await fetch(appUrl + '/api/app/page-settings/theme-assets', { method: 'POST', body: form, headers });
      assert.equal(refused.status, 400, await refused.text());
    }, `invalid upload ${name}`);
    const theme = themeFixture({
      font: 'uploaded', fontAsset, headerImage,
      headerLinks: [{ label: 'Customer home', href: 'https://www.atlascloud.example/' }, { label: 'Service history', href: '/history' }],
      footerLinks: [{ label: 'Help centre', href: 'https://help.atlascloud.example/' }, { label: 'Status feed', href: '/feed.atom' }],
      headerHtml: `<nav class="owner-header"><p><strong>Atlas service record</strong><em>Always available</em><br><span>Customer updates</span></p><ul><li><a href="/history">Browse history</a></li></ul><img src="${headerImage}" alt="Uploaded status header"></nav>`,
      footerHtml: '<p class="owner-footer"><strong>Contact our team</strong></p><ol><li><a href="https://help.atlascloud.example/">Support</a></li></ol>',
      groupsExpanded: false, hiddenUptimeComponents: ['01J00000000000000000000010'], historyDays: 14,
      css: '.owner-header { padding-block: 7px; } h1 { letter-spacing: .035em; } @media (min-width: 40rem) { .owner-footer { padding-block: 9px; } }',
    });
    const saved = await save(theme);
    assert.deepEqual(saved.settings.theme, theme, 'each requested theme field is retained');
    assert.deepEqual(saved.removals, []);
    const published = await snapshot();
    assert.match(published.html, /<body\b[^>]*data-lamp-theme/);
    for (const [label, href] of [...theme.headerLinks, ...theme.footerLinks].map(link => [link.label, link.href])) assert.match(published.html, new RegExp(`href="${escapeRegex(href)}"[^>]*>${escapeRegex(label)}<`));
    assert.ok(published.html.includes(theme.headerHtml), 'sanitized header markup is in the initial snapshot');
    assert.ok(published.html.includes(theme.footerHtml), 'sanitized footer markup is in the initial snapshot');
    assert.match(published.html, new RegExp(`class="theme-header-image"[^>]*>[\\s\\S]*?src="${escapeRegex(headerImage)}"`));
    assert.match(published.css, /body\[data-lamp-theme\]/, 'owner CSS is scoped to the public page');
    for (const color of [...Object.values(theme.palette).filter(value => typeof value === 'string'), ...Object.values(theme.palette.states)]) assert.ok(published.css.toLowerCase().includes(color), `snapshot stylesheet retains ${color}`);
    assert.ok(published.css.includes(fontAsset), 'the stylesheet serves the uploaded WOFF2 from its own origin');
    assert.match(published.css, /letter-spacing:\s*\.035em/);
    assert.doesNotMatch(published.html, /<details\b[^>]*class="[^"]*theme-component-group[^"]*"[^>]*\bopen(?:[\s=>])/, 'configured groups start collapsed without script');
    const row = new RegExp(`<article\\b[^>]*data-component-id="${theme.hiddenUptimeComponents[0]}"[^>]*>[\\s\\S]*?<\\/article>`).exec(published.html)?.[0];
    assert.ok(row, 'the component remains public');
    assert.doesNotMatch(row, /class="uptime-mark |class="uptime-marks"/, 'its uptime bar is omitted without hiding its state');
    assert.match(row, /class="uptime-number"/, 'hiding a bar preserves the component uptime figure required by PAGE-001');
    assert.match(row, /Web application/);
    assert.match(published.html, /last 14 days/);
    for (const [path, bytes, contentType] of [[headerImage, imageBytes, 'image/png'], [fontAsset, fontBytes, 'font/woff2']]) {
      const asset = await fetch(pageUrl + path);
      assert.equal(asset.status, 200);
      assert.ok(asset.headers.get('content-type').startsWith(contentType));
      assert.deepEqual(Buffer.from(await asset.arrayBuffer()), bytes, `${path}: uploaded bytes survive snapshot publication`);
    }
    assert.ok(gzipSync(Buffer.from(published.html)).byteLength <= 50 * 1024, 'custom CSS retains the PAGE-003 initial HTML budget');
    const origin = new URL(pageUrl).origin;
    const isolatedPage = await fetch(pageUrl + '/');
    assert.equal(isolatedPage.headers.get('content-security-policy'), `default-src ${origin}; script-src ${origin}; style-src ${origin}; font-src 'self' data:; img-src ${origin}; connect-src ${origin}; form-action ${origin}; base-uri ${origin}; frame-ancestors 'none'; object-src 'none'`);
    await isolatedPage.arrayBuffer();
    await save({ ...theme, css: `.owner-header { background-image: url("${headerImage}"); }` });
    assert.ok((await snapshot()).css.includes(headerImage), 'valid CSS can use an image uploaded to the page origin');
    const portable = await save({ ...theme, css: `.owner-header { background-image: url("${pageUrl}${headerImage}?version=1#header"); }`, headerHtml: `<img src="${pageUrl}${headerImage}" alt="Owned absolute image">` });
    assert.deepEqual(portable.removals, [], 'an absolute own-origin uploaded image is accepted');
    assert.equal(portable.settings.theme.headerHtml, `<img src="${headerImage}" alt="Owned absolute image">`);
    assert.ok(portable.settings.theme.css.includes(`${headerImage}?version=1#header`) && !portable.settings.theme.css.includes(pageUrl), 'same-origin CSS URLs become portable paths with query and fragment retained');

    diagnostic('THEME-001 — invalid CSS names its offending construct and cannot mutate publication');
    for (const [css, offending] of [
      ['@import "https://outside.example/theme.css";', /@import/i],
      ['@\\69mport "https://outside.example/theme.css";', /@import/i],
      ['.brand { background: url(https://outside.example/image.png); }', /url\(\)|url\(|external|origin/i],
      ['.brand { background: u\\72l("https://outside.example/image.png"); }', /url\(\)|url\(|external|origin/i],
      ['.brand { width: expression(alert(1)); }', /expression/i],
      ['.brand { behavior: url(/asset.htc); }', /behavior/i],
      ['.brand { color: red; } }', /syntax|css|parse/i],
    ]) await unchanged(async () => {
      const body = await save({ ...theme, css }, 400);
      assert.match(JSON.stringify(body), offending);
    }, `refused CSS ${css}`);

    diagnostic('THEME-001 — every configured text/link/state pair is contrast checked before mutation');
    for (const patch of [
      { text: theme.palette.background },
      { surface: theme.palette.text },
      { link: theme.palette.surface },
      ...Object.keys(theme.palette.states).map(state => ({ states: { ...theme.palette.states, [state]: theme.palette.surface } })),
    ]) await unchanged(async () => {
      const refused = await save({ ...theme, palette: { ...theme.palette, ...patch } }, 400);
      assert.match(JSON.stringify(refused), /contrast|4\.5/i);
    }, 'insufficient contrast');

    diagnostic('THEME-001 — unsafe HTML is removed and each removal is returned to the owner');
    const malicious = '<p onclick="alert(1)" style="color:red">A safe announcement</p><script>alert(2)</script><img src="https://outside.example/tracker.png" alt="External"><iframe src="https://outside.example/"></iframe><form><input name="private"></form>';
    const cleaned = await save({ ...theme, headerHtml: malicious });
    assert.ok(cleaned.settings.theme.headerHtml.includes('A safe announcement'));
    assert.doesNotMatch(cleaned.settings.theme.headerHtml, /script|onclick|style=|outside\.example|iframe|form|input/i);
    for (const removal of [/script/i, /onclick/i, /external.*img|img.*external/i, /style/i, /iframe/i, /form/i]) assert.ok(cleaned.removals.some(value => removal.test(value)), `save response names ${removal}`);
    const sanitized = await snapshot();
    assert.match(sanitized.html, /A safe announcement/);
    assert.doesNotMatch(sanitized.html, /alert\(1\)|alert\(2\)|outside\.example\/tracker/);
    await unchanged(async () => { await save({ ...theme, headerHtml: 'x'.repeat(8193) }, 400); }, 'header HTML exceeds 8 KB');
    await unchanged(async () => { await save({ ...theme, footerHtml: 'x'.repeat(8193) }, 400); }, 'footer HTML exceeds 8 KB');
    await unchanged(async () => { await save({ ...theme, headerHtml: 'é'.repeat(4097) }, 400); }, 'HTML limit measures bytes');

    diagnostic('THEME-001 — only authenticated same-origin uploads and owned asset references can change a page');
    for (const patch of [{ headerImage: 'https://outside.example/header.png' }, { headerImage: '/assets/theme/00000000000000000000000000.png' }, { fontAsset: 'https://outside.example/font.woff2' }, { fontAsset: headerImage }]) await unchanged(async () => { await save({ ...theme, ...patch }, 400); }, 'unowned or wrong-kind asset');
    await unchanged(async () => {
      const signedOut = await fetch(appUrl + '/api/app/page-settings', { method: 'PUT', headers: { Origin: appUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, theme }) });
      assert.equal(signedOut.status, 401);
      await signedOut.arrayBuffer();
      const crossOrigin = await appFetch('/api/app/page-settings', { method: 'PUT', headers: { Origin: 'https://outside.example' }, body: JSON.stringify({ ...input, theme }) });
      assert.equal(crossOrigin.status, 403);
      await crossOrigin.arrayBuffer();
      const form = new FormData(); form.set('kind', 'image'); form.set('asset', new Blob([imageBytes], { type: 'image/png' }), 'refused.png');
      const refusedUpload = await fetch(appUrl + '/api/app/page-settings/theme-assets', { method: 'POST', body: form, headers: { Origin: appUrl } });
      assert.equal(refusedUpload.status, 401);
      await refusedUpload.arrayBuffer();
    }, 'unauthorized save/upload');

    await save(theme);
    await themeBrowserFlow({ appFetch, appUrl, pageUrl, sessionId, theme, fontBytes, imageBytes, diagnostic });
  } finally {
    await updateSettings({ ...input, theme: initial.theme });
  }
}
