import { bulbGlow, lampOn } from '../sprites';
import './static-lamp.css';

// The pendant, lit and still: the intro's own lit drawing and glow, so it costs no new request. Section 3 hangs it
// over plate D on the dark band and the close over its headline. Below the fold, so it loads lazily; decorative.
const SIZES = '(min-width: 1024px) calc(min(100vw, 1536px) * 285 / 1536), 197px';

export function StaticLamp({ className }: { className: string }) {
  return <div className={`lamp-static-lamp ${className}`} aria-hidden="true">
    <picture className="lamp-static-lamp__layer">
      <source type="image/avif" srcSet={bulbGlow.avif} sizes={SIZES} />
      <img src={bulbGlow.fallback} srcSet={bulbGlow.webp} sizes={SIZES} alt="" width="1560" height="1560" loading="lazy" decoding="async" />
    </picture>
    <picture className="lamp-static-lamp__layer">
      <source type="image/avif" srcSet={lampOn.avif} sizes={SIZES} />
      <img src={lampOn.fallback} srcSet={lampOn.webp} sizes={SIZES} alt="" width="1560" height="1560" loading="lazy" decoding="async" />
    </picture>
  </div>;
}
