// Copies the landing page's brand mark into src/site/lamp/art/, renders its icons, and records them in the `mark` and
// `icons` sections of src/site/lamp/asset-provenance.json:
//
//   pnpm run lamp-site:mark <badge directory>
//
// The mark is the one the owner chose on 9 October 2026 from 23 numbered variations: mark 18, "Circle: dome above,
// light below". The directory holds it as badge-1.svg (colour, for light grounds) and badge-1-reverse.svg (for dark
// grounds), each on a 64x64 viewBox. The page draws badge-1.svg; the SVG favicon is both, the reverse shown when the
// browser's own chrome is dark; the PNG favicons and the touch icon are rendered from badge-1.svg in Chromium.
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openPixels, sha256 } from "./pixels.mjs";

const [source] = process.argv.slice(2).filter((argument) => argument !== "--");
if (!source) throw new Error("Usage: pnpm run lamp-site:mark <badge directory>");
const site = fileURLToPath(new URL("../../src/site/lamp/", import.meta.url));
const PAPER = "#f8f6f0";
const COLOUR = "badge-1.svg";
const REVERSE = "badge-1-reverse.svg";
const CHOSEN = "2026-10-09";

const fileRecord = async (from) => ({ file: from, sha256: sha256(await readFile(join(source, from))) });
const record = async (path, origin, from, extra = {}) => {
  const bytes = await readFile(join(site, path));
  return { sha256: sha256(bytes), bytes: bytes.length, origin, source: await fileRecord(from), ...extra };
};

// The SVG favicon: the colour mark, and under a dark colour scheme the reverse, both drawn from the source files.
const inner = (svg) => {
  const body = svg.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/);
  if (!body) throw new Error("not an SVG document");
  return body[1].trim().replace(/\s*\n\s*/g, "");
};
const colourSvg = await readFile(join(source, COLOUR), "utf8");
const reverseSvg = await readFile(join(source, REVERSE), "utf8");
for (const svg of [colourSvg, reverseSvg]) if (!/viewBox="0 0 64 64"/.test(svg) || /<image\b|href=|data:/.test(svg)) throw new Error("the mark must be plain 64x64 vector shapes");
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">`
  + `<style>.r{display:none}@media (prefers-color-scheme:dark){.c{display:none}.r{display:inline}}</style>`
  + `<g class="c">${inner(colourSvg)}</g><g class="r">${inner(reverseSvg)}</g></svg>\n`;

await copyFile(join(source, COLOUR), join(site, "art/lamp-badge.svg"));
await writeFile(join(site, "art/lamp-badge-icon.svg"), favicon);
const pixels = await openPixels();
try {
  for (const size of [16, 32]) await writeFile(join(site, `art/lamp-badge-${size}.png`), await pixels.icon(colourSvg, { size, mark: size, paper: "transparent", radius: 0 }));
  await writeFile(join(site, "art/lamp-badge-touch.png"), await pixels.icon(colourSvg, { size: 180, mark: 140, paper: PAPER, radius: 0 }));
} finally {
  await pixels.close();
}

const mark = {
  made: CHOSEN,
  chosen: "The owner chose mark 18 of 23 numbered variations (modern/logo/all-marks-1.png, all-marks-2.png): \"Circle: dome above, light below\", replacing the header's dome-on-a-cord mark.",
  origin: "Hand-written SVG on a 64x64 viewBox: an ink half-disc dome above, a warm amber lower half-disc, and a pale bulb arc at the dome's rim (modern/logo/badge/badge-1.svg).",
  files: { "art/lamp-badge.svg": await record("art/lamp-badge.svg", "the header and footer mark, mark 18", COLOUR) },
};
const icons = {
  made: CHOSEN,
  origin: "Made from mark 18 by scripts/lamp-site/mark.mjs: the SVG favicon combines badge-1.svg with badge-1-reverse.svg for dark browser chrome; the PNGs are badge-1.svg rendered in Playwright Chromium.",
  files: {
    "art/lamp-badge-icon.svg": await record("art/lamp-badge-icon.svg", "the SVG favicon: mark 18, its reverse under prefers-color-scheme: dark", COLOUR, { reverse: await fileRecord(REVERSE) }),
    "art/lamp-badge-16.png": await record("art/lamp-badge-16.png", "the PNG favicon, mark 18 at 16px on transparent", COLOUR),
    "art/lamp-badge-32.png": await record("art/lamp-badge-32.png", "the PNG favicon, mark 18 at 32px on transparent", COLOUR),
    "art/lamp-badge-touch.png": await record("art/lamp-badge-touch.png", `the touch icon, mark 18 at 140px on opaque ${PAPER}, 180px`, COLOUR),
  },
};

const provenancePath = join(site, "asset-provenance.json");
const { design, licence, fonts, intro } = JSON.parse(await readFile(provenancePath, "utf8"));
await writeFile(provenancePath, `${JSON.stringify({ design, licence, fonts, intro, mark, icons }, null, 2)}\n`);
console.log(`Copied mark 18 and rendered its four icons from ${resolve(source)}, and recorded them in src/site/lamp/asset-provenance.json.`);
