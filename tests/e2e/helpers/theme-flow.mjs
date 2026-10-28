import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { themeBrowserFlow } from "./theme-browser-flow.mjs";

export async function themeFlow({ appFetch, fetch, appUrl, pageUrl, currentSettings, updateSettings, sessionId, cookieName, diagnostic }) {
  const original = await currentSettings();
  const defaults = original.theme;
  const theme = {
    ...defaults,
    palette: { background: "#f4f4f4", surface: "#ffffff", text: "#172d24", link: "#195138", operational: "#185a3b", degraded: "#745000", partial: "#884500", major: "#a12619", maintenance: "#354d81" },
    font: "serif", headerImage: false,
    headerLinks: [{ label: "Customer support", href: "https://example.test/support" }],
    footerLinks: [{ label: "Service history", href: "/history" }],
    headerHtml: '<nav class="owner-note"><p>Service updates from the Atlas team.</p></nav>',
    footerHtml: '<p><strong>Always here to help.</strong></p>',
    groupsCollapsed: true, hiddenUptimeComponentIds: ["01J00000000000000000000010"], historyDays: 14,
    customCss: '.owner-note { letter-spacing: 0.4px } .theme-footer { padding: 17px }',
  };
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
      assert.deepEqual((await currentSettings()).theme, beforeRefusal.theme);
    }
    const sanitized = await requestTheme({ ...theme, headerHtml: `${theme.headerHtml}<script>window.themeUnsafe=1</script><p onclick="window.themeUnsafe=2" style="color:red">Safe note</p><img src="https://example.test/pixel.png"><form><input></form><iframe src="https://example.test"></iframe>` });
    assert.doesNotMatch(sanitized.settings.theme.headerHtml, /script|onclick|style=|<img|<form|<iframe/);
    for (const removal of [/<script>/, /onclick/, /src.*<img>/]) assert.ok(sanitized.settings.themeRemovals.some(value => removal.test(value)), `save response reports ${removal}`);
    const oversize = await requestTheme({ ...theme, footerHtml: "é".repeat(4097) }, 400);
    assert.match(oversize.error, /8192/);
    assert.deepEqual((await currentSettings()).theme, sanitized.settings.theme, "oversized HTML leaves the saved theme unchanged");
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAF/gL+3N9nPwAAAABJRU5ErkJggg==", "base64");
    const font = await readFile(new URL("../../../src/core/features/public-snapshot/fonts/inter-latin.woff2", import.meta.url));
    await themeBrowserFlow({ appUrl, pageUrl, sessionId, cookieName, theme, image, font, currentSettings, snapshot });
    const published = await currentSettings();
    assert.equal(published.theme.font, "uploaded");
    assert.equal(published.theme.headerImage, true);
    const fontResponse = await fetch(`${pageUrl}/assets/theme-font`);
    assert.equal(fontResponse.status, 200);
    assert.deepEqual(Buffer.from(await fontResponse.arrayBuffer()), font);
    const headerResponse = await fetch(`${pageUrl}/assets/theme-header`);
    assert.deepEqual(Buffer.from(await headerResponse.arrayBuffer()), image);
    const html = await snapshot("Service updates from the Atlas team.");
    assert.match(html, /<details class="component-group">/);
    assert.match(html, /Uptime over the last 14 days/);
    const web = html.slice(html.indexOf('<h4>Web application</h4>'), html.indexOf('<h4>API gateway</h4>'));
    assert.doesNotMatch(web, /class="uptime-marks"/);
    const css = await (await fetch(`${pageUrl}/assets/status-page.css`)).text();
    assert.match(css, /body\.lamp-public.*owner-note/);
    assert.match(css, /--paper:#f4f4f4/);
    const anonymous = await fetch(`${appUrl}/api/app/page-settings`, { method: "PUT", headers: { "Content-Type": "application/json", Origin: appUrl }, body: JSON.stringify({ ...original, theme }) });
    assert.ok([401,403].includes(anonymous.status));
    for (const template of ["calm", "uptime", "regions"]) {
      await updateSettings({ template });
      const shown = await snapshot(template === "regions" ? 'data-template="calm"' : `data-template="${template}"`);
      assert.match(shown, /Service updates from the Atlas team/);
      assert.match(shown, /Always here to help/);
    }
    await updateSettings({ template: "default" });
    return { customCss: theme.customCss };
  } finally {
    await updateSettings({ theme: defaults, template: original.template });
  }
}

export function assertThemedPageWeight(html) {
  const bytes = gzipSync(Buffer.from(html)).byteLength;
  assert.ok(bytes <= 50 * 1024, `Custom-CSS snapshot exceeded the HTML weight budget: ${bytes}`);
}
