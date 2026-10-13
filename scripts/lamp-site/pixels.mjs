// The landing page image scripts' shared pixel work: hashing, and rendering the SVG mark to PNG icons in Playwright
// Chromium, so the icons are drawn by the same engine that draws the mark on the page.
import { createHash } from "node:crypto";
import { chromium } from "playwright";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Opens a Chromium page. `icon(svg, { size, mark, paper, radius })` draws the SVG `mark` px tall, centred on a
 * `size` px square of `paper` with corners rounded by `radius` (outside them transparent), and returns its PNG.
 * `close()` frees the browser.
 */
export async function openPixels() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  return {
    async icon(svg, { size, mark, paper, radius }) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<!doctype html><html><head><style>body { margin: 0; background: transparent; }
        div { display: grid; place-items: center; width: ${size}px; height: ${size}px; border-radius: ${radius}px; background: ${paper}; }
        svg { display: block; width: ${mark}px; height: ${mark}px; }</style></head><body><div>${svg}</div></body></html>`);
      return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    },
    async close() { await browser.close(); },
  };
}
