import { COMPONENT_STATES } from "../../../shared/domain";
import { MAP_WIDTH, mapHeight, project, type MapView } from "./world";
import { textWidth } from "./text-width";

/** Where each region's pin and label card sit. The stylesheet carries one layout per band of widths of the map's own
 *  section, picked there by container queries, so each card is placed for the map exactly as wide as the reader's
 *  browser draws it. A card always touches its pin; its placement says on which side. Every band is checked at every
 *  width it covers: no card may come near another card or another region's pin, or leave the map. When the cards
 *  cannot all sit beside their pins that way, the band is keyed instead: numbered pins and a list under the map, so
 *  no pin is ever left unlabelled. */
export interface MapMarker { name: string; state: string; place: readonly [number, number] }

interface Pin { width: number; height: number; head: number }

/** The pin glyph (icons.ts: a 24 × 30 view box, its head centred 12.7 down) drawn into a box of this size whose
 *  bottom stands on the place; `head` is how far above the place the head's centre sits. */
function pin(width: number, height: number): Pin {
  const scale = Math.min(width / 24, height / 30);
  return { width, height, head: height - (height - 30 * scale) / 2 - 12.7 * scale };
}

export interface MapStyle {
  view: MapView;
  /** Widths of the map's section this style serves, in pixels: from inclusive, to exclusive. */
  from: number;
  to: number;
  pin: Pin;
  /** A keyed band's pins carry their number in the head. */
  numbered: Pin;
  card: { name: number; state: number; dot: number; padX: number; height: number };
  maxCards: number;
}

// Sizes mirror styles/regions.css. There every card has this fixed height and, as its max-width, the width estimated
// here, so no card is ever larger than the box this layout checked.
const MAP_MAX_WIDTH = 1060;
const NARROW_BELOW = 620;
const MAP_STYLES: readonly MapStyle[] = [
  { view: "narrow", from: 160, to: NARROW_BELOW, pin: pin(14, 19), numbered: pin(24, 30), card: { name: 12, state: 11, dot: 11, padX: 9, height: 40 }, maxCards: 6 },
  { view: "wide", from: NARROW_BELOW, to: MAP_MAX_WIDTH, pin: pin(18, 24), numbered: pin(24, 30), card: { name: 14, state: 12.5, dot: 13, padX: 14, height: 50 }, maxCards: 12 },
];

const BAND = 20;
const CARD_GAP = 2;
const PIN_GAP = 1;
const SEARCH_BUDGET = 2000;

const PLACEMENTS = ["r", "l", "t", "b", "ru", "rd", "lu", "ld", "tl", "tr", "bl", "br"] as const;
type Placement = (typeof PLACEMENTS)[number];

/** A card's top-left corner from its pin's place: pixels plus a share of the card's own width and height, exactly as
 *  the stylesheet's translate() writes it. */
function offset(placement: Placement, pin: Pin) {
  const side = pin.width / 2 + 4, above = -pin.height - 4, half = pin.width / 2;
  switch (placement) {
    case "r": return { x: side, kx: 0, y: -pin.head, ky: -0.5 };
    case "l": return { x: -side, kx: -1, y: -pin.head, ky: -0.5 };
    case "t": return { x: 0, kx: -0.5, y: above, ky: -1 };
    case "b": return { x: 0, kx: -0.5, y: 4, ky: 0 };
    case "ru": return { x: side, kx: 0, y: 8 - pin.head, ky: -1 };
    case "rd": return { x: side, kx: 0, y: -pin.head - 8, ky: 0 };
    case "lu": return { x: -side, kx: -1, y: 8 - pin.head, ky: -1 };
    case "ld": return { x: -side, kx: -1, y: -pin.head - 8, ky: 0 };
    case "tl": return { x: half, kx: -1, y: above, ky: -1 };
    case "tr": return { x: -half, kx: 0, y: above, ky: -1 };
    case "bl": return { x: half, kx: -1, y: 4, ky: 0 };
    case "br": return { x: -half, kx: 0, y: 4, ky: 0 };
  }
}

function translate(placement: Placement, pin: Pin) {
  const { x, kx, y, ky } = offset(placement, pin);
  const part = (pixels: number, share: number) => share === 0 ? `${+pixels.toFixed(2)}px` : pixels === 0 ? `${share * 100}%` : `calc(${+pixels.toFixed(2)}px + ${share * 100}%)`;
  return `translate(${part(x, kx)},${part(y, ky)})`;
}

