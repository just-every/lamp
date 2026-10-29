import { themeHeaderImage, themeSettings } from "./theme-fixture.mjs";
import { themeTemplateFlow } from "./theme-template-flow.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { themeBrowserFlow } from "./theme-browser-flow.mjs";

export async function themeFlow({ appFetch, fetch, appUrl, pageUrl, currentSettings, updateSettings, sessionId, cookieName, diagnostic }) {
  const original = await currentSettings();
  const defaults = original.theme;
  const components = (await (await appFetch("/api/app/components")).json()).components;
  const hidden = components.find(component => component.name === "Web application");
  assert.ok(hidden, "the owner has a real public component to hide its bar");
  const theme = themeSettings(defaults, hidden.id);
  const requestTheme = async (value, status = 200) => {
    const response = await appFetch("/api/app/page-settings", { method: "PUT", body: JSON.stringify({ pageName: original.pageName, tagline: original.tagline, accentColor: original.accentColor, timezone: original.timezone, hostname: original.hostname, footerCreditEnabled: original.footerCreditEnabled, theme: value }) });
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  };
  const snapshot = async marker => {
    let text = "";
    const deadline = performance.now() + 10_000;
    do {
      text = await (await fetch(`${pageUrl}/`)).text();
      if (text.includes(marker)) return text;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (performance.now() < deadline);
    assert.fail(`Theme did not reach the public snapshot: ${marker}`);
  };
  try {
    diagnostic("THEME-001 — owner settings reach the retained page; unsafe CSS and HTML never execute");
    const saved = await requestTheme(theme);
    assert.deepEqual(saved.settings.theme, theme);
    const beforeRefusal = await currentSettings();
    for (const [css, rule] of [
      ['@import "https://example.test/theme.css";', /@import/],
      ['p { background: url("https://example.test/pixel.png") }', /url\(\)/],
      ['p { width: expression(alert(1)) }', /expression/],
      ['p { behavior: url("/assets/logo") }', /behavior/],
      ['@im\\70ort "https://example.test/theme.css";', /@import/],
      ['p { background: u\\72l("https://example.test/pixel.png") }', /url\(\)/],
    ]) {
      const refused = await requestTheme({ ...theme, customCss: css }, 400);
      assert.match(refused.error, rule);
      assert.deepEqual((await currentSettings()).theme, beforeRefusal.theme, "refused CSS leaves persisted settings unchanged");
    }
    for (const key of ["text", "link", "operational", "degraded", "partial", "major", "maintenance"]) {
      const refused = await requestTheme({ ...theme, palette: { ...theme.palette, [key]: "#eeeeee" } }, 400);
      assert.match(refused.error, /contrast.*4\.5:1/i);
      assert.match(refused.error, new RegExp(`Palette ${key} against (background|surface)`));
      assert.deepEqual((await currentSettings()).theme, beforeRefusal.theme);
    }
    const sanitized = await requestTheme({ ...theme, headerHtml: `${theme.headerHtml}<script>window.themeUnsafe=1</script><p onclick="window.themeUnsafe=2" style="color:red">Safe note</p><img src="https://example.test/pixel.png"><form><input></form><iframe src="https://example.test"></iframe>` });
    assert.doesNotMatch(sanitized.settings.theme.headerHtml, /script|onclick|style=|<img|<form|<iframe/);
    for (const removal of [/<script>/, /onclick/, /src.*<img>/]) assert.ok(sanitized.settings.themeRemovals.some(value => removal.test(value)), `save response reports ${removal}`);
    const oversize = await requestTheme({ ...theme, footerHtml: "é".repeat(4097) }, 400);
    assert.match(oversize.error, /8192/);
    assert.deepEqual((await currentSettings()).theme, sanitized.settings.theme, "oversized HTML leaves the saved theme unchanged");
    const image = themeHeaderImage();
    const font = await readFile(new URL("../../../src/core/features/public-snapshot/fonts/inter-latin.woff2", import.meta.url));
    const seed = JSON.parse(await readFile(new URL("../../../seed.json", import.meta.url), "utf8"));
    const upload = async (kind, bytes, type, authenticated = true) => {
      const body = new FormData();
      body.set("file", new Blob([bytes], { type }), `synthetic-lamp-${kind}`);
      return fetch(`${appUrl}/api/app/page-settings/theme-assets/${kind}`, { method: "POST", body, headers: { Origin: appUrl, Accept: "application/json", ...(authenticated ? { Cookie: `${cookieName}=${sessionId}` } : {}) } });
    };
    for (const [kind, bytes, type] of [["font", Buffer.from("synthetic-lamp-3"), "font/woff2"], ["header", Buffer.from("synthetic-lamp-4"), "image/png"], ["header", image, "image/svg+xml"], ["header", Buffer.alloc(seed.limits.uploadMaxBytes.value + 1), "image/png"]]) {
      const refused = await upload(kind, bytes, type);
      assert.equal(refused.status, 400, "invalid uploaded bytes and types are refused");
      assert.deepEqual((await currentSettings()).theme, sanitized.settings.theme);
    }
    await updateSettings({ theme: defaults });
    await themeBrowserFlow({ appUrl, pageUrl, sessionId, cookieName, theme, image, font, currentSettings, snapshot });
    const published = await currentSettings();
    assert.equal(published.theme.font, "uploaded");
    assert.equal(published.theme.headerImage, true);
    const fontResponse = await fetch(`${pageUrl}/assets/theme-font`);
    assert.equal(fontResponse.status, 200);
    assert.equal(fontResponse.headers.get("set-cookie"), null);
    assert.match(fontResponse.headers.get("content-type"), /font\/woff2/);
    assert.match(fontResponse.headers.get("content-disposition"), /attachment/);
    assert.deepEqual(Buffer.from(await fontResponse.arrayBuffer()), font);
    const headerResponse = await fetch(`${pageUrl}/assets/theme-header`);
    assert.match(headerResponse.headers.get("content-type"), /image\/png/);
    assert.match(headerResponse.headers.get("content-disposition"), /attachment/);
    assert.deepEqual(Buffer.from(await headerResponse.arrayBuffer()), image);
    const html = await snapshot("Service updates from the Atlas team.");
    assert.match(html, /<details class="component-group">/);
    assert.match(html, /Uptime over the last 14 days/);
    const web = html.slice(html.indexOf('<h4>Web application</h4>'), html.indexOf('<h4>API gateway</h4>'));
    assert.doesNotMatch(web, /class="uptime-marks"/);
    assert.match(web, /class="uptime-number"/, "hiding the bar keeps the component’s numeric uptime");
    const api = html.slice(html.indexOf('<h4>API gateway</h4>'), html.indexOf('<h4>Customer portal</h4>'));
    assert.equal([...api.matchAll(/class="uptime-mark /g)].length, theme.historyDays, "the public bar has the chosen number of days");
    const css = await (await fetch(`${pageUrl}/assets/status-page.css`)).text();
    assert.match(css, /body\.lamp-public.*owner-note/);
    assert.match(css, /--paper:#f4f4f4/);
    const anonymous = await fetch(`${appUrl}/api/app/page-settings`, { method: "PUT", headers: { "Content-Type": "application/json", Origin: appUrl }, body: JSON.stringify({ ...original, theme }) });
    assert.ok([401,403].includes(anonymous.status));
    for (const kind of ["font", "header"]) {
      assert.ok([401,403].includes((await upload(kind, kind === "font" ? font : image, kind === "font" ? "font/woff2" : "image/png", false)).status));
      const removed = await fetch(`${appUrl}/api/app/page-settings/theme-assets/${kind}`, { method: "DELETE", headers: { Origin: appUrl } });
      assert.ok([401,403].includes(removed.status));
    }
    assert.deepEqual((await currentSettings()).theme, published.theme, "an unauthenticated write changes nothing");
    assert.deepEqual(Buffer.from(await (await fetch(`${pageUrl}/assets/theme-header`)).arrayBuffer()), image, "unauthenticated asset changes leave the publication intact");
    await themeTemplateFlow({ appFetch, pageUrl, updateSettings, snapshot, palette: theme.palette });
    await updateSettings({ template: "default" });
    return { customCss: theme.customCss };
  } finally {
    await updateSettings({ theme: defaults, template: original.template });
  }
}

