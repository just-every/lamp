// Copies the landing page's lamp sprites into src/site/lamp/art/ and records their origin in the `intro` section of
// src/site/lamp/asset-provenance.json (the brand mark and its icons are scripts/lamp-site/mark.mjs's):
//
//   pnpm run lamp-site:intro <sprite set directory>
//
// The directory holds the registered masters (lamp-off.png, lamp-on.png, bulb-glow.png) on one 1560x1560 canvas,
// their delivery copies under delivery/ (1200 and 720 wide, AVIF and WebP), registration.json, and under gen/ the
// prompt of each generation the masters came from.
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./pixels.mjs";

const [source] = process.argv.slice(2).filter((argument) => argument !== "--");
if (!source) throw new Error("Usage: pnpm run lamp-site:intro <sprite set directory>");
const site = fileURLToPath(new URL("../../src/site/lamp/", import.meta.url));

// Published name -> [delivery copy, master it was encoded from, what it is].
const SPRITES = {};
for (const [name, origin] of [
  ["lamp-off", "the pendant lamp, unlit"],
  ["lamp-on", "the pendant lamp, lit"],
  ["bulb-glow", "the bulb's soft warm glow (procedural, not image-model art)"],
]) {
  for (const width of [720, 1200]) for (const format of ["avif", "webp"]) {
    SPRITES[`art/${name}-${width}.${format}`] = [`delivery/${name}-${width}.${format}`, `${name}.png`, `${origin}, ${width}px square`];
  }
}

const record = async (path, origin, from) => {
  const bytes = await readFile(join(site, path));
  return { sha256: sha256(bytes), bytes: bytes.length, origin, source: { file: from, sha256: sha256(await readFile(join(source, from))) } };
};
const files = {};
for (const [path, [from, master, origin]] of Object.entries(SPRITES)) {
  await copyFile(join(source, from), join(site, path));
  files[path] = await record(path, origin, master);
}

// Each prompt is recorded by its file in the sprite set and that file's hash.
const prompt = async (run) => ({ file: `gen/${run}/prompt.txt`, sha256: sha256(await readFile(join(source, "gen", run, "prompt.txt"))) });
const registration = JSON.parse(await readFile(join(source, "registration.json"), "utf8"));
const intro = {
  made: "2026-10-09",
  generator: registration.provenance.generator,
  composition: `${registration.provenance.compose} ${registration.provenance.finish} The lit inner shade of lamp-on was then graded toward design C's #fed587-#fedb8f (grade.py: each channel scaled by C's gold over the render's, weighted by saturation, only where lit and unlit differ; alpha untouched), and every delivery copy re-encoded as the art track encodes them (deliver.mjs: Lanczos, WebP q90 with full-quality alpha, AVIF q68 4:4:4). bulb-glow is a procedural radial glow on the same canvas.`,
  references: ["owner-approved design C (12ui-modern/approved-C.png)", "C's lamp at 3x (refs/c-lamp-3x.png)"],
  prompts: {
    "lamp-on (lit base, gen/on-b): a modern matte dark-green dome pendant as in design C, lit, on a transparent canvas": await prompt("on-b"),
    "lamp-off (edit of the lit base, gen/dark-b2): the same lamp switched off, only the bulb and the inside of the shade changed": await prompt("dark-b2"),
  },
  registration: {
    canvas: registration.canvas, cordX: registration.cord.attachTop.x, cordLeft: registration.cord.left, cordWidth: registration.cord.width,
    gripTopY: registration.cordGrip.topY, rimTips: registration.shade.rimTips, rimEllipse: registration.shade.rimEllipse,
    bulbCentre: registration.bulb.centre, bulbBottomY: registration.bulb.bottomY, fractions: registration.fractions,
  },
  files,
};
const provenancePath = join(site, "asset-provenance.json");
const { design, licence, fonts, mark, icons } = JSON.parse(await readFile(provenancePath, "utf8"));
await writeFile(provenancePath, `${JSON.stringify({ design, licence, fonts, intro, mark, icons }, null, 2)}\n`);
console.log(`Copied ${Object.keys(files).length} sprites from ${resolve(source)} and recorded them in src/site/lamp/asset-provenance.json.`);