/** Reserve every state label so an incident changes content without moving the map layout. */
function cardWidth(marker: MapMarker, style: MapStyle) {
  const { card } = style;
  return Math.max(textWidth(marker.name, card.name, 600), card.dot + Math.max(...COMPONENT_STATES.map(state => textWidth(state, card.state, 400)))) + 2 * card.padX + 2;
}

/** A box on a map m pixels wide: its left edge at x + dx·m, its top at y + dy·m. */
interface Box { x: number; dx: number; y: number; dy: number; width: number; height: number }

/** Whether two boxes come within `gap` of each other at any map width from low to high. Every edge moves linearly
 *  with the width, so the widths at which they do form one interval. */
function near(a: Box, b: Box, gap: number, low: number, high: number) {
  // Each condition holds where c + d·m < 0.
  const conditions = [
    [a.x - b.x - b.width - gap, a.dx - b.dx], [b.x - a.x - a.width - gap, b.dx - a.dx],
    [a.y - b.y - b.height - gap, a.dy - b.dy], [b.y - a.y - a.height - gap, b.dy - a.dy],
  ] as const;
  if (low === high) return conditions.every(([c, d]) => c + d * low < 0);
  let from = low, to = high;
  for (const [c, d] of conditions) {
    if (Math.abs(d) < 1e-12) {
      if (c >= 0) return false;
      continue;
    }
    if (d > 0) to = Math.min(to, -c / d);
    else from = Math.max(from, -c / d);
    if (from >= to) return false;
  }
  return true;
}

/** Whether a box stays on the map, `ratio` times as tall as it is wide, at every width from low to high. */
function inside(box: Box, ratio: number, low: number, high: number) {
  return [low, high].every((width) => {
    const left = box.x + box.dx * width, top = box.y + box.dy * width;
    return left >= 0 && left + box.width <= width && top >= 0 && top + box.height <= ratio * width;
  });
}

/** Pin places as shares of the map at the given width, kept on the map. A pin that would cover another takes the
 *  nearest free spot a whole pin away, sideways before up or down; as the map widens, pins only move further apart. */
function placePins(markers: MapMarker[], view: MapView, size: Pin, width: number) {
  const scale = width / MAP_WIDTH, height = scale * mapHeight(view), across = size.width + 2, down = size.height + 2;
  const steps: Array<[number, number]> = [];
  for (let column = -8; column <= 8; column += 1) for (let row = -3; row <= 3; row += 1) steps.push([column, row]);
  steps.sort((left, right) => Math.hypot(left[0] * across, left[1] * down * 1.25) - Math.hypot(right[0] * across, right[1] * down * 1.25));
  const spots: Array<{ x: number; y: number }> = [];
  for (const marker of markers) {
    const spot = project(view, marker.place);
    const at = ([column, row]: [number, number]) => ({
      x: Math.min(width - size.width / 2, Math.max(size.width / 2, spot.x * scale + column * across)),
      y: Math.min(height, Math.max(size.height, spot.y * scale + row * down)),
    });
    // A hair under a whole pin away counts as clear, so a pin one step off is never stepped again.
    const clear = (place: { x: number; y: number }) => spots.every((other) => Math.abs(other.x - place.x) >= across - 0.01 || Math.abs(other.y - place.y) >= size.height - 0.01);
    spots.push(steps.map(at).find(clear) ?? at([0, 0]));
  }
  return spots.map((spot) => ({ x: spot.x / width, y: spot.y / height }));
}

type Anchor = { x: number; y: number };

/** The first placement for every card, in PLACEMENTS order, that keeps all cards clear across the band; null when
 *  there is none within the search budget. */
function arrange(markers: MapMarker[], style: MapStyle, anchors: Anchor[], low: number, high: number) {
  const ratio = mapHeight(style.view) / MAP_WIDTH, size = style.pin;
  const pins = anchors.map((anchor) => ({ x: -size.width / 2, dx: anchor.x, y: -size.height, dy: anchor.y * ratio, width: size.width, height: size.height }));
  const options = markers.map((marker, index) => {
    const width = cardWidth(marker, style), height = style.card.height, anchor = anchors[index]!;
    return PLACEMENTS.flatMap((placement) => {
      const { x, kx, y, ky } = offset(placement, size);
      const box = { x: x + kx * width, dx: anchor.x, y: y + ky * height, dy: anchor.y * ratio, width, height };
      const clear = inside(box, ratio, low, high) && pins.every((other, at) => at === index || !near(box, other, PIN_GAP, low, high));
      return clear ? [{ placement, box }] : [];
    });
  });
  const chosen: Array<{ placement: Placement; box: Box }> = [];
  let budget = SEARCH_BUDGET;
  const visit = (index: number): boolean => {
    if (index === markers.length) return true;
    for (const option of options[index]!) {
      if ((budget -= 1) < 0) return false;
      if (chosen.some((card) => near(option.box, card.box, CARD_GAP, low, high))) continue;
      chosen.push(option);
      if (visit(index + 1)) return true;
      chosen.pop();
    }
    return false;
  };
  return visit(0) ? chosen.map((card) => card.placement) : null;
}

