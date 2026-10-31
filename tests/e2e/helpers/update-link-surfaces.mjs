import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { assertPublishedUpdateHtml, assertLinkedFeed, assertPublicCsp } from './update-link-evidence.mjs';

/** The existing source aliases and both component feed formats share this publication. */
export async function assertUpdateLinkSurfaces(j, incident, component, update, { history = false } = {}) {
  const pages = history ? ['/history', `/incidents/${incident.reference}`] : ['/', `/incidents/${incident.reference}`];
  for (const path of pages) {
    const html = await j.visible(path, update.details);
    assertPublishedUpdateHtml(html, path, update);
    const response = await j.publicResponse(path);
    assertPublicCsp(response.headers, j.publicOrigin, path);
    await response.arrayBuffer();
  }
  for (const path of ['/feed.atom', '/feed.rss', '/history.atom', '/history.rss',
    `/components/${component.id.toLowerCase()}/feed.atom`, `/components/${component.id.toLowerCase()}/feed.rss`]) {
    assertLinkedFeed(await j.publicText(path), path, update);
  }
}

/** Reuse the public journey's browser and actual published page at both reader widths. */
export async function assertUpdateLinkScreens(page, j, incident, update, { history = false } = {}) {
  const originalViewport = page.viewportSize();
  const paths = history ? ['/history'] : ['/', `/incidents/${incident.reference}`];
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const path of paths) {
        const response = await page.goto(j.publicOrigin + path);
        assert.equal(response.status(), 200);
        assertPublishedUpdateHtml(await page.content(), `${path} at ${width}`, update);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} at ${width}: no horizontal overflow`);
        if (process.env.LAMP_SCREENSHOTS) {
          await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
          const name = path === '/' ? 'root' : path === '/history' ? 'history' : 'permalink';
          await page.screenshot({ path: join(process.env.LAMP_SCREENSHOTS, `${width}-update-links-${name}.png`), fullPage: true });
        }
      }
    }
  } finally { await page.setViewportSize(originalViewport); }
}
