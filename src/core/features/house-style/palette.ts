/** A house palette made from the business's own colours: the site's accent sets the hue of every neutral, the site's
 *  own dark colour (or a deep shade of the accent) is the ink, and every text colour is checked against WCAG AA on
 *  the paper, the stone and the stone as the house light falls on it. Runtime-neutral: Workers and Node. */

type Lch = { l: number; c: number; h: number };

const toLinear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const toGamma = (value: number) => value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;

function rgb(hex: string) {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
}

const hexOf = (channels: number[]) => `#${channels.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, "0")).join("")}`;

export function oklch(hex: string): Lch {
  const [r, g, b] = rgb(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function linearRgb({ l: L, c, h }: Lch) {
  const A = c * Math.cos((h * Math.PI) / 180), B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

/** OKLCH to #rrggbb, lowering chroma until the colour fits sRGB. */
export function hexFrom(colour: Lch) {
  let channels = linearRgb(colour);
  for (let c = colour.c; channels.some((value) => value < -1e-4 || value > 1 + 1e-4) && c > 0; c -= 0.002) channels = linearRgb({ ...colour, c: Math.max(0, c) });
  return hexOf(channels.map((value) => toGamma(Math.min(1, Math.max(0, value)))));
}

export function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio. */
export function contrast(first: string, second: string) {
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** `over` laid on `under` at `alpha`, composited in sRGB as the browser paints a translucent gradient. */
function over(under: string, overColour: string, alpha: number) {
  const below = rgb(under), above = rgb(overColour);
  return hexOf(below.map((value, index) => value * (1 - alpha) + above[index]! * alpha));
}

/** The moment's warm light, the same for every account, and the amber it warms to when something is wrong. */
export const HOUSE_LIGHT = "#f6d7a0";
export const HOUSE_AMBER_LIGHT = "#f4c463";
/** The strongest the light shows over the stone anywhere on the page (house.css draws it at 80% to 92% at its
 *  centre); every lit sample up to this is checked. */
const LIGHT_PEAK = 0.92;

/** The stone as the page shows it under the house light in both states, from no light to its brightest. The light
 *  can lower the stone's luminance as well as raise it (Sentry's lavender under amber, L18), so text is checked on
 *  every step, not only on plain stone. */
export function litStones(stone: string) {
  const steps = 24;
  return [HOUSE_LIGHT, HOUSE_AMBER_LIGHT].flatMap((light) => Array.from({ length: steps + 1 }, (_, step) => over(stone, light, (LIGHT_PEAK * step) / steps)));
}

/** Darkens (or lightens) a text colour along its own hue until it reaches the ratio on every background. */
function readable(text: string, backgrounds: string[], ratio: number) {
  const start = oklch(text);
  const light = backgrounds.every((background) => luminance(background) > 0.18);
  for (let step = 0; step <= 60; step += 1) {
    const candidate = hexFrom({ ...start, l: Math.min(0.98, Math.max(0.02, start.l + (light ? -1 : 1) * step * 0.01)) });
    if (backgrounds.every((background) => contrast(candidate, background) >= ratio)) return candidate;
  }
  return light ? "#000000" : "#ffffff";
}

export interface HousePalette {
  /** The site's accent as read; null when the site gave none. */
  accent: string | null;
  /** Headline, body text and the Subscribe button. */
  ink: string;
  /** Secondary text: times, notes, the uptime figure. */
  inkSoft: string;
  /** Text on an ink button. */
  onInk: string;
  /** The moment band: the picture's background and the band it sits in. */
  stone: string;
  /** The history and subscribe band below. */
  paper: string;
  /** The moment's warm light, the same for every account. */
  light: string;
  /** Where each colour came from, said in Settings. */
  from: { hue: "accent" | "lamp"; ink: "site" | "accent" | "lamp" };
}

/** Lamp's own stone hue and deep green ink (run-lamp.com's #17231c), used when a site gives no accent. */
const LAMP_HUE = { h: 92, c: 0.13 };
const LAMP_INK = "#17231c";
/** Ink reads at AAA; soft ink keeps a margin over AA's 4.5:1, so a measured run never lands a hair under it. */
const INK_RATIO = 7;
const SOFT_INK_RATIO = 4.6;

/** The account's palette, from the site's accent and its other colours (most confident first, as the reader returns them). */
export function housePalette(accent: string | null, colours: string[]): HousePalette {
  const tone = accent ? oklch(accent) : null;
  const hue = tone && tone.c > 0.02 ? { h: tone.h, c: tone.c } : LAMP_HUE;
  const tint = Math.min(0.032, Math.max(0.014, hue.c * 0.2));
  const stone = hexFrom({ l: 0.835, c: tint, h: hue.h });
  const paper = hexFrom({ l: 0.915, c: tint * 0.65, h: hue.h });
  const backgrounds = [paper, ...litStones(stone)];
  // The site's own near-black wins when it has one, as Lamp's deep green is its site's #17231c.
  const siteDark = colours.find((colour) => oklch(colour).l < 0.34);
  const inkSeed = siteDark ?? (tone && tone.c > 0.02 ? hexFrom({ l: 0.28, c: Math.min(0.07, hue.c * 0.45), h: hue.h }) : LAMP_INK);
  const ink = readable(inkSeed, backgrounds, INK_RATIO);
  const softSeed = hexFrom({ ...oklch(ink), l: oklch(ink).l + 0.2 });
  const inkSoft = readable(softSeed, backgrounds, SOFT_INK_RATIO);
  return {
    accent,
    ink,
    inkSoft,
    onInk: contrast("#ffffff", ink) >= contrast(stone, ink) ? "#ffffff" : stone,
    stone,
    paper,
    light: HOUSE_LIGHT,
    from: { hue: tone && tone.c > 0.02 ? "accent" : "lamp", ink: siteDark ? "site" : tone ? "accent" : "lamp" },
  };
}

const HUES: Array<[number, string]> = [[20, "red"], [45, "red-orange"], [65, "orange"], [85, "amber"], [105, "yellow"], [130, "olive"], [155, "green"], [185, "teal"], [215, "cyan"], [245, "blue"], [275, "indigo"], [305, "violet"], [335, "purple"], [355, "pink"], [380, "red"]];

/** A few plain words for a colour, said beside its hex code in the image prompt. */
export function colourWords(hex: string) {
  const { l, c, h } = oklch(hex);
  const name = c < 0.012 ? "grey" : HUES.find(([limit]) => h < limit)![1];
  const depth = l < 0.3 ? "deep" : l < 0.5 ? "dark" : l < 0.7 ? "mid" : l < 0.85 ? "light" : "pale";
  const strength = c < 0.012 ? "" : c < 0.04 ? "greyish " : c < 0.1 ? "muted " : "vivid ";
  return `${depth} ${strength}${name}`.replace("greyish grey", "grey");
}
