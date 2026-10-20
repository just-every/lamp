/** #rgb, #rrggbb, #rrggbbaa and rgb()/rgba() to lowercase #rrggbb; anything else is null. */
export function toHex(value: string | null | undefined): string | null {
  const text = value?.trim().toLowerCase() ?? "";
  const hex = text.match(/^#([0-9a-f]{3,8})$/)?.[1];
  if (hex && (hex.length === 3 || hex.length === 4)) return `#${[...hex.slice(0, 3)].map((digit) => digit + digit).join("")}`;
  if (hex && (hex.length === 6 || hex.length === 8)) return `#${hex.slice(0, 6)}`;
  const rgb = text.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/);
  if (rgb) {
    const channels = rgb.slice(1, 4).map(Number);
    if (channels.every((channel) => channel <= 255)) return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

/** Saturated and mid-light enough to carry buttons and links: not a white, black or grey. */
export function isBrandColour(hex: string) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  return saturation >= 0.35 && lightness >= 0.2 && lightness <= 0.75;
}

/** Colours an SVG paints with, most used first. */
export function svgColours(svg: string): string[] {
  const counts = new Map<string, number>();
  for (const match of svg.matchAll(/(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))/gi)) {
    const hex = toHex(match[1]);
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
}

/** Values of CSS custom properties whose names say brand, primary or accent. */
export function cssBrandColours(styles: string[]): string[] {
  const found: string[] = [];
  for (const style of styles) {
    for (const match of style.matchAll(/--[\w-]*(?:brand|primary|accent)[\w-]*\s*:\s*([^;}\n]+)/gi)) {
      const hex = toHex(match[1]);
      if (hex) found.push(hex);
    }
  }
  return found;
}