export interface MapBand { from: number; to: number; style: MapStyle; keyed: boolean; anchors: Anchor[]; placements: Placement[] }

function layoutBand(markers: MapMarker[], style: MapStyle, from: number, to: number): MapBand {
  // The map is as wide as its section, up to its maximum.
  const low = Math.min(from, MAP_MAX_WIDTH), high = Math.min(to, MAP_MAX_WIDTH);
  const anchors = placePins(markers, style.view, style.pin, low);
  const placements = markers.length > style.maxCards ? null : arrange(markers, style, anchors, low, high);
  if (placements) return { from, to, style, keyed: false, anchors, placements };
  return { from, to, style, keyed: true, anchors: placePins(markers, style.view, style.numbered, low), placements: [] };
}

/** Every band of section widths, narrowest first; the last is open-ended, where the map has stopped growing. A keyed
 *  band's pins only move apart as the map widens, so a run of keyed bands keeps its first band's pins while the map
 *  grows by up to a quarter: fewer rules, and no pin drifts far from its place. */
export function mapPlan(markers: MapMarker[]) {
  const bands: MapBand[] = [];
  for (const style of MAP_STYLES) {
    for (let from = style.from; from < style.to; from += BAND) bands.push(layoutBand(markers, style, from, Math.min(from + BAND, style.to)));
  }
  bands.push(layoutBand(markers, MAP_STYLES.at(-1)!, MAP_MAX_WIDTH, Infinity));
  const runs: MapBand[] = [];
  for (const band of bands) {
    const last = runs.at(-1);
    if (last?.keyed && band.keyed && last.style === band.style && band.to <= last.from * 1.25) last.to = band.to;
    else runs.push({ ...band });
  }
  return runs;
}

function condition(from: number, to: number) {
  const first = from === MAP_STYLES[0]!.from;
  if (first && to === Infinity) return "";
  if (first) return `(width < ${to}px)`;
  if (to === Infinity) return `(width >= ${from}px)`;
  return `(${from}px <= width < ${to}px)`;
}

function bandRules(band: MapBand) {
  const anchors = band.anchors.map((anchor, index) => `.rg-map .m${index}{left:${(anchor.x * 100).toFixed(3)}%;top:${(anchor.y * 100).toFixed(3)}%}`).join("");
  if (!band.keyed) return `${anchors}${band.placements.map((placement, index) => `.rg-map .rg-card.m${index}{transform:${translate(placement, band.style.pin)}}`).join("")}`;
  const { width, height } = band.style.numbered;
  return `${anchors}.rg-map .rg-card{display:none}.rg-map .rg-pin{width:${width}px;height:${height}px}.rg-map .rg-pin b{display:block}.rg-map .pin-icon circle{display:none}.rg-map .pin-icon path{stroke:#fff;stroke-width:1.5px}.rg-key{display:flex}`;
}

/** The plan as container-query rules on the map's section (named rg-map in styles/regions.css): each view's card
 *  widths, then each run of bands that share one layout. */
export function planStyles(markers: MapMarker[], bands: MapBand[]) {
  const widths = MAP_STYLES.map((style) => {
    const rules = markers.map((marker, index) => `.rg-map .rg-card.m${index}{max-width:${cardWidth(marker, style)}px}`).join("");
    return `@container rg-map ${style.from === MAP_STYLES[0]!.from ? `(width < ${style.to}px)` : `(width >= ${style.from}px)`}{${rules}}`;
  });
  const runs: Array<{ from: number; to: number; rules: string }> = [];
  for (const band of bands) {
    const rules = bandRules(band), last = runs.at(-1);
    if (last && last.rules === rules && last.to === band.from) last.to = band.to;
    else runs.push({ from: band.from, to: band.to, rules });
  }
  return [...widths, ...runs.map((run) => {
    const query = condition(run.from, run.to);
    return query ? `@container rg-map ${query}{${run.rules}}` : run.rules;
  })].join("");
}
