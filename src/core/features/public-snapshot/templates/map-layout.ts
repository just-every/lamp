import { MAP_WIDTH, mapHeight, project, type MapView } from "./world";

/** Where each region's pin and label card sit, worked out once per page width tier. A card always touches its pin:
 *  its placement says on which side, in pixels from the pin tip, so it stays beside the pin at any wider screen.
 *  When the cards cannot all sit beside their pins without covering one another, the tier is keyed instead:
 *  numbered pins and a list under the map, so no pin is ever left unlabelled. */
export interface MapTier { name: "large" | "medium" | "narrow"; view: MapView; width: number; pin: { width: number; height: number; head: number }; card: { name: number; state: number; padX: number; height: number }; maxCards: number }

export const MAP_TIERS: readonly MapTier[] = [
  { name: "large", view: "wide", width: 1040, pin: { width: 18, height: 24, head: 15 }, card: { name: 14, state: 12.5, padX: 14, height: 46 }, maxCards: 12 },
  { name: "medium", view: "wide", width: 600, pin: { width: 18, height: 24, head: 15 }, card: { name: 14, state: 12.5, padX: 14, height: 46 }, maxCards: 8 },
  { name: "narrow", view: "narrow", width: 340, pin: { width: 14, height: 19, head: 12 }, card: { name: 12, state: 11, padX: 9, height: 36 }, maxCards: 4 },
];

export const PLACEMENTS = ["r", "l", "t", "b", "ru", "rd", "lu", "ld", "tl", "tr", "bl", "br"] as const;
export type Placement = (typeof PLACEMENTS)[number];

interface Box { left: number; top: number; width: number; height: number }

/** A card's top-left corner from the pin tip, in pixels, for a card of the given size. */
export function placementOffset(placement: Placement, tier: MapTier, width: number, height: number) {
  const { pin } = tier;
  const right = pin.width / 2 + 4, left = -pin.width / 2 - 4 - width, middle = -pin.head - height / 2;
  switch (placement) {
    case "r": return { x: right, y: middle };
    case "l": return { x: left, y: middle };
    case "t": return { x: -width / 2, y: -pin.height - 4 - height };
    case "b": return { x: -width / 2, y: 4 };
    case "ru": return { x: right, y: -pin.head - height + 8 };
    case "rd": return { x: right, y: -pin.head - 8 };
    case "lu": return { x: left, y: -pin.head - height + 8 };
    case "ld": return { x: left, y: -pin.head - 8 };
    case "tl": return { x: -width + pin.width / 2, y: -pin.height - 4 - height };
    case "tr": return { x: -pin.width / 2, y: -pin.height - 4 - height };
    case "bl": return { x: -width + pin.width / 2, y: 4 };
    case "br": return { x: -pin.width / 2, y: 4 };
  }
}

function overlap(a: Box, b: Box) {
  const x = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const y = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return x > 0 && y > 0 ? x * y : 0;
}

function outside(box: Box, width: number, height: number) {
  const inside = overlap(box, { left: 0, top: 0, width, height });
  return box.width * box.height - inside;
}

export interface MapMarker { name: string; state: string; place: readonly [number, number] }
export interface PlacedTier { tier: MapTier; keyed: boolean; anchors: Array<{ x: number; y: number }>; placements: Placement[] }

export function cardSize(marker: MapMarker, tier: MapTier) {
  // Inter's average advance is about 0.6em at weight 600 and 0.56em at 400; err wide so estimates never under-run.
  const name = marker.name.length * tier.card.name * 0.62;
  const state = marker.state.length * tier.card.state * 0.58 + tier.card.state + 6;
  return { width: Math.ceil(Math.max(name, state) + tier.card.padX * 2), height: tier.card.height };
}

export function layoutTier(markers: MapMarker[], tier: MapTier): PlacedTier {
  const width = tier.width, height = (tier.width / MAP_WIDTH) * mapHeight(tier.view);
  const scale = tier.width / MAP_WIDTH;
  // Pins that would sit on top of each other step aside by a pin's width.
  const pins: Array<{ x: number; y: number }> = [];
  for (const marker of markers) {
    const spot = project(tier.view, marker.place);
    let x = spot.x * scale;
    const y = spot.y * scale;
    for (let step = 1; pins.some((pin) => Math.abs(pin.x - x) < tier.pin.width + 2 && Math.abs(pin.y - y) < tier.pin.height); step += 1) {
      x = spot.x * scale + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * (tier.pin.width + 2);
    }
    pins.push({ x: Math.min(width - tier.pin.width / 2, Math.max(tier.pin.width / 2, x)), y: Math.max(tier.pin.height, y) });
  }
  const pinBoxes = pins.map((pin) => ({ left: pin.x - tier.pin.width / 2, top: pin.y - tier.pin.height, width: tier.pin.width, height: tier.pin.height }));
  const cards: Box[] = [];
  const placements: Placement[] = [];
  let crowded = markers.length > tier.maxCards;
  markers.forEach((marker, index) => {
    const size = cardSize(marker, tier);
    let best: { placement: Placement; box: Box; penalty: number; score: number } | null = null;
    PLACEMENTS.forEach((placement, rank) => {
      const offset = placementOffset(placement, tier, size.width, size.height);
      const box = { left: pins[index]!.x + offset.x, top: pins[index]!.y + offset.y, ...size };
      const penalty = cards.reduce((sum, card) => sum + overlap(box, card) * 10, 0)
        + pinBoxes.reduce((sum, pin, other) => sum + (other === index ? 0 : overlap(box, pin) * 6), 0)
        + outside(box, width, height) * 8;
      if (!best || penalty + rank < best.score) best = { placement, box, penalty, score: penalty + rank };
    });
    const chosen = best!;
    // A few square pixels are within the error of the width estimate; more means two labels collide.
    if (chosen.penalty > 60) crowded = true;
    cards.push(chosen.box);
    placements.push(chosen.placement);
  });
  return { tier, keyed: crowded, anchors: pins.map((pin) => ({ x: (pin.x / width) * 100, y: (pin.y / height) * 100 })), placements };
}
