// The operator documents' icon: mark 18 at 32px, the landing's own file (src/site/lamp/art, written by scripts/lamp-site/mark.mjs).
import icon32Url from '../../../../site/lamp/art/lamp-badge-32.png?url&no-inline';
import interUrl from '../../../../site/lamp/fonts/inter-latin.woff2?url';

export const appIconLinks = [
  { rel: 'icon', href: icon32Url, type: 'image/png', sizes: '32x32' },
  { rel: 'preload', href: interUrl, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' as const },
];
