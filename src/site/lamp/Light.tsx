import { LAMP_SIZES, bulbGlow } from './sprites';
import './light.css';

// The lamp's light: a broad warm pool falling from under the shade, and the glow around the bulb. They share one
// wrapper, so the light leaves with its lamp during the scroll handoff and never glows without a source.
export function Light() {
  return <span className="lamp-light">
    <span className="lamp-cone" />
    <picture className="lamp-glow">
      <source type="image/avif" srcSet={bulbGlow.avif} sizes={LAMP_SIZES} />
      <img src={bulbGlow.fallback} srcSet={bulbGlow.webp} sizes={LAMP_SIZES} alt="" width="1560" height="1560" />
    </picture>
  </span>;
}
