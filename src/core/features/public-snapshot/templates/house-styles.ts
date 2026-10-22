import type { HouseStyleMade } from "../../house-style/repository.ts";

/** The object at one visual size (the square root of its area), whatever size the model drew it. */
function fit(made: HouseStyleMade, visual: number, maxWidth: number, maxHeight: number) {
  const { width, height } = made.picture;
  const scale = Math.min(visual / Math.sqrt(width * height), maxWidth / width, maxHeight / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** The account's palette as Lamp's public tokens, and where its object and light sit, as stylesheet rules: the public
 *  page's CSP refuses inline styles. Every text colour was checked against the paper and the lit stone when the
 *  house style was made (house-style/palette.ts). */
export function houseStyles(made: HouseStyleMade) {
  const { palette } = made;
  const tokens = `:root,.tpl-house{--stone:${palette.stone};--paper:${palette.paper};--ink:${palette.ink};--ink-2:${palette.inkSoft};--ink-3:${palette.inkSoft};--on-ink:${palette.onInk};--light:${palette.light};--line:color-mix(in srgb,${palette.ink} 13%,transparent);--line-strong:color-mix(in srgb,${palette.ink} 20%,transparent);--card:color-mix(in srgb,#fff 55%,${palette.paper});--cell-ok:${palette.ink};--no-data:color-mix(in srgb,${palette.ink} 14%,transparent)}`;
  const wide = fit(made, 196, 400, 250), narrow = fit(made, 132, 260, 172);
  const hanging = made.subject.placement === "hanging";
  const drop = hanging ? 48 : 96, dropNarrow = hanging ? 6 : 10;
  const cord = made.picture.cordX === null ? "" : `--cord-x:${made.picture.cordX.toFixed(3)};`;
  const geometry = `.house-moment{--mw:${wide.width}px;--mh:${wide.height}px;--drop:${drop}px;--light-y:${drop + Math.round(wide.height * 0.8)}px;--mw-sm:${narrow.width}px;--mh-sm:${narrow.height}px;--drop-sm:${dropNarrow}px;--light-y-sm:${dropNarrow + Math.round(narrow.height * 0.8)}px;${cord}}`;
  return `${tokens}${geometry}`;
}
