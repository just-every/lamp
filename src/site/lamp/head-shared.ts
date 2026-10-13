// What every Lamp site document shares in its head: the font's preload and the icons, all bundled into /app-assets/. The
// font is imported with plain `?url` so the preload and fonts.css name one URL in development too; the small icons need
// `no-inline`. The landing page's head (head.ts) adds its sprites; the docs pages (src/site/docs) use these alone.
import sansUrl from './fonts/inter-latin.woff2?url';
import iconSvgUrl from './art/lamp-badge-icon.svg?url&no-inline';
import icon32Url from './art/lamp-badge-32.png?url&no-inline';
import icon16Url from './art/lamp-badge-16.png?url&no-inline';
import touchIconUrl from './art/lamp-badge-touch.png?url&no-inline';

export const lampFontPreload = { rel: 'preload', href: sansUrl, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' as const };
export const lampIconLinks = [
  { rel: 'icon', href: iconSvgUrl, type: 'image/svg+xml', sizes: 'any' },
  { rel: 'icon', href: icon32Url, type: 'image/png', sizes: '32x32' },
  { rel: 'icon', href: icon16Url, type: 'image/png', sizes: '16x16' },
  { rel: 'apple-touch-icon', href: touchIconUrl },
];
