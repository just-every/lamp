// The landing page document head. Every file it names is bundled by Vite into /app-assets/; nothing is loaded from elsewhere.
// The font is imported with plain `?url` so the preload and fonts.css name one URL in development too; it is far
// above Vite's inline limit, so it is never a data: URL. The small icons need `no-inline`. The icons are mark 18's
// (scripts/lamp-site/mark.mjs): the SVG favicon, which shows the mark's reverse when the browser's chrome is dark, the
// 32 and 16px PNGs for browsers without SVG favicons, and the touch icon. The intro's three sprites are preloaded with
// the same AVIF srcset and sizes as their <source>s, so each loads once, before first paint needs it.
import { lampFontPreload, lampIconLinks } from './head-shared';
import { LAMP_SIZES, bulbGlow, lampOff, lampOn } from './sprites';

export const lampTitle = 'Lamp — When something breaks, turn the light on.';
export const lampDescription = 'Lamp is the status page that never leaves your customers in the dark: when something breaks, turn the light on and tell them what is happening, clearly and quickly.';

const spritePreload = (srcSet: string) => ({ rel: 'preload', as: 'image', type: 'image/avif', imageSrcSet: srcSet, imageSizes: LAMP_SIZES, fetchPriority: 'high' as const });

export const lampHead = () => ({
  meta: [
    { title: lampTitle },
    { name: 'description', content: lampDescription },
  ],
  links: [
    lampFontPreload,
    spritePreload(lampOff.avif),
    spritePreload(lampOn.avif),
    spritePreload(bulbGlow.avif),
    ...lampIconLinks,
  ],
});
