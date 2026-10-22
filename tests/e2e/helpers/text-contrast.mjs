import { inflateSync } from 'node:zlib';

// WCAG AA contrast of every text run against the real background behind it: the page is shot with all text made
// transparent, and each run's colour is compared with every pixel under each of its line boxes. It measures what a
// reader sees over the picture's light and the stone, which axe leaves as "needs review" over gradients.

/** An 8-bit, non-interlaced RGB or RGBA PNG, as Chromium writes screenshots, to RGBA pixels. */
function decodePng(buffer) {
  let offset = 8, width = 0, height = 0, channels = 0;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8), chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      if (chunk[8] !== 8 || chunk[12] !== 0 || (chunk[9] !== 2 && chunk[9] !== 6)) throw new Error('Only 8-bit, non-interlaced RGB or RGBA screenshots are read.');
      channels = chunk[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') data.push(chunk);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data)), stride = width * channels, pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0, up = previous[x], corner = x >= channels ? previous[x - channels] : 0;
      const guess = left + up - corner, pick = Math.abs(guess - left) <= Math.abs(guess - up) && Math.abs(guess - left) <= Math.abs(guess - corner) ? left : Math.abs(guess - up) <= Math.abs(guess - corner) ? up : corner;
      line[x] = (line[x] + [0, left, up, (left + up) >> 1, pick][filter]) & 255;
    }
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) pixels[(y * width + x) * 4 + channel] = line[x * channels + channel];
      pixels[(y * width + x) * 4 + 3] = channels === 4 ? line[x * 4 + 3] : 255;
    }
    previous = line;
  }
  return { width, height, pixels };
}

const linear = (value) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const ratio = (first, second) => { const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a); return (high + 0.05) / (low + 0.05); };

/** Every visible text run with its worst contrast and the ratio WCAG AA asks of it (3:1 for large text). */
export async function textContrast(page) {
  const runs = await page.evaluate(() => {
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!element || !node.textContent?.trim()) continue;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      // Text for assistive technology only (a 1px clipped box) is not read off the screen.
      if (box.width <= 1 || box.height <= 1 || style.visibility === 'hidden') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((rect) => rect.width >= 2 && rect.height >= 2).map((rect) => ({ x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height }));
      const colour = style.color.match(/[\d.]+/g)?.map(Number) ?? [];
      const size = Number.parseFloat(style.fontSize), weight = Number(style.fontWeight) || 400;
      if (rects.length) found.push({ text: node.textContent.trim().slice(0, 48), colour, large: size >= 24 || (size >= 18.66 && weight >= 700), rects });
    }
    return found;
  });
  // Through the CSSOM, which the public page's CSP allows; a style element would be refused.
  const hiding = { color: 'transparent', '-webkit-text-fill-color': 'transparent', 'text-shadow': 'none', 'text-decoration-color': 'transparent' };
  await page.evaluate((properties) => { for (const element of document.querySelectorAll('body *')) for (const [name, value] of Object.entries(properties)) element.style.setProperty(name, value, 'important'); }, hiding);
  const shot = decodePng(await page.screenshot({ fullPage: true, type: 'png', animations: 'disabled' }));
  await page.evaluate((names) => { for (const element of document.querySelectorAll('body *')) for (const name of names) element.style.removeProperty(name); }, Object.keys(hiding));
  return runs.map((run) => {
    const [r, g, b, alpha = 1] = run.colour;
    let worst = Infinity;
    for (const rect of run.rects) {
      for (let y = Math.max(0, Math.floor(rect.y)); y < Math.min(shot.height, Math.ceil(rect.y + rect.height)); y += 1) {
        for (let x = Math.max(0, Math.floor(rect.x)); x < Math.min(shot.width, Math.ceil(rect.x + rect.width)); x += 1) {
          const at = (y * shot.width + x) * 4, under = [shot.pixels[at], shot.pixels[at + 1], shot.pixels[at + 2]];
          worst = Math.min(worst, ratio([r, g, b].map((value, channel) => value * alpha + under[channel] * (1 - alpha)), under));
        }
      }
    }
    return { text: run.text, worst: Math.round(worst * 100) / 100, needs: run.large ? 3 : 4.5 };
  });
}
