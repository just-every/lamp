// The pendant lamp's sprites, copied from the registered sprite set by scripts/lamp-site/intro.mjs (see
// asset-provenance.json). lamp-off, lamp-on and bulb-glow share one square 1560x1560 canvas, so stacked in one box
// they register exactly; each ships 720 and 1200 square in AVIF with a WebP fallback. The intro, section 4 and the
// close all draw these same files.
import lampOff720Avif from './art/lamp-off-720.avif?url&no-inline';
import lampOff1200Avif from './art/lamp-off-1200.avif?url&no-inline';
import lampOff720Webp from './art/lamp-off-720.webp?url&no-inline';
import lampOff1200Webp from './art/lamp-off-1200.webp?url&no-inline';
import lampOn720Avif from './art/lamp-on-720.avif?url&no-inline';
import lampOn1200Avif from './art/lamp-on-1200.avif?url&no-inline';
import lampOn720Webp from './art/lamp-on-720.webp?url&no-inline';
import lampOn1200Webp from './art/lamp-on-1200.webp?url&no-inline';
import glow720Avif from './art/bulb-glow-720.avif?url&no-inline';
import glow1200Avif from './art/bulb-glow-1200.avif?url&no-inline';
import glow720Webp from './art/bulb-glow-720.webp?url&no-inline';
import glow1200Webp from './art/bulb-glow-1200.webp?url&no-inline';

export type Sprite = { avif: string; webp: string; fallback: string };
const sprite = (avif720: string, avif1200: string, webp720: string, webp1200: string): Sprite => ({
  avif: `${avif720} 720w, ${avif1200} 1200w`,
  webp: `${webp720} 720w, ${webp1200} 1200w`,
  fallback: webp720,
});

// The intro lamp's rendered width (intro.css): 360 units of the 1536 design from 1024px, then clamped widths.
export const LAMP_SIZES = '(min-width: 1024px) calc(min(100vw, 1536px) * 0.2344), (min-width: 600px) clamp(240px, 34vw, 330px), clamp(200px, 54vw, 260px)';
export const lampOff = sprite(lampOff720Avif, lampOff1200Avif, lampOff720Webp, lampOff1200Webp);
export const lampOn = sprite(lampOn720Avif, lampOn1200Avif, lampOn720Webp, lampOn1200Webp);
export const bulbGlow = sprite(glow720Avif, glow1200Avif, glow720Webp, glow1200Webp);
